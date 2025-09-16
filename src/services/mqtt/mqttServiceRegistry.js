const logger = require('../../utils/logger');

/**
 * Registry singleton para acceder a los servicios MQTT desde cualquier parte de la aplicación
 * Permite que otros servicios (como DeviceHistoryService) accedan al buffer y compactador
 */
class MqttServiceRegistry {
  constructor() {
    this.mqttDataService = null;
    this.isRegistered = false;
  }

  /**
   * Registra la instancia del MqttDataService
   * @param {MqttDataService} mqttDataService - Instancia del servicio principal
   */
  register(mqttDataService) {
    if (this.isRegistered) {
      logger.warn('MqttDataService ya está registrado, sobrescribiendo...');
    }

    this.mqttDataService = mqttDataService;
    this.isRegistered = true;
    
    logger.info('MqttDataService registrado en el registry');
  }

  /**
   * Obtiene la instancia del MqttDataService
   * @returns {MqttDataService|null}
   */
  getMqttDataService() {
    if (!this.isRegistered || !this.mqttDataService) {
      logger.debug('MqttDataService no está registrado o no está disponible');
      return null;
    }
    
    return this.mqttDataService;
  }

  /**
   * Obtiene el BufferService
   * @returns {BufferService|null}
   */
  getBufferService() {
    const mqttService = this.getMqttDataService();
    return mqttService ? mqttService.bufferService : null;
  }

  /**
   * Obtiene el CompactorService
   * @returns {CompactorService|null}
   */
  getCompactorService() {
    const mqttService = this.getMqttDataService();
    return mqttService ? mqttService.compactorService : null;
  }

  /**
   * Obtiene datos del buffer para un dispositivo específico
   * @param {string} deviceId - ID del dispositivo
   * @returns {Array|null} - Array de métricas del dispositivo o null si no hay datos
   */
  getBufferDataForDevice(deviceId) {
    const bufferService = this.getBufferService();
    if (!bufferService) {
      return null;
    }

    // Acceder al buffer interno del BufferService
    const buffer = bufferService.buffer;
    if (!buffer || !buffer.has(deviceId)) {
      return null;
    }

    return buffer.get(deviceId);
  }

  /**
   * Obtiene las métricas más recientes de un dispositivo desde el buffer
   * @param {string} deviceId - ID del dispositivo
   * @param {Array<string>} metricNames - Nombres específicos de métricas (opcional)
   * @returns {Object|null} - Objeto con métricas más recientes o null si no hay datos
   */
  getLatestBufferMetricsForDevice(deviceId, metricNames = null) {
    const deviceMetrics = this.getBufferDataForDevice(deviceId);
    if (!deviceMetrics || deviceMetrics.length === 0) {
      return null;
    }

    // Agrupar métricas por nombre y obtener la más reciente de cada tipo
    const latestMetrics = {};
    let latestTimestamp = null;

    for (const metric of deviceMetrics) {
      const { metricName, value, timestamp, receivedAt } = metric;
      
      // Filtrar por métricas específicas si se proporcionan
      if (metricNames && !metricNames.includes(metricName)) {
        continue;
      }

      // Si no tenemos esta métrica o esta es más reciente, actualizarla
      if (!latestMetrics[metricName] || receivedAt > latestMetrics[metricName].receivedAt) {
        latestMetrics[metricName] = {
          value,
          timestamp,
          receivedAt
        };

        // Actualizar el timestamp más reciente
        if (!latestTimestamp || receivedAt > latestTimestamp) {
          latestTimestamp = receivedAt;
        }
      }
    }

    if (Object.keys(latestMetrics).length === 0) {
      return null;
    }

    // Convertir a formato simple (solo valores)
    const metrics = {};
    for (const [metricName, metricData] of Object.entries(latestMetrics)) {
      metrics[metricName] = metricData.value;
    }

    return {
      deviceId,
      timestamp: new Date(latestTimestamp),
      metrics,
      totalMetrics: Object.keys(metrics).length,
      source: 'buffer'
    };
  }

  /**
   * Verifica si el registry está disponible y funcional
   * @returns {boolean}
   */
  isAvailable() {
    return this.isRegistered && this.mqttDataService !== null;
  }

  /**
   * Obtiene estadísticas del registry
   * @returns {Object}
   */
  getStats() {
    return {
      isRegistered: this.isRegistered,
      isAvailable: this.isAvailable(),
      mqttDataServicePresent: this.mqttDataService !== null
    };
  }

  /**
   * Limpia el registry (útil para testing)
   */
  clear() {
    this.mqttDataService = null;
    this.isRegistered = false;
    logger.info('MqttServiceRegistry limpiado');
  }
}

// Exportar instancia singleton
const mqttServiceRegistry = new MqttServiceRegistry();
module.exports = mqttServiceRegistry;
