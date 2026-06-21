const logger = require('../../utils/logger');
const MemoryCache = require('./MemoryCache');
const ScheduleEvaluator = require('./ScheduleEvaluator');
const PowerEvaluator = require('./PowerEvaluator');

/**
 * Gestor principal de automatizaciones (Singleton)
 * Coordina el cache en memoria, los evaluadores y el timer de ejecución
 */
class AutomationManager {
  constructor(plugsService = null, mqttService = null) {
    // Implementar patrón singleton
    if (AutomationManager.instance) {
      // Si ya existe una instancia, actualizar las referencias de servicios si se proporcionan
      if (plugsService) {
        AutomationManager.instance.plugsService = plugsService;
      }
      if (mqttService) {
        AutomationManager.instance.mqttService = mqttService;
      }
      return AutomationManager.instance;
    }

    this.plugsService = plugsService;
    this.mqttService = mqttService;

    // Componentes principales
    this.memoryCache = new MemoryCache();
    this.scheduleEvaluator = new ScheduleEvaluator();
    this.powerEvaluator = new PowerEvaluator(this.memoryCache);

    // Timer de ejecución
    this.executionTimer = null;
    this.isRunning = false;
    this.executionInterval = parseInt(process.env.AUTOMATION_TIMER_INTERVAL) || 1; // segundos

    // Estadísticas
    this.stats = {
      cyclesExecuted: 0,
      scheduleEvaluations: 0,
      powerEvaluations: 0,
      actionsExecuted: 0,
      errors: 0,
      lastError: null,
      startTime: null,
      lastCycleTime: null,
      lastCycleDuration: 0
    };

    // Configuración de eventos MQTT
    this.mqttHandlerRegistered = false;

    // Guardar la instancia singleton
    AutomationManager.instance = this;
  }

  /**
   * Método estático para obtener la instancia singleton
   */
  static getInstance(plugsService = null, mqttService = null) {
    if (!AutomationManager.instance) {
      AutomationManager.instance = new AutomationManager(plugsService, mqttService);
    } else {
      // Actualizar referencias de servicios si se proporcionan
      if (plugsService) {
        AutomationManager.instance.plugsService = plugsService;
      }
      if (mqttService) {
        AutomationManager.instance.mqttService = mqttService;
      }
    }
    return AutomationManager.instance;
  }

  /**
   * Actualiza las referencias de servicios
   */
  updateServices(plugsService = null, mqttService = null) {
    if (plugsService) {
      this.plugsService = plugsService;
      logger.info('PlugsService actualizado en AutomationManager singleton');
    }
    if (mqttService) {
      this.mqttService = mqttService;
      logger.info('MqttService actualizado en AutomationManager singleton');
    }
  }

  /**
   * Inicializa el gestor de automatizaciones
   */
  async initialize() {
    try {
      logger.info('Inicializando AutomationManager...');

      // Inicializar cache en memoria
      await this.memoryCache.initialize();

      // Registrar handler MQTT para eventos de potencia
      this.registerMqttHandler();

      logger.info('AutomationManager inicializado exitosamente', {
        executionInterval: this.executionInterval + 's',
        cacheStats: this.memoryCache.getStats()
      });

    } catch (error) {
      logger.error('Error inicializando AutomationManager:', error);
      throw error;
    }
  }

  /**
   * Inicia el timer de ejecución de automatizaciones
   */
  start() {
    try {
      if (this.isRunning) {
        logger.warn('AutomationManager ya está ejecutándose');
        return;
      }

      logger.info('Iniciando AutomationManager', {
        intervalSeconds: this.executionInterval
      });

      this.stats.startTime = new Date();
      this.isRunning = true;

      // Ejecutar primer ciclo inmediatamente
      this.executeCycle().catch(error => {
        logger.error('Error en primer ciclo de automatización:', error);
      });

      // Configurar timer para ejecuciones periódicas
      this.executionTimer = setInterval(async () => {
        try {
          //logger.info("Ejecutando ciclo de automatización...");
          await this.executeCycle();
        } catch (error) {
          this.stats.errors++;
          this.stats.lastError = {
            message: error.message,
            timestamp: new Date()
          };
          logger.error('Error en ciclo de automatización:', error);
        }
      }, this.executionInterval * 1000);

      logger.info('AutomationManager iniciado exitosamente');

    } catch (error) {
      logger.error('Error iniciando AutomationManager:', error);
      throw error;
    }
  }

  /**
   * Detiene el timer de ejecución
   */
  stop() {
    try {
      if (!this.isRunning) {
        logger.warn('AutomationManager no está ejecutándose');
        return;
      }

      logger.info('Deteniendo AutomationManager...');

      if (this.executionTimer) {
        clearInterval(this.executionTimer);
        this.executionTimer = null;
      }

      this.isRunning = false;

      logger.info('AutomationManager detenido exitosamente');

    } catch (error) {
      logger.error('Error deteniendo AutomationManager:', error);
      throw error;
    }
  }

  /**
   * Ejecuta un ciclo completo de evaluación de automatizaciones
   */
  async executeCycle() {
    const cycleStartTime = Date.now();
    this.stats.lastCycleTime = new Date();

    try {
      logger.debug('Iniciando ciclo de automatización');
      // Obtener todas las configuraciones activas
      const allConfigs = this.memoryCache.getAllAutomationConfigs();


      if (allConfigs.length === 0) {
        logger.debug('No hay configuraciones de automatización activas');
        return;
      }

      // Separar por tipo de automatización
      const scheduleConfigs = allConfigs.filter(config => config.config.type === 'schedule');
      const powerConfigs = allConfigs.filter(config => config.config.type === 'power');

      logger.debug('Configuraciones encontradas', {
        total: allConfigs.length,
        schedule: scheduleConfigs.length,
        power: powerConfigs.length
      });

      // Evaluar automatizaciones por horario
      if (scheduleConfigs.length > 0) {
        await this.evaluateScheduleAutomations(scheduleConfigs);
      }

      // Evaluar automatizaciones por potencia
      if (powerConfigs.length > 0) {
        await this.evaluatePowerAutomations(powerConfigs);
      }

      this.stats.cyclesExecuted++;

    } catch (error) {
      logger.error('Error en ciclo de automatización:', error);
      throw error;
    } finally {
      this.stats.lastCycleDuration = Date.now() - cycleStartTime;

      if (this.stats.lastCycleDuration > 5000) { // Más de 5 segundos
        logger.warn('Ciclo de automatización lento', {
          duration: this.stats.lastCycleDuration + 'ms'
        });
      }
    }
  }

  /**
   * Evalúa automatizaciones por horario
   */
  async evaluateScheduleAutomations(scheduleConfigs) {
    try {
      logger.debug('Evaluando automatizaciones por horario', {
        count: scheduleConfigs.length
      });

      for (const configData of scheduleConfigs) {
        try {
          const evaluation = this.scheduleEvaluator.evaluate(configData.config);
          this.stats.scheduleEvaluations++;

          if (evaluation !== null) {
            await this.processEvaluationResult(configData, evaluation, 'schedule');
          }

        } catch (configError) {
          logger.error('Error evaluando configuración schedule individual', {
            deviceId: configData.deviceId,
            deviceName: configData.deviceName,
            error: configError.message
          });
        }
      }

    } catch (error) {
      logger.error('Error evaluando automatizaciones schedule:', error);
      throw error;
    }
  }

  /**
   * Evalúa automatizaciones por potencia
   */
  async evaluatePowerAutomations(powerConfigs) {

    try {
      logger.debug('Evaluando automatizaciones por potencia', {
        count: powerConfigs.length
      });

      //console.log('Evaluando automatizaciones por potencia', { count: powerConfigs.length });

      // Evaluar todas las configuraciones de potencia de una vez
      const evaluations = await this.powerEvaluator.evaluateMultiple(powerConfigs);

      //console.log('Evaluación múltiple de power completada', { evaluations });

      this.stats.powerEvaluations += evaluations.length;

      for (const evaluation of evaluations) {
        //console.log('Procesando resultado de evaluación de power', { evaluation });
        try {
          if (evaluation.evaluation !== null && !evaluation.error) {
            //console.log('Procesando resultado de  dins el if evaluación de power', { evaluation, evaluationType: 'power' });
            await this.processEvaluationResult(evaluation, evaluation.evaluation, 'power');
          }

        } catch (evaluationError) {
          logger.error('Error procesando resultado de evaluación power', {
            deviceId: evaluation.deviceId,
            deviceName: evaluation.deviceName,
            error: evaluationError.message
          });
        }
      }

    } catch (error) {
      logger.error('Error evaluando automatizaciones power:', error);
      throw error;
    }
  }

  /**
   * Procesa el resultado de una evaluación y ejecuta la acción si es necesaria
   */
  async processEvaluationResult(configData, shouldBeOn, evaluationType) {
    //console.log(' estem dins la funcio Procesando resultado de evaluación', { configData, shouldBeOn, evaluationType });
    try {
      //console.log('Procesando resultado de evaluación dins de try');
      const deviceId = configData.deviceId;
      const deviceName = configData.deviceName;

      // Obtener estado actual del dispositivo
      const currentState = this.memoryCache.getDeviceState(deviceId);
      const currentOutput = currentState ? currentState.output : null;

      // console.log('Estado actual del dispositivo obtenido del cache', { deviceId, deviceName, evaluationType, shouldBeOn, currentState, currentOutput });

      logger.debug('Procesando resultado de evaluación', {
        deviceId,
        deviceName,
        evaluationType,
        shouldBeOn,
        currentOutput,
        needsAction: currentOutput !== shouldBeOn
      });



      // Solo actuar si hay cambio necesario
      if (currentOutput !== shouldBeOn) {
        const success = await this.executePlugAction(deviceId, shouldBeOn, deviceName, evaluationType);

        if (success) {
          // this.memoryCache.updateDeviceState(deviceId, shouldBeOn);
          this.stats.actionsExecuted++;

          logger.info('Acción de automatización ejecutada', {
            deviceId,
            deviceName,
            evaluationType,
            action: shouldBeOn ? 'ON' : 'OFF',
            previousState: currentOutput
          });
          /*console.log('Acción de automatización ejecutada', {
            deviceId,
            deviceName,
            evaluationType,
            action: shouldBeOn ? 'ON' : 'OFF',
            previousState: currentOutput
          });
          */
        }
      } else {
        logger.debug('No se requiere acción, dispositivo ya en estado correcto', {
          deviceId,
          deviceName,
          currentState: currentOutput
        });
      }

    } catch (error) {
      logger.error('Error procesando resultado de evaluación:', {
        deviceId: configData.deviceId,
        deviceName: configData.deviceName,
        error: error.message
      });
    }
  }

  /**
   * Ejecuta una acción de control sobre un plug
   */
  async executePlugAction(deviceId, shouldBeOn, deviceName, evaluationType) {
    try {
      if (!this.plugsService) {
        logger.warn('PlugsService no disponible, simulando acción', {
          deviceId,
          deviceName,
          action: shouldBeOn ? 'ON' : 'OFF',
          evaluationType
        });
        return true; // Simular éxito
      }

      // Obtener información del dispositivo para el control
      const deviceConfig = this.memoryCache.getAutomationConfig(deviceId);
      if (!deviceConfig) {
        logger.error('Configuración de dispositivo no encontrada', { deviceId });
        return false;
      }

      // Verificar que tenemos el userId del dispositivo
      if (!deviceConfig.userId) {
        logger.error('UserId no encontrado en configuración del dispositivo', {
          deviceId,
          deviceName,
          deviceConfig
        });
        return false;
      }

      // Ejecutar control del plug usando el userId real del dispositivo
      const action = shouldBeOn ? 'on' : 'off';
      const result = await this.plugsService.controlPlug(deviceId, deviceConfig.userId, action);

      if (result && result.success) {
        logger.info('Control de plug ejecutado exitosamente', {
          deviceId,
          deviceName,
          action: action.toUpperCase(),
          evaluationType,
          topic: result.topic
        });
        return true;
      } else {
        logger.error('Error en control de plug', {
          deviceId,
          deviceName,
          action,
          evaluationType,
          result
        });
        return false;
      }

    } catch (error) {
      logger.error('Error ejecutando acción de plug:', {
        deviceId,
        deviceName,
        shouldBeOn,
        evaluationType,
        error: error.message
      });
      return false;
    }
  }

  /**
   * Registra el handler MQTT para eventos de potencia en tiempo real
   */
  registerMqttHandler() {

    try {
      if (!this.mqttService || this.mqttHandlerRegistered) {
        return;
      }

      const mqttHandler = (messageData) => {
        try {
          this.handleMqttPowerEvent(messageData);
        } catch (error) {
          logger.error('Error en handler MQTT de automatización:', error);
        }
      };

      this.mqttService.addMessageHandler(mqttHandler);
      this.mqttHandlerRegistered = true;

      logger.debug('Handler MQTT registrado para eventos de potencia');

    } catch (error) {
      logger.error('Error registrando handler MQTT:', error);
    }
  }

  /**
   * Maneja eventos MQTT de potencia y estado en tiempo real
   */
  handleMqttPowerEvent(messageData) {

    try {
      const { topic, payload } = messageData;

      // Verificar si es un evento de potencia o estado relevante
      if (!this.isPowerOrStateRelatedTopic(topic)) {
        return;
      }

      // Manejar eventos de estado de switch
      if (this.isSwitchStateTopic(topic)) {
        this.updateDeviceStateFromMqtt(topic, payload);
      }

      // Manejar eventos de potencia
      if (this.isPowerRelatedTopic(topic)) {
        this.updatePowerMetricsFromMqtt(topic, payload);

        // Evaluar automatizaciones por potencia si hay configuraciones activas
        const powerConfigs = this.memoryCache.getConfigsByType('power');
        if (powerConfigs.length > 0) {
          // Ejecutar evaluación asíncrona sin bloquear
          setImmediate(async () => {
            try {
              await this.evaluatePowerAutomations(powerConfigs);
            } catch (error) {
              logger.error('Error en evaluación power por evento MQTT:', error);
            }
          });
        }
      }

    } catch (error) {
      logger.error('Error manejando evento MQTT de potencia/estado:', error);
    }
  }

  /**
   * Verifica si un topic MQTT es relevante para automatizaciones de potencia o estado
   */
  isPowerOrStateRelatedTopic(topic) {
    return this.isPowerRelatedTopic(topic) || this.isSwitchStateTopic(topic);
  }

  /**
   * Verifica si un topic MQTT es relevante para automatizaciones de potencia
   */
  isPowerRelatedTopic(topic) {
    // Topics de generadores
    const generatorConfigs = this.memoryCache.getAllGeneratorConfigs();
    for (const generator of generatorConfigs) {
      if (topic === generator.topic) {
        return true;
      }
    }

    // Topics de dispositivos con métricas de potencia
    if (topic.includes('power') || topic.includes('emeter')) {
      return true;
    }

    return false;
  }

  /**
   * Verifica si un topic MQTT es de estado de switch
   */
  isSwitchStateTopic(topic) {
    // Topics de estado de switch de Shelly Plus Plug S
    // Formato: {device_id}/status/switch:0
    if (topic.includes('/status/switch:')) {
      return true;
    }

    // También puede ser el topic general de status que incluye el switch
    // Formato: {device_id}/status
    if (topic.endsWith('/status') && !topic.includes('emeter')) {
      return true;
    }

    return false;
  }

  /**
   * Actualiza el estado del dispositivo en el cache desde eventos MQTT
   */
  updateDeviceStateFromMqtt(topic, payload) {
    try {
      // Extraer device_id del topic
      const deviceId = this.extractDeviceIdFromTopic(topic);
      if (!deviceId) {
        logger.debug('No se pudo extraer device_id del topic', { topic });
        return;
      }

      // recargar estado completo del dispositivo desde la base de datos
      this.memoryCache.reloadDeviceStates();



    } catch (error) {
      logger.error('Error actualizando estado de dispositivo desde MQTT:', {
        topic,
        payload,
        error: error.message
      });
    }
  }

  /**
   * Extrae el device_id del topic MQTT
   */
  extractDeviceIdFromTopic(topic) {
    try {
      // Para topics como: shellyplusplugs-64b7080cc994/status/switch:0
      // o: shellyplusplugs-64b7080cc994/status
      const parts = topic.split('/');
      if (parts.length >= 2) {
        return parts[0] + "/" + parts[1]; // El device_id es la primera parte
      }
      return null;
    } catch (error) {
      logger.error('Error extrayendo device_id del topic:', { topic, error: error.message });
      return null;
    }
  }

  /**
   * Actualiza métricas de potencia en el cache desde eventos MQTT
   */
  updatePowerMetricsFromMqtt(topic, payload) {
    try {
      // Intentar parsear el payload
      let data;
      try {
        data = JSON.parse(payload);
      } catch {
        // Si no es JSON, asumir que es un valor numérico
        data = parseFloat(payload);
      }

      // Actualizar según el tipo de topic
      if (typeof data === 'object' && data !== null) {
        // Payload JSON (generadores)
        if (data.potenciaFotovoltaica !== undefined) {
          this.memoryCache.updatePowerMetricByTopic(topic, data.potenciaFotovoltaica * 1000); // Convertir a W
        } else if (data.potencia_circutor !== undefined) {
          this.memoryCache.updatePowerMetricByTopic(topic, data.potencia_circutor * 1000); // Convertir a W
        }
      } else if (typeof data === 'number') {
        // Payload numérico directo
        this.memoryCache.updatePowerMetricByTopic(topic, data);
      }

    } catch (error) {
      logger.error('Error actualizando métricas de potencia desde MQTT:', {
        topic,
        payload,
        error: error.message
      });
    }
  }

  /**
   * Fuerza la actualización de una configuración específica
   */
  async updateDeviceConfig(deviceId) {

    try {
      await this.memoryCache.updateAutomationConfig(deviceId);

      logger.info('Configuración de dispositivo actualizada', { deviceId });

      // Evaluar inmediatamente si hay configuración activa
      const config = this.memoryCache.getAutomationConfig(deviceId);
      if (config) {
        if (config.config.type === 'schedule') {
          await this.evaluateScheduleAutomations([config]);
        } else if (config.config.type === 'power') {
          await this.evaluatePowerAutomations([config]);
        }
      }

    } catch (error) {
      logger.error('Error actualizando configuración de dispositivo:', {
        deviceId,
        error: error.message
      });
    }
  }

  /**
   * Obtiene estadísticas del gestor
   */
  getStats() {
    const uptime = this.stats.startTime ? Date.now() - this.stats.startTime.getTime() : 0;

    return {
      ...this.stats,
      isRunning: this.isRunning,
      executionInterval: this.executionInterval,
      uptime,
      cacheStats: this.memoryCache.getStats(),
      scheduleEvaluatorStats: {
        timezone: this.scheduleEvaluator.userTimezone
      },
      powerEvaluatorStats: this.powerEvaluator.getStats(),
      mqttHandlerRegistered: this.mqttHandlerRegistered
    };
  }

  /**
   * Obtiene información de debug del sistema
   */
  getDebugInfo() {
    return {
      manager: this.getStats(),
      cache: this.memoryCache.getStats(),
      powerEvaluator: this.powerEvaluator.checkDataAvailability(),
      activeConfigs: {
        schedule: this.memoryCache.getConfigsByType('schedule').length,
        power: this.memoryCache.getConfigsByType('power').length,
        manual: this.memoryCache.getConfigsByType('manual').length
      }
    };
  }

  /**
   * Cierra el gestor y libera recursos
   */
  async close() {
    try {
      logger.info('Cerrando AutomationManager...');

      this.stop();
      this.memoryCache.close();

      logger.info('AutomationManager cerrado exitosamente');

    } catch (error) {
      logger.error('Error cerrando AutomationManager:', error);
    }
  }
}

module.exports = AutomationManager;
