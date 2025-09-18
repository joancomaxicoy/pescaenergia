const database = require('./src/utils/database');
const PlugsService = require('./src/services/plugsService');
const logger = require('./src/utils/logger');

/**
 * Test de integración completa del nuevo sistema de automatización
 */
async function testIntegrationNewAutomation() {
  console.log('🚀 Iniciando test de integración del nuevo sistema de automatización...\n');

  let plugsService = null;

  try {
    // 1. Conectar a la base de datos
    console.log('📦 Conectando a la base de datos...');
    await database.connect();
    console.log('✅ Base de datos conectada');

    // 2. Inicializar PlugsService
    console.log('\n🔧 Inicializando PlugsService...');
    plugsService = new PlugsService();
    
    // Esperar un poco para que se inicialice MQTT
    await new Promise(resolve => setTimeout(resolve, 3000));
    console.log('✅ PlugsService inicializado');

    // 3. Inicializar AutomationManager
    console.log('\n⚙️ Inicializando AutomationManager...');
    await plugsService.initializeAutomationManager();
    console.log('✅ AutomationManager inicializado');

    // 4. Iniciar AutomationManager
    console.log('\n▶️ Iniciando AutomationManager...');
    await plugsService.startAutomationManager();
    console.log('✅ AutomationManager iniciado');

    // 5. Verificar estado inicial
    console.log('\n📊 Verificando estado inicial...');
    const initialStats = plugsService.getAutomationStats();
    console.log('Estado inicial:', {
      available: initialStats.available,
      isRunning: initialStats.isRunning,
      executionInterval: initialStats.executionInterval,
      cacheConfigs: initialStats.cacheStats?.currentSize?.configs || 0,
      cacheStates: initialStats.cacheStats?.currentSize?.states || 0,
      cachePowerMetrics: initialStats.cacheStats?.currentSize?.powerMetrics || 0,
      cacheGenerators: initialStats.cacheStats?.currentSize?.generators || 0
    });

    // 6. Obtener información de debug
    console.log('\n🔍 Información de debug:');
    const debugInfo = plugsService.getAutomationDebugInfo();
    console.log('Debug info:', {
      available: debugInfo.available,
      activeConfigs: debugInfo.activeConfigs,
      cacheSize: debugInfo.cache?.currentSize,
      powerEvaluator: {
        available: debugInfo.powerEvaluator?.available,
        reason: debugInfo.powerEvaluator?.reason
      }
    });

    // 7. Ejecutar por 15 segundos para ver estadísticas
    console.log('\n⏱️ Ejecutando por 15 segundos para recopilar estadísticas...');
    await new Promise(resolve => setTimeout(resolve, 15000));

    // 8. Verificar estadísticas después de ejecución
    console.log('\n📈 Estadísticas después de 15 segundos:');
    const finalStats = plugsService.getAutomationStats();
    console.log('Estadísticas finales:', {
      cyclesExecuted: finalStats.cyclesExecuted,
      scheduleEvaluations: finalStats.scheduleEvaluations,
      powerEvaluations: finalStats.powerEvaluations,
      actionsExecuted: finalStats.actionsExecuted,
      errors: finalStats.errors,
      lastCycleDuration: finalStats.lastCycleDuration + 'ms',
      uptime: Math.round(finalStats.uptime / 1000) + 's'
    });

    // 9. Verificar estado MQTT
    console.log('\n📡 Estado MQTT:');
    const mqttStatus = plugsService.getMqttStatus();
    console.log('MQTT Status:', {
      available: mqttStatus.available,
      connected: mqttStatus.connected
    });

    // 10. Health check
    console.log('\n🏥 Health check:');
    const healthCheck = await plugsService.healthCheck();
    console.log('Health:', {
      status: healthCheck.status,
      database: healthCheck.database,
      totalPlugs: healthCheck.totalPlugs,
      mqttConnected: healthCheck.mqtt?.connected
    });

    // 11. Test de configuración (si hay plugs disponibles)
    console.log('\n🔧 Probando configuración de automatización...');
    try {
      // Buscar un plug de prueba
      const testQuery = `
        SELECT d.id, d.device_name, d.shelly_device_id, u.id as user_id
        FROM devices d
        JOIN users u ON d.user_id = u.id::text
        WHERE d.device_type = 'PLUG'
        LIMIT 1
      `;
      
      const testResult = await database.query(testQuery);
      
      if (testResult.rows.length > 0) {
        const testPlug = testResult.rows[0];
        
        console.log(`Usando plug de prueba: ${testPlug.device_name} (${testPlug.id})`);
        
        // Obtener configuración actual
        const currentConfig = await plugsService.getPlugAutomation(testPlug.id, testPlug.user_id);
        console.log('Configuración actual:', currentConfig.automation);
        
        // Crear configuración de prueba
        const testConfig = {
          type: 'schedule',
          power: 5,
          schedule: [
            {
              id: 1,
              enabled: true,
              days: [1, 2, 3, 4, 5], // Lunes a Viernes
              startTime: '08:00',
              endTime: '18:00'
            }
          ]
        };
        
        // Guardar configuración de prueba
        const saveResult = await plugsService.savePlugAutomation(testPlug.id, testPlug.user_id, testConfig);
        console.log('✅ Configuración de prueba guardada:', {
          success: saveResult.success,
          operation: saveResult.operation,
          configId: saveResult.configId
        });
        
        // Esperar un poco para que se procese
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        // Verificar estadísticas actualizadas
        const updatedStats = plugsService.getAutomationStats();
        console.log('Estadísticas después de configuración:', {
          configsInCache: updatedStats.cacheStats?.currentSize?.configs || 0,
          scheduleEvaluations: updatedStats.scheduleEvaluations,
          powerEvaluations: updatedStats.powerEvaluations
        });
        
      } else {
        console.log('⚠️ No se encontraron plugs para probar configuración');
      }
      
    } catch (configError) {
      console.log('⚠️ Error probando configuración:', configError.message);
    }

    console.log('\n✅ Test de integración completado exitosamente');

  } catch (error) {
    console.error('❌ Error en test de integración:', error);
    process.exit(1);
  } finally {
    // Cleanup
    if (plugsService) {
      try {
        console.log('\n🧹 Limpiando recursos...');
        await plugsService.closeAutomationManager();
        console.log('✅ AutomationManager cerrado');
      } catch (cleanupError) {
        console.error('⚠️ Error en cleanup:', cleanupError.message);
      }
    }
    
    try {
      await database.close();
      console.log('✅ Base de datos desconectada');
    } catch (dbError) {
      console.error('⚠️ Error cerrando base de datos:', dbError.message);
    }
  }
}

/**
 * Test específico de rendimiento
 */
async function testPerformance() {
  console.log('\n🏃 Test de rendimiento del nuevo sistema...');

  let plugsService = null;

  try {
    await database.connect();
    
    plugsService = new PlugsService();
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    await plugsService.initializeAutomationManager();
    await plugsService.startAutomationManager();

    // Medir rendimiento durante 30 segundos
    const startTime = Date.now();
    const initialStats = plugsService.getAutomationStats();
    
    console.log('Midiendo rendimiento durante 30 segundos...');
    await new Promise(resolve => setTimeout(resolve, 30000));
    
    const endTime = Date.now();
    const finalStats = plugsService.getAutomationStats();
    
    const duration = endTime - startTime;
    const cyclesExecuted = finalStats.cyclesExecuted - (initialStats.cyclesExecuted || 0);
    const avgCycleDuration = finalStats.lastCycleDuration;
    
    console.log('📊 Resultados de rendimiento:');
    console.log(`  Duración total: ${duration}ms`);
    console.log(`  Ciclos ejecutados: ${cyclesExecuted}`);
    console.log(`  Ciclos por segundo: ${(cyclesExecuted / (duration / 1000)).toFixed(2)}`);
    console.log(`  Duración promedio por ciclo: ${avgCycleDuration}ms`);
    console.log(`  Evaluaciones schedule: ${finalStats.scheduleEvaluations - (initialStats.scheduleEvaluations || 0)}`);
    console.log(`  Evaluaciones power: ${finalStats.powerEvaluations - (initialStats.powerEvaluations || 0)}`);
    console.log(`  Acciones ejecutadas: ${finalStats.actionsExecuted - (initialStats.actionsExecuted || 0)}`);
    console.log(`  Errores: ${finalStats.errors - (initialStats.errors || 0)}`);

    // Verificar que el rendimiento sea aceptable
    if (avgCycleDuration > 1000) {
      console.log('⚠️ ADVERTENCIA: Duración de ciclo alta (>1s)');
    } else if (avgCycleDuration > 500) {
      console.log('⚠️ ADVERTENCIA: Duración de ciclo moderada (>500ms)');
    } else {
      console.log('✅ Rendimiento óptimo (<500ms por ciclo)');
    }

  } catch (error) {
    console.error('❌ Error en test de rendimiento:', error);
  } finally {
    if (plugsService) {
      await plugsService.closeAutomationManager();
    }
    await database.close();
  }
}

// Ejecutar tests
async function runAllIntegrationTests() {
  await testIntegrationNewAutomation();
  await testPerformance();
  
  console.log('\n🎉 Todos los tests de integración completados');
  process.exit(0);
}

// Manejar errores no capturados
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  process.exit(1);
});

// Ejecutar si se llama directamente
if (require.main === module) {
  runAllIntegrationTests();
}

module.exports = {
  testIntegrationNewAutomation,
  testPerformance
};
