const logger = require('../../utils/logger');
const DeviceStateService = require('./deviceStateService');

class MqttDataService {
  constructor(bufferService, persistenceService) {
    this.bufferService = bufferService;
    this.persistenceService = persistenceService;
    this.deviceStateService = new DeviceStateService();
    
    // Estadísticas
    this.stats = {
      messagesProcessed: 0,
      statesProcessed: 0,
      timeSeriesProcessed: 0,
      statesErrors: 0,
      timeSeriesErrors: 0,
      lastError: null,
      startTime: Date.now()
    };
  }

  /**
   * Procesa datos normalizados y clasificados del NormalizerService
   * Implementa el flujo dual: estados inmediatos + series temporales al buffer
   * @param {Object} classifiedData - Datos clasificados del normalizador
   */
  async processClassifiedData(classifiedData) {
    this.stats.messagesProcessed++;
    
    try {
      const { 
        deviceId, 
        deviceType, 
        timestamp, 
        stateMetrics, 
        timeSeriesMetrics,
        generatorName 
      } = classifiedData;

      // Procesar estados inmediatamente (solo para dispositivos físicos)
      if (stateMetrics.length > 0 && !deviceId.startsWith('gen-')) {
        await this.processStatesImmediately(deviceId, stateMetrics);
      }

      // Procesar series temporales (enviar al buffer para agregación)
      if (timeSeriesMetrics.length > 0) {
        this.processTimeSeriesMetrics(deviceId, deviceType, timestamp, timeSeriesMetrics, generatorName);
      }

      logger.debug('Datos procesados con flujo dual', {
        deviceId,
        deviceType,
        statesProcessed: stateMetrics.length,
        timeSeriesProcessed: timeSeriesMetrics.length,
        isGenerator: deviceId.startsWith('gen-')
      });

    } catch (error) {
      this.stats.lastError = {
        message: error.message,
        timestamp: new Date(),
        deviceId: classifiedData.deviceId
      };

      logger.error('Error procesando datos clasificados:', {
        error: error.message,
        deviceId: classifiedData.deviceId,
        stack: error.stack
      });
    }
  }

  /**
   * Procesa estados inmediatamente usando DeviceStateService
   * @param {string} deviceId - ID del dispositivo
   * @param {Array} stateMetrics - Array de métricas de estado
   */
  async processStatesImmediately(deviceId, stateMetrics) {
    try {
      // Resolver el UUID del dispositivo
      let deviceUuid;
      
      try {
        deviceUuid = await this.persistenceService.resolveDeviceId(deviceId);
      } catch (error) {
        // Si el dispositivo no existe, intentar crearlo automáticamente
        logger.info('Dispositivo no encontrado para estados, creando automáticamente', { 
          deviceId,
          statesCount: stateMetrics.length
        });

        const deviceType = stateMetrics[0]?.deviceType || 'UNKNOWN';
        deviceUuid = await this.persistenceService.findOrCreateDevice(deviceId, deviceType, {});
        
        if (!deviceUuid) {
          logger.error('No se pudo crear dispositivo para estados', { 
            deviceId,
            statesCount: stateMetrics.length
          });
          this.stats.statesErrors++;
          return;
        }
      }

      // Preparar estados para DeviceStateService
      const states = stateMetrics.map(metric => ({
        stateName: metric.metricName,
        stateValue: metric.value,
        stateType: this.determineStateType(metric.value)
      }));

      // Actualizar estados inmediatamente
      await this.deviceStateService.updateMultipleDeviceStates(deviceUuid, states);
      
      this.stats.statesProcessed += states.length;
      
      logger.debug('Estados actualizados inmediatamente', {
        deviceId,
        deviceUuid,
        statesCount: states.length
      });

    } catch (error) {
      this.stats.statesErrors++;
      logger.error('Error procesando estados inmediatamente:', {
        error: error.message,
        deviceId,
        statesCount: stateMetrics.length
      });
    }
  }

  /**
   * Procesa métricas de series temporales enviándolas al buffer
   * @param {string} deviceId - ID del dispositivo
   * @param {string} deviceType - Tipo del dispositivo
   * @param {Date} timestamp - Timestamp del mensaje
   * @param {Array} timeSeriesMetrics - Array de métricas de series temporales
   * @param {string} generatorName - Nombre del generador (si aplica)
   */
  processTimeSeriesMetrics(deviceId, deviceType, timestamp, timeSeriesMetrics, generatorName) {
    try {
      // Convertir métricas al formato esperado por el buffer
      const metricsForBuffer = timeSeriesMetrics.map(metric => ({
        metricName: metric.metricName,
        value: metric.value,
        unit: metric.unit,
        deviceType,
        generatorName,
        timestamp
      }));

      // Enviar al buffer para agregación posterior
      this.bufferService.addMetrics(deviceId, metricsForBuffer);
      
      this.stats.timeSeriesProcessed += metricsForBuffer.length;
      
      logger.debug('Métricas de series temporales enviadas al buffer', {
        deviceId,
        deviceType,
        metricsCount: metricsForBuffer.length,
        isGenerator: !!generatorName
      });

    } catch (error) {
      this.stats.timeSeriesErrors++;
      logger.error('Error procesando métricas de series temporales:', {
        error: error.message,
        deviceId,
        metricsCount: timeSeriesMetrics.length
      });
    }
  }

  /**
   * Determina el tipo de estado basándose en el valor
   * @param {any} value - Valor del estado
   * @returns {string} - 'boolean', 'numeric', 'string', o 'json'
   */
  determineStateType(value) {
    if (typeof value === 'boolean') {
      return 'boolean';
    } else if (typeof value === 'number') {
      return 'numeric';
    } else if (typeof value === 'object' && value !== null) {
      return 'json';
    } else {
      return 'string';
    }
  }

  /**
   * Procesa datos normalizados del formato anterior (compatibilidad)
   * @param {Object} normalizedData - Datos normalizados sin clasificar
   */
  async processLegacyData(normalizedData) {
    logger.warn('Procesando datos en formato legacy (sin clasificar)', {
      deviceId: normalizedData.deviceId,
      metricsCount: normalizedData.metrics?.length || 0
    });

    // Enviar directamente al buffer como antes
    this.bufferService.addMetrics(normalizedData.deviceId, normalizedData.metrics || []);
  }

  /**
   * Obtiene las estadísticas del servicio
   * @returns {Object}
   */
  getStats() {
    const uptime = Date.now() - this.stats.startTime;
    const totalProcessed = this.stats.statesProcessed + this.stats.timeSeriesProcessed;
    const totalErrors = this.stats.statesErrors + this.stats.timeSeriesErrors;
    
    return {
      ...this.stats,
      uptime: Math.floor(uptime / 1000),
      totalProcessed,
      totalErrors,
      errorRate: this.stats.messagesProcessed > 0 
        ? (totalErrors / this.stats.messagesProcessed * 100).toFixed(2) + '%'
        : '0%',
      stateProcessingRate: this.stats.messagesProcessed > 0
        ? (this.stats.statesProcessed / this.stats.messagesProcessed).toFixed(2)
        : '0',
      timeSeriesProcessingRate: this.stats.messagesProcessed > 0
        ? (this.stats.timeSeriesProcessed / this.stats.messagesProcessed).toFixed(2)
        : '0',
      bufferStats: this.bufferService.getStats(),
      deviceStateStats: this.deviceStateService.getStats()
    };
  }

  /**
   * Resetea las estadísticas
   */
  resetStats() {
    this.stats = {
      messagesProcessed: 0,
      statesProcessed: 0,
      timeSeriesProcessed: 0,
      statesErrors: 0,
      timeSeriesErrors: 0,
      lastError: null,
      startTime: Date.now()
    };
    
    logger.info('Estadísticas del MqttDataService reseteadas');
  }

  /**
   * Verifica el estado de salud del servicio
   * @returns {Object}
   */
  async healthCheck() {
    try {
      const bufferHealth = this.bufferService.getStats();
      const deviceStateHealth = await this.deviceStateService.healthCheck();
      
      return {
        status: 'healthy',
        stats: this.getStats(),
        bufferHealth,
        deviceStateHealth,
        errors: this.stats.totalErrors,
        lastError: this.stats.lastError
      };

    } catch (error) {
      return {
        status: 'unhealthy',
        error: error.message,
        stats: this.getStats(),
        lastError: this.stats.lastError
      };
    }
  }
}

module.exports = MqttDataService;
