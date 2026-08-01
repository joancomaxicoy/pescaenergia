const logger = require('../utils/logger');
const database = require('../utils/database');
const { getTodayLocal } = require('../utils/dateUtils');
const poolStateCache = require('./poolStateCache');

class PoolHoursService {
  constructor() {
    this.interval = null;
  }

  start() {
    logger.info('⏰ PoolHoursService: iniciant comptador horari (cada 60s)');
    this.process();
    this.interval = setInterval(() => this.process(), 60000);
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  async process() {
    try {
      const devicesQuery = `
        SELECT id, shelly_device_id FROM devices
        WHERE device_type = 'POOL' OR shelly_device_id LIKE 'DepuradoraPiscina/%'
      `;
      const devices = await database.query(devicesQuery);
      if (devices.rows.length === 0) return;

      for (const device of devices.rows) {
        await this.processDevice(device);
      }
    } catch (error) {
      logger.error('PoolHoursService.process error', { error: error.message });
    }
  }

  async processDevice(device) {
    const today = getTodayLocal();
    const elements = { bombaDepuradora: false, bombaNeteja: false, cloradorSali: false };

    // 1) Utilitzar poolStateCache (temps real des de MQTT) si té dades recents
    const cached = poolStateCache.getState();
    const now = new Date();
    const twoMinutesAgo = new Date(now.getTime() - 2 * 60 * 1000);
    if (cached.lastUpdate && new Date(cached.lastUpdate) > twoMinutesAgo) {
      for (const [key, el] of Object.entries(cached.elements)) {
        if (elements[key] !== undefined) {
          elements[key] = el.isOn;
        }
      }
    } else {
      // 2) Fallback: consultar device_states a la BD amb totes les variants de dispositiu
      await this._checkDeviceStates(device.id, elements);

      const cups = device.shelly_device_id.split('/')[1] || '';
      if (cups) {
        const trimmed = cups.trim();
        try {
          const mqttDevicesQuery = `
            SELECT id FROM devices
            WHERE (
              shelly_device_id LIKE $1
              OR shelly_device_id LIKE $2
              OR shelly_device_id LIKE $3
              OR shelly_device_id LIKE $4
              OR shelly_device_id LIKE $5
            )
            AND device_type IN ('SHELLY_BOMBADEPURADORA', 'SHELLY_BOMBANETEJA', 'SHELLY_CLORADORSALI', 'SHELLY_ANNOUNCE')
          `;
          const mqttResult = await database.query(mqttDevicesQuery, [
            `${trimmed}%`,
            `BombaDepuradora/${trimmed}%`,
            `BombaNet/${trimmed}%`,
            `CloradorSali/${trimmed}%`,
            `DepuradoraPiscina/${trimmed}%`
          ]);
          for (const mqttDevice of mqttResult.rows) {
            await this._checkDeviceStates(mqttDevice.id, elements);
          }
        } catch (err) {
          logger.warn('Error checking pool device states', { deviceId: device.id, error: err.message });
        }
      }
    }

    // Read existing config
    const configQuery = `
      SELECT id, config_data FROM automation_configs
      WHERE device_id = $1::uuid AND config_name = 'pool_hours'
      ORDER BY updated_at DESC LIMIT 1
    `;
    const configResult = await database.query(configQuery, [device.id]);

    let hoursData = {
      date: today,
      bombaDepuradora: 0,
      bombaNeteja: 0,
      cloradorSali: 0
    };

    if (configResult.rows.length > 0) {
      const existing = configResult.rows[0].config_data;
      if (existing.date === today) {
        hoursData = existing;
      }
    }

    // Increment for each element that is ON
    for (const [key, isOn] of Object.entries(elements)) {
      if (isOn) {
        hoursData[key] = (hoursData[key] || 0) + 1;
      }
    }

    // Upsert config
    const existingId = configResult.rows[0]?.id;
    if (existingId) {
      await database.query(`
        UPDATE automation_configs
        SET config_data = $1, updated_at = NOW()
        WHERE id = $2::uuid
      `, [JSON.stringify(hoursData), existingId]);
    } else {
      await database.query(`
        INSERT INTO automation_configs (device_id, config_name, config_data, is_active)
        VALUES ($1::uuid, 'pool_hours', $2, true)
      `, [device.id, JSON.stringify(hoursData)]);
    }
  }

  async _checkDeviceStates(deviceId, elements) {
    const cutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const statesQuery = `
      SELECT state_name, state_value_boolean, state_value_numeric
      FROM device_states
      WHERE device_id = $1::uuid
      AND last_updated > $2
      AND state_name IN ('relay_0', 'emeter_0_power', 'bombaNeteja_output', 'cloradorSali_output', 'bombaNeteja_apower', 'cloradorSali_apower')
    `;
    const result = await database.query(statesQuery, [deviceId, cutoff]);

    const stateMap = {};
    for (const row of result.rows) {
      stateMap[row.state_name] = row;
    }

    if (!elements.bombaDepuradora) {
      const relay = stateMap['relay_0'];
      if (relay?.state_value_boolean === true || relay?.state_value_numeric === 1) {
        elements.bombaDepuradora = true;
      } else {
        const power = stateMap['emeter_0_power'];
        if (power && power.state_value_numeric > 0) {
          elements.bombaDepuradora = true;
        }
      }
    }

    for (const name of ['bombaNeteja', 'cloradorSali']) {
      if (!elements[name]) {
        const output = stateMap[`${name}_output`];
        if (output?.state_value_boolean === true) {
          elements[name] = true;
          continue;
        }
        const power = stateMap[`${name}_apower`];
        if (power && power.state_value_numeric > 0) {
          elements[name] = true;
        }
      }
    }
  }
}

module.exports = PoolHoursService;
