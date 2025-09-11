const logger = require('../../utils/logger');
const configLoader = require('../../utils/configLoader');
const { getDeviceTypeFromTopic, classifyMetric } = require('../../config/device-metrics-config');

class NormalizerService {
  constructor() {
    this.parsers = new Map();
    this.dynamicParsers = new Map();
    this.setupStaticParsers();
    this.setupDynamicParsers();
    
    // Estadísticas
    this.stats = {
      messagesProcessed: 0,
      messagesNormalized: 0,
      messagesSkipped: 0,
      messagesErrored: 0,
      parserStats: new Map()
    };
  }

  /**
   * Configura los parsers estáticos para tipos de topics fijos
   */
  setupStaticParsers() {
    // Dispositivos Shelly - Cualquier métrica de forma dinámica
    this.parsers.set(
      /^shellies\/(.+)$/,
      this.parseShelly.bind(this)
    );

    // Datos de consumo por CUPS
    this.parsers.set(
      /^ConsumCups\/(.+)$/,
      this.parseConsumCups.bind(this)
    );

    // Control ACS - Cualquier estado
    this.parsers.set(
      /^acs\/(.+)$/,
      this.parseAcs.bind(this)
    );

    logger.info('Parsers estáticos configurados', { 
      totalStaticParsers: this.parsers.size 
    });
  }

  /**
   * Configura los parsers dinámicos basándose en la configuración YAML
   */
  setupDynamicParsers() {
    try {
      this.dynamicParsers.clear();
      const generators = configLoader.getActiveGenerators();
      
      for (const generator of generators) {
        if (generator.topic) {
          // Crear un parser específico para cada topic de generador
          this.dynamicParsers.set(generator.topic, {
            id: generator.id,
            name: generator.name,
            parser: this.parseEnergyGenerator.bind(this)
          });
        }
      }

      logger.info('Parsers dinámicos configurados', { 
        totalDynamicParsers: this.dynamicParsers.size,
        generators: generators.map(g => ({ id: g.id, topic: g.topic }))
      });

    } catch (error) {
      logger.error('Error configurando parsers dinámicos:', error);
    }
  }

  /**
   * Recarga los parsers dinámicos (útil cuando cambia la configuración)
   */
  reloadDynamicParsers() {
    logger.info('Recargando parsers dinámicos...');
    this.setupDynamicParsers();
  }

  /**
   * Normaliza un mensaje MQTT
   * @param {Object} messageData - Datos del mensaje MQTT
   * @returns {Object|null} - Objeto normalizado o null si no se puede procesar
   */
  normalize(messageData) {
    this.stats.messagesProcessed++;

    try {
      const { topic, payload, timestamp } = messageData;

      // Primero buscar en parsers dinámicos (generadores)
      if (this.dynamicParsers.has(topic)) {
        const dynamicParser = this.dynamicParsers.get(topic);
        const parserName = `dynamic_${dynamicParser.id}`;
        
        // Actualizar estadísticas del parser
        this.updateParserStats(parserName);

        const result = dynamicParser.parser(dynamicParser, payload, timestamp);
        
        if (result) {
          this.stats.messagesNormalized++;
          
          // Clasificar métricas en estados y series temporales
          const classifiedResult = this.classifyMetrics(result);
          
          logger.debug('Mensaje normalizado (dinámico)', { 
            topic, 
            generatorId: dynamicParser.id,
            deviceId: result.deviceId,
            metricsCount: result.metrics?.length || 0,
            stateMetrics: classifiedResult.stateMetrics.length,
            timeSeriesMetrics: classifiedResult.timeSeriesMetrics.length
          });
          return classifiedResult;
        } else {
          this.stats.messagesSkipped++;
          logger.debug('Mensaje omitido por parser dinámico', { topic, generator: dynamicParser.id });
          return null;
        }
      }

      // Luego buscar en parsers estáticos
      for (const [pattern, parser] of this.parsers) {
        const match = topic.match(pattern);
        if (match) {
          const parserName = parser.name || 'unknown';
          
          // Actualizar estadísticas del parser
          this.updateParserStats(parserName);

          const result = parser(match, payload, timestamp, topic);
          
          if (result) {
            this.stats.messagesNormalized++;
            
            // Clasificar métricas en estados y series temporales
            const classifiedResult = this.classifyMetrics(result);
            
            logger.debug('Mensaje normalizado (estático)', { 
              topic, 
              deviceId: result.deviceId,
              metricsCount: result.metrics?.length || 0,
              stateMetrics: classifiedResult.stateMetrics.length,
              timeSeriesMetrics: classifiedResult.timeSeriesMetrics.length
            });
            return classifiedResult;
          } else {
            this.stats.messagesSkipped++;
            logger.debug('Mensaje omitido por parser estático', { topic, parser: parserName });
            return null;
          }
        }
      }

      // No se encontró parser
      this.stats.messagesSkipped++;
      logger.debug('No se encontró parser para el topic', { topic });
      return null;

    } catch (error) {
      this.stats.messagesErrored++;
      logger.error('Error normalizando mensaje', { 
        topic: messageData.topic,
        error: error.message 
      });
      return null;
    }
  }

  /**
   * Actualiza las estadísticas de un parser
   */
  updateParserStats(parserName) {
    if (!this.stats.parserStats.has(parserName)) {
      this.stats.parserStats.set(parserName, 0);
    }
    this.stats.parserStats.set(parserName, this.stats.parserStats.get(parserName) + 1);
  }

  /**
   * Parser universal para dispositivos Shelly - Maneja cualquier métrica dinámicamente
   */
  parseShelly(match, payload, timestamp, fullTopic) {
    const [, topicPath] = match;
    
    // Parsear la estructura del topic de Shelly
    const topicParts = topicPath.split('/');
    
    // Diferentes estructuras posibles:
    // shellyem/DEVICE_ID/emeter/INDEX/METRIC
    // shellyem/DEVICE_ID/relay/INDEX
    // shellyem/DEVICE_ID/online
    // shellyem/DEVICE_ID/announce
    // shellyem/DEVICE_ID/info
    // announce (global)
    
    let deviceId, deviceType, metricInfo;

    if (topicParts[0] === 'announce') {
      // Topic global de announce
      try {
        const data = JSON.parse(payload);
        deviceId = data.id || 'unknown';
        deviceType = 'SHELLY_ANNOUNCE';
        metricInfo = {
          name: 'device_announce',
          value: payload,
          unit: 'json'
        };
      } catch (error) {
        return null;
      }
    } else if (topicParts.length >= 2) {
      // Topics específicos de dispositivo
      const shellyType = topicParts[0]; // shellyem, shellyplusplugs, etc.
      deviceId = topicParts[1];
      deviceType = `SHELLY_${shellyType.toUpperCase()}`;
      
      if (topicParts.length === 2) {
        // shellies/shellyem/DEVICE_ID (sin subtopic)
        metricInfo = {
          name: 'device_info',
          value: payload,
          unit: 'string'
        };
      } else {
        // Subtopics como emeter, relay, online, etc.
        const subtopic = topicParts.slice(2).join('/');
        metricInfo = this.parseShellySubtopic(subtopic, payload);
      }
    } else {
      return null;
    }

    if (!metricInfo) {
      return null;
    }

    return {
      deviceId,
      deviceType,
      timestamp: new Date(timestamp),
      metrics: [metricInfo]
    };
  }

  /**
   * Parsea subtopics de Shelly de forma dinámica
   */
  parseShellySubtopic(subtopic, payload) {
    const parts = subtopic.split('/');
    
    // Intentar parsear como número primero
    let value = payload;
    const numericValue = parseFloat(payload);
    if (!isNaN(numericValue)) {
      value = numericValue;
    } else if (payload.toLowerCase() === 'true' || payload.toLowerCase() === 'false') {
      value = payload.toLowerCase() === 'true' ? 1 : 0;
    } else if (payload.toLowerCase() === 'on' || payload.toLowerCase() === 'off') {
      value = payload.toLowerCase() === 'on' ? 1 : 0;
    } else {
      // Intentar parsear como JSON
      try {
        const jsonData = JSON.parse(payload);
        value = jsonData;
      } catch (error) {
        // Mantener como string
        value = payload;
      }
    }

    // Crear nombre de métrica basado en el subtopic
    const metricName = parts.join('_');
    
    // Determinar unidad basada en el nombre y valor
    let unit = this.determineUnit(metricName, value);
    
    // Agregar información adicional si es un subtopic estructurado
    const metricInfo = {
      name: metricName,
      value: value,
      unit: unit
    };

    // Agregar índices si están presentes (ej: emeter/0/power)
    if (parts.length >= 2 && !isNaN(parseInt(parts[1]))) {
      metricInfo.index = parseInt(parts[1]);
    }

    return metricInfo;
  }

  /**
   * Verifica si un string es una dirección IP válida
   * @param {string} str - String a verificar
   * @returns {boolean}
   */
  isIpAddress(str) {
    // Regex simple para IPv4
    const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
    return ipv4Regex.test(str);
  }

  /**
   * Determina la unidad basándose en el nombre de la métrica y su valor
   */
  determineUnit(metricName, value) {
    const lowerName = metricName.toLowerCase();
    
    // Unidades basadas en nombres conocidos
    if (lowerName.includes('power')) return 'W';
    if (lowerName.includes('voltage')) return 'V';
    if (lowerName.includes('current') || lowerName.includes('intensitat')) return 'A';
    if (lowerName.includes('frequency') || lowerName.includes('frequencia')) return 'Hz';
    if (lowerName.includes('energy') || lowerName.includes('total')) return 'Wh';
    if (lowerName.includes('reactive')) return 'VAR';
    if (lowerName.includes('pf') || lowerName.includes('factor')) return 'ratio';
    if (lowerName.includes('temperature') || lowerName.includes('temp')) return 'C';
    
    // Unidades basadas en el tipo de valor
    if (typeof value === 'boolean' || value === 0 || value === 1) {
      if (lowerName.includes('online') || lowerName.includes('relay') || lowerName.includes('switch')) {
        return 'boolean';
      }
    }
    
    if (typeof value === 'object') return 'json';
    if (typeof value === 'string' && isNaN(parseFloat(value))) return 'string';
    if (typeof value === 'number') return 'numeric';
    
    return 'unknown';
  }

  /**
   * Parser para datos de consumo por CUPS
   */
  parseConsumCups(match, payload, timestamp) {
    const [, cups] = match;

    try {
      const data = JSON.parse(payload);
      const metrics = [];

      // Procesar todos los campos del JSON dinámicamente
      for (const [key, value] of Object.entries(data)) {
        if (typeof value === 'number') {
          let normalizedValue = value;
          let unit = 'numeric';
          
          // Convertir kW a W si es potencia
          if (key.toLowerCase().includes('potencia') && value < 100) {
            normalizedValue = value * 1000;
            unit = 'W';
          } else if (key.toLowerCase().includes('voltatge') || key.toLowerCase().includes('voltage')) {
            unit = 'V';
          } else if (key.toLowerCase().includes('intensitat') || key.toLowerCase().includes('current')) {
            unit = 'A';
          } else if (key.toLowerCase().includes('frequencia') || key.toLowerCase().includes('frequency')) {
            unit = 'Hz';
          }

          metrics.push({
            name: key,
            value: normalizedValue,
            unit: unit
          });
        }
      }

      if (metrics.length === 0) {
        return null;
      }

      return {
        deviceId: cups,
        deviceType: 'CIRCUTOR',
        timestamp: new Date(timestamp),
        metrics
      };

    } catch (error) {
      logger.warn('Error parseando JSON de ConsumCups', { cups, payload, error: error.message });
      return null;
    }
  }

  /**
   * Parser universal para PLUGs (incluyendo ACS)
   * Maneja tanto valores simples como JSONs complejos de status
   */
  parseAcs(match, payload, timestamp, fullTopic) {
    const [, acsPath] = match;
    const pathParts = acsPath.split('/');
    
    if (pathParts.length < 1) {
      return null;
    }

    // Para dispositivos PLUG, el deviceId debe incluir el prefijo completo
    // Ejemplo: acs/ES0031446458360006JY0F/status/switch:0 -> deviceId = "acs/ES0031446458360006JY0F"
    // El deviceId se construye desde el topic original, no del path parseado
    const topicParts = fullTopic.split('/');
    const deviceId = topicParts.length >= 2 ? `${topicParts[0]}/${topicParts[1]}` : topicParts[0];
    const subtopic = pathParts.slice(1).join('/');
    
    // Determinar el tipo de dispositivo usando la nueva función
    const deviceType = getDeviceTypeFromTopic(fullTopic);
    
    let metrics = [];
    
    try {
      // Intentar parsear como JSON primero
      const data = JSON.parse(payload);
      
      // Si es un JSON complejo (como el status de un PLUG), extraer métricas anidadas
      if (typeof data === 'object' && data !== null) {
        metrics = this.extractNestedMetrics(data, subtopic.replace(/\//g, '_'));
      } else {
        // JSON simple, tratar como una sola métrica
        metrics.push({
          name: subtopic.replace(/\//g, '_'),
          value: data,
          unit: this.determineUnit(subtopic, data)
        });
      }
    } catch (error) {
      // Si no es JSON, tratar como valor simple
      let value = payload;
      if (!isNaN(parseFloat(payload))) {
        value = parseFloat(payload);
      } else if (payload.toLowerCase() === 'true' || payload.toLowerCase() === 'false') {
        value = payload.toLowerCase() === 'true';
      }
      
      metrics.push({
        name: subtopic.replace(/\//g, '_'),
        value: value,
        unit: this.determineUnit(subtopic, value)
      });
    }

    if (metrics.length === 0) {
      return null;
    }

    return {
      deviceId,
      deviceType,
      timestamp: new Date(timestamp),
      metrics
    };
  }

  /**
   * Extrae métricas de objetos JSON anidados (para PLUGs)
   * @param {Object} data - Objeto JSON a procesar
   * @param {string} prefix - Prefijo para los nombres de métricas
   * @returns {Array} - Array de métricas extraídas
   */
  extractNestedMetrics(data, prefix = '') {
    const metrics = [];
    
    const processObject = (obj, currentPrefix) => {
      for (const [key, value] of Object.entries(obj)) {
        const metricName = currentPrefix ? `${currentPrefix}_${key}` : key;
        
        if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
          // Objeto anidado, procesar recursivamente
          processObject(value, metricName);
        } else if (Array.isArray(value)) {
          // Array, procesar elementos si son primitivos
          value.forEach((item, index) => {
            if (typeof item !== 'object') {
              metrics.push({
                name: `${metricName}_${index}`,
                value: item,
                unit: this.determineUnit(`${metricName}_${index}`, item)
              });
            }
          });
        } else {
          // Valor primitivo
          let processedValue = value;
          
          // Convertir strings booleanos a boolean
          if (typeof value === 'string') {
            if (value.toLowerCase() === 'true') {
              processedValue = true;
            } else if (value.toLowerCase() === 'false') {
              processedValue = false;
            } else if (this.isIpAddress(value)) {
              // Mantener direcciones IP como strings
              processedValue = value;
            } else if (!isNaN(parseFloat(value))) {
              processedValue = parseFloat(value);
            }
          }
          
          metrics.push({
            name: metricName,
            value: processedValue,
            unit: this.determineUnit(metricName, processedValue)
          });
        }
      }
    };
    
    processObject(data, prefix);
    return metrics;
  }

  /**
   * Parser dinámico para generadores de energía
   */
  parseEnergyGenerator(generatorConfig, payload, timestamp) {
    try {
      const data = JSON.parse(payload);
      const metrics = [];

      // Procesar todos los campos del JSON dinámicamente
      for (const [key, value] of Object.entries(data)) {
        if (typeof value === 'number') {
          let normalizedValue = value;
          let unit = 'numeric';
          
          // Convertir kW a W si parece ser potencia
          if (key.toLowerCase().includes('potencia') && value < 100) {
            normalizedValue = value * 1000;
            unit = 'W';
          } else {
            unit = this.determineUnit(key, value);
          }

          metrics.push({
            name: key,
            value: normalizedValue,
            unit: unit
          });
        }
      }

      if (metrics.length === 0) {
        logger.debug('No se encontraron campos numéricos en generador', { 
          generatorId: generatorConfig.id,
          payload: payload.substring(0, 100)
        });
        return null;
      }

      return {
        deviceId: generatorConfig.id,
        deviceType: 'ENERGY_GENERATOR',
        generatorName: generatorConfig.name,
        timestamp: new Date(timestamp),
        metrics
      };

    } catch (error) {
      logger.warn('Error parseando JSON de generador de energía', { 
        generatorId: generatorConfig.id,
        payload: payload.substring(0, 100), 
        error: error.message 
      });
      return null;
    }
  }

  /**
   * Clasifica las métricas en estados y series temporales
   * @param {Object} normalizedData - Datos normalizados del parser
   * @returns {Object} - Objeto con stateMetrics y timeSeriesMetrics separados
   */
  classifyMetrics(normalizedData) {
    const { deviceId, deviceType, timestamp, metrics, generatorName } = normalizedData;
    
    const stateMetrics = [];
    const timeSeriesMetrics = [];
    const ignoredMetrics = [];
    
    for (const metric of metrics) {
      const { name: metricName, value, unit } = metric;
      
      // Clasificar la métrica según la configuración
      const classification = classifyMetric(deviceType, metricName);
      
      switch (classification) {
        case 'state':
          stateMetrics.push({
            metricName,
            value,
            unit,
            deviceType
          });
          break;
          
        case 'timeseries':
          // Solo agregar a series temporales si el valor es numérico
          if (typeof value === 'number' && !isNaN(value)) {
            timeSeriesMetrics.push({
              metricName,
              value,
              unit,
              deviceType
            });
          } else {
            logger.debug('Valor no numérico omitido para serie temporal', { 
              deviceId, 
              metricName, 
              value, 
              type: typeof value 
            });
          }
          break;
          
        case 'ignored':
          ignoredMetrics.push(metricName);
          break;
          
        case 'unknown':
          // Para métricas desconocidas, decidir basándose en el tipo de valor
          if (typeof value === 'number' && !isNaN(value)) {
            timeSeriesMetrics.push({
              metricName,
              value,
              unit,
              deviceType
            });
            logger.debug('Métrica desconocida tratada como serie temporal', {
              deviceId,
              deviceType,
              metricName,
              value
            });
          } else {
            stateMetrics.push({
              metricName,
              value,
              unit,
              deviceType
            });
            logger.debug('Métrica desconocida tratada como estado', {
              deviceId,
              deviceType,
              metricName,
              value
            });
          }
          break;
      }
    }
    
    // Log del resumen de clasificación
    if (ignoredMetrics.length > 0) {
      logger.debug('Métricas ignoradas según configuración', {
        deviceId,
        deviceType,
        ignoredMetrics
      });
    }
    
    return {
      deviceId,
      deviceType,
      timestamp,
      generatorName,
      stateMetrics,
      timeSeriesMetrics,
      // Mantener métricas originales para compatibilidad
      metrics
    };
  }

  /**
   * Obtiene las estadísticas del normalizador
   */
  getStats() {
    return {
      ...this.stats,
      parserStats: Object.fromEntries(this.stats.parserStats),
      successRate: this.stats.messagesProcessed > 0 
        ? (this.stats.messagesNormalized / this.stats.messagesProcessed * 100).toFixed(2) + '%'
        : '0%',
      totalParsers: this.parsers.size + this.dynamicParsers.size
    };
  }

  /**
   * Resetea las estadísticas
   */
  resetStats() {
    this.stats = {
      messagesProcessed: 0,
      messagesNormalized: 0,
      messagesSkipped: 0,
      messagesErrored: 0,
      parserStats: new Map()
    };
    logger.info('Estadísticas del normalizador reseteadas');
  }
}

module.exports = NormalizerService;
