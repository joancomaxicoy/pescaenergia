const logger = require('../../utils/logger');
const PowerDifferenceService = require('../powerDifferenceService');

/**
 * Evaluador de automatizaciones por potencia
 * Determina si un dispositivo debe estar encendido o apagado según el exceso de generación
 */
class PowerEvaluator {
  constructor(memoryCache) {
    this.memoryCache = memoryCache;
    this.lastEvaluationTime = null;
    this.lastPowerDifference = null;
    this.PowerDifferenceService = new PowerDifferenceService();
    // Cache para almacenar resultados de getPowerDifference por 5 minutos
    this.powerDifferenceCache = new Map();
    this.CACHE_DURATION_MS = 5 * 60 * 1000; // 5 minutos en milisegundos
  }

  /**
   * Genera una clave de cache única para un array de userIds
   * @param {Array} userIds - Array de IDs de usuario
   * @returns {string} - Clave de cache
   */
  generateCacheKey(userIds) {
    return userIds.sort().join(',');
  }

  /**
   * Verifica si el cache para una clave específica es válido (no ha expirado)
   * @param {string} cacheKey - Clave del cache
   * @returns {boolean} - true si el cache es válido
   */
  isCacheValid(cacheKey) {
    const cachedItem = this.powerDifferenceCache.get(cacheKey);
    if (!cachedItem) {
      return false;
    }

    const now = Date.now();
    const timeDiff = now - cachedItem.timestamp;

    return timeDiff < this.CACHE_DURATION_MS;
  }

  /**
   * Obtiene datos de potencia desde cache o servicio
   * @param {Array} userIds - Array de IDs de usuario
   * @returns {Object} - Datos de potencia
   */
  async getPowerDifferenceCached(userIds) {
    const cacheKey = this.generateCacheKey(userIds);

    // Verificar si hay datos en cache válidos
    if (this.isCacheValid(cacheKey)) {
      logger.debug('Usando datos de potencia desde cache', { cacheKey, userIds });
      return this.powerDifferenceCache.get(cacheKey).data;
    }

    // Obtener datos frescos del servicio
    logger.debug('Obteniendo datos de potencia frescos (cache expirado o no existe)', { cacheKey, userIds });
    const freshData = await this.PowerDifferenceService.getPowerDifference(userIds);

    // Almacenar en cache
    this.powerDifferenceCache.set(cacheKey, {
      data: freshData,
      timestamp: Date.now()
    });

    return freshData;
  }

  /**
   * Evalúa si un dispositivo debe estar encendido según el exceso de potencia
   * @param {Object} config - Configuración de automatización del dispositivo
   * @param {Object} powerData - Datos de potencia actuales (opcional, se calcula si no se proporciona)
   * @returns {boolean|null} - true si debe estar ON, false si debe estar OFF, null si no hay cambio
   */
  evaluate(config, currentPowerData) {
    try {
      
      // Obtener umbral de potencia configurado
      const powerThreshold = parseFloat(config.config.power) || 0;
      const difference = (currentPowerData[config.userId]?.difference * 1000 ) || 0;

      if (powerThreshold <= 0) {
        logger.warn('Umbral de potencia inválido', { powerThreshold });
        return null;
      }

      let powerDifference = difference > powerThreshold;

      return powerDifference;

      // // diferencia entre geeración y consumo
      // let powerDifference = difference > powerThreshold;

      // console.log(powerDifference);

      // return powerDifference;

    } catch (error) {
      logger.error('Error evaluando configuración power', {
        error: error.message,
        config
      });
      return null;
    }
  }

  /**
   * Evalúa múltiples dispositivos con automatización por potencia
   * @param {Array} configs - Array de configuraciones de automatización
   * @param {Object} powerData - Datos de potencia actuales (opcional)
   * @returns {Array} - Array de resultados de evaluación
   */
  async evaluateMultiple(configs) {
    try {
      if (!Array.isArray(configs) || configs.length === 0) {
        return [];
      }

      const userIds = [...new Set(configs.map(c => c.userId).filter(id => id))];
      if (userIds.length === 0) {
        logger.warn('No se encontraron userIds válidos en las configuraciones de power');
        return [];
      }

      const currentPowerData = await this.getPowerDifferenceCached(userIds);
     
      const results = [];


      for (const configData of configs) {
        try {
          // true o false
          const evaluation = this.evaluate(configData, currentPowerData);
          
          results.push({
            deviceId: configData.deviceId,
            deviceName: configData.deviceName,
            config: configData.config,
            evaluation: evaluation,
            powerThreshold: parseFloat(configData.config.power) || 0
          });

        } catch (configError) {
          logger.error('Error evaluando configuración individual', {
            deviceId: configData.deviceId,
            deviceName: configData.deviceName,
            error: configError.message
          });

          results.push({
            deviceId: configData.deviceId,
            deviceName: configData.deviceName,
            config: configData.config,
            evaluation: null,
            error: configError.message
          });
        }
      }

      logger.debug('Evaluación múltiple de power completada', {
        totalConfigs: configs.length,
        successfulEvaluations: results.filter(r => r.evaluation !== null).length,
        onDevices: results.filter(r => r.evaluation === true).length,
        offDevices: results.filter(r => r.evaluation === false).length,
        errors: results.filter(r => r.error).length
      });

      return results;

    } catch (error) {
      logger.error('Error en evaluación múltiple de power', {
        error: error.message,
        configsCount: configs?.length || 0
      });
      return [];
    }
  }

}

module.exports = PowerEvaluator;
