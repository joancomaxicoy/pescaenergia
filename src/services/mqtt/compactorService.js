const logger = require('../../utils/logger');
const database = require('../../utils/database');
const DeviceStateService = require('./deviceStateService');
const { classifyMetric, getDeviceTypeFromTopic } = require('../../config/device-metrics-config');

class CompactorService {
  constructor(bufferService, persistenceService) {
    this.bufferService = bufferService;
    this.persistenceService = persistenceService;
    this.deviceStateService = new DeviceStateService();
    
    // Configuración
    const compactorTimeMinutes = parseInt(process.env.COMPACTOR_TIME_INTERVAL) || 1;
    this.compactionInterval = compactorTimeMinutes * 60 * 1000; // Convertir minutos a milisegundos
    this.isRunning = false;
    this.intervalId = null;
    
    // Estadísticas
    this.stats = {
      cyclesCompleted: 0,
      totalDevicesProcessed: 0,
      totalMetricsAggregated: 0,
      totalMetricsInserted: 0,
      lastCycleTime: null,
      averageCycleTime: 0,
      totalCycleTime: 0,
      errors: 0,
      lastError: null,
      filteredSamples: 0,
      startTime: Date.now()
    };
    
    // Configuración de agregados
    this.aggregationTypes = ['avg', 'min', 'max', 'sum', 'count'];
    
    // Running max per comptadors acumulatius (deviceUuid|metricName -> value)
    // Els comptadors acumulatius mai han de baixar: qualsevol mostra per sota
    // del màxim ja conegut es considera esporàdica i es descarta.
    this.counterRunningMax = new Map();
  }

  /**
   * Inicia el servicio de compactación
   */
  start() {
    if (this.isRunning) {
      logger.warn('CompactorService ya está ejecutándose');
      return;
    }

    this.isRunning = true;
    this.stats.startTime = Date.now();
    
    // Ejecutar el primer ciclo inmediatamente (para testing)
    this.runCompactionCycle();
    
    // Configurar el intervalo
    this.intervalId = setInterval(() => {
      this.runCompactionCycle();
    }, this.compactionInterval);

    logger.info('CompactorService iniciado', {
      compactionInterval: this.compactionInterval,
      aggregationTypes: this.aggregationTypes
    });
  }

  /**
   * Detiene el servicio de compactación
   */
  stop() {
    if (!this.isRunning) {
      logger.warn('CompactorService no está ejecutándose');
      return;
    }

    this.isRunning = false;
    
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    logger.info('CompactorService detenido', {
      cyclesCompleted: this.stats.cyclesCompleted,
      totalRunTime: Date.now() - this.stats.startTime
    });
  }

  /**
   * Ejecuta un ciclo de compactación
   */
  async runCompactionCycle() {
    const cycleStartTime = Date.now();
    
    try {
      logger.debug('Iniciando ciclo de compactación...');

      // 1. Tomar snapshot del buffer
      const bufferSnapshot = this.bufferService.takeSnapshot();
      
      if (bufferSnapshot.size === 0) {
        logger.debug('Buffer vacío, omitiendo ciclo de compactación');
        return;
      }

      // 2. Separar dispositivos físicos de generadores
      const physicalDevices = [];
      const generators = [];
      
      for (const [deviceId, metrics] of bufferSnapshot) {
        // Verificar si es un generador basándose en el deviceType
        const isGenerator = metrics.some(metric => metric.deviceType === 'ENERGY_GENERATOR');
        
        if (isGenerator) {
          generators.push([deviceId, metrics]);
        } else {
          physicalDevices.push(deviceId);
        }
      }

      // 3. Resolver solo los dispositivos físicos contra la BD
      const deviceIdMap = new Map();
      if (physicalDevices.length > 0) {
        const resolvedDevices = await this.persistenceService.resolveMultipleDeviceIds(physicalDevices);
        for (const [deviceId, uuid] of resolvedDevices) {
          deviceIdMap.set(deviceId, uuid);
        }
      }

      // 4. Procesar cada dispositivo
      const aggregatedMetrics = [];
      let devicesProcessed = 0;
      let metricsProcessed = 0;

      // Procesar dispositivos físicos
      for (const [deviceId, metrics] of bufferSnapshot) {
        if (generators.some(([genId]) => genId === deviceId)) {
          continue; // Saltar generadores, se procesan después
        }

        let deviceUuid = deviceIdMap.get(deviceId);
        
        if (!deviceUuid) {
          // Intentar crear el dispositivo automáticamente
          const deviceType = metrics[0]?.deviceType || 'UNKNOWN';
          const additionalInfo = {
            generatorName: metrics[0]?.generatorName
          };
          
          logger.info('Dispositivo físico no encontrado, creando automáticamente', { 
            deviceId, 
            deviceType,
            metricsCount: metrics.length
          });

          deviceUuid = await this.persistenceService.findOrCreateDevice(deviceId, deviceType, additionalInfo);
          
          if (!deviceUuid) {
            logger.error('No se pudo crear dispositivo automáticamente, omitiendo métricas', { 
              deviceId, 
              deviceType,
              metricsCount: metrics.length
            });
            continue;
          }

          // Actualizar el mapa para futuros dispositivos en este ciclo
          deviceIdMap.set(deviceId, deviceUuid);
        }

        // Agregar métricas del dispositivo físico
        const deviceAggregates = await this.aggregateDeviceMetrics(deviceUuid, metrics, cycleStartTime);
        aggregatedMetrics.push(...deviceAggregates);
        
        devicesProcessed++;
        metricsProcessed += metrics.length;
      }

      // Procesar generadores con UUID sintético
      for (const [generatorId, metrics] of generators) {
        // Crear UUID sintético para generadores
        const generatorUuid = `gen-${generatorId}`;
        
        logger.debug('Procesando generador de energía', {
          generatorId,
          generatorUuid,
          metricsCount: metrics.length,
          generatorName: metrics[0]?.generatorName || 'unknown'
        });

        // Agregar métricas del generador
        const generatorAggregates = await this.aggregateDeviceMetrics(generatorUuid, metrics, cycleStartTime);
        aggregatedMetrics.push(...generatorAggregates);
        
        devicesProcessed++;
        metricsProcessed += metrics.length;
      }

      // 5. Persistir métricas agregadas
      if (aggregatedMetrics.length > 0) {
        await this.persistenceService.bulkInsert(aggregatedMetrics);
      }

      // 6. Actualizar estadísticas
      const cycleTime = Date.now() - cycleStartTime;
      this.updateStats(cycleTime, devicesProcessed, metricsProcessed, aggregatedMetrics.length);

      logger.info('Ciclo de compactación completado', {
        cycleTime,
        devicesProcessed,
        physicalDevices: physicalDevices.length,
        generators: generators.length,
        metricsProcessed,
        aggregatedMetrics: aggregatedMetrics.length,
        bufferDevices: bufferSnapshot.size
      });

    } catch (error) {
      const cycleTime = Date.now() - cycleStartTime;
      this.stats.errors++;
      this.stats.lastError = {
        message: error.message,
        timestamp: new Date(),
        cycleTime
      };

      logger.error('Error en ciclo de compactación:', {
        error: error.message,
        cycleTime,
        stack: error.stack
      });
    }
  }

  /**
   * Agrega las métricas de un dispositivo específico con persistencia dual
   * @param {string} deviceUuid - UUID del dispositivo
   * @param {Array} metrics - Array de métricas del dispositivo
   * @param {number} cycleStartTime - Timestamp del inicio del ciclo
   * @returns {Array} - Array de métricas agregadas para series temporales
   */
  async aggregateDeviceMetrics(deviceUuid, metrics, cycleStartTime) {
    if (metrics.length === 0) return [];

    // Determinar el tipo de dispositivo basándose en el primer metric
    const firstMetric = metrics[0];
    const deviceType = firstMetric.deviceType;
    
    // Seedejar el running max dels comptadors acumulatius d'aquest dispositiu
    // (una sola consulta per comptador, la primera vegada que es veu)
    const counterMetrics = new Set();
    for (const metric of metrics) {
      if (this.isCumulativeCounter(metric.metricName)) {
        counterMetrics.add(metric.metricName);
      }
    }
    for (const metricName of counterMetrics) {
      await this.getCounterRunningMax(deviceUuid, metricName);
    }
    
    // Separar métricas por tipo de persistencia
    const timeSeriesMetrics = new Map();
    const stateMetrics = [];
    const ignoredMetrics = [];

    for (const metric of metrics) {
      const { metricName, value, unit } = metric;
      
      // Clasificar la métrica según la configuración
      const classification = classifyMetric(deviceType, metricName);
      
      switch (classification) {
        case 'timeseries':
          // Validar que el valor sea numérico para series temporales
          if (typeof value !== 'number' || isNaN(value)) {
            logger.debug('Valor no numérico omitido para serie temporal', { 
              deviceUuid, 
              metricName, 
              value, 
              type: typeof value 
            });
            continue;
          }

          // Els comptadors acumulatius mai han de baixar: descartar qualsevol
          // mostra per sota del màxim ja conegut (sense finestra temporal).
          if (this.isCumulativeCounter(metricName)) {
            const counterKey = `${deviceUuid}|${metricName}`;
            const runningMax = this.counterRunningMax.get(counterKey);
            if (runningMax !== null && runningMax !== undefined && value < runningMax) {
              this.stats.filteredSamples++;
              logger.debug('Mostra per sota del running max descartada', {
                deviceUuid,
                metricName,
                value,
                runningMax
              });
              continue;
            }
            if (runningMax === null || runningMax === undefined || value > runningMax) {
              this.counterRunningMax.set(counterKey, value);
            }
          }

          if (!timeSeriesMetrics.has(metricName)) {
            timeSeriesMetrics.set(metricName, {
              values: [],
              unit: unit,
              count: 0
            });
          }

          timeSeriesMetrics.get(metricName).values.push(value);
          timeSeriesMetrics.get(metricName).count++;
          break;

        case 'state':
          // Para estados, tomar el último valor recibido
          stateMetrics.push({
            stateName: metricName,
            stateValue: value,
            stateType: this.determineStateType(value),
            unit: unit
          });
          break;

        case 'ignored':
          ignoredMetrics.push(metricName);
          break;

        case 'unknown':
          logger.debug('Métrica desconocida, tratando como serie temporal por defecto', {
            deviceUuid,
            deviceType,
            metricName,
            value
          });
          
          // Tratar como serie temporal por defecto si es numérica
          if (typeof value === 'number' && !isNaN(value)) {
            // Els comptadors acumulatius mai han de baixar: mateix filtre
            // que al cas 'timeseries' (cobreix mètriques fora de config).
            if (this.isCumulativeCounter(metricName)) {
              const counterKey = `${deviceUuid}|${metricName}`;
              const runningMax = this.counterRunningMax.get(counterKey);
              if (runningMax !== null && runningMax !== undefined && value < runningMax) {
                this.stats.filteredSamples++;
                logger.debug('Mostra per sota del running max descartada (unknown)', {
                  deviceUuid,
                  metricName,
                  value,
                  runningMax
                });
                continue;
              }
              if (runningMax === null || runningMax === undefined || value > runningMax) {
                this.counterRunningMax.set(counterKey, value);
              }
            }

            if (!timeSeriesMetrics.has(metricName)) {
              timeSeriesMetrics.set(metricName, {
                values: [],
                unit: unit,
                count: 0
              });
            }
            timeSeriesMetrics.get(metricName).values.push(value);
            timeSeriesMetrics.get(metricName).count++;
          }
          break;
      }
    }

    // Procesar estados (solo si no es un generador sintético)
    if (stateMetrics.length > 0 && !deviceUuid.startsWith('gen-')) {
      try {
        await this.deviceStateService.updateMultipleDeviceStates(deviceUuid, stateMetrics);
        logger.debug('Estados de dispositivo actualizados', {
          deviceUuid,
          statesCount: stateMetrics.length
        });
      } catch (error) {
        logger.error('Error actualizando estados de dispositivo', {
          deviceUuid,
          error: error.message,
          statesCount: stateMetrics.length
        });
      }
    }

    // Procesar series temporales (calcular agregados)
    const aggregatedMetrics = [];
    const timestamp = new Date(Math.floor(cycleStartTime / 60000) * 60000); // Redondear al minuto

    for (const [metricName, group] of timeSeriesMetrics) {
      const { values, unit, count } = group;
      
      if (values.length === 0) continue;

      // Calcular estadísticas
      const sum = values.reduce((acc, val) => acc + val, 0);
      const avg = sum / values.length;
      const min = Math.min(...values);
      const max = Math.max(...values);

      // Crear métricas agregadas
      for (const aggregationType of this.aggregationTypes) {
        let aggregatedValue;
        
        switch (aggregationType) {
          case 'avg':
            aggregatedValue = avg;
            break;
          case 'min':
            aggregatedValue = min;
            break;
          case 'max':
            aggregatedValue = max;
            break;
          case 'sum':
            aggregatedValue = sum;
            break;
          case 'count':
            aggregatedValue = count;
            break;
          default:
            continue;
        }

        // Redondear valores para evitar precisión excesiva
        if (aggregationType !== 'count') {
          aggregatedValue = Math.round(aggregatedValue * 1000) / 1000;
        }

        aggregatedMetrics.push({
          timestamp,
          device_id: deviceUuid,
          metric_name: `${metricName}_${aggregationType}`,
          value: aggregatedValue
        });
      }

      logger.debug('Métrica de serie temporal agregada', {
        deviceUuid,
        metricName,
        originalCount: values.length,
        aggregatesCreated: this.aggregationTypes.length,
        unit,
        stats: { avg, min, max, sum, count }
      });
    }

    // Log del resumen del procesamiento
    logger.debug('Resumen de procesamiento de métricas', {
      deviceUuid,
      deviceType,
      totalMetrics: metrics.length,
      timeSeriesMetrics: timeSeriesMetrics.size,
      stateMetrics: stateMetrics.length,
      ignoredMetrics: ignoredMetrics.length,
      aggregatedMetrics: aggregatedMetrics.length
    });

    return aggregatedMetrics;
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
   * Actualiza las estadísticas del compactador
   */
  updateStats(cycleTime, devicesProcessed, metricsProcessed, metricsInserted) {
    this.stats.cyclesCompleted++;
    this.stats.totalDevicesProcessed += devicesProcessed;
    this.stats.totalMetricsAggregated += metricsProcessed;
    this.stats.totalMetricsInserted += metricsInserted;
    this.stats.lastCycleTime = cycleTime;
    this.stats.totalCycleTime += cycleTime;
    this.stats.averageCycleTime = Math.round(this.stats.totalCycleTime / this.stats.cyclesCompleted);
  }

  /**
   * Obtiene las estadísticas del compactador
   * @returns {Object}
   */
  getStats() {
    const uptime = Date.now() - this.stats.startTime;
    const compressionRatio = this.stats.totalMetricsAggregated > 0 
      ? (this.stats.totalMetricsInserted / this.stats.totalMetricsAggregated).toFixed(2)
      : '0';

    return {
      ...this.stats,
      isRunning: this.isRunning,
      uptime: Math.floor(uptime / 1000),
      compactionInterval: this.compactionInterval,
      compressionRatio: `1:${compressionRatio}`,
      metricsPerCycle: this.stats.cyclesCompleted > 0 
        ? Math.round(this.stats.totalMetricsAggregated / this.stats.cyclesCompleted)
        : 0,
      aggregationTypes: this.aggregationTypes,
      bufferStats: this.bufferService.getStats(),
      persistenceStats: this.persistenceService.getStats()
    };
  }

  /**
   * Ejecuta un ciclo de compactación manual (útil para testing)
   */
  async runManualCycle() {
    if (!this.isRunning) {
      logger.warn('CompactorService no está ejecutándose, iniciando ciclo manual');
    }
    
    await this.runCompactionCycle();
  }

  /**
   * Cambia el intervalo de compactación
   * @param {number} newInterval - Nuevo intervalo en milisegundos
   */
  setCompactionInterval(newInterval) {
    if (newInterval < 1000) {
      throw new Error('L\'interval de compactació ha de ser almenys 1 segon');
    }

    const oldInterval = this.compactionInterval;
    this.compactionInterval = newInterval;

    // Si está ejecutándose, reiniciar con el nuevo intervalo
    if (this.isRunning) {
      this.stop();
      this.start();
    }

    logger.info('Intervalo de compactación cambiado', {
      oldInterval,
      newInterval,
      wasRunning: this.isRunning
    });
  }

  /**
   * Configura los tipos de agregación
   * @param {Array<string>} types - Array de tipos de agregación
   */
  setAggregationTypes(types) {
    const validTypes = ['avg', 'min', 'max', 'sum', 'count'];
    const invalidTypes = types.filter(type => !validTypes.includes(type));
    
    if (invalidTypes.length > 0) {
      throw new Error(`Tipus d'agregació invàlids: ${invalidTypes.join(', ')}`);
    }

    this.aggregationTypes = [...types];
    
    logger.info('Tipos de agregación actualizados', {
      aggregationTypes: this.aggregationTypes
    });
  }

  /**
   * Resetea las estadísticas
   */
  resetStats() {
    this.stats = {
      cyclesCompleted: 0,
      totalDevicesProcessed: 0,
      totalMetricsAggregated: 0,
      totalMetricsInserted: 0,
      lastCycleTime: null,
      averageCycleTime: 0,
      totalCycleTime: 0,
      errors: 0,
      lastError: null,
      filteredSamples: 0,
      startTime: Date.now()
    };
    
    logger.info('Estadísticas del compactador reseteadas');
  }

  /**
   * Determina si una métrica és un comptador acumulatiu (monotònic).
   * Els comptadors acumulatius mai han de baixar; les métriques diàries
   * (que es reinicien cada dia) queden excloses del filtre.
   * @param {string} metricName - Nom de la métrica
   * @returns {boolean}
   */
  isCumulativeCounter(metricName) {
    if (!metricName) return false;
    if (metricName.includes('dia')) return false;
    return metricName.includes('_total') || metricName.includes('aenergy_total');
  }

  /**
   * Obté (i cacheja) el running max conegut per a un comptador acumulatiu.
   * Sembra amb l'última mostra _max persistida per evitar rebaixar el
   * llindar després d'un reinici del procés.
   * @param {string} deviceUuid - UUID del dispositiu
   * @param {string} metricName - Nom de la métrica
   * @returns {Promise<number|null>}
   */
  async getCounterRunningMax(deviceUuid, metricName) {
    const key = `${deviceUuid}|${metricName}`;
    if (this.counterRunningMax.has(key)) {
      return this.counterRunningMax.get(key);
    }

    let seeded = null;
    try {
      const result = await database.query(
        `SELECT value FROM energy_metrics
         WHERE device_id = $1 AND metric_name = $2
         ORDER BY timestamp DESC LIMIT 1`,
        [deviceUuid, `${metricName}_max`]
      );
      if (result.rows.length > 0) {
        seeded = parseFloat(result.rows[0].value);
      }
    } catch (error) {
      logger.error('Error sembrant running max del comptador', {
        deviceUuid,
        metricName,
        error: error.message
      });
    }

    this.counterRunningMax.set(key, seeded);
    return seeded;
  }

  /**
   * Verifica el estado de salud del compactador
   * @returns {Object}
   */
  async healthCheck() {
    const health = {
      isRunning: this.isRunning,
      lastCycleTime: this.stats.lastCycleTime,
      errors: this.stats.errors,
      lastError: this.stats.lastError,
      bufferHealth: this.bufferService.getStats(),
      persistenceHealth: await this.persistenceService.healthCheck()
    };

    // Determinar estado general
    health.status = 'healthy';
    
    if (!this.isRunning) {
      health.status = 'stopped';
    } else if (this.stats.errors > 0 && this.stats.lastError) {
      const errorAge = Date.now() - new Date(this.stats.lastError.timestamp).getTime();
      if (errorAge < 300000) { // Errores en los últimos 5 minutos
        health.status = 'degraded';
      }
    }

    if (!health.persistenceHealth) {
      health.status = 'unhealthy';
    }

    return health;
  }
}

module.exports = CompactorService;
