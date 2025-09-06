const logger = require('../../utils/logger');

class BufferService {
  constructor() {
    // Buffer principal: Map<deviceId, Array<metricData>>
    this.buffer = new Map();
    
    // Estadísticas
    this.stats = {
      totalMessages: 0,
      uniqueDevices: 0,
      bufferSize: 0,
      lastMessageTime: null,
      startTime: Date.now()
    };
  }

  /**
   * Añade datos normalizados al buffer
   * @param {Object} normalizedData - Datos del normalizador
   */
  addData(normalizedData) {
    try {
      const { deviceId, deviceType, timestamp, metrics, generatorName } = normalizedData;

      if (!deviceId || !metrics || !Array.isArray(metrics)) {
        logger.warn('Datos normalizados inválidos', { deviceId, metricsCount: metrics?.length });
        return;
      }

      // Crear entrada para el dispositivo si no existe
      if (!this.buffer.has(deviceId)) {
        this.buffer.set(deviceId, []);
      }

      // Añadir cada métrica al buffer del dispositivo
      for (const metric of metrics) {
        const metricData = {
          deviceId,
          deviceType,
          generatorName,
          timestamp: new Date(timestamp),
          metricName: metric.name,
          value: metric.value,
          unit: metric.unit,
          index: metric.index,
          receivedAt: Date.now()
        };

        this.buffer.get(deviceId).push(metricData);
      }

      // Actualizar estadísticas
      this.stats.totalMessages++;
      this.stats.uniqueDevices = this.buffer.size;
      this.stats.bufferSize = this.getTotalBufferSize();
      this.stats.lastMessageTime = Date.now();

      logger.debug('Datos añadidos al buffer', {
        deviceId,
        deviceType,
        metricsCount: metrics.length,
        totalBufferSize: this.stats.bufferSize
      });

    } catch (error) {
      logger.error('Error añadiendo datos al buffer:', error);
    }
  }

  /**
   * Toma un snapshot del buffer actual y lo vacía
   * @returns {Map<string, Array>} - Snapshot del buffer
   */
  takeSnapshot() {
    try {
      const snapshot = new Map(this.buffer);
      const snapshotSize = this.getTotalBufferSize();
      
      // Vaciar el buffer para el siguiente ciclo
      this.buffer.clear();
      
      // Actualizar estadísticas
      this.stats.bufferSize = 0;
      this.stats.uniqueDevices = 0;

      logger.info('Snapshot del buffer tomado', {
        devicesInSnapshot: snapshot.size,
        totalMetricsInSnapshot: snapshotSize,
        bufferCleared: true
      });

      return snapshot;

    } catch (error) {
      logger.error('Error tomando snapshot del buffer:', error);
      return new Map();
    }
  }

  /**
   * Calcula el tamaño total del buffer (número de métricas)
   * @returns {number}
   */
  getTotalBufferSize() {
    let total = 0;
    for (const metrics of this.buffer.values()) {
      total += metrics.length;
    }
    return total;
  }

  /**
   * Obtiene las estadísticas del buffer
   * @returns {Object}
   */
  getStats() {
    return {
      ...this.stats,
      uptime: Math.floor((Date.now() - this.stats.startTime) / 1000),
      currentBufferSize: this.getTotalBufferSize(),
      currentUniqueDevices: this.buffer.size
    };
  }

  /**
   * Obtiene información detallada del buffer actual
   * @returns {Object}
   */
  getBufferInfo() {
    const deviceInfo = {};
    
    for (const [deviceId, metrics] of this.buffer.entries()) {
      const metricCounts = {};
      for (const metric of metrics) {
        metricCounts[metric.metricName] = (metricCounts[metric.metricName] || 0) + 1;
      }
      
      deviceInfo[deviceId] = {
        totalMetrics: metrics.length,
        metricTypes: Object.keys(metricCounts).length,
        metricCounts,
        deviceType: metrics[0]?.deviceType || 'unknown',
        lastUpdate: Math.max(...metrics.map(m => m.receivedAt))
      };
    }

    return {
      totalDevices: this.buffer.size,
      totalMetrics: this.getTotalBufferSize(),
      devices: deviceInfo
    };
  }

  /**
   * Limpia el buffer (útil para testing o reset manual)
   */
  clear() {
    const previousSize = this.getTotalBufferSize();
    this.buffer.clear();
    this.stats.bufferSize = 0;
    this.stats.uniqueDevices = 0;
    
    logger.info('Buffer limpiado manualmente', { 
      previousSize,
      currentSize: 0 
    });
  }

  /**
   * Resetea las estadísticas
   */
  resetStats() {
    this.stats = {
      totalMessages: 0,
      uniqueDevices: this.buffer.size,
      bufferSize: this.getTotalBufferSize(),
      lastMessageTime: null,
      startTime: Date.now()
    };
    
    logger.info('Estadísticas del buffer reseteadas');
  }
}

module.exports = BufferService;
