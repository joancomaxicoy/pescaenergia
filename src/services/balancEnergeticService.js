const logger = require('../utils/logger');
const database = require('../utils/database');

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

class BalancEnergeticService {
  constructor() {
    this.running = false;
  }

  async process() {
    if (this.running) {
      logger.debug('BalancEnergeticService ja està processant, saltant cicle');
      return;
    }
    this.running = true;

    const startTime = Date.now();

    try {
      const participations = await database.query(`
        SELECT up.user_id, up.generator_code, up.participation_percentage, u.cups
        FROM user_participation up
        JOIN users u ON u.id = up.user_id
        WHERE u.cups IS NOT NULL
      `);

      if (participations.rows.length === 0) {
        logger.debug('BalancEnergeticService: sense participacions registrades');
        return;
      }

      const timestamp = roundToQuarterHour(new Date());

      let inserted = 0;
      let skipped = 0;
      let errors = 0;

      for (const row of participations.rows) {
        try {
          const result = await this.processUserGenerator(
            row.user_id,
            row.cups,
            row.generator_code,
            parseFloat(row.participation_percentage),
            timestamp
          );
          if (result) inserted++;
          else skipped++;
        } catch (err) {
          errors++;
          logger.error('Error processant balanc per usuari+generador', {
            userId: row.user_id,
            generatorCode: row.generator_code,
            error: err.message,
          });
        }
      }

      const elapsed = Date.now() - startTime;
      logger.info('BalancEnergeticService cicle completat', {
        participations: participations.rows.length,
        inserted,
        skipped,
        errors,
        elapsed: `${elapsed}ms`,
      });
    } finally {
      this.running = false;
    }
  }

  async processUserGenerator(userId, cups, generatorCode, participationPct, timestamp) {
    const deviceId = `gen-${generatorCode}`;

    const exists = await database.query(
      `SELECT 1 FROM balanc_energetic
       WHERE user_id = $1 AND generator_code = $2 AND timestamp = $3`,
      [userId, generatorCode, timestamp]
    );
    if (exists.rows.length > 0) return false;

    const currentResult = await database.query(
      `SELECT value FROM energy_metrics
       WHERE device_id = $1 AND metric_name = 'e_total_fotovoltaica_max'
       ORDER BY timestamp DESC LIMIT 1`,
      [deviceId]
    );
    if (currentResult.rows.length === 0) {
      logger.debug('Sense dades de generació per al generador', { deviceId });
      return false;
    }
    const currentTotal = parseFloat(currentResult.rows[0].value);

    const prevResult = await database.query(
      `SELECT generator_total_cumulative_wh FROM balanc_energetic
       WHERE user_id = $1 AND generator_code = $2 AND timestamp < $3
       ORDER BY timestamp DESC LIMIT 1`,
      [userId, generatorCode, timestamp]
    );

    let previousTotal = 0;
    let hasPrevious = false;
    if (prevResult.rows.length > 0) {
      previousTotal = parseFloat(prevResult.rows[0].generator_total_cumulative_wh);
      hasPrevious = true;
    }

    let cumulativeWh;
    let generatorTotalWh;
    let allocatedWh;

    if (hasPrevious && currentTotal < previousTotal) {
      logger.warn('generator_total_cumulative_wh decreix, mantenint màxim acumulat', {
        deviceId, currentTotal, previousTotal
      });
      cumulativeWh = Math.max(previousTotal, currentTotal);
      generatorTotalWh = 0;
      allocatedWh = 0;
    } else if (!hasPrevious) {
      logger.debug('Primer registre guardant valor inicial sense delta', {
        deviceId, currentTotal
      });
      cumulativeWh = currentTotal;
      generatorTotalWh = 0;
      allocatedWh = 0;
    } else {
      cumulativeWh = currentTotal;
      generatorTotalWh = Math.max(0, Math.round((currentTotal - previousTotal) * 100) / 100);
      allocatedWh = Math.round(generatorTotalWh * (participationPct / 100) * 100) / 100;
    }

    const consumptionResult = await database.query(
      `SELECT COALESCE(SUM(energia_wh), 0) as total
       FROM consums
       WHERE cups = $1 AND timestamp = $2
         AND dispositiu LIKE 'Shelly EM%'`,
      [cups, timestamp]
    );
    const consumptionWh = parseFloat(consumptionResult.rows[0].total) || 0;

    const generatorScales = {
      'giravolt': 100,
      'sala-polivalent': 1000,
      'residencia': 1000,
    };
    const scale = generatorScales[generatorCode] || 1;
    const balanceWh = Math.round((allocatedWh * scale - consumptionWh) * 100) / 100;

    await database.query(
      `INSERT INTO balanc_energetic
        (user_id, cups, generator_code, participation_pct,
         generator_total_cumulative_wh, generator_total_wh,
         allocated_wh, consumption_wh, balance_wh, timestamp)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        userId, cups, generatorCode, participationPct,
        cumulativeWh, generatorTotalWh,
        allocatedWh, consumptionWh, balanceWh, timestamp,
      ]
    );

    return true;
  }

  async getRecent(limit = 10) {
    const result = await database.query(
      `SELECT user_id, cups, generator_code, participation_pct,
              generator_total_cumulative_wh, generator_total_wh,
              allocated_wh, consumption_wh, balance_wh, timestamp
       FROM balanc_energetic
       ORDER BY timestamp DESC, user_id
       LIMIT $1`,
      [limit]
    );
    return result.rows;
  }
}

module.exports = BalancEnergeticService;
