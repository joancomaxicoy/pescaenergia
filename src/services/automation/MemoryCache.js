const logger = require('../../utils/logger');
const database = require('../../utils/database');
const configLoader = require('../../utils/configLoader');
const { getPowerMetrics } = require('../../config/device-metrics-config');

/**
 * Cache en memoria para configuraciones de automatización y estados de dispositivos
 * Se recarga cada 5 minutos y escucha cambios en tiempo real
 */
class MemoryCache {
  constructor() {
    this.automationConfigs = new Map(); // device_id -> config
    this.deviceStates = new Map();      // device_id -> { output: boolean, lastUpdate: timestamp }
    this.powerMetrics = new Map();      // device_id/generator_id -> { power: number, lastUpdate: timestamp, type: 'device'|'generator' }
    this.generatorConfigs = new Map();  // generator_id -> { name, topic, active }

    this.reloadInterval = 5 * 60 * 1000; // 5 minutos
    this.reloadTimer = null;
    this.lastReload = null;
    this.isInitialized = false; // Flag para saber si ya se inicializó

    // Timeouts para debouncing
    this.reloadAutomationConfigsTimeout = null;
    this.reloadDeviceStatesTimeout = null;
    
    this.stats = {
      configsLoaded: 0,
      statesLoaded: 0,
      powerMetricsLoaded: 0,
      generatorsLoaded: 0,
      reloadCount: 0,
      lastError: null
    };
  }

  /**
   * Inicializa el cache cargando datos y configurando recarga automática
   */
  async initialize() {
    try {
      logger.info('Inicializando MemoryCache para automatizaciones...');
      
      await this.reloadAll();
      this.startAutoReload();
      
      // Marcar como inicializado
      this.isInitialized = true;
      
      logger.info('MemoryCache inicializado exitosamente', {
        configs: this.automationConfigs.size,
        states: this.deviceStates.size,
        powerMetrics: this.powerMetrics.size,
        generators: this.generatorConfigs.size,
        reloadInterval: this.reloadInterval / 1000 + 's',
        isInitialized: this.isInitialized
      });
      
    } catch (error) {
      logger.error('Error inicializando MemoryCache:', error);
      throw error;
    }
  }

  /**
   * Recarga todos los datos del cache
   */
  async reloadAll() {
    try {
      logger.debug('Recargando cache completo...');
      
      await Promise.all([
        this.reloadAutomationConfigs(),
        this.reloadDeviceStates(),
        this.reloadGeneratorConfigs(),
        this.reloadPowerMetrics()
      ]);
      
      this.lastReload = new Date();
      this.stats.reloadCount++;
      
      logger.debug('Cache recargado exitosamente', {
        configs: this.automationConfigs.size,
        states: this.deviceStates.size,
        powerMetrics: this.powerMetrics.size,
        generators: this.generatorConfigs.size,
        timestamp: this.lastReload
      });
      
    } catch (error) {
      this.stats.lastError = {
        message: error.message,
        timestamp: new Date()
      };
      logger.error('Error recargando cache:', error);
      throw error;
    }
  }

  /**
   * Recarga las configuraciones de automatización activas (con debouncing)
   */
  async reloadAutomationConfigs() {
    return new Promise((resolve, reject) => {
      // Limpiar timeout anterior si existe
      if (this.reloadAutomationConfigsTimeout) {
        clearTimeout(this.reloadAutomationConfigsTimeout);
      }

      // Establecer nuevo timeout con debouncing de 100ms
      this.reloadAutomationConfigsTimeout = setTimeout(async () => {
        try {
          await this._reloadAutomationConfigs();
          resolve();
        } catch (error) {
          reject(error);
        }
      }, 100);
    });
  }

  /**
   * Método privado para recargar configuraciones de automatización (lógica real)
   */
  async _reloadAutomationConfigs() {
    try {
      const query = `
        SELECT
          ac.device_id,
          ac.config_data,
          ac.updated_at,
          d.device_name,
          d.shelly_device_id,
          d.device_type,
          d.user_id
        FROM automation_configs ac
        JOIN devices d ON ac.device_id = d.id
        WHERE ac.is_active = true
        AND d.device_type = 'PLUG'
        AND ac.config_data->>'type' IN ('schedule', 'power')
        ORDER BY ac.updated_at DESC
      `;

      const result = await database.query(query);
      // Limpiar cache anterior
      this.automationConfigs.clear();

      // Cargar nuevas configuraciones
      for (const row of result.rows) {
        this.automationConfigs.set(row.device_id, {
          deviceId: row.device_id,
          deviceName: row.device_name,
          shellyDeviceId: row.shelly_device_id,
          deviceType: row.device_type,
          userId: row.user_id,
          config: row.config_data,
          updatedAt: row.updated_at
        });
      }

      this.stats.configsLoaded = result.rows.length;

      logger.debug('Configuraciones de automatización recargadas', {
        count: result.rows.length,
        types: this.getConfigTypeStats()
      });

    } catch (error) {
      logger.error('Error recargando configuraciones de automatización:', error);
      throw error;
    }
  }

  /**
   * Recarga los estados actuales de los dispositivos PLUG (con debouncing)
   */
  async reloadDeviceStates() {
    return new Promise((resolve, reject) => {
      // Limpiar timeout anterior si existe
      if (this.reloadDeviceStatesTimeout) {
        clearTimeout(this.reloadDeviceStatesTimeout);
      }

      // Establecer nuevo timeout con debouncing de 100ms
      this.reloadDeviceStatesTimeout = setTimeout(async () => {
        try {
          await this._reloadDeviceStates();
          resolve();
        } catch (error) {
          reject(error);
        }
      }, 100);
    });
  }

  /**
   * Método privado para recargar estados de dispositivos (lógica real)
   */
  async _reloadDeviceStates() {
    try {
      const query = `
        SELECT
          ds.device_id,
          ds.state_value_boolean as output,
          ds.last_updated,
          d.device_name,
          d.shelly_device_id
        FROM device_states ds
        JOIN devices d ON ds.device_id = d.id
        WHERE ds.state_name = 'status_switch:0_output'
        AND d.device_type = 'PLUG'
        ORDER BY ds.last_updated DESC
      `;

      const result = await database.query(query);

      // Limpiar cache anterior
      this.deviceStates.clear();

      // Cargar nuevos estados
      for (const row of result.rows) {
        this.deviceStates.set(row.device_id, {
          deviceId: row.device_id,
          deviceName: row.device_name,
          shellyDeviceId: row.shelly_device_id,
          output: row.output === 'true' || row.output === true,
          lastUpdated: row.last_updated
        });
      }

      this.stats.statesLoaded = result.rows.length;

      logger.debug('Estados de dispositivos recargados', {
        count: result.rows.length,
        onDevices: result.rows.filter(r => r.output).length,
        offDevices: result.rows.filter(r => !r.output).length
      });

    } catch (error) {
      logger.error('Error recargando estados de dispositivos:', error);
      throw error;
    }
  }

  /**
   * Recarga las configuraciones de generadores desde el YAML
   */
  async reloadGeneratorConfigs() {
    try {
      // Cargar generadores activos desde el YAML
      const generators = configLoader.getActiveGenerators();
      
      // Limpiar configuraciones anteriores
      this.generatorConfigs.clear();
      
      // Cargar nuevas configuraciones
      for (const generator of generators) {
        this.generatorConfigs.set(generator.id, {
          id: generator.id,
          name: generator.name,
          topic: generator.topic,
          active: generator.active
        });
      }
      
      this.stats.generatorsLoaded = generators.length;
      
      logger.debug('Configuraciones de generadores recargadas', {
        count: generators.length,
        generators: generators.map(g => ({ id: g.id, name: g.name, topic: g.topic }))
      });
      
    } catch (error) {
      logger.error('Error recargando configuraciones de generadores:', error);
      // No lanzar error para no interrumpir la carga del cache
      this.generatorConfigs.clear();
      this.stats.generatorsLoaded = 0;
    }
  }

  /**
   * Recarga las métricas de potencia desde la base de datos
   */
  async reloadPowerMetrics() {
    try {
      // Cargar todas las métricas de potencia (dispositivos y generadores)
      const powerQuery = `
        SELECT DISTINCT ON (em.device_id)
          em.device_id,
          em.value as power,
          em.timestamp,
          em.metric_name
        FROM energy_metrics em
        WHERE em.metric_name LIKE '%power%_avg'
        AND em.timestamp >= NOW() - INTERVAL '15 minutes'
        ORDER BY em.device_id, em.timestamp DESC
      `;

      const powerResult = await database.query(powerQuery);
      
      // Limpiar métricas anteriores
      this.powerMetrics.clear();
      
      // Cargar nuevas métricas
      for (const row of powerResult.rows) {
        const deviceId = row.device_id;
        const isGenerator = deviceId.startsWith('gen-');
        
        if (isGenerator) {
          // Es un generador
          const generatorId = deviceId.replace('gen-', '');
          const generatorConfig = this.generatorConfigs.get(generatorId);
          
          this.powerMetrics.set(deviceId, {
            power: parseFloat(row.power) || 0,
            lastUpdate: row.timestamp,
            type: 'generator',
            generatorId: generatorId,
            generatorName: generatorConfig ? generatorConfig.name : `Generator ${generatorId}`,
            metricName: row.metric_name
          });
        } else {
          // Es un dispositivo (EM o PLUG)
          // Intentar obtener información del dispositivo desde la tabla devices
          try {
            const deviceInfoQuery = `
              SELECT device_name, device_type, shelly_device_id 
              FROM devices 
              WHERE id = $1
            `;
            const deviceInfoResult = await database.query(deviceInfoQuery, [deviceId]);
            
            let deviceInfo = {
              deviceName: `Device ${deviceId}`,
              deviceType: 'UNKNOWN',
              shellyDeviceId: null
            };
            
            if (deviceInfoResult.rows.length > 0) {
              const device = deviceInfoResult.rows[0];
              deviceInfo = {
                deviceName: device.device_name,
                deviceType: device.device_type,
                shellyDeviceId: device.shelly_device_id
              };
            }
            
            this.powerMetrics.set(deviceId, {
              power: parseFloat(row.power) || 0,
              lastUpdate: row.timestamp,
              type: 'device',
              deviceName: deviceInfo.deviceName,
              deviceType: deviceInfo.deviceType,
              shellyDeviceId: deviceInfo.shellyDeviceId,
              metricName: row.metric_name
            });
          } catch (deviceError) {
            logger.warn('Error obteniendo información del dispositivo', {
              deviceId,
              error: deviceError.message
            });
            
            // Crear entrada básica sin información del dispositivo
            this.powerMetrics.set(deviceId, {
              power: parseFloat(row.power) || 0,
              lastUpdate: row.timestamp,
              type: 'device',
              deviceName: `Device ${deviceId}`,
              deviceType: 'UNKNOWN',
              shellyDeviceId: null,
              metricName: row.metric_name
            });
          }
        }
      }
      
      this.stats.powerMetricsLoaded = powerResult.rows.length;
      
      // Calcular estadísticas por tipo
      const typeStats = {};
      for (const metric of this.powerMetrics.values()) {
        const key = metric.type === 'generator' ? 'generators' : metric.deviceType || 'unknown';
        typeStats[key] = (typeStats[key] || 0) + 1;
      }
      
      logger.debug('Métricas de potencia recargadas', {
        total: powerResult.rows.length,
        typeStats,
        generators: Array.from(this.powerMetrics.values())
          .filter(m => m.type === 'generator')
          .map(m => ({ id: m.generatorId, name: m.generatorName, power: m.power }))
      });
      
    } catch (error) {
      logger.error('Error recargando métricas de potencia:', error);
      throw error;
    }
  }

  /**
   * Inicia la recarga automática cada 5 minutos
   */
  startAutoReload() {
    if (this.reloadTimer) {
      clearInterval(this.reloadTimer);
    }
    
    this.reloadTimer = setInterval(async () => {
      try {
        await this.reloadAll();
      } catch (error) {
        logger.error('Error en recarga automática del cache:', error);
      }
    }, this.reloadInterval);
    
    logger.debug('Recarga automática del cache iniciada', {
      intervalMinutes: this.reloadInterval / 60000
    });
  }

  /**
   * Detiene la recarga automática
   */
  stopAutoReload() {
    if (this.reloadTimer) {
      clearInterval(this.reloadTimer);
      this.reloadTimer = null;
      logger.debug('Recarga automática del cache detenida');
    }
  }

  /**
   * Obtiene la configuración de automatización de un dispositivo
   */
  getAutomationConfig(deviceId) {
    return this.automationConfigs.get(deviceId) || null;
  }

  /**
   * Obtiene todas las configuraciones de automatización
   */
  getAllAutomationConfigs() {
    return Array.from(this.automationConfigs.values());
  }

  /**
   * Obtiene configuraciones por tipo
   */
  getConfigsByType(type) {
    return Array.from(this.automationConfigs.values())
      .filter(config => config.config.type === type);
  }

  /**
   * Obtiene el estado actual de un dispositivo
   */
  getDeviceState(deviceId) {
    return this.deviceStates.get(deviceId) || null;
  }

  /**
   * Obtiene todos los estados de dispositivos
   */
  getAllDeviceStates() {
    return Array.from(this.deviceStates.values());
  }

  /**
   * Actualiza el estado de un dispositivo en el cache
   */
  updateDeviceState(deviceId, output, timestamp = new Date()) {
    const existing = this.deviceStates.get(deviceId);
    if (existing) {
      existing.output = output === 'true' || output === true;
      existing.lastUpdated = timestamp;
      
      logger.debug('Estado de dispositivo actualizado en cache', {
        deviceId,
        deviceName: existing.deviceName,
        output: existing.output,
        originalValue: output,
        timestamp
      });
    }
  }

  /**
   * Actualiza una configuración específica en el cache
   */
  async updateAutomationConfig(deviceId) {
    try {
      const query = `
        SELECT 
          ac.device_id,
          ac.config_data,
          ac.updated_at,
          d.device_name,
          d.shelly_device_id,
          d.device_type,
          d.user_id
        FROM automation_configs ac
        JOIN devices d ON ac.device_id = d.id
        WHERE ac.device_id = $1
        AND ac.is_active = true
        AND d.device_type = 'PLUG'
        AND ac.config_data->>'type' IN ('schedule', 'power')
        ORDER BY ac.updated_at DESC
        LIMIT 1
      `;

      const result = await database.query(query, [deviceId]);
      
      if (result.rows.length > 0) {
        const row = result.rows[0];
        this.automationConfigs.set(deviceId, {
          deviceId: row.device_id,
          deviceName: row.device_name,
          shellyDeviceId: row.shelly_device_id,
          deviceType: row.device_type,
          userId: row.user_id,
          config: row.config_data,
          updatedAt: row.updated_at
        });
        
        logger.debug('Configuración de automatización actualizada en cache', {
          deviceId,
          deviceName: row.device_name,
          type: row.config_data.type
        });
      } else {
        // Si no hay configuración activa, remover del cache
        this.automationConfigs.delete(deviceId);
        
        logger.debug('Configuración de automatización removida del cache', {
          deviceId
        });
      }
      
    } catch (error) {
      logger.error('Error actualizando configuración en cache:', {
        deviceId,
        error: error.message
      });
    }
  }

  /**
   * Actualiza métricas de potencia en tiempo real
   */
  updatePowerMetric(deviceId, power, timestamp = new Date()) {
    this.powerMetrics.set(deviceId, {
      power: parseFloat(power) || 0,
      lastUpdate: timestamp,
      type: 'device'
    });
    
    logger.debug('Métrica de potencia actualizada', {
      deviceId,
      power,
      timestamp
    });
  }

  /**
   * Actualiza métricas de potencia de generadores en tiempo real
   */
  updateGeneratorPowerMetric(generatorId, power, timestamp = new Date()) {
    const generatorConfig = this.generatorConfigs.get(generatorId);
    
    if (generatorConfig) {
      this.powerMetrics.set(`gen-${generatorId}`, {
        power: parseFloat(power) || 0,
        lastUpdate: timestamp,
        type: 'generator',
        generatorId: generatorId,
        generatorName: generatorConfig.name,
        topic: generatorConfig.topic
      });
      
      logger.debug('Métrica de potencia de generador actualizada', {
        generatorId,
        generatorName: generatorConfig.name,
        power,
        timestamp
      });
    } else {
      logger.warn('Generador no encontrado en configuración', { generatorId });
    }
  }

  /**
   * Actualiza métricas de potencia por topic MQTT (para generadores)
   */
  updatePowerMetricByTopic(topic, power, timestamp = new Date()) {
    // Buscar el generador por topic
    for (const [generatorId, config] of this.generatorConfigs.entries()) {
      if (config.topic === topic) {
        this.updateGeneratorPowerMetric(generatorId, power, timestamp);
        return;
      }
    }
    
    logger.debug('Topic no encontrado en configuración de generadores', { topic });
  }

  /**
   * Obtiene la métrica de potencia de un dispositivo
   */
  getPowerMetric(deviceId) {
    return this.powerMetrics.get(deviceId) || null;
  }

  /**
   * Obtiene todas las métricas de potencia
   */
  getAllPowerMetrics() {
    return Array.from(this.powerMetrics.entries()).map(([deviceId, metric]) => ({
      deviceId,
      ...metric
    }));
  }

  /**
   * Calcula la diferencia total de potencia (generación - consumo) mejorada
   */
  calculatePowerDifference() {
    let totalGeneration = 0;
    let totalConsumption = 0;
    let generationDevices = 0;
    let consumptionDevices = 0;
    let generationSources = [];
    let consumptionSources = [];
    console.log(this.powerMetrics.entries());

    for (const [key, metric] of this.powerMetrics.entries()) {
      if (metric.type === 'generator') {
        totalGeneration += metric.power;
        generationDevices++;
        generationSources.push({
          id: metric.generatorId,
          name: metric.generatorName,
          power: metric.power,
          lastUpdate: metric.lastUpdate
        });
      } else if (metric.type === 'device') {
        // Clasificar dispositivos según su tipo
        if (metric.deviceType === 'EM') {
          // Los EM pueden ser consumo o generación según el valor
          if (metric.power >= 0) {
            totalConsumption += metric.power;
            consumptionDevices++;
            consumptionSources.push({
              id: key,
              name: metric.deviceName,
              power: metric.power,
              type: metric.deviceType,
              lastUpdate: metric.lastUpdate
            });
          } else {
            // Potencia negativa en EM indica generación
            totalGeneration += Math.abs(metric.power);
            generationDevices++;
            generationSources.push({
              id: key,
              name: metric.deviceName,
              power: Math.abs(metric.power),
              type: metric.deviceType,
              lastUpdate: metric.lastUpdate
            });
          }
        } else {
          // PLUG siempre es consumo
          totalConsumption += metric.power;
          consumptionDevices++;
          consumptionSources.push({
            id: key,
            name: metric.deviceName,
            power: metric.power,
            type: metric.deviceType,
            lastUpdate: metric.lastUpdate
          });
        }
      }
    }

    const difference = totalGeneration - totalConsumption;
    
    logger.debug('Diferencia de potencia calculada (mejorada)', {
      totalGeneration,
      totalConsumption,
      difference,
      generationDevices,
      consumptionDevices,
      generationSources: generationSources.length,
      consumptionSources: consumptionSources.length
    });

    return {
      totalGeneration,
      totalConsumption,
      difference,
      generationDevices,
      consumptionDevices,
      generationSources,
      consumptionSources,
      timestamp: new Date()
    };
  }

  /**
   * Obtiene todas las configuraciones de generadores
   */
  getAllGeneratorConfigs() {
    return Array.from(this.generatorConfigs.values());
  }

  /**
   * Obtiene la configuración de un generador específico
   */
  getGeneratorConfig(generatorId) {
    return this.generatorConfigs.get(generatorId) || null;
  }

  /**
   * Obtiene estadísticas por tipo de configuración
   */
  getConfigTypeStats() {
    const stats = { schedule: 0, power: 0, manual: 0 };
    
    for (const config of this.automationConfigs.values()) {
      const type = config.config.type || 'manual';
      stats[type] = (stats[type] || 0) + 1;
    }
    
    return stats;
  }

  /**
   * Obtiene estadísticas del cache
   */
  getStats() {
    return {
      ...this.stats,
      currentSize: {
        configs: this.automationConfigs.size,
        states: this.deviceStates.size,
        powerMetrics: this.powerMetrics.size,
        generators: this.generatorConfigs.size
      },
      configTypes: this.getConfigTypeStats(),
      lastReload: this.lastReload,
      nextReload: this.reloadTimer ? new Date(Date.now() + this.reloadInterval) : null,
      uptime: this.lastReload ? Date.now() - this.lastReload.getTime() : 0
    };
  }

  /**
   * Limpia el cache
   */
  clear() {
    this.automationConfigs.clear();
    this.deviceStates.clear();
    this.powerMetrics.clear();
    this.generatorConfigs.clear();
    
    logger.debug('Cache limpiado');
  }

  /**
   * Cierra el cache y detiene timers
   */
  close() {
    this.stopAutoReload();
    this.clear();

    // Limpiar timeouts de debouncing
    if (this.reloadAutomationConfigsTimeout) {
      clearTimeout(this.reloadAutomationConfigsTimeout);
      this.reloadAutomationConfigsTimeout = null;
    }
    if (this.reloadDeviceStatesTimeout) {
      clearTimeout(this.reloadDeviceStatesTimeout);
      this.reloadDeviceStatesTimeout = null;
    }

    logger.info('MemoryCache cerrado');
  }
}

module.exports = MemoryCache;
