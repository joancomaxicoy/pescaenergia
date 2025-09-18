const AutomationManager = require('./src/services/automation/AutomationManager');
const MemoryCache = require('./src/services/automation/MemoryCache');
const ScheduleEvaluator = require('./src/services/automation/ScheduleEvaluator');
const PowerEvaluator = require('./src/services/automation/PowerEvaluator');
const logger = require('./src/utils/logger');

/**
 * Script de prueba para el nuevo sistema de automatización
 */
async function testNewAutomationSystem() {
  console.log('🚀 Iniciando pruebas del nuevo sistema de automatización...\n');

  try {
    // Test 1: MemoryCache
    console.log('📦 Test 1: MemoryCache');
    const memoryCache = new MemoryCache();
    await memoryCache.initialize();
    
    const cacheStats = memoryCache.getStats();
    console.log('Cache inicializado:', {
      configs: cacheStats.currentSize.configs,
      states: cacheStats.currentSize.states,
      powerMetrics: cacheStats.currentSize.powerMetrics,
      generators: cacheStats.currentSize.generators
    });

    // Test 2: ScheduleEvaluator
    console.log('\n⏰ Test 2: ScheduleEvaluator');
    const scheduleEvaluator = new ScheduleEvaluator();
    
    // Configuración de prueba para horario
    const scheduleConfig = {
      type: 'schedule',
      schedule: [
        {
          id: 1,
          enabled: true,
          days: [1, 2, 3, 4, 5], // Lunes a Viernes
          startTime: '08:00',
          endTime: '18:00'
        },
        {
          id: 2,
          enabled: true,
          days: [6, 0], // Sábado y Domingo
          startTime: '10:00',
          endTime: '16:00'
        }
      ]
    };

    const scheduleValidation = scheduleEvaluator.validateConfig(scheduleConfig);
    console.log('Validación schedule:', scheduleValidation);

    const scheduleEvaluation = scheduleEvaluator.evaluate(scheduleConfig);
    console.log('Evaluación schedule actual:', scheduleEvaluation);

    const scheduleDebug = scheduleEvaluator.getDebugInfo(scheduleConfig);
    console.log('Debug schedule:', {
      currentTime: scheduleDebug.currentTime,
      evaluation: scheduleDebug.evaluation,
      activeSlots: scheduleDebug.activeSlots.length,
      inactiveSlots: scheduleDebug.inactiveSlots.length
    });

    // Test 3: PowerEvaluator
    console.log('\n⚡ Test 3: PowerEvaluator');
    const powerEvaluator = new PowerEvaluator(memoryCache);
    
    // Configuración de prueba para potencia
    const powerConfig = {
      type: 'power',
      power: 5 // 5kW de umbral
    };

    const powerValidation = powerEvaluator.validateConfig(powerConfig);
    console.log('Validación power:', powerValidation);

    const dataAvailability = powerEvaluator.checkDataAvailability();
    console.log('Disponibilidad de datos:', {
      available: dataAvailability.available,
      hasGeneration: dataAvailability.hasGeneration,
      hasConsumption: dataAvailability.hasConsumption,
      reason: dataAvailability.reason
    });

    // Simulación de evaluación power
    const powerSimulation = powerEvaluator.simulate(powerConfig, 8000, 2000); // 8kW generación, 2kW consumo
    console.log('Simulación power:', {
      evaluation: powerSimulation.evaluation,
      reason: powerSimulation.reason
    });

    // Test 4: AutomationManager (sin servicios externos)
    console.log('\n🎯 Test 4: AutomationManager');
    const automationManager = new AutomationManager();
    
    await automationManager.initialize();
    console.log('AutomationManager inicializado');

    const managerStats = automationManager.getStats();
    console.log('Estadísticas iniciales:', {
      isRunning: managerStats.isRunning,
      executionInterval: managerStats.executionInterval,
      cacheConfigs: managerStats.cacheStats.currentSize.configs,
      mqttHandlerRegistered: managerStats.mqttHandlerRegistered
    });

    // Iniciar el manager por unos segundos para ver si funciona
    console.log('\n🔄 Iniciando AutomationManager por 10 segundos...');
    automationManager.start();

    // Esperar 10 segundos
    await new Promise(resolve => setTimeout(resolve, 10000));

    const finalStats = automationManager.getStats();
    console.log('Estadísticas después de 10 segundos:', {
      cyclesExecuted: finalStats.cyclesExecuted,
      scheduleEvaluations: finalStats.scheduleEvaluations,
      powerEvaluations: finalStats.powerEvaluations,
      actionsExecuted: finalStats.actionsExecuted,
      errors: finalStats.errors,
      lastCycleDuration: finalStats.lastCycleDuration + 'ms'
    });

    // Detener el manager
    automationManager.stop();
    console.log('AutomationManager detenido');

    // Test 5: Debug Info
    console.log('\n🔍 Test 5: Información de Debug');
    const debugInfo = automationManager.getDebugInfo();
    console.log('Debug completo:', {
      activeConfigs: debugInfo.activeConfigs,
      cacheSize: debugInfo.cache.currentSize,
      powerEvaluator: {
        available: debugInfo.powerEvaluator.available,
        reason: debugInfo.powerEvaluator.reason
      }
    });

    // Cerrar recursos
    await automationManager.close();
    console.log('\n✅ Todas las pruebas completadas exitosamente');

  } catch (error) {
    console.error('❌ Error en las pruebas:', error);
    process.exit(1);
  }
}

/**
 * Test específico de configuraciones reales de la base de datos
 */
async function testRealConfigurations() {
  console.log('\n🔧 Test adicional: Configuraciones reales de la base de datos');

  try {
    const memoryCache = new MemoryCache();
    await memoryCache.initialize();

    const allConfigs = memoryCache.getAllAutomationConfigs();
    console.log(`Configuraciones encontradas: ${allConfigs.length}`);

    if (allConfigs.length > 0) {
      console.log('\nPrimeras 3 configuraciones:');
      allConfigs.slice(0, 3).forEach((config, index) => {
        console.log(`${index + 1}. ${config.deviceName} (${config.config.type}):`, {
          deviceId: config.deviceId,
          type: config.config.type,
          power: config.config.power,
          scheduleSlots: config.config.schedule?.length || 0
        });
      });
    }

    const configsByType = {
      schedule: memoryCache.getConfigsByType('schedule').length,
      power: memoryCache.getConfigsByType('power').length,
      manual: memoryCache.getConfigsByType('manual').length
    };
    console.log('Configuraciones por tipo:', configsByType);

    const deviceStates = memoryCache.getAllDeviceStates();
    console.log(`Estados de dispositivos: ${deviceStates.length}`);

    if (deviceStates.length > 0) {
      const onDevices = deviceStates.filter(state => state.output).length;
      const offDevices = deviceStates.filter(state => !state.output).length;
      console.log(`Dispositivos ON: ${onDevices}, OFF: ${offDevices}`);
    }

    const powerMetrics = memoryCache.getAllPowerMetrics();
    console.log(`Métricas de potencia: ${powerMetrics.length}`);

    if (powerMetrics.length > 0) {
      const generators = powerMetrics.filter(m => m.type === 'generator').length;
      const devices = powerMetrics.filter(m => m.type === 'device').length;
      console.log(`Generadores: ${generators}, Dispositivos: ${devices}`);

      // Calcular diferencia de potencia
      const powerDifference = memoryCache.calculatePowerDifference();
      console.log('Diferencia de potencia actual:', {
        totalGeneration: powerDifference.totalGeneration.toFixed(2) + 'W',
        totalConsumption: powerDifference.totalConsumption.toFixed(2) + 'W',
        difference: powerDifference.difference.toFixed(2) + 'W',
        generationSources: powerDifference.generationSources.length,
        consumptionSources: powerDifference.consumptionSources.length
      });
    }

    memoryCache.close();

  } catch (error) {
    console.error('❌ Error en test de configuraciones reales:', error);
  }
}

// Ejecutar las pruebas
async function runAllTests() {
  await testNewAutomationSystem();
  await testRealConfigurations();
  
  console.log('\n🎉 Todas las pruebas completadas');
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
  runAllTests();
}

module.exports = {
  testNewAutomationSystem,
  testRealConfigurations
};
