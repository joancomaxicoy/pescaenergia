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

    //console.log('Datos de potencia obtenidos y almacenados en cache', { cacheKey, userIds, freshData });
    return freshData;
  }

  /**
   * Evalúa si un dispositivo debe estar encendido según el exceso de potencia con histéresis
   * Usa dos umbrales para evitar oscilaciones (flapping):
   * - powerOnThreshold: umbral para ENCENDER (debe ser mayor)
   * - powerOffThreshold: umbral para APAGAR (debe ser menor)
   * 
   * @param {Object} config - Configuración de automatización del dispositivo
   * @param {Object} currentPowerData - Datos de potencia actuales
   * @param {boolean} currentDeviceState - Estado actual del dispositivo (true=ON, false=OFF)
   * @returns {boolean|null} - true si debe estar ON, false si debe estar OFF, null si no hay cambio
   */
  evaluate(config, currentPowerData, currentDeviceState = false) {
    console.log('Evaluando configuración de power', { config, currentPowerData, currentDeviceState });
    try {
      // Obtener umbrales de potencia configurados (en kW)
      const powerOnThreshold = parseFloat(config.config.powerOnThreshold || config.config.power) || 0;
      const powerOffThreshold = parseFloat(config.config.powerOffThreshold) || (powerOnThreshold * 0.4); // Default: 40% del umbral ON

      // Diferencia de potencia actual (generación - consumo) en Watts
      const differenceKW = currentPowerData[config.userId]?.difference || 0;
      const differenceW = differenceKW * 1000;

      // Convertir umbrales a Watts para comparación
      const onThresholdW = powerOnThreshold * 1000;
      const offThresholdW = powerOffThreshold * 1000;

      // Validación de umbrales
      if (powerOnThreshold <= 0) {
        logger.warn('Umbral de encendido inválido', { powerOnThreshold });
        return null;
      }
      //ojo modificat joan, se permite umbral de apagado en 0 o incluso negativo para casos donde se quiera apagar con cualquier exceso de generación
      if (powerOffThreshold < -10) {
        logger.warn('Umbral de apagado inválido', { powerOffThreshold });
        return null;
      }

      if (powerOffThreshold >= powerOnThreshold) {
        logger.warn('Umbral de apagado debe ser menor que umbral de encendido', {
          powerOnThreshold,
          powerOffThreshold
        });
        return null;
      }

      // Lógica de histéresis

      //es el bit de on i off entic 
      let shouldBeOn = false;
      // afegit per fer proves tenim un bit de stop 
      let shouldBeOff = false;

      if (currentDeviceState) {
        // Si el dispositivo está ENCENDIDO, solo apagar si cae por debajo del umbral de apagado
        shouldBeOn = differenceW >= offThresholdW;
        // afegit per fer proves, si el umbral de apagado se cumple, se activa un bit de stop que podria ser usat per altres automatitzacions o alertes
        shouldBeOff = offThresholdW >= differenceW;

        logger.debug('Evaluación power (dispositivo ON)', {
          deviceId: config.deviceId,
          deviceName: config.deviceName,
          currentState: 'ON',
          differenceW,
          offThresholdW,
          decision: shouldBeOn ? 'MANTENER ON' : 'APAGAR'
        });
      } else {
        // Si el dispositivo está APAGADO, solo encender si supera el umbral de encendido
        shouldBeOn = differenceW >= onThresholdW;

        logger.debug('Evaluación power (dispositivo OFF)', {
          deviceId: config.deviceId,
          deviceName: config.deviceName,
          currentState: 'OFF',
          differenceW,
          onThresholdW,
          decision: shouldBeOn ? 'ENCENDER' : 'MANTENER OFF'
        });
      }
      console.log('Resultado de evaluación de power', { deviceId: config.deviceId, deviceName: config.deviceName, shouldBeOn, shouldBeOff });
      return shouldBeOn;

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
          // Obtener estado actual del dispositivo desde cache
          const currentDeviceState = this.memoryCache.getDeviceState(configData.deviceId)?.output || false;

          // Evaluar con histéresis usando el estado actual
          const evaluation = this.evaluate(configData, currentPowerData, currentDeviceState);

          results.push({
            deviceId: configData.deviceId,
            deviceName: configData.deviceName,
            config: configData.config,
            evaluation: evaluation,
            currentState: currentDeviceState,
            powerOnThreshold: parseFloat(configData.config.powerOnThreshold || configData.config.power) || 0,
            powerOffThreshold: parseFloat(configData.config.powerOffThreshold) || 0
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
      // console.log('Evaluación múltiple de power completada', { results }); 
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
