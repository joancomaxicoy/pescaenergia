const logger = require('../utils/logger');
const database = require('../utils/database');
const configLoader = require('../utils/configLoader');
const mqttServiceRegistry = require('./mqtt/mqttServiceRegistry');

class DeviceHistoryService {
  constructor() {
    // Cache para metadatos de dispositivos
    this.deviceCache = new Map();
    this.cacheHits = 0;
    this.cacheMisses = 0;
    
    // Configuración de límites para prevenir consultas excesivas
    this.limits = {
      maxDataPoints: 10000,
      maxDaysRange: 365,
      defaultPageSize: 1000
    };

    // Estadísticas del servicio
    this.stats = {
      totalQueries: 0,
      totalLatestMetricsQueries: 0,
      totalEvolutionQueries: 0,
      totalErrors: 0,
      averageQueryTime: 0,
      totalQueryTime: 0,
      cacheHits: 0,
      cacheMisses: 0
    };
  }

  /**
   * Obtiene las métricas más recientes para un dispositivo (NUEVA LÓGICA HÍBRIDA)
   * Busca primero en el buffer MQTT y luego en la base de datos
   * @param {string} deviceId - UUID del dispositivo o shelly_device_id
   * @param {Array<string>} metricNames - Nombres específicos de métricas (opcional)
   * @returns {Object} - Objeto con las métricas más recientes
   */
  async getLatestMetrics(deviceId, metricNames = null) {
    const startTime = Date.now();
    
    try {
      // Validar deviceId
      if (!deviceId || typeof deviceId !== 'string') {
        throw new Error('deviceId és obligatori i ha de ser un string vàlid');
      }

      // Obtener información del dispositivo y resolver al UUID real
      const deviceInfo = await this.getDeviceInfo(deviceId);
      if (!deviceInfo) {
        throw new Error(`Dispositiu amb ID ${deviceId} no trobat`);
      }

      // PASO 1: Intentar obtener datos del buffer MQTT (datos más frescos)
      const bufferMetrics = await this.getLatestMetricsFromBuffer(deviceId, metricNames);
      
      // PASO 2: Obtener datos de la base de datos (datos persistidos)
      const dbMetrics = await this.getLatestMetricsFromDatabase(deviceInfo.id, metricNames);

      // PASO 3: Combinar resultados priorizando datos del buffer
      const combinedMetrics = this.combineBufferAndDbMetrics(bufferMetrics, dbMetrics, metricNames);

      // Actualizar estadísticas
      const queryTime = Date.now() - startTime;
      this.updateStats('latest', queryTime);

      logger.info('Métricas más recientes obtenidas (híbrido)', {
        deviceId,
        metricsCount: combinedMetrics.totalMetrics,
        queryTime,
        requestedMetrics: metricNames,
        bufferMetrics: bufferMetrics ? bufferMetrics.totalMetrics : 0,
        dbMetrics: dbMetrics ? dbMetrics.totalMetrics : 0,
        sources: combinedMetrics.sources
      });

      return combinedMetrics;

    } catch (error) {
      this.stats.totalErrors++;
      logger.error('Error obteniendo métricas más recientes:', {
        deviceId,
        metricNames,
        error: error.message,
        queryTime: Date.now() - startTime
      });
      throw error;
    }
  }

  /**
   * Obtiene las métricas más recientes desde el buffer MQTT
   * @param {string} deviceId - ID del dispositivo (puede ser shelly_device_id)
   * @param {Array<string>} metricNames - Nombres específicos de métricas (opcional)
   * @returns {Object|null} - Métricas del buffer o null si no hay datos
   */
  async getLatestMetricsFromBuffer(deviceId, metricNames = null) {
    try {
      // Verificar si el registry MQTT está disponible
      if (!mqttServiceRegistry.isAvailable()) {
        logger.debug('Registry MQTT no disponible, omitiendo consulta al buffer', { deviceId });
        return null;
      }

      // Mapear métricas agregadas a métricas raw para buscar en buffer
      const rawMetricNames = metricNames ? this.mapAggregatedToRawMetrics(metricNames) : null;

      // Obtener datos del buffer usando el deviceId original (shelly_device_id)
      const bufferData = mqttServiceRegistry.getLatestBufferMetricsForDevice(deviceId, rawMetricNames);
      
      if (!bufferData) {
        logger.debug('No hay datos en buffer para dispositivo', { deviceId, rawMetricNames });
        return null;
      }

      // Si se pidieron métricas específicas agregadas, mapear las respuestas
      if (metricNames && metricNames.length > 0) {
        const mappedMetrics = {};
        
        for (const requestedMetric of metricNames) {
          const rawMetric = this.getRawMetricName(requestedMetric);
          
          if (bufferData.metrics[rawMetric] !== undefined) {
            // Si tenemos el valor raw, usarlo para todas las variantes agregadas
            mappedMetrics[requestedMetric] = bufferData.metrics[rawMetric];
            
            logger.debug('Métrica mapeada desde buffer', {
              requested: requestedMetric,
              raw: rawMetric,
              value: bufferData.metrics[rawMetric]
            });
          }
        }

        if (Object.keys(mappedMetrics).length > 0) {
          return {
            ...bufferData,
            metrics: mappedMetrics,
            totalMetrics: Object.keys(mappedMetrics).length
          };
        }
      }

      logger.debug('Datos obtenidos del buffer', {
        deviceId,
        metricsCount: bufferData.totalMetrics,
        timestamp: bufferData.timestamp
      });

      return bufferData;

    } catch (error) {
      logger.error('Error obteniendo métricas del buffer:', {
        deviceId,
        metricNames,
        error: error.message
      });
      return null;
    }
  }

  /**
   * Obtiene las métricas más recientes desde la base de datos
   * @param {string} realDeviceId - UUID real del dispositivo
   * @param {Array<string>} metricNames - Nombres específicos de métricas (opcional)
   * @returns {Object|null} - Métricas de la BD o null si no hay datos
   */
  async getLatestMetricsFromDatabase(realDeviceId, metricNames = null) {
    try {
      // Construir la consulta
      let query = `
        SELECT DISTINCT ON (metric_name) 
          metric_name,
          value,
          timestamp
        FROM energy_metrics 
        WHERE device_id = $1
      `;
      
      const params = [realDeviceId];

      // Filtrar por métricas específicas si se proporcionan
      if (metricNames && Array.isArray(metricNames) && metricNames.length > 0) {
        const placeholders = metricNames.map((_, index) => `$${index + 2}`).join(', ');
        query += ` AND metric_name IN (${placeholders})`;
        params.push(...metricNames);
      }

      query += `
        ORDER BY metric_name, timestamp DESC
      `;

      const result = await database.query(query, params);

      if (result.rows.length === 0) {
        return null;
      }

      // Procesar resultados
      const metrics = {};
      let latestTimestamp = null;

      for (const row of result.rows) {
        metrics[row.metric_name] = row.value;
        
        // Encontrar el timestamp más reciente
        if (!latestTimestamp || new Date(row.timestamp) > new Date(latestTimestamp)) {
          latestTimestamp = row.timestamp;
        }
      }

      return {
        deviceId: realDeviceId,
        timestamp: latestTimestamp,
        metrics,
        totalMetrics: Object.keys(metrics).length,
        source: 'database'
      };

    } catch (error) {
      logger.error('Error obteniendo métricas de la base de datos:', {
        realDeviceId,
        metricNames,
        error: error.message
      });
      return null;
    }
  }

  /**
   * Combina métricas del buffer y de la base de datos, priorizando el buffer
   * @param {Object|null} bufferMetrics - Métricas del buffer
   * @param {Object|null} dbMetrics - Métricas de la base de datos
   * @param {Array<string>} requestedMetrics - Métricas solicitadas originalmente
   * @returns {Object} - Métricas combinadas
   */
  combineBufferAndDbMetrics(bufferMetrics, dbMetrics, requestedMetrics) {
    const combinedMetrics = {};
    let latestTimestamp = null;
    const sources = { buffer: 0, database: 0 };

    // Priorizar métricas del buffer
    if (bufferMetrics && bufferMetrics.metrics) {
      for (const [metricName, value] of Object.entries(bufferMetrics.metrics)) {
        combinedMetrics[metricName] = value;
        sources.buffer++;
      }
      
      if (bufferMetrics.timestamp) {
        latestTimestamp = bufferMetrics.timestamp;
      }
    }

    // Añadir métricas de la BD que no estén en el buffer
    if (dbMetrics && dbMetrics.metrics) {
      for (const [metricName, value] of Object.entries(dbMetrics.metrics)) {
        if (combinedMetrics[metricName] === undefined) {
          combinedMetrics[metricName] = value;
          sources.database++;
        }
      }
      
      // Usar timestamp de BD si no hay timestamp del buffer o si es más reciente
      if (dbMetrics.timestamp && (!latestTimestamp || new Date(dbMetrics.timestamp) > new Date(latestTimestamp))) {
        latestTimestamp = dbMetrics.timestamp;
      }
    }

    // Si no hay datos en ninguna fuente
    if (Object.keys(combinedMetrics).length === 0) {
      return {
        deviceId: bufferMetrics?.deviceId || dbMetrics?.deviceId || 'unknown',
        timestamp: null,
        metrics: {},
        totalMetrics: 0,
        sources
      };
    }

    return {
      deviceId: bufferMetrics?.deviceId || dbMetrics?.deviceId,
      timestamp: latestTimestamp,
      metrics: combinedMetrics,
      totalMetrics: Object.keys(combinedMetrics).length,
      sources
    };
  }

  /**
   * Mapea métricas agregadas a sus equivalentes raw para buscar en buffer
   * @param {Array<string>} metricNames - Nombres de métricas agregadas
   * @returns {Array<string>} - Nombres de métricas raw correspondientes
   */
  mapAggregatedToRawMetrics(metricNames) {
    const rawMetrics = new Set();
    
    for (const metricName of metricNames) {
      const rawMetric = this.getRawMetricName(metricName);
      rawMetrics.add(rawMetric);
    }
    
    return Array.from(rawMetrics);
  }

  /**
   * Obtiene el nombre de la métrica raw a partir de una métrica agregada
   * @param {string} aggregatedMetric - Nombre de métrica agregada (ej: "power_consumption_avg")
   * @returns {string} - Nombre de métrica raw (ej: "power_consumption")
   */
  getRawMetricName(aggregatedMetric) {
    // Sufijos de agregación conocidos
    const aggregationSuffixes = ['_avg', '_min', '_max', '_sum', '_count'];
    
    for (const suffix of aggregationSuffixes) {
      if (aggregatedMetric.endsWith(suffix)) {
        return aggregatedMetric.slice(0, -suffix.length);
      }
    }
    
    // Si no tiene sufijo de agregación, devolver tal como está
    return aggregatedMetric;
  }

  /**
   * Obtiene la evolución temporal de una métrica específica
   * @param {string} deviceId - UUID del dispositivo o shelly_device_id
   * @param {string} metricName - Nombre de la métrica
   * @param {Date|string} startDate - Fecha de inicio
   * @param {Date|string} endDate - Fecha de fin
   * @param {string} aggregation - Nivel de agregación ('1m', '5m', '15m', '1h', '1d', '1w')
   * @param {number} limit - Límite de puntos de datos (opcional)
   * @returns {Object} - Evolución temporal de la métrica
   */
  async getMetricEvolution(deviceId, metricName, startDate, endDate, aggregation = '1h', limit = null) {
    const startTime = Date.now();

    try {
      // Validaciones
      this.validateEvolutionParams(deviceId, metricName, startDate, endDate, aggregation);

      // Convertir fechas
      const start = new Date(startDate);
      const end = new Date(endDate);

      // Validar rango de fechas
      this.validateDateRange(start, end);

      // Obtener información del dispositivo y resolver al UUID real
      const deviceInfo = await this.getDeviceInfo(deviceId);
      if (!deviceInfo) {
        throw new Error(`Dispositiu amb ID ${deviceId} no trobat`);
      }

      const realDeviceId = deviceInfo.id; // UUID real del dispositivo

      // Construir consulta con agregación temporal usando funciones SQL estándar
      // Para PostgreSQL date_trunc, necesitamos usar time_bucket de TimescaleDB para intervalos personalizados
      let query;
      
      if (['1m', '5m', '15m', '30m'].includes(aggregation)) {
        // Para minutos, usar time_bucket con intervalos específicos
        const minutes = parseInt(aggregation.replace('m', ''));
        query = `
          SELECT 
            time_bucket('${minutes} minutes', timestamp) AS time_bucket,
            AVG(value) as avg_value,
            MIN(value) as min_value,
            MAX(value) as max_value,
            COUNT(value) as data_points
          FROM energy_metrics 
          WHERE device_id = $1 
            AND metric_name = $2 
            AND timestamp >= $3 
            AND timestamp <= $4
          GROUP BY time_bucket 
          ORDER BY time_bucket ASC
          ${limit ? `LIMIT $5` : ''}
        `;
      } else if (['1h', '2h', '6h', '12h'].includes(aggregation)) {
        // Para horas, usar time_bucket con intervalos específicos
        const hours = parseInt(aggregation.replace('h', ''));
        query = `
          SELECT 
            time_bucket('${hours} hours', timestamp) AS time_bucket,
            AVG(value) as avg_value,
            MIN(value) as min_value,
            MAX(value) as max_value,
            COUNT(value) as data_points
          FROM energy_metrics 
          WHERE device_id = $1 
            AND metric_name = $2 
            AND timestamp >= $3 
            AND timestamp <= $4
          GROUP BY time_bucket 
          ORDER BY time_bucket ASC
          ${limit ? `LIMIT $5` : ''}
        `;
      } else {
        // Para días, semanas y meses, usar date_trunc estándar
        const truncMap = {
          '1d': 'day',
          '1w': 'week', 
          '1M': 'month'
        };
        const truncInterval = truncMap[aggregation] || 'hour';
        
        query = `
          SELECT 
            date_trunc('${truncInterval}', timestamp) AS time_bucket,
            AVG(value) as avg_value,
            MIN(value) as min_value,
            MAX(value) as max_value,
            COUNT(value) as data_points
          FROM energy_metrics 
          WHERE device_id = $1 
            AND metric_name = $2 
            AND timestamp >= $3 
            AND timestamp <= $4
          GROUP BY time_bucket 
          ORDER BY time_bucket ASC
          ${limit ? `LIMIT $5` : ''}
        `;
      }

      const params = [realDeviceId, metricName, start, end];
      if (limit) {
        params.push(limit);
      }

      const result = await database.query(query, params);

      // Procesar resultados
      const data = result.rows.map(row => ({
        timestamp: row.time_bucket,
        value: parseFloat(row.avg_value),
        min: parseFloat(row.min_value),
        max: parseFloat(row.max_value),
        dataPoints: parseInt(row.data_points)
      }));

      // Actualizar estadísticas
      const queryTime = Date.now() - startTime;
      this.updateStats('evolution', queryTime);

      const response = {
        deviceId,
        metricName,
        aggregation,
        period: {
          start: start.toISOString(),
          end: end.toISOString()
        },
        data,
        totalPoints: data.length,
        queryTime
      };

      logger.info('Evolución de métrica obtenida', {
        deviceId,
        metricName,
        aggregation,
        dataPoints: data.length,
        queryTime,
        dateRange: `${start.toISOString()} - ${end.toISOString()}`
      });

      return response;

    } catch (error) {
      this.stats.totalErrors++;
      logger.error('Error obteniendo evolución de métrica:', {
        deviceId,
        metricName,
        startDate,
        endDate,
        aggregation,
        error: error.message,
        queryTime: Date.now() - startTime
      });
      throw error;
    }
  }

  /**
   * Obtiene múltiples métricas para un dispositivo en un rango de tiempo
   * @param {string} deviceId - UUID del dispositivo o shelly_device_id
   * @param {Date|string} startDate - Fecha de inicio
   * @param {Date|string} endDate - Fecha de fin
   * @param {Array<string>} metricNames - Nombres de métricas específicas (opcional)
   * @param {string} aggregation - Nivel de agregación
   * @param {number} limit - Límite de resultados
   * @returns {Object} - Datos de múltiples métricas
   */
  async getDeviceMetrics(deviceId, startDate, endDate, metricNames = null, aggregation = '1h', limit = 1000) {
    const startTime = Date.now();

    try {
      // Validaciones básicas
      if (!deviceId || typeof deviceId !== 'string') {
        throw new Error('deviceId és obligatori i ha de ser un string vàlid');
      }

      const start = new Date(startDate);
      const end = new Date(endDate);
      this.validateDateRange(start, end);

      // Obtener información del dispositivo y resolver al UUID real
      const deviceInfo = await this.getDeviceInfo(deviceId);
      if (!deviceInfo) {
        throw new Error(`Dispositiu amb ID ${deviceId} no trobat`);
      }

      const realDeviceId = deviceInfo.id; // UUID real del dispositivo

      // Construir consulta con agregación temporal usando TimescaleDB time_bucket
      let query;
      
      if (['1m', '5m', '15m', '30m'].includes(aggregation)) {
        // Para minutos, usar time_bucket con intervalos específicos
        const minutes = parseInt(aggregation.replace('m', ''));
        query = `
          SELECT 
            time_bucket('${minutes} minutes', timestamp) AS time_bucket,
            metric_name,
            AVG(value) as avg_value,
            MIN(value) as min_value,
            MAX(value) as max_value,
            COUNT(value) as data_points
          FROM energy_metrics 
          WHERE device_id = $1 
            AND timestamp >= $2 
            AND timestamp <= $3
        `;
      } else if (['1h', '2h', '6h', '12h'].includes(aggregation)) {
        // Para horas, usar time_bucket con intervalos específicos
        const hours = parseInt(aggregation.replace('h', ''));
        query = `
          SELECT 
            time_bucket('${hours} hours', timestamp) AS time_bucket,
            metric_name,
            AVG(value) as avg_value,
            MIN(value) as min_value,
            MAX(value) as max_value,
            COUNT(value) as data_points
          FROM energy_metrics 
          WHERE device_id = $1 
            AND timestamp >= $2 
            AND timestamp <= $3
        `;
      } else {
        // Para días, semanas y meses, usar date_trunc estándar
        const truncMap = {
          '1d': 'day',
          '1w': 'week', 
          '1M': 'month'
        };
        const truncInterval = truncMap[aggregation] || 'hour';
        
        query = `
          SELECT 
            date_trunc('${truncInterval}', timestamp) AS time_bucket,
            metric_name,
            AVG(value) as avg_value,
            MIN(value) as min_value,
            MAX(value) as max_value,
            COUNT(value) as data_points
          FROM energy_metrics 
          WHERE device_id = $1 
            AND timestamp >= $2 
            AND timestamp <= $3
        `;
      }

      const params = [realDeviceId, start, end];

      // Filtrar por métricas específicas si se proporcionan
      if (metricNames && Array.isArray(metricNames) && metricNames.length > 0) {
        const placeholders = metricNames.map((_, index) => `$${index + 4}`).join(', ');
        query += ` AND metric_name IN (${placeholders})`;
        params.push(...metricNames);
      }

      query += `
        GROUP BY time_bucket, metric_name 
        ORDER BY time_bucket ASC, metric_name ASC
        LIMIT $${params.length + 1}
      `;
      params.push(limit);

      const result = await database.query(query, params);

      // Procesar y agrupar resultados por métrica
      const metricsData = {};
      
      for (const row of result.rows) {
        const metricName = row.metric_name;
        
        if (!metricsData[metricName]) {
          metricsData[metricName] = [];
        }

        metricsData[metricName].push({
          timestamp: row.time_bucket,
          value: parseFloat(row.avg_value),
          min: parseFloat(row.min_value),
          max: parseFloat(row.max_value),
          dataPoints: parseInt(row.data_points)
        });
      }

      // Actualizar estadísticas
      const queryTime = Date.now() - startTime;
      this.updateStats('multiple', queryTime);

      const response = {
        deviceId,
        aggregation,
        period: {
          start: start.toISOString(),
          end: end.toISOString()
        },
        metrics: metricsData,
        totalMetrics: Object.keys(metricsData).length,
        totalDataPoints: result.rows.length,
        queryTime
      };

      logger.info('Métricas múltiples obtenidas', {
        deviceId,
        metricsCount: response.totalMetrics,
        totalDataPoints: response.totalDataPoints,
        queryTime,
        requestedMetrics: metricNames
      });

      return response;

    } catch (error) {
      this.stats.totalErrors++;
      logger.error('Error obteniendo métricas múltiples:', {
        deviceId,
        startDate,
        endDate,
        metricNames,
        error: error.message,
        queryTime: Date.now() - startTime
      });
      throw error;
    }
  }

  /**
   * Obtiene información básica de un dispositivo
   * @param {string} deviceId - UUID del dispositivo o generator key del YAML
   * @returns {Object} - Información del dispositivo
   */
  async getDeviceInfo(deviceId) {
    try {
      // Verificar cache primero
      if (this.deviceCache.has(deviceId)) {
        this.cacheHits++;
        return this.deviceCache.get(deviceId);
      }

      this.cacheMisses++;

      // Determinar si el deviceId es un UUID
      const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(deviceId);
      
      if (isUUID) {
        // Buscar en la base de datos por UUID
        const query = `
          SELECT 
            d.id,
            d.device_name,
            d.device_type,
            d.shelly_device_id,
            d.created_at,
            d.user_id,
            u.cups as user_cups,
            u.name as user_name
          FROM devices d
          LEFT JOIN users u ON (d.user_id != 'not_assigned' AND d.user_id::uuid = u.id)
          WHERE d.id = $1::uuid
          LIMIT 1
        `;

        const result = await database.query(query, [deviceId]);

        if (result.rows.length === 0) {
          return null;
        }

        const deviceInfo = result.rows[0];
        
        // Cachear el resultado usando tanto el UUID como el shelly_device_id
        this.deviceCache.set(deviceInfo.id, deviceInfo);
        this.deviceCache.set(deviceInfo.shelly_device_id, deviceInfo);
        
        return deviceInfo;

      } else {
        // No es UUID, buscar en el archivo YAML
        const generatorKey = deviceId.startsWith('gen-') ? deviceId.substring(4) : deviceId;
        const config = configLoader.loadEnergyGenerators();
        
        if (config[generatorKey] && config[generatorKey].active) {
          // Crear objeto virtual del generador
          // IMPORTANTE: Para generadores, el ID en la BD es CON prefijo (ej: "gen-giravolt")
          const deviceInfo = {
            id: `gen-${generatorKey}`, // CON prefijo para que coincida con la BD
            device_name: config[generatorKey].name,
            device_type: 'GENERATOR',
            shelly_device_id: deviceId,
            created_at: new Date().toISOString(),
            user_cups: null, // Los generadores no tienen usuario específico
            user_name: null,
            mqtt_topic: config[generatorKey].mqtt_topic
          };
          
          // Cachear el resultado usando múltiples claves para máxima compatibilidad
          this.deviceCache.set(deviceId, deviceInfo);           // "giravolt" -> deviceInfo
          this.deviceCache.set(generatorKey, deviceInfo);       // "giravolt" -> deviceInfo (por si acaso)
          this.deviceCache.set(`gen-${generatorKey}`, deviceInfo); // "gen-giravolt" -> deviceInfo (compatibilidad)
          
          logger.debug('Dispositivo generador encontrado en YAML', {
            deviceId,
            generatorKey,
            deviceName: deviceInfo.device_name,
            realDeviceId: deviceInfo.id
          });
          
          return deviceInfo;
        }
        
        // No encontrado ni en base de datos ni en YAML
        return null;
      }

    } catch (error) {
      logger.error('Error obteniendo información del dispositivo:', {
        deviceId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Obtiene las métricas disponibles para un dispositivo
   * @param {string} deviceId - UUID del dispositivo o shelly_device_id
   * @returns {Array} - Lista de nombres de métricas disponibles
   */
  async getAvailableMetrics(deviceId) {
    try {
      // Obtener información del dispositivo y resolver al UUID real
      const deviceInfo = await this.getDeviceInfo(deviceId);
      if (!deviceInfo) {
        throw new Error(`Dispositiu amb ID ${deviceId} no trobat`);
      }

      const realDeviceId = deviceInfo.id; // UUID real del dispositivo

      const query = `
        SELECT DISTINCT metric_name
        FROM energy_metrics
        WHERE device_id = $1
        ORDER BY metric_name
      `;

      const result = await database.query(query, [realDeviceId]);
      
      return result.rows.map(row => row.metric_name);

    } catch (error) {
      logger.error('Error obteniendo métricas disponibles:', {
        deviceId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Valida que un dispositivo existe
   * @param {string} deviceId - UUID del dispositivo
   * @returns {boolean} - True si existe, false si no
   */
  async validateDevice(deviceId) {
    try {
      const deviceInfo = await this.getDeviceInfo(deviceId);
      return deviceInfo !== null;
    } catch (error) {
      logger.error('Error validando dispositivo:', { deviceId, error: error.message });
      return false;
    }
  }

  /**
   * Valida los parámetros para consultas de evolución
   * @param {string} deviceId 
   * @param {string} metricName 
   * @param {Date|string} startDate 
   * @param {Date|string} endDate 
   * @param {string} aggregation 
   */
  validateEvolutionParams(deviceId, metricName, startDate, endDate, aggregation) {
    if (!deviceId || typeof deviceId !== 'string') {
      throw new Error('deviceId és obligatori i ha de ser un string vàlid');
    }

    if (!metricName || typeof metricName !== 'string') {
      throw new Error('metricName és obligatori i ha de ser un string vàlid');
    }

    if (!startDate || !endDate) {
      throw new Error('startDate i endDate són obligatoris');
    }

    const validAggregations = ['1m', '5m', '15m', '30m', '1h', '2h', '6h', '12h', '1d', '1w', '1M'];
    if (!validAggregations.includes(aggregation)) {
      throw new Error(`Agregació invàlida. Valors vàlids: ${validAggregations.join(', ')}`);
    }
  }

  /**
   * Valida el rango de fechas
   * @param {Date} start 
   * @param {Date} end 
   */
  validateDateRange(start, end) {
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      throw new Error('Dates invàlides proporcionades');
    }

    if (start >= end) {
      throw new Error('La data d\'inici ha de ser anterior a la data de fi');
    }

    const daysDiff = (end - start) / (1000 * 60 * 60 * 24);
    if (daysDiff > this.limits.maxDaysRange) {
      throw new Error(`El rang de dates no pot excedir ${this.limits.maxDaysRange} dies`);
    }
  }

  /**
   * Actualiza las estadísticas del servicio
   * @param {string} queryType 
   * @param {number} queryTime 
   */
  updateStats(queryType, queryTime) {
    this.stats.totalQueries++;
    this.stats.totalQueryTime += queryTime;
    this.stats.averageQueryTime = Math.round(this.stats.totalQueryTime / this.stats.totalQueries);
    this.stats.cacheHits = this.cacheHits;
    this.stats.cacheMisses = this.cacheMisses;

    switch (queryType) {
      case 'latest':
        this.stats.totalLatestMetricsQueries++;
        break;
      case 'evolution':
        this.stats.totalEvolutionQueries++;
        break;
    }
  }

  /**
   * Obtiene las estadísticas del servicio
   * @returns {Object} - Estadísticas completas
   */
  getStats() {
    const cacheTotal = this.cacheHits + this.cacheMisses;
    const cacheHitRate = cacheTotal > 0 ? (this.cacheHits / cacheTotal * 100).toFixed(2) + '%' : '0%';

    return {
      ...this.stats,
      cacheSize: this.deviceCache.size,
      cacheHitRate,
      limits: this.limits
    };
  }

  /**
   * Limpia el cache de dispositivos
   */
  clearCache() {
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
   * Resetea las estadísticas del servicio
   */
  resetStats() {
    this.stats = {
      totalQueries: 0,
      totalLatestMetricsQueries: 0,
      totalEvolutionQueries: 0,
      totalErrors: 0,
      averageQueryTime: 0,
      totalQueryTime: 0,
      cacheHits: 0,
      cacheMisses: 0
    };

    this.cacheHits = 0;
    this.cacheMisses = 0;

    logger.info('Estadísticas del servicio de historial reseteadas');
  }

  /**
   * Verifica la salud del servicio
   * @returns {boolean} - True si está saludable
   */
  async healthCheck() {
    try {
      const result = await database.query('SELECT COUNT(*) as total FROM energy_metrics LIMIT 1');
      logger.debug('Health check del servicio de historial exitoso', {
        totalMetrics: result.rows[0].total
      });
      return true;
    } catch (error) {
      logger.error('Health check del servicio de historial falló:', error);
      return false;
    }
  }
}

module.exports = DeviceHistoryService;
