const logger = require('../../utils/logger');
const MqttService = require('./mqttService');
const NormalizerService = require('./normalizerService');
const BufferService = require('./bufferService');
const PersistenceService = require('./persistenceService');
const CompactorService = require('./compactorService');
const DeviceStateService = require('./deviceStateService');

class MqttDataService {
  constructor() {
    // Servicios principales
    this.mqttService = new MqttService();
    this.normalizerService = new NormalizerService();
    this.bufferService = new BufferService();
    this.persistenceService = new PersistenceService();
    this.compactorService = new CompactorService(this.bufferService, this.persistenceService);
    this.deviceStateService = new DeviceStateService();
    
    // Estado del servicio
    this.isRunning = false;
    this.isInitialized = false;
    
    // Estadísticas del coordinador
    this.stats = {
      messagesProcessed: 0,
      statesProcessedImmediately: 0,
      timeSeriesBuffered: 0,
      errors: 0,
      lastError: null,
      startTime: Date.now()
    };
  }

  /**
   * Inicializa todos los servicios MQTT
   */
  async initialize() {
    try {
      logger.info('Inicializando MqttDataService coordinador...');

      // Inicializar servicios base
      await this.mqttService.initialize();
      logger.info('MqttService inicializado');

      // Configurar el handler de mensajes MQTT con flujo dual
      this.mqttService.addMessageHandler(this.handleMqttMessage.bind(this));
      logger.info('Handler de mensajes MQTT configurado con flujo dual');

      this.isInitialized = true;
      logger.info('MqttDataService coordinador inicializado correctamente');

    } catch (error) {
      logger.error('Error inicializando MqttDataService:', error);
      throw error;
    }
  }

  /**
   * Inicia todos los servicios
   */
  async start() {
    if (!this.isInitialized) {
      throw new Error('MqttDataService debe ser inicializado antes de iniciarse');
    }

    try {
      logger.info('Iniciando servicios MQTT...');

      // Iniciar el compactador (para series temporales)
      this.compactorService.start();
      logger.info('CompactorService iniciado');

      this.isRunning = true;
      this.stats.startTime = Date.now();

      logger.info('Todos los servicios MQTT iniciados correctamente');
      logger.info('🔄 Flujo dual activo: Estados inmediatos + Series temporales agregadas');

    } catch (error) {
      logger.error('Error iniciando servicios MQTT:', error);
      throw error;
    }
  }

  /**
   * Maneja mensajes MQTT con el nuevo flujo dual
   * @param {Object} messageData - Datos del mensaje MQTT
   */
  async handleMqttMessage(messageData) {
    this.stats.messagesProcessed++;

    try {
      // 1. Normalizar el mensaje
      const normalizedData = this.normalizerService.normalize(messageData);
      
      if (!normalizedData) {
        // Mensaje no procesable, omitir silenciosamente
        return;
      }

      // 2. Verificar si tiene clasificación (nuevo flujo)
      if (normalizedData.stateMetrics !== undefined && normalizedData.timeSeriesMetrics !== undefined) {
        // NUEVO FLUJO DUAL
        await this.processDualFlow(normalizedData);
      } else {
        // FLUJO LEGACY (compatibilidad)
        await this.processLegacyFlow(normalizedData);
      }

    } catch (error) {
      this.stats.errors++;
      this.stats.lastError = {
        message: error.message,
        timestamp: new Date(),
        topic: messageData.topic
      };

      logger.error('Error procesando mensaje MQTT:', {
        topic: messageData.topic,
        error: error.message
      });
    }
  }

  /**
   * Procesa datos con el nuevo flujo dual
   * @param {Object} classifiedData - Datos clasificados del normalizador
   */
  async processDualFlow(classifiedData) {
    const { 
      deviceId, 
      deviceType, 
      timestamp, 
      stateMetrics, 
      timeSeriesMetrics 
    } = classifiedData;

    // PROCESAR ESTADOS INMEDIATAMENTE
    if (stateMetrics.length > 0 && !deviceId.startsWith('gen-')) {
      try {
        await this.processStatesImmediately(deviceId, stateMetrics);
        this.stats.statesProcessedImmediately += stateMetrics.length;
      } catch (error) {
        logger.error('Error procesando estados inmediatamente:', {
          deviceId,
          error: error.message,
          statesCount: stateMetrics.length
        });
      }
    }

    // PROCESAR SERIES TEMPORALES (al buffer para agregación)
    if (timeSeriesMetrics.length > 0) {
      try {
        this.processTimeSeriesMetrics(deviceId, deviceType, timestamp, timeSeriesMetrics);
        this.stats.timeSeriesBuffered += timeSeriesMetrics.length;
      } catch (error) {
        logger.error('Error procesando series temporales:', {
          deviceId,
          error: error.message,
          metricsCount: timeSeriesMetrics.length
        });
      }
    }

    logger.debug('Mensaje procesado con flujo dual', {
      deviceId,
      deviceType,
      statesProcessed: stateMetrics.length,
      timeSeriesBuffered: timeSeriesMetrics.length
    });
  }

  /**
   * Procesa estados inmediatamente usando DeviceStateService
   * @param {string} deviceId - ID del dispositivo
   * @param {Array} stateMetrics - Array de métricas de estado
   */
  async processStatesImmediately(deviceId, stateMetrics) {
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
        throw new Error(`No se pudo crear dispositivo para estados: ${deviceId}`);
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
    
    logger.debug('Estados actualizados inmediatamente', {
      deviceId,
      deviceUuid,
      statesCount: states.length
    });
  }

  /**
   * Procesa métricas de series temporales enviándolas al buffer
   * @param {string} deviceId - ID del dispositivo
   * @param {string} deviceType - Tipo del dispositivo
   * @param {Date} timestamp - Timestamp del mensaje
   * @param {Array} timeSeriesMetrics - Array de métricas de series temporales
   */
  processTimeSeriesMetrics(deviceId, deviceType, timestamp, timeSeriesMetrics) {
    // Convertir métricas al formato esperado por el buffer
    const metricsForBuffer = timeSeriesMetrics.map(metric => ({
      name: metric.metricName,  // BufferService espera 'name', no 'metricName'
      value: metric.value,
      unit: metric.unit
    }));

    // Crear objeto normalizado para BufferService.addData()
    const normalizedData = {
      deviceId,
      deviceType,
      timestamp,
      metrics: metricsForBuffer
    };

    // Enviar al buffer para agregación posterior usando el método correcto
    this.bufferService.addData(normalizedData);
    
    logger.debug('Métricas de series temporales enviadas al buffer', {
      deviceId,
      deviceType,
      metricsCount: metricsForBuffer.length
    });
  }

  /**
   * Procesa datos con el flujo legacy (compatibilidad)
   * @param {Object} normalizedData - Datos normalizados sin clasificar
   */
  async processLegacyFlow(normalizedData) {
    logger.debug('Procesando datos en formato legacy (sin clasificar)', {
      deviceId: normalizedData.deviceId,
      metricsCount: normalizedData.metrics?.length || 0
    });

    // Enviar directamente al buffer como antes usando el método correcto
    this.bufferService.addData(normalizedData);
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
   * Detiene todos los servicios
   */
  async stop() {
    try {
      logger.info('Deteniendo servicios MQTT...');

      // Detener compactador
      if (this.compactorService) {
        this.compactorService.stop();
      }

      // Cerrar conexión MQTT
      if (this.mqttService) {
        await this.mqttService.close();
      }

      this.isRunning = false;
      logger.info('Servicios MQTT detenidos correctamente');

    } catch (error) {
      logger.error('Error deteniendo servicios MQTT:', error);
      throw error;
    }
  }

  /**
   * Ejecuta un ciclo de compactación manual
   */
  async runManualCompaction() {
    if (this.compactorService) {
      await this.compactorService.runManualCycle();
    }
  }

  /**
   * Obtiene estadísticas resumidas del sistema
   */
  getStatsSummary() {
    const uptime = Date.now() - this.stats.startTime;
    
    return {
      coordinator: {
        ...this.stats,
        uptime: Math.floor(uptime / 1000),
        isRunning: this.isRunning
      },
      mqtt: this.mqttService.getStats(),
      normalizer: this.normalizerService.getStats(),
      buffer: this.bufferService.getStats(),
      compactor: this.compactorService.getStats(),
      persistence: this.persistenceService.getStats(),
      deviceStates: this.deviceStateService.getStats()
    };
  }

  /**
   * Obtiene estadísticas completas del sistema
   */
  getCompleteStats() {
    return this.getStatsSummary();
  }

  /**
   * Obtiene información del buffer actual
   */
  getBufferInfo() {
    return this.bufferService.getStats();
  }

  /**
   * Limpia todos los buffers
   */
  clearAllBuffers() {
    this.bufferService.clear();
    logger.info('Todos los buffers limpiados');
  }

  /**
   * Resetea todas las estadísticas
   */
  resetAllStats() {
    this.stats = {
      messagesProcessed: 0,
      statesProcessedImmediately: 0,
      timeSeriesBuffered: 0,
      errors: 0,
      lastError: null,
      startTime: Date.now()
    };

    this.normalizerService.resetStats();
    this.compactorService.resetStats();
    this.deviceStateService.resetStats();
    
    logger.info('Todas las estadísticas reseteadas');
  }

  /**
   * Verifica el estado de salud del sistema completo
   */
  async healthCheck() {
    try {
      const services = {
        mqtt: {
          status: this.mqttService.isConnected ? 'healthy' : 'unhealthy',
          stats: this.mqttService.getStats()
        },
        normalizer: {
          status: 'healthy',
          stats: this.normalizerService.getStats()
        },
        buffer: {
          status: 'healthy',
          stats: this.bufferService.getStats()
        },
        compactor: {
          status: this.compactorService.isRunning ? 'healthy' : 'stopped',
          stats: this.compactorService.getStats()
        },
        persistence: {
          status: 'healthy',
          stats: this.persistenceService.getStats()
        },
        deviceStates: await this.deviceStateService.healthCheck()
      };

      const healthyServices = Object.values(services).filter(s => s.status === 'healthy').length;
      const totalServices = Object.keys(services).length;
      const overallStatus = healthyServices === totalServices ? 'healthy' : 'degraded';

      return {
        status: overallStatus,
        services,
        summary: {
          healthyServices,
          totalServices,
          coordinator: {
            isRunning: this.isRunning,
            isInitialized: this.isInitialized,
            errors: this.stats.errors,
            lastError: this.stats.lastError
          }
        }
      };

    } catch (error) {
      return {
        status: 'unhealthy',
        error: error.message,
        summary: {
          healthyServices: 0,
          totalServices: 6,
          coordinator: {
            isRunning: this.isRunning,
            isInitialized: this.isInitialized,
            errors: this.stats.errors + 1,
            lastError: { message: error.message, timestamp: new Date() }
          }
        }
      };
    }
  }
}

module.exports = MqttDataService;
