const configLoader = require('../utils/configLoader');

/**
 * Configuración de métricas por tipo de dispositivo
 * Define qué métricas se guardan como series temporales vs estados
 * 
 * Solo hay 3 tipos de dispositivos:
 * 1. SHELLY_EM: topics que empiezan con "shellies/shellyem/"
 * 2. PLUG: topics que empiezan con "* /cups" (acs/xxx, pepe/xxx, etc.)
 * 3. GENERATOR: topics definidos en el yml de configuración de generadores
 */

const DEVICE_METRICS_CONFIG = {
  // Shelly EM 50A - Medidor de energía
  // Topics: shellies/shellyem/{cups}/...
  SHELLY_SHELLYEM: {
    deviceType: 'EM',
    description: 'Shelly EM 50A - Medidor de energía bifásico',
    
    // Métricas que se guardan como series temporales (con agregados)
    timeSeriesMetrics: [
      'emeter_0_power',           // Potencia instantánea canal 0
      // 'emeter_0_reactive_power',  // Potencia reactiva canal 0
      // 'emeter_0_voltage',         // Voltaje canal 0
      // 'emeter_0_frequency',       // Frecuencia canal 0
      'emeter_0_energy',          // Contador a corto plazo (usar power o total)
      'emeter_0_total',           // Energía total consumida canal 0 (timeseries + state)
      'emeter_0_total_returned',  // Energía total devuelta canal 0 (timeseries + state)
      // 'emeter_1_power',           // Potencia instantánea canal 1
      // 'emeter_1_reactive_power',  // Potencia reactiva canal 1
      // 'emeter_1_voltage',         // Voltaje canal 1
      // 'emeter_1_frequency'        // Frecuencia canal 1
    ],
    
    // Métricas que se guardan como estados (valor actual)
    stateMetrics: [
      'online',                   // Estado de conexión
      'relay_0',                  // Estado del relé interno
      'emeter_0_power',           // Potencia instantánea canal 0 (també timeseries)
      'emeter_0_total',           // Energía total consumida canal 0 (timeseries + state)
      'emeter_0_total_returned',  // Energía total devuelta canal 0 (timeseries + state)
      'emeter_1_total',           // Energía total consumida canal 1
      'emeter_1_total_returned'   // Energía total devuelta canal 1
    ],
    
    // Métricas que se ignoran (no se procesan)
    ignoredMetrics: [
      'emeter_0_returned_energy', // Contador a corto plazo (usar total_returned)
      'emeter_1_energy',          // Contador a corto plazo (usar power o total)
      'emeter_1_returned_energy'  // Contador a corto plazo (usar total_returned)
    ]
  },

  // Bomba depuradora de piscina
  // Topics: shellies/BombaDepuradora/{cups}/...
  SHELLY_BOMBADEPURADORA: {
    deviceType: 'POOL',
    description: 'Shelly - Bomba depuradora de piscina',
    
    timeSeriesMetrics: [
      'emeter_0_total',
      'emeter_0_total_returned'
    ],
    
    stateMetrics: [
      'emeter_0_power',            // Potència actual (W) - vital per poolService
      'relay_0'                    // Estat del relé (on/off)
    ],
    
    ignoredMetrics: [
      'emeter_0_reactive_power',
      'emeter_0_voltage',
      'emeter_1_power',
      'emeter_1_reactive_power',
      'emeter_1_voltage',
      'emeter_1_total',
      'emeter_1_total_returned',
      'emeter_0_energy',
      'emeter_0_returned_energy',
      'emeter_1_energy',
      'emeter_1_returned_energy'
    ]
  },

  // Bomba neteja fons de piscina
  // Topics: shellies/BombaNet/{cups}/...
  SHELLY_BOMBANETEJA: {
    deviceType: 'POOL',
    description: 'Shelly - Bomba neteja fons de piscina',

    timeSeriesMetrics: [
      'emeter_0_total',
      'emeter_0_total_returned'
    ],

    stateMetrics: [
      'emeter_0_power',
      'relay_0'
    ],

    ignoredMetrics: [
      'emeter_0_reactive_power',
      'emeter_0_voltage',
      'emeter_1_power',
      'emeter_1_reactive_power',
      'emeter_1_voltage',
      'emeter_1_total',
      'emeter_1_total_returned',
      'emeter_0_energy',
      'emeter_0_returned_energy',
      'emeter_1_energy',
      'emeter_1_returned_energy'
    ]
  },

  // Clorador salí de piscina
  // Topics: shellies/CloradorSali/{cups}/...
  SHELLY_CLORADORSALI: {
    deviceType: 'POOL',
    description: 'Shelly - Clorador salí de piscina',

    timeSeriesMetrics: [
      'emeter_0_total',
      'emeter_0_total_returned'
    ],

    stateMetrics: [
      'emeter_0_power',
      'relay_0'
    ],

    ignoredMetrics: [
      'emeter_0_reactive_power',
      'emeter_0_voltage',
      'emeter_1_power',
      'emeter_1_reactive_power',
      'emeter_1_voltage',
      'emeter_1_total',
      'emeter_1_total_returned',
      'emeter_0_energy',
      'emeter_0_returned_energy',
      'emeter_1_energy',
      'emeter_1_returned_energy'
    ]
  },

  // Shelly Plus Plug S - Enchufe inteligente
  // Topics: {cualquier_prefijo}/{cups}/... (acs/xxx, pepe/xxx, etc.)
  PLUG: {
    deviceType: 'PLUG',
    description: 'Shelly Plus Plug S - Enchufe inteligente con medición',
    
    // Métricas que se guardan como series temporales (con agregados)
    timeSeriesMetrics: [
      'status_switch:0_apower',      // Potencia instantánea
      'status_switch:0_aenergy_total', // Energía total consumida
      'status_switch:0_temperature_tC', // Temperatura interna
      //'status_wifi_rssi',            // Intensidad señal WiFi
      'status_switch:0_voltage',     // Voltaje de línea
      'status_switch:0_current'      // Corriente
    ],
    
    // Métricas que se guardan como estados (valor actual)
    stateMetrics: [
      'online',                      // Estado de conexión MQTT
      'status_switch:0_output',      // Estado del enchufe (on/off)
      'status_mqtt_connected',       // Conexión MQTT
      'status_cloud_connected',      // Conexión con la nube
      'status_switch:0_source',      // Último sistema que cambió el estado
      'status_sys_mac',              // Dirección MAC
      'status_sys_uptime',           // Tiempo encendido
      'status_wifi_sta_ip',          // IP asignada
      'status_wifi_ssid'             // Red WiFi conectada
    ],
    
    // Métricas que se ignoran
    ignoredMetrics: [
      'status_switch:0_freq',        // Frecuencia (normalmente estable)
      'status_switch:0_aenergy_by_minute', // Datos por minuto (redundante)
      'status_switch:0_ret_aenergy', // Energía devuelta (normalmente 0 en plugs)
      'status_ble',                  // Bluetooth (no usado)
      'status_plugs_ui',             // UI específica (no relevante)
      'status_sys_restart_required', // Estado temporal
      'status_sys_time',             // Hora del sistema (redundante)
      'status_sys_unixtime',         // Timestamp (redundante)
      'status_sys_ram_size',         // Info hardware (estática)
      'status_sys_ram_free',         // RAM libre (muy variable, poco útil)
      'status_sys_fs_size',          // Tamaño filesystem (estático)
      'status_sys_fs_free',          // Espacio libre (poco relevante)
      'status_sys_cfg_rev',          // Revisión config (técnico)
      'status_sys_kvs_rev',          // Revisión KVS (técnico)
      'status_sys_schedule_rev',     // Revisión schedule (técnico)
      'status_sys_webhook_rev',      // Revisión webhook (técnico)
      'status_sys_available_updates', // Updates disponibles (temporal)
      'status_sys_reset_reason',     // Razón último reset (histórico)
      'status_wifi_status',          // Estado WiFi (redundante con sta_ip)
      'status_ws_connected'          // WebSocket (técnico)
    ]
  },

  // Generadores de energía
  // Topics: definidos en el yml de configuración de generadores
  GENERATOR: {
    deviceType: 'GENERATOR',
    description: 'Generadores de energía fotovoltaica',
    
    // Métricas que se guardan como series temporales
    timeSeriesMetrics: [
      'e_total_fotovoltaica',        // Energía total generada
      'potenciaFotovoltaica',        // Potencia generada instantánea
      'voltatge',                    // Voltaje del generador
      'intensitat',                  // Intensidad del generador
      'frequencia',                  // Frecuencia
      'potencia_circutor',           // Potencia del circutor
      'voltatge_circutor',           // Voltaje del circutor
      'intensitat_circutor',         // Intensidad del circutor
      'frequencia_circutor'          // Frecuencia del circutor
    ],
    
    // Métricas que se guardan como estados
    stateMetrics: [
      'e_total_dia_fotovoltaica',    // Energía del día
      'e_total_abocada_fotovoltaica', // Energía vertida a red
      'e_activa_total',              // Energía activa total
      'e_reactiva_total',            // Energía reactiva total
      'e_activa_consumida',          // Energía activa consumida
      'e_activa_generada'            // Energía activa generada
    ],
    
    ignoredMetrics: [
      'nodada1', 'nodada2', 'nodada3', 'nodada4', // Campos sin datos
      'timestamp'                    // Ya tenemos timestamp del mensaje
    ]
  }
};

/**
 * Determina el tipo de dispositivo basándose en el topic MQTT
 * @param {string} topic - Topic MQTT
 * @returns {string} - 'SHELLY_EM', 'PLUG', 'GENERATOR', o 'UNKNOWN'
 */
function getDeviceTypeFromTopic(topic) {
  // Bomba depuradora: shellies/BombaDepuradora/...
  if (topic.startsWith('shellies/BombaDepuradora/')) {
    return 'SHELLY_BOMBADEPURADORA';
  }

  // Bomba neteja: shellies/BombaNet/...
  if (topic.startsWith('shellies/BombaNet/')) {
    return 'SHELLY_BOMBANETEJA';
  }

  // Clorador salí: shellies/CloradorSali/...
  if (topic.startsWith('shellies/CloradorSali/')) {
    return 'SHELLY_CLORADORSALI';
  }

  // Shelly EM: shellies/shellyem/...
  if (topic.startsWith('shellies/shellyem/')) {
    return 'SHELLY_EM';
  }
  
  // Verificar si el topic está en la configuración de generadores
  try {
    const generators = configLoader.getActiveGenerators();
    for (const generator of generators) {
      if (generator.topic && generator.topic === topic) {
        return 'GENERATOR';
      }
    }
  } catch (error) {
    // Si hay error leyendo la configuración, continuar con la lógica normal
    console.warn('Error leyendo configuración de generadores:', error.message);
  }
  
  // PLUG: cualquier otro patrón {prefijo}/{cups}/...
  // Verificar que tiene al menos dos partes separadas por /
  const parts = topic.split('/');
  if (parts.length >= 2) {
    return 'PLUG';
  }
  
  return 'UNKNOWN';
}

/**
 * Obtiene la configuración de métricas para un tipo de dispositivo
 * @param {string} deviceType - Tipo de dispositivo
 * @returns {Object|null} - Configuración de métricas o null si no existe
 */
function getMetricsConfig(deviceType) {
  return DEVICE_METRICS_CONFIG[deviceType] || null;
}

/**
 * Determina si una métrica debe guardarse como serie temporal
 * @param {string} deviceType - Tipo de dispositivo
 * @param {string} metricName - Nombre de la métrica
 * @returns {boolean}
 */
function isTimeSeriesMetric(deviceType, metricName) {
  const config = getMetricsConfig(deviceType);
  if (!config) return false;
  
  return config.timeSeriesMetrics.includes(metricName);
}

/**
 * Determina si una métrica debe guardarse como estado
 * @param {string} deviceType - Tipo de dispositivo
 * @param {string} metricName - Nombre de la métrica
 * @returns {boolean}
 */
function isStateMetric(deviceType, metricName) {
  const config = getMetricsConfig(deviceType);
  if (!config) return false;
  
  return config.stateMetrics.includes(metricName);
}

/**
 * Determina si una métrica debe ignorarse
 * @param {string} deviceType - Tipo de dispositivo
 * @param {string} metricName - Nombre de la métrica
 * @returns {boolean}
 */
function isIgnoredMetric(deviceType, metricName) {
  const config = getMetricsConfig(deviceType);
  if (!config) return false;
  
  return config.ignoredMetrics.includes(metricName);
}

/**
 * Clasifica una métrica según su tipo de persistencia
 * @param {string} deviceType - Tipo de dispositivo
 * @param {string} metricName - Nombre de la métrica
 * @returns {string} - 'timeseries', 'state', 'ignored', o 'unknown'
 */
function classifyMetric(deviceType, metricName) {
  if (isIgnoredMetric(deviceType, metricName)) return 'ignored';
  if (isTimeSeriesMetric(deviceType, metricName)) return 'timeseries';
  if (isStateMetric(deviceType, metricName)) return 'state';
  return 'unknown';
}

/**
 * Obtiene todas las configuraciones disponibles
 * @returns {Object}
 */
function getAllConfigs() {
  return DEVICE_METRICS_CONFIG;
}

/**
 * Getters para métricas específicas por tipo de dispositivo
 */

/**
 * Obtiene las claves de potencia para un tipo de dispositivo
 * @param {string} deviceType - Tipo de dispositivo ('SHELLY_EM', 'PLUG', 'GENERATOR')
 * @returns {Array<string>} - Array de claves de potencia
 */
function getPowerMetrics(deviceType) {
  switch (deviceType) {
    case 'SHELLY_EM':
      return ['emeter_0_power', 'emeter_1_power'];
    case 'PLUG':
      return ['status_switch:0_apower'];
    case 'GENERATOR':
      return ['potenciaFotovoltaica', 'potencia_circutor'];
    default:
      return [];
  }
}

/**
 * Obtiene las claves de tensión para un tipo de dispositivo
 * @param {string} deviceType - Tipo de dispositivo ('SHELLY_EM', 'PLUG', 'GENERATOR')
 * @returns {Array<string>} - Array de claves de tensión
 */
function getVoltageMetrics(deviceType) {
  switch (deviceType) {
    case 'SHELLY_EM':
      return ['emeter_0_voltage', 'emeter_1_voltage'];
    case 'PLUG':
      return ['status_switch:0_voltage'];
    case 'GENERATOR':
      return ['voltatge', 'voltatge_circutor'];
    default:
      return [];
  }
}

/**
 * Obtiene las claves de frecuencia para un tipo de dispositivo
 * @param {string} deviceType - Tipo de dispositivo ('SHELLY_EM', 'PLUG', 'GENERATOR')
 * @returns {Array<string>} - Array de claves de frecuencia
 */
function getFrequencyMetrics(deviceType) {
  switch (deviceType) {
    case 'SHELLY_EM':
      return ['emeter_0_frequency', 'emeter_1_frequency'];
    case 'PLUG':
      return ['status_switch:0_freq']; // Nota: Esta métrica está marcada como ignorada
    case 'GENERATOR':
      return ['frequencia', 'frequencia_circutor'];
    default:
      return [];
  }
}

/**
 * Obtiene todas las métricas de un tipo específico para un dispositivo
 * @param {string} deviceType - Tipo de dispositivo
 * @param {string} metricType - Tipo de métrica ('power', 'voltage', 'frequency')
 * @returns {Array<string>} - Array de claves de métricas
 */
function getMetricsByType(deviceType, metricType) {
  switch (metricType.toLowerCase()) {
    case 'power':
    case 'potencia':
      return getPowerMetrics(deviceType);
    case 'voltage':
    case 'tension':
    case 'voltaje':
      return getVoltageMetrics(deviceType);
    case 'frequency':
    case 'frecuencia':
      return getFrequencyMetrics(deviceType);
    default:
      return [];
  }
}

/**
 * Obtiene las unidades para un tipo de métrica
 * @param {string} metricType - Tipo de métrica ('power', 'voltage', 'frequency')
 * @returns {string} - Unidad de medida
 */
function getMetricUnit(metricType) {
  switch (metricType.toLowerCase()) {
    case 'power':
    case 'potencia':
      return 'W'; // Vatios
    case 'voltage':
    case 'tension':
    case 'voltaje':
      return 'V'; // Voltios
    case 'frequency':
    case 'frecuencia':
      return 'Hz'; // Hercios
    default:
      return '';
  }
}

/**
 * Obtiene información completa de métricas para un dispositivo
 * @param {string} deviceType - Tipo de dispositivo
 * @returns {Object} - Objeto con todas las métricas organizadas por tipo
 */
function getDeviceMetricsInfo(deviceType) {
  return {
    deviceType,
    power: {
      metrics: getPowerMetrics(deviceType),
      unit: getMetricUnit('power'),
      description: 'Potencia instantánea'
    },
    voltage: {
      metrics: getVoltageMetrics(deviceType),
      unit: getMetricUnit('voltage'),
      description: 'Tensión de línea'
    },
    frequency: {
      metrics: getFrequencyMetrics(deviceType),
      unit: getMetricUnit('frequency'),
      description: 'Frecuencia de la red eléctrica'
    }
  };
}

module.exports = {
  DEVICE_METRICS_CONFIG,
  getDeviceTypeFromTopic,
  getMetricsConfig,
  isTimeSeriesMetric,
  isStateMetric,
  isIgnoredMetric,
  classifyMetric,
  getAllConfigs,
  // Nuevos getters para métricas específicas
  getPowerMetrics,
  getVoltageMetrics,
  getFrequencyMetrics,
  getMetricsByType,
  getMetricUnit,
  getDeviceMetricsInfo
};
