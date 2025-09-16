/**
 * Script de prueba simple para verificar que el AutomationTimerService funciona
 * Este script solo verifica que el servicio se puede instanciar y ejecutar métodos básicos
 */

const AutomationTimerService = require('./src/services/automationTimerService');

async function testAutomationService() {
  console.log('🧪 Iniciando prueba simple del AutomationTimerService\n');

  try {
    // 1. Crear instancia del servicio
    console.log('📦 Creando instancia del AutomationTimerService...');
    const automationService = new AutomationTimerService();
    console.log('✅ Instancia creada exitosamente');

    // 2. Verificar configuración inicial
    console.log('\n⚙️  Verificando configuración inicial...');
    const stats = automationService.getStats();
    console.log('📊 Estadísticas iniciales:', stats);

    // 3. Probar health check
    console.log('\n🏥 Probando health check...');
    const health = await automationService.healthCheck();
    console.log('💚 Health check:', health);

    // 4. Probar evaluación de timezone
    console.log('\n🌍 Probando manejo de timezone...');
    const currentTime = automationService.getCurrentTimeInUserTimezone();
    console.log('⏰ Tiempo actual en timezone del usuario:', {
      timezone: automationService.userTimezone,
      currentTime: currentTime.toISOString(),
      localString: currentTime.toLocaleString('es-ES', { timeZone: automationService.userTimezone }),
      day: currentTime.getDay(),
      hour: currentTime.getHours(),
      minute: currentTime.getMinutes()
    });

    // 5. Probar evaluación de slot de horario (sin BD)
    console.log('\n📅 Probando evaluación de slot de horario...');
    
    const currentDay = currentTime.getDay();
    const currentHour = currentTime.getHours();
    const currentMinute = currentTime.getMinutes();
    const currentTimeString = `${currentHour.toString().padStart(2, '0')}:${currentMinute.toString().padStart(2, '0')}`;
    
    // Crear un slot que debería estar activo ahora
    const activeSlot = {
      id: 1,
      days: [currentDay], // Día actual
      startTime: `${(currentHour - 1).toString().padStart(2, '0')}:00`, // Hace 1 hora
      endTime: `${(currentHour + 1).toString().padStart(2, '0')}:00`, // En 1 hora
      enabled: true
    };

    // Crear un slot que NO debería estar activo
    const inactiveSlot = {
      id: 2,
      days: [currentDay === 0 ? 6 : currentDay - 1], // Día diferente
      startTime: '08:00',
      endTime: '18:00',
      enabled: true
    };

    const activeResult = automationService.isScheduleSlotActive(activeSlot, currentDay, currentTimeString);
    const inactiveResult = automationService.isScheduleSlotActive(inactiveSlot, currentDay, currentTimeString);

    console.log('🟢 Slot activo (debería ser true):', {
      slot: activeSlot,
      result: activeResult,
      expected: true,
      passed: activeResult === true
    });

    console.log('🔴 Slot inactivo (debería ser false):', {
      slot: inactiveSlot,
      result: inactiveResult,
      expected: false,
      passed: inactiveResult === false
    });

    // 6. Probar evaluación de automatización completa
    console.log('\n🤖 Probando evaluación de automatización schedule...');
    
    const scheduleConfig = {
      type: 'schedule',
      power: 10,
      schedule: [activeSlot, inactiveSlot]
    };

    const automationResult = automationService.evaluateScheduleAutomation(
      scheduleConfig,
      currentDay,
      currentTimeString
    );

    console.log('📋 Resultado de evaluación de automatización:', {
      config: scheduleConfig,
      currentDay,
      currentTimeString,
      result: automationResult,
      expected: true, // Debería ser true porque activeSlot está activo
      passed: automationResult === true
    });

    // 7. Probar método placeholder de power automation
    console.log('\n⚡ Probando evaluación de automatización power (placeholder)...');
    const powerResult = automationService.evaluatePowerAutomation({ automation_id: 'test' });
    console.log('🔌 Resultado power automation:', {
      result: powerResult,
      expected: null,
      passed: powerResult === null
    });

    // 8. Resumen de pruebas
    console.log('\n📊 Resumen de pruebas:');
    const tests = [
      { name: 'Creación de instancia', passed: true },
      { name: 'Health check', passed: health.status === 'stopped' }, // Stopped porque no está iniciado
      { name: 'Manejo de timezone', passed: currentTime instanceof Date },
      { name: 'Slot activo', passed: activeResult === true },
      { name: 'Slot inactivo', passed: inactiveResult === false },
      { name: 'Evaluación de automatización', passed: automationResult === true },
      { name: 'Power automation placeholder', passed: powerResult === null }
    ];

    const passedTests = tests.filter(t => t.passed).length;
    const totalTests = tests.length;

    tests.forEach(test => {
      console.log(`${test.passed ? '✅' : '❌'} ${test.name}`);
    });

    console.log(`\n🎯 Resultado final: ${passedTests}/${totalTests} pruebas pasaron`);

    if (passedTests === totalTests) {
      console.log('🎉 ¡Todas las pruebas pasaron! El AutomationTimerService está funcionando correctamente.');
    } else {
      console.log('⚠️  Algunas pruebas fallaron. Revisa la implementación.');
    }

  } catch (error) {
    console.error('❌ Error durante las pruebas:', error);
    console.error('Stack trace:', error.stack);
  }
}

// Ejecutar si se llama directamente
if (require.main === module) {
  testAutomationService().catch(console.error);
}

module.exports = { testAutomationService };
