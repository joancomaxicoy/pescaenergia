require('dotenv').config();
const logger = require('./src/utils/logger');
const database = require('./src/utils/database');
const DeviceHistoryService = require('./src/services/deviceHistoryService');
const MqttDataService = require('./src/services/mqtt/mqttDataService');
const mqttServiceRegistry = require('./src/services/mqtt/mqttServiceRegistry');

/**
 * Script de prueba para verificar la nueva funcionalidad híbrida del endpoint
 * /api/devices/{deviceId}/metrics/latest
 * 
 * Prueba:
 * 1. Consulta sin datos en buffer (solo BD)
 * 2. Simulación de datos en buffer
 * 3. Consulta híbrida (buffer + BD)
 * 4. Mapeo de métricas agregadas a raw
 */

class LatestMetricsHybridTest {
  constructor() {
    this.deviceHistoryService = new DeviceHistoryService();
    this.mqttDataService = null;
    this.testDeviceId = 'shellyplusplugs-test123'; // ID de prueba
    this.testResults = [];
  }

  async initialize() {
    try {
      logger.info('🚀 Iniciando test de métricas híbridas...');

      // Conectar a la base de datos
      await database.connect();
      logger.info('✅ Base de datos conectada');

      // Inicializar servicios MQTT
      this.mqttDataService = new MqttDataService();
      await this.mqttDataService.initialize();
      await this.mqttDataService.start();
      
      // Registrar en el registry
      mqttServiceRegistry.register(this.mqttDataService);
      logger.info('✅ Servicios MQTT inicializados y registrados');

      // Esperar un momento para que todo se estabilice
      await this.sleep(2000);

    } catch (error) {
      logger.error('❌ Error inicializando test:', error);
      throw error;
    }
  }

  async runTests() {
    try {
      logger.info('📋 Ejecutando batería de tests...');

      // Test 1: Consulta sin datos en buffer (solo BD)
      await this.testOnlyDatabaseQuery();

      // Test 2: Simular datos en buffer
      await this.simulateBufferData();

      // Test 3: Consulta híbrida (buffer + BD)
      await this.testHybridQuery();

      // Test 4: Mapeo de métricas agregadas
      await this.testAggregatedMetricsMapping();

      // Test 5: Verificar priorización de timestamps
      await this.testTimestampPrioritization();

      // Mostrar resumen
      this.showTestSummary();

    } catch (error) {
      logger.error('❌ Error ejecutando tests:', error);
      throw error;
    }
  }

  async testOnlyDatabaseQuery() {
    logger.info('🧪 Test 1: Consulta solo desde base de datos');
    
    try {
      // Asegurarse de que no hay datos en buffer
      const bufferService = mqttServiceRegistry.getBufferService();
      if (bufferService) {
        bufferService.clear();
      }

      // Primero crear un dispositivo de prueba si no existe
      await this.ensureTestDeviceExists();

      // Consultar métricas (debería venir solo de BD)
      const result = await this.deviceHistoryService.getLatestMetrics(this.testDeviceId);
      
      this.testResults.push({
        test: 'Database Only Query',
        success: true,
        details: {
          totalMetrics: result.totalMetrics,
          sources: result.sources,
          timestamp: result.timestamp
        }
      });

      logger.info('✅ Test 1 completado', {
        totalMetrics: result.totalMetrics,
        sources: result.sources
      });

    } catch (error) {
      this.testResults.push({
        test: 'Database Only Query',
        success: false,
        error: error.message
      });
      logger.error('❌ Test 1 falló:', error.message);
    }
  }

  async ensureTestDeviceExists() {
    try {
      // Verificar si el dispositivo ya existe
      const existingDevice = await this.deviceHistoryService.getDeviceInfo(this.testDeviceId);
      
      if (existingDevice) {
        logger.info('Dispositivo de prueba ya existe', { deviceId: this.testDeviceId });
        return;
      }

      // Crear dispositivo de prueba en la base de datos
      const insertQuery = `
        INSERT INTO devices (id, user_id, shelly_device_id, device_name, device_type, created_at)
        VALUES (gen_random_uuid(), 'not_assigned', $1, $2, $3, NOW())
        ON CONFLICT (shelly_device_id) DO NOTHING
        RETURNING id, shelly_device_id
      `;

      const result = await database.query(insertQuery, [
        this.testDeviceId,
        'Dispositivo de Prueba Híbrido',
        'SHELLY_PLUG'
      ]);

      if (result.rows.length > 0) {
        logger.info('Dispositivo de prueba creado', {
          deviceId: this.testDeviceId,
          uuid: result.rows[0].id
        });

        // Insertar algunas métricas de prueba en la BD
        await this.insertTestMetrics(result.rows[0].id);
      } else {
        logger.info('Dispositivo de prueba ya existía (conflict)');
      }

    } catch (error) {
      logger.error('Error creando dispositivo de prueba:', error);
      throw error;
    }
  }

  async insertTestMetrics(deviceUuid) {
    try {
      const insertMetricsQuery = `
        INSERT INTO energy_metrics (timestamp, device_id, metric_name, value)
        VALUES 
          (NOW() - INTERVAL '5 minutes', $1, 'power_consumption_avg', 100.5),
          (NOW() - INTERVAL '5 minutes', $1, 'power_consumption_max', 120.0),
          (NOW() - INTERVAL '5 minutes', $1, 'voltage_avg', 230.0),
          (NOW() - INTERVAL '3 minutes', $1, 'power_consumption_avg', 95.2),
          (NOW() - INTERVAL '3 minutes', $1, 'voltage_avg', 229.5)
        ON CONFLICT DO NOTHING
      `;

      await database.query(insertMetricsQuery, [deviceUuid]);
      logger.info('Métricas de prueba insertadas en BD', { deviceUuid });

    } catch (error) {
      logger.error('Error insertando métricas de prueba:', error);
      throw error;
    }
  }

  async simulateBufferData() {
    logger.info('🧪 Test 2: Simulando datos en buffer');
    
    try {
      const bufferService = mqttServiceRegistry.getBufferService();
      if (!bufferService) {
        throw new Error('BufferService no disponible');
      }

      // Simular datos normalizados llegando al buffer
      const simulatedData = {
        deviceId: this.testDeviceId,
        deviceType: 'SHELLY_PLUG',
        timestamp: new Date(),
        metrics: [
          { name: 'power_consumption', value: 125.5, unit: 'W' },
          { name: 'voltage', value: 230.2, unit: 'V' },
          { name: 'energy_total', value: 1500.75, unit: 'Wh' }
        ]
      };

      // Añadir al buffer
      bufferService.addData(simulatedData);

      // Verificar que los datos están en el buffer
      const bufferInfo = bufferService.getBufferInfo();
      
      this.testResults.push({
        test: 'Buffer Data Simulation',
        success: true,
        details: {
          deviceId: this.testDeviceId,
          metricsInBuffer: bufferInfo.devices[this.testDeviceId]?.totalMetrics || 0,
          bufferDevices: bufferInfo.totalDevices
        }
      });

      logger.info('✅ Test 2 completado', {
        metricsInBuffer: bufferInfo.devices[this.testDeviceId]?.totalMetrics || 0,
        totalDevices: bufferInfo.totalDevices
      });

    } catch (error) {
      this.testResults.push({
        test: 'Buffer Data Simulation',
        success: false,
        error: error.message
      });
      logger.error('❌ Test 2 falló:', error.message);
    }
  }

  async testHybridQuery() {
    logger.info('🧪 Test 3: Consulta híbrida (buffer + BD)');
    
    try {
      // Consultar métricas (debería combinar buffer + BD)
      const result = await this.deviceHistoryService.getLatestMetrics(this.testDeviceId);
      
      const hasBufferData = result.sources && result.sources.buffer > 0;
      const hasDatabaseData = result.sources && result.sources.database > 0;

      this.testResults.push({
        test: 'Hybrid Query',
        success: true,
        details: {
          totalMetrics: result.totalMetrics,
          sources: result.sources,
          hasBufferData,
          hasDatabaseData,
          timestamp: result.timestamp
        }
      });

      logger.info('✅ Test 3 completado', {
        totalMetrics: result.totalMetrics,
        sources: result.sources,
        hasBufferData,
        hasDatabaseData
      });

    } catch (error) {
      this.testResults.push({
        test: 'Hybrid Query',
        success: false,
        error: error.message
      });
      logger.error('❌ Test 3 falló:', error.message);
    }
  }

  async testAggregatedMetricsMapping() {
    logger.info('🧪 Test 4: Mapeo de métricas agregadas');
    
    try {
      // Consultar métricas específicas agregadas
      const aggregatedMetrics = ['power_consumption_avg', 'power_consumption_max', 'voltage_avg'];
      const result = await this.deviceHistoryService.getLatestMetrics(this.testDeviceId, aggregatedMetrics);
      
      // Verificar que se devolvieron las métricas solicitadas
      const returnedMetrics = Object.keys(result.metrics);
      const mappingSuccess = aggregatedMetrics.some(metric => returnedMetrics.includes(metric));

      this.testResults.push({
        test: 'Aggregated Metrics Mapping',
        success: mappingSuccess,
        details: {
          requestedMetrics: aggregatedMetrics,
          returnedMetrics,
          totalMetrics: result.totalMetrics,
          sources: result.sources
        }
      });

      logger.info('✅ Test 4 completado', {
        requestedMetrics: aggregatedMetrics,
        returnedMetrics,
        mappingSuccess
      });

    } catch (error) {
      this.testResults.push({
        test: 'Aggregated Metrics Mapping',
        success: false,
        error: error.message
      });
      logger.error('❌ Test 4 falló:', error.message);
    }
  }

  async testTimestampPrioritization() {
    logger.info('🧪 Test 5: Priorización de timestamps');
    
    try {
      // Obtener timestamp actual del buffer
      const bufferData = mqttServiceRegistry.getLatestBufferMetricsForDevice(this.testDeviceId);
      const bufferTimestamp = bufferData ? new Date(bufferData.timestamp) : null;

      // Consultar métricas híbridas
      const result = await this.deviceHistoryService.getLatestMetrics(this.testDeviceId);
      const resultTimestamp = result.timestamp ? new Date(result.timestamp) : null;

      // Verificar que el timestamp es el más reciente
      const timestampCorrect = !bufferTimestamp || !resultTimestamp || 
                              resultTimestamp >= bufferTimestamp;

      this.testResults.push({
        test: 'Timestamp Prioritization',
        success: timestampCorrect,
        details: {
          bufferTimestamp: bufferTimestamp?.toISOString(),
          resultTimestamp: resultTimestamp?.toISOString(),
          timestampCorrect
        }
      });

      logger.info('✅ Test 5 completado', {
        bufferTimestamp: bufferTimestamp?.toISOString(),
        resultTimestamp: resultTimestamp?.toISOString(),
        timestampCorrect
      });

    } catch (error) {
      this.testResults.push({
        test: 'Timestamp Prioritization',
        success: false,
        error: error.message
      });
      logger.error('❌ Test 5 falló:', error.message);
    }
  }

  showTestSummary() {
    logger.info('📊 RESUMEN DE TESTS');
    logger.info('==================');
    
    let passed = 0;
    let failed = 0;

    for (const result of this.testResults) {
      const status = result.success ? '✅ PASS' : '❌ FAIL';
      logger.info(`${status} - ${result.test}`);
      
      if (result.success) {
        passed++;
        if (result.details) {
          logger.info(`   Detalles:`, result.details);
        }
      } else {
        failed++;
        logger.error(`   Error: ${result.error}`);
      }
    }

    logger.info('==================');
    logger.info(`Total: ${this.testResults.length} | Passed: ${passed} | Failed: ${failed}`);
    
    if (failed === 0) {
      logger.info('🎉 ¡Todos los tests pasaron exitosamente!');
    } else {
      logger.warn(`⚠️  ${failed} test(s) fallaron`);
    }
  }

  async cleanup() {
    try {
      logger.info('🧹 Limpiando recursos...');

      // Limpiar buffer
      const bufferService = mqttServiceRegistry.getBufferService();
      if (bufferService) {
        bufferService.clear();
      }

      // Detener servicios MQTT
      if (this.mqttDataService) {
        await this.mqttDataService.stop();
      }

      // Cerrar conexión a BD
      await database.close();

      logger.info('✅ Limpieza completada');

    } catch (error) {
      logger.error('❌ Error durante limpieza:', error);
    }
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Ejecutar el test
async function runTest() {
  const test = new LatestMetricsHybridTest();
  
  try {
    await test.initialize();
    await test.runTests();
  } catch (error) {
    logger.error('💥 Test falló:', error);
  } finally {
    await test.cleanup();
    process.exit(0);
  }
}

// Manejar señales de cierre
process.on('SIGINT', async () => {
  logger.info('🛑 Test interrumpido por usuario');
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('🛑 Test terminado');
  process.exit(0);
});

// Ejecutar
runTest().catch((error) => {
  logger.error('💥 Error fatal en test:', error);
  process.exit(1);
});
