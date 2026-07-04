const logger = require('../utils/logger');
const database = require('../utils/database');
const MqttService = require('./mqtt/mqttService');

class PoolService {
  constructor() {
    this.logger = logger;
    this.mqttService = null;
    this.initializeMqtt();
  }

  async initializeMqtt() {
    try {
      this.mqttService = new MqttService();
      if (!this.mqttService.isConnected) {
        await this.mqttService.connect();
      }
      this.logger.info(' MQTT singleton inicialitzat per PoolService');
    } catch (error) {
      this.logger.error(' Error inicialitzant MQTT per PoolService:', { error: error.message });
      this.mqttService = null;
    }
  }

  async ensureMqttConnection() {
    if (!this.mqttService || !this.mqttService.isConnected) {
      this.logger.info(' MQTT no disponible, reintentant connexió...');
      await this.initializeMqtt();
    }
  }

  async publishMqttCommand(topic, command) {
    return new Promise((resolve, reject) => {
      try {
        if (!this.mqttService || !this.mqttService.client) {
          throw new Error('Servei MQTT no disponible');
        }
        if (!this.mqttService.isConnected) {
          throw new Error('Client MQTT no connectat');
        }

        this.logger.info('Enviant comanda MQTT des de PoolService', { topic, command });

        this.mqttService.client.publish(topic, command, { qos: 0 }, (error) => {
          if (error) {
            this.logger.error('Error publicant comanda MQTT', { topic, command, error: error.message });
            reject(error);
          } else {
            this.logger.info('Comanda MQTT enviada exitosament', { topic, command });
            resolve();
          }
        });
      } catch (error) {
        this.logger.error('Error a publishMqttCommand', { topic, command, error: error.message });
        reject(error);
      }
    });
  }

  async findUserPoolDevice(userId) {
    try {
      const query = `
        SELECT id, shelly_device_id, device_name, device_type, user_id
        FROM devices
        WHERE user_id = $1
        AND (device_type = 'POOL' OR shelly_device_id LIKE 'DepuradoraPiscina/%')
        ORDER BY created_at DESC
        LIMIT 1
      `;
      const result = await database.query(query, [userId]);
      return result.rows[0] || null;
    } catch (error) {
      this.logger.error('Error finding user pool device', { userId, error: error.message });
      throw error;
    }
  }

  async findDeviceByShellyId(shellyDeviceId) {
    const query = `
      SELECT id, shelly_device_id, device_name, device_type, user_id
      FROM devices
      WHERE shelly_device_id = $1
      LIMIT 1
    `;
    const result = await database.query(query, [shellyDeviceId]);
    return result.rows[0] || null;
  }

  async getPoolAutomation(deviceId) {
    try {
      const device = await this.findDeviceByShellyId(deviceId);
      if (!device) {
        return {
          mode: 'manual',
          schedule: {
            bombaDepuradora: { start: '09:00', end: '15:00' },
            bombaNeteja: { start: '09:00', end: '12:00' },
            cloradorSali: { start: '11:00', end: '15:00' }
          },
          automatic: {
            maxHours: { bombaDepuradora: 5, bombaNeteja: 1, cloradorSali: 4 },
            thresholds: { bombaDepuradora: 0.5, bombaNeteja: 1.2, cloradorSali: 0.8 },
            offThresholds: { bombaDepuradora: 0.1, bombaNeteja: 0.3, cloradorSali: 0.2 }
          }
        };
      }

      const query = `
        SELECT config_data
        FROM automation_configs
        WHERE device_id = $1::uuid
        AND config_name = 'pool_automation'
        AND is_active = true
        ORDER BY updated_at DESC
        LIMIT 1
      `;
      const result = await database.query(query, [device.id]);

      if (result.rows.length > 0) {
        return result.rows[0].config_data;
      }

      return {
        mode: 'manual',
        schedule: {
          bombaDepuradora: { start: '09:00', end: '15:00' },
          bombaNeteja: { start: '09:00', end: '12:00' },
          cloradorSali: { start: '11:00', end: '15:00' }
        },
        automatic: {
          maxHours: { bombaDepuradora: 5, bombaNeteja: 1, cloradorSali: 4 },
          thresholds: { bombaDepuradora: 0.5, bombaNeteja: 1.2, cloradorSali: 0.8 },
          offThresholds: { bombaDepuradora: 0.1, bombaNeteja: 0.3, cloradorSali: 0.2 }
        }
      };
    } catch (error) {
      this.logger.error('Error getting pool automation config', { deviceId, error: error.message });
      throw error;
    }
  }

  async savePoolAutomation(deviceId, config) {
    try {
      const device = await this.findDeviceByShellyId(deviceId);
      if (!device) {
        throw new Error('Dispositiu de piscina no trobat');
      }

      const configData = {
        mode: config.mode || 'manual',
        schedule: config.schedule || {
          bombaDepuradora: { start: '09:00', end: '15:00' },
          bombaNeteja: { start: '09:00', end: '12:00' },
          cloradorSali: { start: '11:00', end: '15:00' }
        },
        automatic: {
          maxHours: config.automatic?.maxHours || { bombaDepuradora: 5, bombaNeteja: 1, cloradorSali: 4 },
          thresholds: config.automatic?.thresholds || { bombaDepuradora: 0.5, bombaNeteja: 1.2, cloradorSali: 0.8 },
          offThresholds: config.automatic?.offThresholds || { bombaDepuradora: 0.1, bombaNeteja: 0.3, cloradorSali: 0.2 }
        }
      };

      const existingQuery = `
        SELECT id FROM automation_configs
        WHERE device_id = $1::uuid AND config_name = 'pool_automation'
      `;
      const existingResult = await database.query(existingQuery, [device.id]);

      let result;
      if (existingResult.rows.length > 0) {
        result = await database.query(`
          UPDATE automation_configs
          SET config_data = $1, updated_at = NOW()
          WHERE device_id = $2::uuid AND config_name = 'pool_automation'
          RETURNING id, updated_at
        `, [JSON.stringify(configData), device.id]);
      } else {
        result = await database.query(`
          INSERT INTO automation_configs (device_id, config_name, config_data, is_active)
          VALUES ($1::uuid, 'pool_automation', $2, true)
          RETURNING id, created_at AS updated_at
        `, [device.id, JSON.stringify(configData)]);
      }

      this.logger.info('Pool automation config saved', {
        deviceId,
        configId: result.rows[0].id,
        mode: configData.mode
      });

      return { success: true, config: configData };
    } catch (error) {
      this.logger.error('Error saving pool automation config', { deviceId, error: error.message });
      throw error;
    }
  }

  async getPoolStatus(deviceId) {
    try {
      const device = await this.findDeviceByShellyId(deviceId);
      if (!device) {
        return {
          elements: {
            bombaDepuradora: { isOn: false, power: 0, isOnline: false },
            bombaNeteja: { isOn: false, power: 0, isOnline: false },
            cloradorSali: { isOn: false, power: 0, isOnline: false }
          },
          totalPower: 0,
          solarExcedent: 0,
          lastUpdate: null
        };
      }

      const statesQuery = `
        SELECT state_name, state_value_boolean, state_value_numeric, last_updated
        FROM device_states
        WHERE device_id = $1::uuid
        ORDER BY last_updated DESC
      `;
      const statesResult = await database.query(statesQuery, [device.id]);

      const elements = {
        bombaDepuradora: { isOn: false, power: 0, isOnline: false },
        bombaNeteja: { isOn: false, power: 0, isOnline: false },
        cloradorSali: { isOn: false, power: 0, isOnline: false }
      };

      let lastUpdate = null;

      // Process states stored with pool element naming (bombaDepuradora_apower, etc.)
      for (const row of statesResult.rows) {
        const stateName = row.state_name;
        let elementKey = null;
        let metricType = null;

        if (stateName.startsWith('bombaDepuradora_')) {
          elementKey = 'bombaDepuradora';
          metricType = stateName.replace('bombaDepuradora_', '');
        } else if (stateName.startsWith('bombaNeteja_')) {
          elementKey = 'bombaNeteja';
          metricType = stateName.replace('bombaNeteja_', '');
        } else if (stateName.startsWith('cloradorSali_')) {
          elementKey = 'cloradorSali';
          metricType = stateName.replace('cloradorSali_', '');
        }

        if (elementKey && metricType) {
          if (metricType === 'output' && row.state_value_boolean !== null) {
            elements[elementKey].isOn = row.state_value_boolean;
          } else if (metricType === 'apower' && row.state_value_numeric !== null) {
            elements[elementKey].power = row.state_value_numeric;
          }
        }

        if (!lastUpdate || new Date(row.last_updated) > new Date(lastUpdate)) {
          lastUpdate = row.last_updated;
        }
      }

      // Also try to read states from MQTT-created device (by CUPS only)
      // The MQTT normalizer stores states like emeter_0_power and relay_0
      // under deviceId = CUPS (without the "DepuradoraPiscina/" prefix)
      const cups = device.shelly_device_id.split('/')[1] || '';
      if (cups) {
        try {
          // Trobar TOTS els dispositius MQTT que coincideixin amb el CUPS
          // (pot haver-n'hi un amb espai final del normalitzador vell i un sense del nou)
          const mqttFindQuery = `
            SELECT id, shelly_device_id FROM devices
            WHERE shelly_device_id LIKE $1
            AND shelly_device_id NOT LIKE 'DepuradoraPiscina/%'
            ORDER BY created_at DESC
          `;
          const mqttFindResult = await database.query(mqttFindQuery, [`${cups.trim()}%`]);
          const mqttDevices = mqttFindResult.rows || [];

          // Fusionar estats de TOTS els dispositius MQTT que coincideixin
          for (const mqttDevice of mqttDevices) {
            const mqttStatesQuery = `
              SELECT state_name, state_value_boolean, state_value_numeric, last_updated
              FROM device_states
              WHERE device_id = $1::uuid
            `;
            const mqttResult = await database.query(mqttStatesQuery, [mqttDevice.id]);

            for (const row of mqttResult.rows) {
              if (row.state_name === 'emeter_0_power' && row.state_value_numeric !== null) {
                elements.bombaDepuradora.power = row.state_value_numeric;
              } else if (row.state_name === 'relay_0') {
                if (row.state_value_boolean !== null) {
                  elements.bombaDepuradora.isOn = row.state_value_boolean;
                } else if (row.state_value_numeric !== null) {
                  elements.bombaDepuradora.isOn = row.state_value_numeric === 1;
                }
              }
              if (!lastUpdate || new Date(row.last_updated) > new Date(lastUpdate)) {
                lastUpdate = row.last_updated;
              }
            }
          }
        } catch (err) {
          this.logger.warn('No s\'ha pogut llegir estat MQTT del dispositiu:', {
            cups,
            error: err.message
          });
        }
      }

      const now = new Date();
      const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);
      for (const el of Object.values(elements)) {
        el.isOnline = lastUpdate ? new Date(lastUpdate) > fiveMinutesAgo : false;
      }

      const totalPower = Object.values(elements).reduce((sum, el) => sum + (el.isOn ? el.power : 0), 0);

      return {
        elements,
        totalPower,
        solarExcedent: 0,
        lastUpdate
      };
    } catch (error) {
      this.logger.error('Error getting pool status', { deviceId, error: error.message });
      throw error;
    }
  }

  async requestStatusUpdate(deviceId) {
    try {
      const device = await this.findDeviceByShellyId(deviceId);
      if (!device) {
        throw new Error('Dispositiu de piscina no trobat');
      }

      await this.ensureMqttConnection();

      const topic = `${device.shelly_device_id}/command`;
      this.logger.info('Enviant status_update a la piscina', { deviceId, topic });

      await this.publishMqttCommand(topic, 'status_update');

      return { success: true, message: 'Actualització d\'estat sol·licitada' };
    } catch (error) {
      this.logger.error('Error requesting pool status update', { deviceId, error: error.message });
      throw error;
    }
  }

  async controlElement(deviceId, element, action) {
    try {
      const device = await this.findDeviceByShellyId(deviceId);
      if (!device) {
        throw new Error('Dispositiu de piscina no trobat');
      }

      const validElements = ['bombaDepuradora', 'bombaNeteja', 'cloradorSali'];
      if (!validElements.includes(element)) {
        throw new Error(`Element no vàlid: ${element}`);
      }

      if (!['on', 'off'].includes(action)) {
        throw new Error('Acció no vàlida. Utilitza on/off');
      }

      await this.ensureMqttConnection();

      const cups = device.shelly_device_id.split('/')[1] || '';
      const shellyName = element.charAt(0).toUpperCase() + element.slice(1);
      const topic = `shellies/${shellyName}/${cups} /relay/0/command`;

      this.logger.info('Controlant element de piscina via MQTT', {
        deviceId, element, action, topic
      });

      await this.publishMqttCommand(topic, action);

      return {
        success: true,
        element,
        action,
        message: `Comanda ${action} enviada a ${element}`
      };
    } catch (error) {
      this.logger.error('Error controlling pool element', { deviceId, element, action, error: error.message });
      throw error;
    }
  }
}

module.exports = PoolService;
