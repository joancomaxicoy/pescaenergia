const DeviceHistoryService = require('../src/services/deviceHistoryService');
const database = require('../src/utils/database');
const logger = require('../src/utils/logger');

async function testDeviceHistoryService() {
  logger.info('=== INICIANDO PRUEBAS DEL SERVICIO DE HISTORIAL ===');

  try {
    // Conectar a la base de datos
    await database.connect();
    logger.info('Conexión a base de datos establecida');

    // Crear instancia del servicio
    const historyService = new DeviceHistoryService();

    // Test 1: Health Check
    logger.info('\n--- Test 1: Health Check ---');
    const isHealthy = await historyService.healthCheck();
    logger.info('Health check resultado:', isHealthy);

    // Test 2: Obtener dispositivos disponibles para pruebas
    logger.info('\n--- Test 2: Obtener dispositivos disponibles ---');
    const devicesResult = await database.query(`
      SELECT d.id, d.device_name, d.device_type, d.shelly_device_id,
             COUNT(em.id) as metrics_count
      FROM devices d
      LEFT JOIN energy_metrics em ON d.id = em.device_id
      GROUP BY d.id, d.device_name, d.device_type, d.shelly_device_id
      ORDER BY metrics_count DESC
      LIMIT 5
    `);

    if (devicesResult.rows.length === 0) {
      logger.warn('No hay dispositivos en la base de datos para probar');
      return;
    }

    logger.info('Dispositivos disponibles:', devicesResult.rows.map(row => ({
      id: row.id,
      name: row.device_name,
      type: row.device_type,
      metricsCount: parseInt(row.metrics_count)
    })));

    // Seleccionar el dispositivo con más métricas para las pruebas
    const testDevice = devicesResult.rows[0];
    const deviceId = testDevice.id;

    logger.info(`\nUsando dispositivo para pruebas: ${testDevice.device_name} (${deviceId})`);

    // Test 3: Obtener información del dispositivo
    logger.info('\n--- Test 3: Información del dispositivo ---');
    const deviceInfo = await historyService.getDeviceInfo(deviceId);
    logger.info('Información del dispositivo:', deviceInfo);

    // Test 4: Obtener métricas disponibles
    logger.info('\n--- Test 4: Métricas disponibles ---');
    const availableMetrics = await historyService.getAvailableMetrics(deviceId);
    logger.info('Métricas disponibles:', availableMetrics);

    if (availableMetrics.length === 0) {
      logger.warn('No hay métricas disponibles para este dispositivo');
      return;
    }

    // Test 5: Obtener métricas más recientes
    logger.info('\n--- Test 5: Métricas más recientes ---');
    const latestMetrics = await historyService.getLatestMetrics(deviceId);
    logger.info('Métricas más recientes:', latestMetrics);

    // Test 6: Obtener métricas más recientes filtradas
    logger.info('\n--- Test 6: Métricas más recientes filtradas ---');
    const firstTwoMetrics = availableMetrics.slice(0, 2);
    const filteredLatestMetrics = await historyService.getLatestMetrics(deviceId, firstTwoMetrics);
    logger.info('Métricas filtradas:', filteredLatestMetrics);

    // Test 7: Obtener rango de fechas disponible
    logger.info('\n--- Test 7: Rango de fechas disponible ---');
    const dateRangeResult = await database.query(`
      SELECT 
        MIN(timestamp) as earliest_date,
        MAX(timestamp) as latest_date,
        COUNT(*) as total_records
      FROM energy_metrics 
      WHERE device_id = $1
    `, [deviceId]);

    const dateRange = dateRangeResult.rows[0];
    logger.info('Rango de fechas:', {
      earliest: dateRange.earliest_date,
      latest: dateRange.latest_date,
      totalRecords: parseInt(dateRange.total_records)
    });

    if (!dateRange.earliest_date || !dateRange.latest_date) {
      logger.warn('No hay datos temporales suficientes para pruebas de evolución');
      return;
    }

    // Test 8: Evolución de métrica (últimas 24 horas)
    logger.info('\n--- Test 8: Evolución de métrica (últimas 24 horas) ---');
    const endDate = new Date(dateRange.latest_date);
    const startDate = new Date(endDate.getTime() - (24 * 60 * 60 * 1000)); // 24 horas atrás
    const testMetric = availableMetrics[0];

    try {
      const evolution = await historyService.getMetricEvolution(
        deviceId,
        testMetric,
        startDate,
        endDate,
        '1h'
      );
      logger.info('Evolución de métrica:', {
        metricName: evolution.metricName,
        totalPoints: evolution.totalPoints,
        period: evolution.period,
        sampleData: evolution.data.slice(0, 3) // Primeros 3 puntos
      });
    } catch (error) {
      logger.warn('Error en evolución de métrica:', error.message);
    }

    // Test 9: Múltiples métricas en rango
    logger.info('\n--- Test 9: Múltiples métricas en rango ---');
    try {
      const multipleMetrics = await historyService.getDeviceMetrics(
        deviceId,
        startDate,
        endDate,
        availableMetrics.slice(0, 3), // Primeras 3 métricas
        '2h',
        100
      );
      logger.info('Múltiples métricas:', {
        totalMetrics: multipleMetrics.totalMetrics,
        totalDataPoints: multipleMetrics.totalDataPoints,
        metricsNames: Object.keys(multipleMetrics.metrics)
      });
    } catch (error) {
      logger.warn('Error en múltiples métricas:', error.message);
    }

    // Test 10: Estadísticas del servicio
    logger.info('\n--- Test 10: Estadísticas del servicio ---');
    const stats = historyService.getStats();
    logger.info('Estadísticas del servicio:', stats);

    // Test 11: Pruebas de validación (errores esperados)
    logger.info('\n--- Test 11: Pruebas de validación ---');
    
    try {
      await historyService.getLatestMetrics('invalid-uuid');
      logger.error('ERROR: Debería haber fallado con UUID inválido');
    } catch (error) {
      logger.info('✓ Validación correcta para UUID inválido:', error.message);
    }

    try {
      await historyService.getMetricEvolution(deviceId, 'invalid_metric', startDate, endDate);
      logger.warn('Métrica inválida no generó error (puede ser normal si no hay datos)');
    } catch (error) {
      logger.info('✓ Validación correcta para métrica inválida:', error.message);
    }

    try {
      await historyService.getMetricEvolution(deviceId, testMetric, endDate, startDate); // Fechas invertidas
      logger.error('ERROR: Debería haber fallado con fechas invertidas');
    } catch (error) {
      logger.info('✓ Validación correcta para fechas invertidas:', error.message);
    }

    // Test 12: Rendimiento con consulta grande
    logger.info('\n--- Test 12: Prueba de rendimiento ---');
    const performanceStart = Date.now();
    try {
      const largeQuery = await historyService.getDeviceMetrics(
        deviceId,
        new Date(dateRange.earliest_date),
        new Date(dateRange.latest_date),
        null, // Todas las métricas
        '1d',
        1000
      );
      const performanceTime = Date.now() - performanceStart;
      logger.info('Consulta grande completada:', {
        totalMetrics: largeQuery.totalMetrics,
        totalDataPoints: largeQuery.totalDataPoints,
        queryTime: performanceTime + 'ms'
      });
    } catch (error) {
      logger.warn('Error en prueba de rendimiento:', error.message);
    }

    logger.info('\n=== PRUEBAS COMPLETADAS EXITOSAMENTE ===');

  } catch (error) {
    logger.error('Error en las pruebas:', error);
  } finally {
    // Cerrar conexión
    await database.close();
    logger.info('Conexión a base de datos cerrada');
  }
}

// Ejecutar las pruebas si el script se ejecuta directamente
if (require.main === module) {
  testDeviceHistoryService()
    .then(() => {
      logger.info('Script de pruebas finalizado');
      process.exit(0);
    })
    .catch((error) => {
      logger.error('Error fatal en las pruebas:', error);
      process.exit(1);
    });
}

module.exports = { testDeviceHistoryService };
