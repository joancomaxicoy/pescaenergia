const logger = require('../utils/logger');
const { Pool } = require('pg');
const BalancEnergeticService = require('./balancEnergeticService');

const TOTAL_METRIC_MAP = {
  SHELLY_SHELLYEM: 'emeter_0_total_avg',
  POOL: 'emeter_0_total_avg',
  SHELLY_ANNOUNCE: 'emeter_0_total_avg',
  PLUG: 'events_rpc_params_switch:0_aenergy_total_avg',
};

function roundToQuarterHour(date) {
  const tz = process.env.USERS_TIMEZONE || 'Europe/Madrid';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false
  }).formatToParts(date);
  const get = (type) => parseInt(parts.find(p => p.type === type).value);
  const hour = get('hour') % 24;
  const minute = Math.floor(get('minute') / 15) * 15;
  const localAsUtc = Date.UTC(get('year'), get('month') - 1, get('day'), hour, minute, 0);
  const tempDate = new Date(localAsUtc);
  const offsetMs = new Date(tempDate.toLocaleString('en-US', { timeZone: tz })) -
                   new Date(tempDate.toLocaleString('en-US', { timeZone: 'UTC' }));
  return new Date(localAsUtc - offsetMs);
}

class ConsumptionService {
  constructor() {
    this.cronJob = null;
    this.pool = new Pool({ connectionString: process.env.DATABASE_URL });
    this.balancService = new BalancEnergeticService();
  }

  async start() {
    const cron = require('node-cron');
    this.cronJob = cron.schedule('0,15,30,45 * * * *', () => {
      this.process().catch(err => {
        logger.error('Error en ConsumptionService', { error: err.message });
      });
    });
    logger.info('ConsumptionService iniciat (cron: cada ¼ d\'hora)');
  }

  stop() {
    if (this.cronJob) {
      this.cronJob.stop();
      this.cronJob = null;
    }
    if (this.pool) {
      this.pool.end();
    }
    logger.info('ConsumptionService aturat');
  }

  async process() {
    const startTime = Date.now();
    const devices = await this.getDevices();

    let inserted = 0;
    let skipped = 0;
    let errors = 0;

    for (const device of devices) {
      try {
        const result = await this.processDevice(device);
        if (result) inserted++;
        else skipped++;
      } catch (err) {
        errors++;
        logger.error('Error processant dispositiu', {
          deviceId: device.device_id,
          deviceName: device.device_name,
          error: err.message,
        });
      }
    }

    const elapsed = Date.now() - startTime;
    logger.info('ConsumptionService cicle completat', {
      devices: devices.length,
      inserted,
      skipped,
      errors,
      elapsed: `${elapsed}ms`,
    });

    await this.balancService.process().catch(err => {
      logger.error('Error processant BalancEnergeticService des de ConsumptionService', {
        error: err.message,
      });
    });
  }

  async getDevices() {
    const result = await this.pool.query(`
      SELECT
        d.id::text AS device_id,
        d.device_name,
        d.device_type,
        d.shelly_device_id,
        u.cups
      FROM devices d
      JOIN users u ON d.user_id = u.id::text
      WHERE d.device_type IN ('SHELLY_SHELLYEM', 'POOL', 'SHELLY_ANNOUNCE', 'PLUG')
      ORDER BY u.cups, d.device_name
    `);
    return result.rows;
  }

  async processDevice(device) {
    const metricName = TOTAL_METRIC_MAP[device.device_type];
    if (!metricName) return false;

    // Get latest energy_metrics entry (current total)
    const currentResult = await this.pool.query(
      `SELECT timestamp, value
       FROM energy_metrics
       WHERE device_id = $1 AND metric_name = $2
       ORDER BY timestamp DESC LIMIT 1`,
      [device.device_id, metricName]
    );
    if (currentResult.rows.length < 1) return false;
    const current = currentResult.rows[0];

    // Round cron execution time to quarter hour (not energy_metrics timestamp)
    const ts = roundToQuarterHour(new Date());

    // Get last consums entry for this device
    const lastConsumResult = await this.pool.query(
      `SELECT timestamp, energia_total_wh
       FROM consums
       WHERE device_id = $1
       ORDER BY timestamp DESC LIMIT 1`,
      [device.device_id]
    );

    let previousTotal;
    let previousRawTs;

    if (lastConsumResult.rows.length > 0) {
      // Normal case: compare with last consums record
      previousTotal = lastConsumResult.rows[0].energia_total_wh;
      previousRawTs = new Date(lastConsumResult.rows[0].timestamp);
    } else {
      // Bootstrap: compare with 2nd-to-last energy_metrics entry
      const prevResult = await this.pool.query(
        `SELECT timestamp, value
         FROM energy_metrics
         WHERE device_id = $1 AND metric_name = $2
         ORDER BY timestamp DESC LIMIT 1 OFFSET 1`,
        [device.device_id, metricName]
      );
      if (prevResult.rows.length < 1) return false;
      previousTotal = prevResult.rows[0].value;
      previousRawTs = new Date(prevResult.rows[0].timestamp);
    }

    // Delta = consumed energy in Wh since last record
    let energiaWh;
    let potenciaW;
    const energiaTotalWh = current.value;

    if (current.value < previousTotal) {
      // El comptador ha baixat (reset/reinici del dispositiu): re-baseline a
      // l'acumulat actual amb energia 0 per no bloquejar la ingesta permanentment.
      logger.warn('Energia total disminueix — comptador reiniciat, re-baseline', {
        deviceId: device.device_id,
        deviceName: device.device_name,
        currentValue: current.value,
        previousTotal,
        currentTs: current.timestamp,
      });
      energiaWh = 0;
      potenciaW = 0;
    } else {
      energiaWh = Math.round((current.value - previousTotal) * 100) / 100;

      // Power in W = Wh / hours elapsed between raw timestamps
      const hoursElapsed = Math.abs(current.timestamp - previousRawTs) / (1000 * 60 * 60);
      potenciaW = hoursElapsed > 0
        ? Math.round((energiaWh / hoursElapsed) * 100) / 100
        : 0;
    }

    // Skip if record already exists for this device+timestamp
    const existing = await this.pool.query(
      `SELECT 1 FROM consums WHERE device_id = $1 AND timestamp = $2 LIMIT 1`,
      [device.device_id, ts]
    );
    if (existing.rows.length > 0) return false;

    await this.pool.query(
      `INSERT INTO consums (device_id, cups, dispositiu, energia_wh, potencia_w, energia_total_wh, timestamp)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [device.device_id, device.cups, device.device_name, energiaWh, potenciaW, energiaTotalWh, ts]
    );

    return true;
  }
}

module.exports = ConsumptionService;
