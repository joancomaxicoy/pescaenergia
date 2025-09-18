const ScheduleEvaluator = require('./src/services/automation/ScheduleEvaluator');
const PowerEvaluator = require('./src/services/automation/PowerEvaluator');

/**
 * Test de la lógica de automatización sin dependencias de base de datos
 */
async function testAutomationLogic() {
  console.log('🚀 Probando lógica de automatización (sin BD)...\n');

  try {
    // Test 1: ScheduleEvaluator
    console.log('⏰ Test 1: ScheduleEvaluator');
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

    console.log('Configuración schedule:', JSON.stringify(scheduleConfig, null, 2));

    const scheduleValidation = scheduleEvaluator.validateConfig(scheduleConfig);
    console.log('✅ Validación schedule:', scheduleValidation);

    const scheduleEvaluation = scheduleEvaluator.evaluate(scheduleConfig);
    console.log('📊 Evaluación schedule actual:', scheduleEvaluation);

    const scheduleDebug = scheduleEvaluator.getDebugInfo(scheduleConfig);
    console.log('🔍 Debug schedule:', {
      currentTime: scheduleDebug.currentTime,
      evaluation: scheduleDebug.evaluation,
      activeSlots: scheduleDebug.activeSlots,
      inactiveSlots: scheduleDebug.inactiveSlots
    });

    // Test con diferentes horarios
    console.log('\n🕐 Probando diferentes horarios:');
    const testTimes = [
      new Date('2025-09-16T09:00:00'), // Lunes 9:00 (debería estar ON)
      new Date('2025-09-16T19:00:00'), // Lunes 19:00 (debería estar OFF)
      new Date('2025-09-15T12:00:00'), // Domingo 12:00 (debería estar ON)
      new Date('2025-09-15T17:00:00'), // Domingo 17:00 (debería estar OFF)
    ];

    testTimes.forEach((testTime, index) => {
      const evaluation = scheduleEvaluator.evaluate(scheduleConfig, testTime);
      const dayName = scheduleEvaluator.dayNames[testTime.getDay()];
      const timeStr = testTime.toTimeString().substring(0, 5);
      console.log(`  ${index + 1}. ${dayName} ${timeStr}: ${evaluation ? 'ON' : 'OFF'}`);
    });

    // Test 2: PowerEvaluator (con mock cache)
    console.log('\n⚡ Test 2: PowerEvaluator');
    
    // Mock del MemoryCache
    const mockCache = {
      calculatePowerDifference: () => ({
        totalGeneration: 8000, // 8kW
        totalConsumption: 3000, // 3kW
        difference: 5000, // 5kW de exceso
        generationSources: [
          { id: 'gen-giravolt', name: 'Giravolt', power: 5000 },
          { id: 'gen-residencia', name: 'Residència', power: 3000 }
        ],
        consumptionSources: [
          { id: 'device1', name: 'Contador General', power: 3000 }
        ],
        timestamp: new Date()
      })
    };

    const powerEvaluator = new PowerEvaluator(mockCache);
    
    // Configuraciones de prueba para potencia
    const powerConfigs = [
      { type: 'power', power: 2 }, // 2kW umbral (debería estar ON)
      { type: 'power', power: 6 }, // 6kW umbral (debería estar OFF)
      { type: 'power', power: 5 }, // 5kW umbral (justo en el límite)
    ];

    powerConfigs.forEach((config, index) => {
      const validation = powerEvaluator.validateConfig(config);
      const evaluation = powerEvaluator.evaluate(config);
      
      console.log(`  Config ${index + 1} (${config.power}kW):`, {
        valid: validation.valid,
        evaluation: evaluation,
        result: evaluation ? 'ON' : 'OFF'
      });
    });

    // Test de simulación
    console.log('\n🧪 Test de simulación PowerEvaluator:');
    const simulationTests = [
      { generation: 10000, consumption: 2000, threshold: 5 }, // 8kW exceso, umbral 5kW → ON
      { generation: 4000, consumption: 2000, threshold: 5 },  // 2kW exceso, umbral 5kW → OFF
      { generation: 0, consumption: 3000, threshold: 2 },     // -3kW exceso, umbral 2kW → OFF
    ];

    simulationTests.forEach((test, index) => {
      const config = { type: 'power', power: test.threshold };
      const simulation = powerEvaluator.simulate(config, test.generation, test.consumption);
      
      console.log(`  Simulación ${index + 1}:`, {
        generation: test.generation + 'W',
        consumption: test.consumption + 'W',
        threshold: test.threshold + 'kW',
        result: simulation.evaluation ? 'ON' : 'OFF',
        reason: simulation.reason
      });
    });

    // Test 3: Validaciones de configuración
    console.log('\n✅ Test 3: Validaciones');
    
    // Configuraciones inválidas para schedule
    const invalidScheduleConfigs = [
      { type: 'schedule', schedule: [] }, // Sin horarios
      { type: 'schedule', schedule: [{ id: 1, enabled: true, days: [], startTime: '08:00', endTime: '18:00' }] }, // Sin días
      { type: 'schedule', schedule: [{ id: 1, enabled: true, days: [1], startTime: '18:00', endTime: '08:00' }] }, // Hora fin antes que inicio
    ];

    console.log('Validaciones schedule inválidas:');
    invalidScheduleConfigs.forEach((config, index) => {
      const validation = scheduleEvaluator.validateConfig(config);
      console.log(`  ${index + 1}. Valid: ${validation.valid}, Errors: ${validation.errors.length}`);
      if (!validation.valid) {
        console.log(`     Errores: ${validation.errors.join(', ')}`);
      }
    });

    // Configuraciones inválidas para power
    const invalidPowerConfigs = [
      { type: 'power' }, // Sin umbral
      { type: 'power', power: -5 }, // Umbral negativo
      { type: 'power', power: 'invalid' }, // Umbral no numérico
    ];

    console.log('\nValidaciones power inválidas:');
    invalidPowerConfigs.forEach((config, index) => {
      const validation = powerEvaluator.validateConfig(config);
      console.log(`  ${index + 1}. Valid: ${validation.valid}, Errors: ${validation.errors.length}`);
      if (!validation.valid) {
        console.log(`     Errores: ${validation.errors.join(', ')}`);
      }
    });

    console.log('\n✅ Todas las pruebas de lógica completadas exitosamente');

  } catch (error) {
    console.error('❌ Error en las pruebas de lógica:', error);
    process.exit(1);
  }
}

/**
 * Test de integración de evaluadores
 */
async function testEvaluatorIntegration() {
  console.log('\n🔗 Test de integración de evaluadores');

  try {
    const scheduleEvaluator = new ScheduleEvaluator();
    
    // Mock cache con datos más realistas
    const mockCache = {
      calculatePowerDifference: () => ({
        totalGeneration: 6500, // 6.5kW
        totalConsumption: 2800, // 2.8kW
        difference: 3700, // 3.7kW de exceso
        generationSources: [
          { id: 'gen-giravolt', name: 'Giravolt', power: 4000 },
          { id: 'gen-residencia', name: 'Residència', power: 2500 }
        ],
        consumptionSources: [
          { id: 'em1', name: 'Contador General', power: 2800 }
        ],
        timestamp: new Date()
      })
    };

    const powerEvaluator = new PowerEvaluator(mockCache);

    // Simular dispositivos con diferentes configuraciones
    const devices = [
      {
        id: 'device1',
        name: 'Termo ACS',
        config: { type: 'schedule', schedule: [{ id: 1, enabled: true, days: [1,2,3,4,5], startTime: '08:00', endTime: '18:00' }] }
      },
      {
        id: 'device2',
        name: 'Cargador Coche',
        config: { type: 'power', power: 3 } // 3kW umbral
      },
      {
        id: 'device3',
        name: 'Bomba Piscina',
        config: { type: 'power', power: 5 } // 5kW umbral
      }
    ];

    console.log('Evaluando dispositivos:');
    devices.forEach(device => {
      let evaluation = null;
      let evaluationType = device.config.type;

      if (device.config.type === 'schedule') {
        evaluation = scheduleEvaluator.evaluate(device.config);
      } else if (device.config.type === 'power') {
        evaluation = powerEvaluator.evaluate(device.config);
      }

      console.log(`  ${device.name} (${evaluationType}): ${evaluation !== null ? (evaluation ? 'ON' : 'OFF') : 'N/A'}`);
    });

    console.log('\n📊 Resumen de potencia actual:');
    const powerData = mockCache.calculatePowerDifference();
    console.log(`  Generación total: ${powerData.totalGeneration}W`);
    console.log(`  Consumo total: ${powerData.totalConsumption}W`);
    console.log(`  Exceso disponible: ${powerData.difference}W`);
    console.log(`  Fuentes de generación: ${powerData.generationSources.length}`);
    console.log(`  Fuentes de consumo: ${powerData.consumptionSources.length}`);

  } catch (error) {
    console.error('❌ Error en test de integración:', error);
  }
}

// Ejecutar las pruebas
async function runLogicTests() {
  await testAutomationLogic();
  await testEvaluatorIntegration();
  
  console.log('\n🎉 Todas las pruebas de lógica completadas');
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
  runLogicTests();
}

module.exports = {
  testAutomationLogic,
  testEvaluatorIntegration
};
