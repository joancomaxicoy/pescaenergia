const logger = require('../../utils/logger');
const MqttService = require('./mqttService');
const NormalizerService = require('./normalizerService');
const BufferService = require('./bufferService');
const CompactorService = require('./compactorService');
const PersistenceService = require('./persistenceService');

class MqttDataService {
  constructor() {
    // Inicializar servicios
    this.mqttService = new MqttService();
    this.normalizerService = new NormalizerService();
    this.bufferService = new BufferService();
    this.persistenceService = new PersistenceService();
    this.compactorService = new CompactorService(this.bufferService, this.persistenceService);
    
    // Estado del servicio
    this.isInitialized = false;
    this.isRunning = false;
    
    // Estadísticas globales
    this.globalStats = {
      startTime: null,
      totalMessagesReceived: 0,
      totalMessagesNormalized: 0,
      totalMessagesBuffered: 0,
      lastMessageTime: null
    };
    
    // Configurar handlers
    this.setupMessageHandlers();
  }

  /**
   * Configura los handlers de mensajes entre servicios
   */
  setupMessageHandlers() {
    // Handler principal: MQTT -> Normalizer -> Buffer
    this.mqttService.addMessageHandler((messageData) => {
      this.handleMqttMessage(messageData);
    });
  }

  /**
   * Maneja los mensajes MQTT recibidos
   * @param {Object} messageData - Datos del mensaje MQTT
   */
  handleMqttMessage(messageData) {
    try {
      // Actualizar estadísticas globales
      this.globalStats.totalMessagesReceived++;
      this.globalStats.lastMessageTime = Date.now();

      // Normalizar el mensaje
      const normalizedData = this.normalizerService.normalize(messageData);
      
      if (normalizedData) {
        this.globalStats.totalMessagesNormalized++;
        
        // Enviar al buffer
        this.bufferService.addData(normalizedData);
        this.globalStats.totalMessagesBuffered++;
        
        logger.debug('Mensaje procesado exitosamente', {
          topic: messageData.topic,
          deviceId: normalizedData.deviceId,
          deviceType: normalizedData.deviceType,
          metricsCount: normalizedData.metrics?.length || 0
        });
      } else {
        logger.debug('Mensaje omitido por el normalizador', {
          topic: messageData.topic
        });
      }

    } catch (error) {
      logger.error('Error procesando mensaje MQTT:', {
        topic: messageData.topic,
        error: error.message,
        stack: error.stack
      });
    }
  }

  /**
   * Inicializa todos los servicios
   */
  async initialize() {
    if (this.isInitialized) {
      logger.warn('MqttDataService ya está inicializado');
      return;
    }

    try {
      logger.info('Inicializando MqttDataService...');

      // Inicializar servicios en orden
      await this.mqttService.initialize();
      
      // El normalizador, buffer y persistencia no requieren inicialización async
      logger.info('Servicios MQTT inicializados correctamente');
      
      this.isInitialized = true;
      this.globalStats.startTime = Date.now();

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

    if (this.isRunning) {
      logger.warn('MqttDataService ya está ejecutándose');
      return;
    }

    try {
      logger.info('Iniciando MqttDataService...');

      // Iniciar el compactador (que maneja la persistencia automática)
      this.compactorService.start();
      
      this.isRunning = true;
      this.globalStats.startTime = Date.now();

      logger.info('MqttDataService iniciado correctamente', {
        mqttConnected: this.mqttService.isConnected,
        compactorRunning: this.compactorService.isRunning
      });

    } catch (error) {
      logger.error('Error iniciando MqttDataService:', error);
      throw error;
    }
  }

  /**
   * Detiene todos los servicios
   */
  async stop() {
    if (!this.isRunning) {
      logger.warn('MqttDataService no está ejecutándose');
      return;
    }

    try {
      logger.info('Deteniendo MqttDataService...');

      // Detener servicios en orden inverso
      this.compactorService.stop();
      await this.mqttService.close();
      
      this.isRunning = false;

      logger.info('MqttDataService detenido correctamente');

    } catch (error) {
      logger.error('Error deteniendo MqttDataService:', error);
      throw error;
    }
  }

  /**
   * Recarga la configuración de todos los servicios
   */
  async reloadConfiguration() {
    try {
      logger.info('Recargando configuración de MqttDataService...');

      // Recargar configuración de servicios que lo soporten
      await this.mqttService.reloadConfiguration();
      this.normalizerService.reloadDynamicParsers();

      logger.info('Configuración recargada correctamente');

    } catch (error) {
      logger.error('Error recargando configuración:', error);
      throw error;
    }
  }

  /**
   * Obtiene estadísticas completas de todos los servicios
   * @returns {Object}
   */
  getCompleteStats() {
    const uptime = this.globalStats.startTime 
      ? Math.floor((Date.now() - this.globalStats.startTime) / 1000)
      : 0;

    return {
      global: {
        ...this.globalStats,
        uptime,
        isInitialized: this.isInitialized,
        isRunning: this.isRunning,
        messagesPerSecond: uptime > 0 
          ? Math.round(this.globalStats.totalMessagesReceived / uptime)
          : 0,
        normalizationRate: this.globalStats.totalMessagesReceived > 0
          ? (this.globalStats.totalMessagesNormalized / this.globalStats.totalMessagesReceived * 100).toFixed(2) + '%'
          : '0%'
      },
      mqtt: this.mqttService.getStats(),
      normalizer: this.normalizerService.getStats(),
      buffer: this.bufferService.getStats(),
      compactor: this.compactorService.getStats(),
      persistence: this.persistenceService.getStats()
    };
  }

  /**
   * Obtiene un resumen de estadísticas para monitoreo
   * @returns {Object}
   */
  getStatsSummary() {
    const stats = this.getCompleteStats();
    
    return {
      status: this.isRunning ? 'running' : 'stopped',
      uptime: stats.global.uptime,
      messagesReceived: stats.global.totalMessagesReceived,
      messagesPerSecond: stats.global.messagesPerSecond,
      normalizationRate: stats.global.normalizationRate,
      bufferSize: stats.buffer.currentBufferSize,
      compactorCycles: stats.compactor.cyclesCompleted,
      persistenceErrors: stats.persistence.errors,
      mqttConnected: stats.mqtt.connected
    };
  }

  /**
   * Ejecuta un health check completo
   * @returns {Object}
   */
  async healthCheck() {
    const health = {
      status: 'healthy',
      timestamp: new Date(),
      services: {}
    };

    try {
      // Check MQTT
      health.services.mqtt = {
        connected: this.mqttService.isConnected,
        reconnectAttempts: this.mqttService.reconnectAttempts,
        status: this.mqttService.isConnected ? 'healthy' : 'unhealthy'
      };

      // Check Normalizer
      const normalizerStats = this.normalizerService.getStats();
      health.services.normalizer = {
        successRate: normalizerStats.successRate,
        totalParsers: normalizerStats.totalParsers,
        status: parseFloat(normalizerStats.successRate) > 80 ? 'healthy' : 'degraded'
      };

      // Check Buffer
      const bufferStats = this.bufferService.getStats();
      health.services.buffer = {
        currentSize: bufferStats.currentBufferSize,
        uniqueDevices: bufferStats.currentUniqueDevices,
        status: 'healthy'
      };

      // Check Compactor
      health.services.compactor = await this.compactorService.healthCheck();

      // Check Persistence
      health.services.persistence = {
        connected: await this.persistenceService.healthCheck(),
        errors: this.persistenceService.getStats().errors,
        status: await this.persistenceService.healthCheck() ? 'healthy' : 'unhealthy'
      };

      // Determinar estado general
      const unhealthyServices = Object.values(health.services)
        .filter(service => service.status === 'unhealthy');
      
      const degradedServices = Object.values(health.services)
        .filter(service => service.status === 'degraded');

      if (unhealthyServices.length > 0) {
        health.status = 'unhealthy';
      } else if (degradedServices.length > 0) {
        health.status = 'degraded';
      }

      health.summary = {
        totalServices: Object.keys(health.services).length,
        healthyServices: Object.values(health.services).filter(s => s.status === 'healthy').length,
        degradedServices: degradedServices.length,
        unhealthyServices: unhealthyServices.length
      };

    } catch (error) {
      health.status = 'error';
      health.error = error.message;
      logger.error('Error en health check:', error);
    }

    return health;
  }

  /**
   * Ejecuta un ciclo de compactación manual
   */
  async runManualCompaction() {
    await this.compactorService.runManualCycle();
  }

  /**
   * Limpia todos los buffers y caches
   */
  clearAllBuffers() {
    this.bufferService.clear();
    this.persistenceService.clearDeviceCache();
    
    logger.info('Todos los buffers y caches limpiados');
  }

  /**
   * Resetea todas las estadísticas
   */
  resetAllStats() {
    this.globalStats = {
      startTime: Date.now(),
      totalMessagesReceived: 0,
      totalMessagesNormalized: 0,
      totalMessagesBuffered: 0,
      lastMessageTime: null
    };

    this.normalizerService.resetStats();
    this.bufferService.resetStats();
    this.compactorService.resetStats();
    this.persistenceService.resetStats();
    
    logger.info('Todas las estadísticas reseteadas');
  }

  /**
   * Obtiene información detallada del buffer actual
   */
  getBufferInfo() {
    return this.bufferService.getBufferInfo();
  }

  /**
   * Configura el intervalo de compactación
   * @param {number} interval - Intervalo en milisegundos
   */
  setCompactionInterval(interval) {
    this.compactorService.setCompactionInterval(interval);
  }

  /**
   * Configura los tipos de agregación
   * @param {Array<string>} types - Tipos de agregación
   */
  setAggregationTypes(types) {
    this.compactorService.setAggregationTypes(types);
  }
}

module.exports = MqttDataService;
