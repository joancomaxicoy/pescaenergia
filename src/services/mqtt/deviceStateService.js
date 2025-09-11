const logger = require('../../utils/logger');
const { getPool } = require('../../utils/database');

class DeviceStateService {
  constructor() {
    // Estadísticas
    this.stats = {
      statesUpdated: 0,
      statesCreated: 0,
      statesSkipped: 0, // Nuevas estadísticas para valores sin cambios
      errors: 0,
      lastError: null,
      startTime: Date.now()
    };
  }

  /**
   * Actualiza o crea un estado de dispositivo solo si el valor ha cambiado
   * @param {string} deviceId - UUID del dispositivo
   * @param {string} stateName - Nombre del estado
   * @param {any} stateValue - Valor del estado
   * @param {string} stateType - Tipo del estado ('boolean', 'numeric', 'string', 'json')
   */
  async updateDeviceState(deviceId, stateName, stateValue, stateType) {
    try {
      // Convertir el valor a string para almacenamiento
      let valueAsString;
      if (stateType === 'json') {
        valueAsString = JSON.stringify(stateValue);
      } else {
        valueAsString = String(stateValue);
      }

      // Primero verificar si el valor actual es diferente
      const checkQuery = `
        SELECT state_value_boolean, state_value_numeric, state_value_string, state_value_json
        FROM device_states
        WHERE device_id = $1 AND state_name = $2
      `;

      const checkResult = await getPool().query(checkQuery, [deviceId, stateName]);
      
      // Si existe y el valor es el mismo, no hacer nada
      if (checkResult.rows.length > 0) {
        const row = checkResult.rows[0];
        let currentValue;
        
        // Obtener el valor actual según el tipo
        switch (stateType) {
          case 'boolean':
            currentValue = String(row.state_value_boolean);
            break;
          case 'numeric':
            currentValue = String(row.state_value_numeric);
            break;
          case 'json':
            currentValue = JSON.stringify(row.state_value_json);
            break;
          default: // 'string'
            currentValue = row.state_value_string;
            break;
        }
        
        if (currentValue === valueAsString) {
          this.stats.statesSkipped++;
          logger.debug('Estado sin cambios, omitiendo actualización', {
            deviceId,
            stateName,
            currentValue: valueAsString
          });
          return { skipped: true };
        }
      }

      // El valor es diferente o no existe, proceder con la actualización
      let query, params;
      
      switch (stateType) {
        case 'boolean':
          query = `
            INSERT INTO device_states (device_id, state_name, state_value_boolean, last_updated)
            VALUES ($1, $2, $3, NOW())
            ON CONFLICT (device_id, state_name)
            DO UPDATE SET 
              state_value_boolean = EXCLUDED.state_value_boolean,
              state_value_numeric = NULL,
              state_value_string = NULL,
              state_value_json = NULL,
              last_updated = NOW()
            RETURNING id, created_at = last_updated as is_new
          `;
          params = [deviceId, stateName, stateValue === 'true' || stateValue === true];
          break;
          
        case 'numeric':
          query = `
            INSERT INTO device_states (device_id, state_name, state_value_numeric, last_updated)
            VALUES ($1, $2, $3, NOW())
            ON CONFLICT (device_id, state_name)
            DO UPDATE SET 
              state_value_boolean = NULL,
              state_value_numeric = EXCLUDED.state_value_numeric,
              state_value_string = NULL,
              state_value_json = NULL,
              last_updated = NOW()
            RETURNING id, created_at = last_updated as is_new
          `;
          params = [deviceId, stateName, parseFloat(stateValue)];
          break;
          
        case 'json':
          query = `
            INSERT INTO device_states (device_id, state_name, state_value_json, last_updated)
            VALUES ($1, $2, $3, NOW())
            ON CONFLICT (device_id, state_name)
            DO UPDATE SET 
              state_value_boolean = NULL,
              state_value_numeric = NULL,
              state_value_string = NULL,
              state_value_json = EXCLUDED.state_value_json,
              last_updated = NOW()
            RETURNING id, created_at = last_updated as is_new
          `;
          params = [deviceId, stateName, stateValue];
          break;
          
        default: // 'string'
          query = `
            INSERT INTO device_states (device_id, state_name, state_value_string, last_updated)
            VALUES ($1, $2, $3, NOW())
            ON CONFLICT (device_id, state_name)
            DO UPDATE SET 
              state_value_boolean = NULL,
              state_value_numeric = NULL,
              state_value_string = EXCLUDED.state_value_string,
              state_value_json = NULL,
              last_updated = NOW()
            RETURNING id, created_at = last_updated as is_new
          `;
          params = [deviceId, stateName, valueAsString];
          break;
      }

      const result = await getPool().query(query, params);
      
      if (result.rows[0].is_new) {
        this.stats.statesCreated++;
      } else {
        this.stats.statesUpdated++;
      }

      logger.debug('Estado de dispositivo actualizado', {
        deviceId,
        stateName,
        stateValue: valueAsString,
        stateType,
        isNew: result.rows[0].is_new
      });

      return { ...result.rows[0], skipped: false };

    } catch (error) {
      this.stats.errors++;
      this.stats.lastError = {
        message: error.message,
        timestamp: new Date(),
        deviceId,
        stateName
      };

      logger.error('Error actualizando estado de dispositivo:', {
        error: error.message,
        deviceId,
        stateName,
        stateValue,
        stateType
      });

      throw error;
    }
  }

  /**
   * Actualiza múltiples estados de un dispositivo en una transacción
   * Solo actualiza los que realmente han cambiado
   * @param {string} deviceId - UUID del dispositivo
   * @param {Array} states - Array de objetos {stateName, stateValue, stateType}
   */
  async updateMultipleDeviceStates(deviceId, states) {
    const client = await getPool().connect();
    
    try {
      await client.query('BEGIN');

      // Primero obtener todos los estados actuales del dispositivo
      const currentStatesQuery = `
        SELECT state_name, state_value_boolean, state_value_numeric, state_value_string, state_value_json
        FROM device_states
        WHERE device_id = $1
      `;
      
      const currentStatesResult = await client.query(currentStatesQuery, [deviceId]);
      const currentStates = new Map();
      
      for (const row of currentStatesResult.rows) {
        // Determinar el tipo y valor actual basándose en qué columna tiene datos
        let currentType, currentValue;
        if (row.state_value_boolean !== null) {
          currentType = 'boolean';
          currentValue = String(row.state_value_boolean);
        } else if (row.state_value_numeric !== null) {
          currentType = 'numeric';
          currentValue = String(row.state_value_numeric);
        } else if (row.state_value_json !== null) {
          currentType = 'json';
          currentValue = JSON.stringify(row.state_value_json);
        } else {
          currentType = 'string';
          currentValue = row.state_value_string;
        }
        
        currentStates.set(row.state_name, {
          value: currentValue,
          type: currentType
        });
      }

      const results = [];
      let skippedCount = 0;
      
      for (const state of states) {
        const { stateName, stateValue, stateType } = state;
        
        // Convertir el valor a string para comparación
        let valueAsString;
        if (stateType === 'json') {
          valueAsString = JSON.stringify(stateValue);
        } else {
          valueAsString = String(stateValue);
        }

        // Verificar si el valor ha cambiado
        const currentState = currentStates.get(stateName);
        if (currentState && 
            currentState.value === valueAsString && 
            currentState.type === stateType) {
          skippedCount++;
          this.stats.statesSkipped++;
          results.push({ skipped: true, stateName });
          continue;
        }

        // El valor es diferente o no existe, proceder con la actualización
        let query, params;
        
        switch (stateType) {
          case 'boolean':
            query = `
              INSERT INTO device_states (device_id, state_name, state_value_boolean, last_updated)
              VALUES ($1, $2, $3, NOW())
              ON CONFLICT (device_id, state_name)
              DO UPDATE SET 
                state_value_boolean = EXCLUDED.state_value_boolean,
                state_value_numeric = NULL,
                state_value_string = NULL,
                state_value_json = NULL,
                last_updated = NOW()
              RETURNING id, created_at = last_updated as is_new
            `;
            params = [deviceId, stateName, stateValue === 'true' || stateValue === true];
            break;
            
          case 'numeric':
            query = `
              INSERT INTO device_states (device_id, state_name, state_value_numeric, last_updated)
              VALUES ($1, $2, $3, NOW())
              ON CONFLICT (device_id, state_name)
              DO UPDATE SET 
                state_value_boolean = NULL,
                state_value_numeric = EXCLUDED.state_value_numeric,
                state_value_string = NULL,
                state_value_json = NULL,
                last_updated = NOW()
              RETURNING id, created_at = last_updated as is_new
            `;
            params = [deviceId, stateName, parseFloat(stateValue)];
            break;
            
          case 'json':
            query = `
              INSERT INTO device_states (device_id, state_name, state_value_json, last_updated)
              VALUES ($1, $2, $3, NOW())
              ON CONFLICT (device_id, state_name)
              DO UPDATE SET 
                state_value_boolean = NULL,
                state_value_numeric = NULL,
                state_value_string = NULL,
                state_value_json = EXCLUDED.state_value_json,
                last_updated = NOW()
              RETURNING id, created_at = last_updated as is_new
            `;
            params = [deviceId, stateName, stateValue];
            break;
            
          default: // 'string'
            query = `
              INSERT INTO device_states (device_id, state_name, state_value_string, last_updated)
              VALUES ($1, $2, $3, NOW())
              ON CONFLICT (device_id, state_name)
              DO UPDATE SET 
                state_value_boolean = NULL,
                state_value_numeric = NULL,
                state_value_string = EXCLUDED.state_value_string,
                state_value_json = NULL,
                last_updated = NOW()
              RETURNING id, created_at = last_updated as is_new
            `;
            params = [deviceId, stateName, valueAsString];
            break;
        }

        const result = await client.query(query, params);
        
        if (result.rows[0].is_new) {
          this.stats.statesCreated++;
        } else {
          this.stats.statesUpdated++;
        }

        results.push({ ...result.rows[0], skipped: false, stateName });
      }

      await client.query('COMMIT');

      logger.debug('Estados múltiples de dispositivo procesados', {
        deviceId,
        totalStates: states.length,
        skipped: skippedCount,
        created: results.filter(r => !r.skipped && r.is_new).length,
        updated: results.filter(r => !r.skipped && !r.is_new).length
      });

      return results;

    } catch (error) {
      await client.query('ROLLBACK');
      
      this.stats.errors++;
      this.stats.lastError = {
        message: error.message,
        timestamp: new Date(),
        deviceId,
        statesCount: states.length
      };

      logger.error('Error actualizando estados múltiples de dispositivo:', {
        error: error.message,
        deviceId,
        statesCount: states.length
      });

      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Obtiene todos los estados de un dispositivo
   * @param {string} deviceId - UUID del dispositivo
   * @returns {Object} - Objeto con los estados del dispositivo
   */
  async getDeviceStates(deviceId) {
    try {
      const query = `
        SELECT state_name, state_value_boolean, state_value_numeric, state_value_string, state_value_json, last_updated
        FROM device_states
        WHERE device_id = $1
        ORDER BY state_name
      `;

      const result = await getPool().query(query, [deviceId]);
      
      const states = {};
      for (const row of result.rows) {
        let parsedValue, stateType;
        
        // Determinar el tipo y valor basándose en qué columna tiene datos
        if (row.state_value_boolean !== null) {
          stateType = 'boolean';
          parsedValue = row.state_value_boolean;
        } else if (row.state_value_numeric !== null) {
          stateType = 'numeric';
          parsedValue = row.state_value_numeric;
        } else if (row.state_value_json !== null) {
          stateType = 'json';
          parsedValue = row.state_value_json;
        } else {
          stateType = 'string';
          parsedValue = row.state_value_string;
        }

        states[row.state_name] = {
          value: parsedValue,
          type: stateType,
          lastUpdated: row.last_updated
        };
      }

      return states;

    } catch (error) {
      logger.error('Error obteniendo estados de dispositivo:', {
        error: error.message,
        deviceId
      });
      throw error;
    }
  }

  /**
   * Obtiene un estado específico de un dispositivo
   * @param {string} deviceId - UUID del dispositivo
   * @param {string} stateName - Nombre del estado
   * @returns {Object|null} - Estado del dispositivo o null si no existe
   */
  async getDeviceState(deviceId, stateName) {
    try {
      const query = `
        SELECT state_value_boolean, state_value_numeric, state_value_string, state_value_json, last_updated
        FROM device_states
        WHERE device_id = $1 AND state_name = $2
      `;

      const result = await getPool().query(query, [deviceId, stateName]);
      
      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0];
      let parsedValue, stateType;
      
      // Determinar el tipo y valor basándose en qué columna tiene datos
      if (row.state_value_boolean !== null) {
        stateType = 'boolean';
        parsedValue = row.state_value_boolean;
      } else if (row.state_value_numeric !== null) {
        stateType = 'numeric';
        parsedValue = row.state_value_numeric;
      } else if (row.state_value_json !== null) {
        stateType = 'json';
        parsedValue = row.state_value_json;
      } else {
        stateType = 'string';
        parsedValue = row.state_value_string;
      }

      return {
        value: parsedValue,
        type: stateType,
        lastUpdated: row.last_updated
      };

    } catch (error) {
      logger.error('Error obteniendo estado específico de dispositivo:', {
        error: error.message,
        deviceId,
        stateName
      });
      throw error;
    }
  }

  /**
   * Elimina estados antiguos (cleanup)
   * @param {number} daysOld - Días de antigüedad para eliminar
   * @returns {number} - Número de estados eliminados
   */
  async cleanupOldStates(daysOld = 30) {
    try {
      const query = `
        DELETE FROM device_states
        WHERE last_updated < NOW() - INTERVAL '${daysOld} days'
      `;

      const result = await getPool().query(query);
      
      logger.info('Estados antiguos eliminados', {
        daysOld,
        deletedCount: result.rowCount
      });

      return result.rowCount;

    } catch (error) {
      logger.error('Error eliminando estados antiguos:', {
        error: error.message,
        daysOld
      });
      throw error;
    }
  }

  /**
   * Obtiene las estadísticas del servicio
   * @returns {Object}
   */
  getStats() {
    const totalOperations = this.stats.statesUpdated + this.stats.statesCreated + this.stats.statesSkipped;
    const skipRate = totalOperations > 0 ? (this.stats.statesSkipped / totalOperations * 100).toFixed(2) : '0';
    
    return {
      ...this.stats,
      uptime: Math.floor((Date.now() - this.stats.startTime) / 1000),
      totalOperations,
      skipRate: `${skipRate}%`,
      efficiency: `${this.stats.statesSkipped} escrituras evitadas`
    };
  }

  /**
   * Resetea las estadísticas
   */
  resetStats() {
    this.stats = {
      statesUpdated: 0,
      statesCreated: 0,
      statesSkipped: 0,
      errors: 0,
      lastError: null,
      startTime: Date.now()
    };
    
    logger.info('Estadísticas del DeviceStateService reseteadas');
  }

  /**
   * Verifica el estado de salud del servicio
   * @returns {Object}
   */
  async healthCheck() {
    try {
      // Probar conexión con una consulta simple
      const result = await getPool().query('SELECT COUNT(*) as total FROM device_states');
      
      return {
        status: 'healthy',
        totalStates: parseInt(result.rows[0].total),
        errors: this.stats.errors,
        lastError: this.stats.lastError,
        efficiency: this.getStats().efficiency
      };

    } catch (error) {
      return {
        status: 'unhealthy',
        error: error.message,
        errors: this.stats.errors,
        lastError: this.stats.lastError
      };
    }
  }
}

module.exports = DeviceStateService;
