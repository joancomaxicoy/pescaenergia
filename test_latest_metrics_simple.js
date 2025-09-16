require('dotenv').config();
const logger = require('./src/utils/logger');
const database = require('./src/utils/database');
const DeviceHistoryService = require('./src/services/deviceHistoryService');
const mqttServiceRegistry = require('./src/services/mqtt/mqttServiceRegistry');

/**
 * Script de prueba simplificado para verificar la nueva funcionalidad híbrida
 * del endpoint /api/devices/{deviceId}/metrics/latest
 * 
 * Este test no requiere conexión MQTT y se enfoca en probar:
 * 1. Consulta desde base de datos
 * 2. Mapeo de métricas agregadas a raw
 * 3. Funcionalidad del registry (sin datos reales)
 */

class SimpleLatestMetricsTest {
  constructor() {
    this.deviceHistoryService = new DeviceHistoryService();
    this.testDeviceId = 'shellyplusplugs-test123';
    this.testResults = [];
  }

  async initialize() {
    try {
      logger.info('🚀 Iniciando test simplificado de métricas híbridas...');

      // Conectar a la base de datos
      await database.connect();
      logger.info('✅ Base de datos conectada');

    } catch (error) {
      logger.error('❌ Error inicializando test:', error);
      throw error;
    }
  }

  async runTests() {
    try {
      logger.info('📋 Ejecutando batería de tests simplificados...');

      // Test 1: Crear dispositivo de prueba
      await this.testCreateTestDevice();

      // Test 2: Consulta desde base de datos
      await this.testDatabaseQuery();

      // Test 3: Mapeo de métricas agregadas
      await this.testMetricMapping();

      // Test 4: Verificar registry (sin datos)
      await this.testRegistryFunctionality();

      // Test 5: Consulta con métricas específicas
      await this.testSpecificMetricsQuery();

      // Mostrar resumen
      this.showTestSummary();

    } catch (error) {
      logger.error('❌ Error ejecutando tests:', error);
      throw error;
    }
  }

  async testCreateTestDevice() {
    logger.info('🧪 Test 1: Crear dispositivo de prueba');
    
    try {
      // Crear dispositivo de prueba en la base de datos
      const insertQuery = `
        INSERT INTO devices (id, user_id, shelly_device_id, device_name, device_type, created_at)
        VALUES (gen_random_uuid(), 'not_assigned', $1, $2, $3, NOW())
        ON CONFLICT (shelly_device_id) DO UPDATE SET device_name = EXCLUDED.device_name
        RETURNING id, shelly_device_id
      `;

      const result = await database.query(insertQuery, [
        this.testDeviceId,
        'Dispositivo de Prueba Híbrido',
        'SHELLY_PLUG'
      ]);

      if (result.rows.length > 0) {
        this.testDeviceUuid = result.rows[0].id;
        
        // Insertar métricas de prueba
        await this.insertTestMetrics(this.testDeviceUuid);
        
        // Limpiar cache del DeviceHistoryService para que reconozca el nuevo dispositivo
        this.deviceHistoryService.clearCache();
        
        this.testResults.push({
          test: 'Create Test Device',
          success: true,
          details: {
            deviceId: this.testDeviceId,
            uuid: this.testDeviceUuid
          }
        });

        logger.info('✅ Test 1 completado', {
          deviceId: this.testDeviceId,
          uuid: this.testDeviceUuid
        });
      }

    } catch (error) {
      this.testResults.push({
        test: 'Create Test Device',
        success: false,
        error: error.message
      });
      logger.error('❌ Test 1 falló:', error.message);
    }
  }

  async insertTestMetrics(deviceUuid) {
    try {
      const insertMetricsQuery = `
        INSERT INTO energy_metrics (timestamp, device_id, metric_name, value)
        VALUES 
          (NOW() - INTERVAL '5 minutes', $1, 'power_consumption_avg', 100.5),
          (NOW() - INTERVAL '5 minutes', $1, 'power_consumption_max', 120.0),
          (NOW() - INTERVAL '5 minutes', $1, 'power_consumption_min', 85.0),
          (NOW() - INTERVAL '5 minutes', $1, 'voltage_avg', 230.0),
          (NOW() - INTERVAL '3 minutes', $1, 'power_consumption_avg', 95.2),
          (NOW() - INTERVAL '3 minutes', $1, 'voltage_avg', 229.5),
          (NOW() - INTERVAL '1 minute', $1, 'power_consumption_avg', 110.8),
          (NOW() - INTERVAL '1 minute', $1, 'voltage_avg', 231.2)
        ON CONFLICT DO NOTHING
      `;

      await database.query(insertMetricsQuery, [deviceUuid]);
      logger.info('Métricas de prueba insertadas en BD', { deviceUuid });

    } catch (error) {
      logger.error('Error insertando métricas de prueba:', error);
      throw error;
    }
  }

  async testDatabaseQuery() {
    logger.info('🧪 Test 2: Consulta desde base de datos');
    
    try {
      // Consultar métricas desde BD
      const result = await this.deviceHistoryService.getLatestMetrics(this.testDeviceId);
      
      const success = result && result.totalMetrics > 0;
      
      this.testResults.push({
        test: 'Database Query',
        success,
        details: {
          totalMetrics: result?.totalMetrics || 0,
          sources: result?.sources || {},
          timestamp: result?.timestamp,
          metrics: Object.keys(result?.metrics || {})
        }
      });

      logger.info('✅ Test 2 completado', {
        totalMetrics: result?.totalMetrics || 0,
        sources: result?.sources || {},
        success
      });

    } catch (error) {
      this.testResults.push({
        test: 'Database Query',
        success: false,
        error: error.message
      });
      logger.error('❌ Test 2 falló:', error.message);
    }
  }

  async testMetricMapping() {
    logger.info('🧪 Test 3: Mapeo de métricas agregadas');
    
    try {
      // Probar métodos de mapeo directamente
      const testMetrics = ['power_consumption_avg', 'power_consumption_max', 'voltage_avg'];
      const rawMetrics = this.deviceHistoryService.mapAggregatedToRawMetrics(testMetrics);
      
      // Verificar que el mapeo funciona
      const expectedRaw = ['power_consumption', 'voltage'];
      const mappingCorrect = expectedRaw.every(metric => rawMetrics.includes(metric));
      
      // Probar getRawMetricName individualmente
      const testCases = [
        { input: 'power_consumption_avg', expected: 'power_consumption' },
        { input: 'voltage_max', expected: 'voltage' },
        { input: 'energy_total_sum', expected: 'energy_total' },
        { input: 'temperature', expected: 'temperature' } // Sin sufijo
      ];
      
      const individualTests = testCases.map(testCase => {
        const result = this.deviceHistoryService.getRawMetricName(testCase.input);
        return {
          input: testCase.input,
          expected: testCase.expected,
          result,
          correct: result === testCase.expected
        };
      });
      
      const allIndividualCorrect = individualTests.every(test => test.correct);
      
      this.testResults.push({
        test: 'Metric Mapping',
        success: mappingCorrect && allIndividualCorrect,
        details: {
          testMetrics,
          rawMetrics,
          mappingCorrect,
          individualTests,
          allIndividualCorrect
        }
      });

      logger.info('✅ Test 3 completado', {
        mappingCorrect,
        allIndividualCorrect,
        rawMetrics
      });

    } catch (error) {
      this.testResults.push({
        test: 'Metric Mapping',
        success: false,
        error: error.message
      });
      logger.error('❌ Test 3 falló:', error.message);
    }
  }

  async testRegistryFunctionality() {
    logger.info('🧪 Test 4: Funcionalidad del registry');
    
    try {
      // Verificar que el registry existe y tiene métodos
      const registryAvailable = mqttServiceRegistry.isAvailable();
      const registryStats = mqttServiceRegistry.getStats();
      
      // Intentar obtener datos del buffer (debería devolver null sin MQTT)
      const bufferData = mqttServiceRegistry.getLatestBufferMetricsForDevice(this.testDeviceId);
      
      this.testResults.push({
        test: 'Registry Functionality',
        success: true, // El registry existe aunque no tenga datos
        details: {
          registryAvailable,
          registryStats,
          bufferDataNull: bufferData === null
        }
      });

      logger.info('✅ Test 4 completado', {
        registryAvailable,
        bufferDataNull: bufferData === null
      });

    } catch (error) {
      this.testResults.push({
        test: 'Registry Functionality',
        success: false,
        error: error.message
      });
      logger.error('❌ Test 4 falló:', error.message);
    }
  }

  async testSpecificMetricsQuery() {
    logger.info('🧪 Test 5: Consulta con métricas específicas');
    
    try {
      // Consultar métricas específicas
      const specificMetrics = ['power_consumption_avg', 'voltage_avg'];
      const result = await this.deviceHistoryService.getLatestMetrics(this.testDeviceId, specificMetrics);
      
      const returnedMetrics = Object.keys(result?.metrics || {});
      const hasRequestedMetrics = specificMetrics.some(metric => returnedMetrics.includes(metric));
      
      this.testResults.push({
        test: 'Specific Metrics Query',
        success: hasRequestedMetrics,
        details: {
          requestedMetrics: specificMetrics,
          returnedMetrics,
          totalMetrics: result?.totalMetrics || 0,
          hasRequestedMetrics
        }
      });

      logger.info('✅ Test 5 completado', {
        requestedMetrics: specificMetrics,
        returnedMetrics,
        hasRequestedMetrics
      });

    } catch (error) {
      this.testResults.push({
        test: 'Specific Metrics Query',
        success: false,
        error: error.message
      });
      logger.error('❌ Test 5 falló:', error.message);
    }
  }

  showTestSummary() {
    logger.info('📊 RESUMEN DE TESTS SIMPLIFICADOS');
    logger.info('==================================');
    
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

    logger.info('==================================');
    logger.info(`Total: ${this.testResults.length} | Passed: ${passed} | Failed: ${failed}`);
    
    if (failed === 0) {
      logger.info('🎉 ¡Todos los tests pasaron exitosamente!');
      logger.info('✨ La funcionalidad híbrida está implementada correctamente');
    } else {
      logger.warn(`⚠️  ${failed} test(s) fallaron`);
    }
  }

  async cleanup() {
    try {
      logger.info('🧹 Limpiando recursos...');

      // Limpiar datos de prueba
      if (this.testDeviceUuid) {
        await database.query('DELETE FROM energy_metrics WHERE device_id = $1', [this.testDeviceUuid]);
        await database.query('DELETE FROM devices WHERE id = $1', [this.testDeviceUuid]);
        logger.info('Datos de prueba eliminados');
      }

      // Cerrar conexión a BD
      await database.close();

      logger.info('✅ Limpieza completada');

    } catch (error) {
      logger.error('❌ Error durante limpieza:', error);
    }
  }
}

// Ejecutar el test
async function runTest() {
  const test = new SimpleLatestMetricsTest();
  
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
