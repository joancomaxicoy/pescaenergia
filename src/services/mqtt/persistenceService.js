const logger = require('../../utils/logger');
const database = require('../../utils/database');

class PersistenceService {
  constructor() {
    // Cache de device IDs para evitar consultas repetidas
    this.deviceCache = new Map(); // shelly_device_id -> uuid
    this.cacheHits = 0;
    this.cacheMisses = 0;
    
    // Estadísticas
    this.stats = {
      totalInserts: 0,
      totalMetrics: 0,
      totalBatches: 0,
      averageBatchSize: 0,
      lastInsertTime: null,
      totalInsertTime: 0,
      cacheHits: 0,
      cacheMisses: 0,
      errors: 0
    };
  }

  /**
   * Inserta métricas agregadas en la base de datos de forma masiva
   * @param {Array} aggregatedMetrics - Array de métricas agregadas
   */
  async bulkInsert(aggregatedMetrics) {
    if (!aggregatedMetrics || aggregatedMetrics.length === 0) {
      logger.debug('No hay métricas para insertar');
      return;
    }

    const startTime = Date.now();
    let client;

    try {
      client = await database.getClient();
      await client.query('BEGIN');

      // Preparar los datos para inserción
      const insertData = [];
      const values = [];
      let paramIndex = 1;

      for (const metric of aggregatedMetrics) {
        const { timestamp, device_id, metric_name, value } = metric;
        
        // Validar datos
        if (!timestamp || !device_id || !metric_name || value === undefined || value === null) {
          logger.warn('Métrica inválida omitida', { metric });
          continue;
        }

        insertData.push(`($${paramIndex}, $${paramIndex + 1}, $${paramIndex + 2}, $${paramIndex + 3})`);
        values.push(timestamp, device_id, metric_name, value);
        paramIndex += 4;
      }

      if (insertData.length === 0) {
        logger.warn('No hay métricas válidas para insertar');
        await client.query('ROLLBACK');
        return;
      }

      // Construir y ejecutar la query de inserción masiva
      const insertQuery = `
        INSERT INTO energy_metrics (timestamp, device_id, metric_name, value)
        VALUES ${insertData.join(', ')}
      `;

      const result = await client.query(insertQuery, values);
      await client.query('COMMIT');

      // Actualizar estadísticas
      const insertTime = Date.now() - startTime;
      this.stats.totalInserts += result.rowCount;
      this.stats.totalMetrics += result.rowCount;
      this.stats.totalBatches++;
      this.stats.averageBatchSize = Math.round(this.stats.totalMetrics / this.stats.totalBatches);
      this.stats.lastInsertTime = insertTime;
      this.stats.totalInsertTime += insertTime;
      this.stats.cacheHits = this.cacheHits;
      this.stats.cacheMisses = this.cacheMisses;

      logger.info('Inserción masiva completada', {
        metricsInserted: result.rowCount,
        insertTime,
        batchSize: aggregatedMetrics.length,
        validMetrics: insertData.length
      });

    } catch (error) {
      this.stats.errors++;
      
      if (client) {
        try {
          await client.query('ROLLBACK');
        } catch (rollbackError) {
          logger.error('Error en rollback:', rollbackError);
        }
      }

      logger.error('Error en inserción masiva:', {
        error: error.message,
        metricsCount: aggregatedMetrics.length,
        insertTime: Date.now() - startTime
      });
      
      throw error;
    } finally {
      if (client) {
        client.release();
      }
    }
  }

  /**
   * Resuelve un shelly_device_id a su UUID en la base de datos
   * @param {string} shellyDeviceId - ID del dispositivo Shelly
   * @returns {string|null} - UUID del dispositivo o null si no existe
   */
  async resolveDeviceId(shellyDeviceId) {
    // Verificar cache primero
    if (this.deviceCache.has(shellyDeviceId)) {
      this.cacheHits++;
      return this.deviceCache.get(shellyDeviceId);
    }

    this.cacheMisses++;

    try {
      const result = await database.query(
        'SELECT id FROM devices WHERE shelly_device_id = $1',
        [shellyDeviceId]
      );

      if (result.rows.length === 0) {
        logger.warn('Dispositivo no encontrado en BD', { shellyDeviceId });
        // Cachear el resultado negativo para evitar consultas repetidas
        this.deviceCache.set(shellyDeviceId, null);
        return null;
      }

      const deviceUuid = result.rows[0].id;
      
      // Cachear el resultado
      this.deviceCache.set(shellyDeviceId, deviceUuid);
      
      logger.debug('Device ID resuelto', { 
        shellyDeviceId, 
        deviceUuid,
        cacheSize: this.deviceCache.size 
      });

      return deviceUuid;

    } catch (error) {
      logger.error('Error resolviendo device ID:', { 
        shellyDeviceId, 
        error: error.message 
      });
      return null;
    }
  }

  /**
   * Resuelve múltiples device IDs de una vez
   * @param {Array<string>} shellyDeviceIds - Array de IDs de dispositivos
   * @returns {Map<string, string|null>} - Map de shelly_device_id -> uuid
   */
  async resolveMultipleDeviceIds(shellyDeviceIds) {
    const results = new Map();
    const uncachedIds = [];

    // Verificar cache para todos los IDs
    for (const shellyId of shellyDeviceIds) {
      if (this.deviceCache.has(shellyId)) {
        this.cacheHits++;
        results.set(shellyId, this.deviceCache.get(shellyId));
      } else {
        uncachedIds.push(shellyId);
      }
    }

    // Consultar los IDs no cacheados
    if (uncachedIds.length > 0) {
      this.cacheMisses += uncachedIds.length;

      try {
        const placeholders = uncachedIds.map((_, index) => `$${index + 1}`).join(', ');
        const query = `SELECT id, shelly_device_id FROM devices WHERE shelly_device_id IN (${placeholders})`;
        
        const result = await database.query(query, uncachedIds);

        // Procesar resultados encontrados
        const foundIds = new Set();
        for (const row of result.rows) {
          const { id, shelly_device_id } = row;
          this.deviceCache.set(shelly_device_id, id);
          results.set(shelly_device_id, id);
          foundIds.add(shelly_device_id);
        }

        // Cachear resultados negativos
        for (const shellyId of uncachedIds) {
          if (!foundIds.has(shellyId)) {
            this.deviceCache.set(shellyId, null);
            results.set(shellyId, null);
            logger.warn('Dispositivo no encontrado en BD', { shellyDeviceId: shellyId });
          }
        }

        logger.debug('Device IDs resueltos en lote', {
          requested: uncachedIds.length,
          found: foundIds.size,
          cacheSize: this.deviceCache.size
        });

      } catch (error) {
        logger.error('Error resolviendo device IDs en lote:', error);
        
        // En caso de error, marcar todos como null
        for (const shellyId of uncachedIds) {
          results.set(shellyId, null);
        }
      }
    }

    return results;
  }

  /**
   * Busca o crea un dispositivo automáticamente
   * @param {string} deviceId - ID del dispositivo (shelly_device_id o CUPS)
   * @param {string} deviceType - Tipo del dispositivo
   * @param {Object} additionalInfo - Información adicional del dispositivo
   * @returns {string|null} - UUID del dispositivo
   */
  async findOrCreateDevice(deviceId, deviceType, additionalInfo = {}) {
    try {
      // Primero intentar resolver el dispositivo existente
      const existingUuid = await this.resolveDeviceId(deviceId);
      if (existingUuid) {
        return existingUuid;
      }

      logger.info('Creando dispositivo automáticamente', { 
        deviceId, 
        deviceType, 
        additionalInfo 
      });

      // Para dispositivos PLUG, siempre usar 'not_assigned'
      // Solo los dispositivos CIRCUTOR (ConsumCups) necesitan asignación de usuario
      let userId = 'not_assigned';
      
      if (deviceType === 'CIRCUTOR' && deviceId.startsWith('ES')) {
        // Para dispositivos CIRCUTOR, el deviceId es el CUPS
        userId = await this.findOrCreateUserByCups(deviceId);
        
        if (!userId) {
          logger.error('No se pudo determinar usuario para dispositivo CIRCUTOR', { deviceId, deviceType });
          return null;
        }
      }

      // Crear el dispositivo
      const deviceUuid = await this.createDevice({
        userId,
        shellyDeviceId: deviceId,
        deviceName: this.generateDeviceName(deviceId, deviceType, additionalInfo),
        deviceType
      });

      if (deviceUuid) {
        // Actualizar cache
        this.deviceCache.set(deviceId, deviceUuid);
        logger.info('Dispositivo creado exitosamente', { 
          deviceId, 
          deviceUuid, 
          deviceType,
          userId 
        });
      }

      return deviceUuid;

    } catch (error) {
      logger.error('Error creando dispositivo automáticamente:', { 
        deviceId, 
        deviceType, 
        error: error.message 
      });
      return null;
    }
  }

  /**
   * Busca o crea un usuario basándose en el CUPS
   * @param {string} cups - Código CUPS
   * @returns {string|null} - UUID del usuario
   */
  async findOrCreateUserByCups(cups) {
    try {
      // Buscar usuario existente por CUPS
      const result = await database.query(
        'SELECT id FROM users WHERE cups = $1',
        [cups]
      );

      if (result.rows.length > 0) {
        return result.rows[0].id;
      }

      // Crear usuario automáticamente
      logger.info('Creando usuario automáticamente para CUPS', { cups });

      const insertResult = await database.query(`
        INSERT INTO users (cups, email, name, password_hash)
        VALUES ($1, $2, $3, $4)
        RETURNING id
      `, [
        cups,
        `${cups}@energina.auto`,
        `Usuario ${cups}`,
        'auto_generated_user' // Hash placeholder para usuarios auto-generados
      ]);

      const userId = insertResult.rows[0].id;
      logger.info('Usuario creado automáticamente', { cups, userId });
      
      return userId;

    } catch (error) {
      logger.error('Error creando usuario por CUPS:', { cups, error: error.message });
      return null;
    }
  }


  /**
   * Crea un nuevo dispositivo en la base de datos
   * @param {Object} deviceData - Datos del dispositivo
   * @returns {string|null} - UUID del dispositivo creado
   */
  async createDevice({ userId, shellyDeviceId, deviceName, deviceType }) {
    try {
      const result = await database.query(`
        INSERT INTO devices (user_id, shelly_device_id, device_name, device_type)
        VALUES ($1, $2, $3, $4)
        RETURNING id
      `, [userId, shellyDeviceId, deviceName, deviceType]);

      logger.debug('Dispositivo creado en BD', {
        deviceUuid: result.rows[0].id,
        shellyDeviceId,
        userId,
        deviceType
      });

      return result.rows[0].id;

    } catch (error) {
      // Si es error de duplicado, intentar resolver de nuevo
      if (error.code === '23505') { // unique_violation
        logger.warn('Dispositivo ya existe (creado concurrentemente)', { shellyDeviceId });
        return await this.resolveDeviceId(shellyDeviceId);
      }
      
      logger.error('Error creando dispositivo:', { 
        userId, 
        shellyDeviceId, 
        deviceName, 
        deviceType, 
        error: error.message 
      });
      return null;
    }
  }

  /**
   * Genera un nombre automático para el dispositivo
   * @param {string} deviceId - ID del dispositivo
   * @param {string} deviceType - Tipo del dispositivo
   * @param {Object} additionalInfo - Información adicional
   * @returns {string} - Nombre generado
   */
  generateDeviceName(deviceId, deviceType, additionalInfo = {}) {
    switch (deviceType) {
      case 'CIRCUTOR':
        return `Contador ${deviceId}`;
      case 'PLUG':
        // Para dispositivos PLUG, extraer el tipo del prefijo
        if (deviceId.startsWith('acs/')) {
          return `ACS ${deviceId.replace('acs/', '')}`;
        }
        return `Dispositivo ${deviceId}`;
      case 'ENERGY_GENERATOR':
        return additionalInfo.generatorName || `Generador ${deviceId}`;
      // Manejar tipos de dispositivos Shelly específicos
      case 'SHELLY_EM':
      case 'SHELLY_SHELLYEM':
        return `Shelly EM ${deviceId}`;
      case 'SHELLY_PLUSPLUGS':
        return `Shelly Plug ${deviceId}`;
      default:
        // Para cualquier dispositivo que empiece con un prefijo conocido
        if (deviceId.startsWith('acs/')) {
          return `ACS ${deviceId.replace('acs/', '')}`;
        } else if (deviceId.startsWith('shelly')) {
          return `Dispositivo Shelly ${deviceId}`;
        }
        return `Dispositivo ${deviceId}`;
    }
  }

  /**
   * Limpia el cache de device IDs
   */
  clearDeviceCache() {
    const previousSize = this.deviceCache.size;
    this.deviceCache.clear();
    this.cacheHits = 0;
    this.cacheMisses = 0;
    
    logger.info('Cache de dispositivos limpiado', { 
      previousSize,
      currentSize: 0 
    });
  }

  /**
   * Obtiene las estadísticas del servicio de persistencia
   * @returns {Object}
   */
  getStats() {
    const cacheTotal = this.cacheHits + this.cacheMisses;
    const cacheHitRate = cacheTotal > 0 ? (this.cacheHits / cacheTotal * 100).toFixed(2) + '%' : '0%';
    const averageInsertTime = this.stats.totalBatches > 0 
      ? Math.round(this.stats.totalInsertTime / this.stats.totalBatches) 
      : 0;

    return {
      ...this.stats,
      cacheSize: this.deviceCache.size,
      cacheHitRate,
      averageInsertTime,
      metricsPerSecond: this.stats.totalInsertTime > 0 
        ? Math.round((this.stats.totalMetrics / this.stats.totalInsertTime) * 1000)
        : 0
    };
  }

  /**
   * Resetea las estadísticas
   */
  resetStats() {
    this.stats = {
      totalInserts: 0,
      totalMetrics: 0,
      totalBatches: 0,
      averageBatchSize: 0,
      lastInsertTime: null,
      totalInsertTime: 0,
      cacheHits: 0,
      cacheMisses: 0,
      errors: 0
    };
    
    this.cacheHits = 0;
    this.cacheMisses = 0;
    
    logger.info('Estadísticas de persistencia reseteadas');
  }

  /**
   * Verifica la conectividad con la base de datos
   * @returns {boolean}
   */
  async healthCheck() {
    try {
      const result = await database.query('SELECT NOW() as current_time');
      logger.debug('Health check de persistencia exitoso', { 
        currentTime: result.rows[0].current_time 
      });
      return true;
    } catch (error) {
      logger.error('Health check de persistencia falló:', error);
      return false;
    }
  }
}

module.exports = PersistenceService;
