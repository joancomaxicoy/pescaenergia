const AutomationTimerService = require('./src/services/automationTimerService');

// Crear una instancia del servicio
const automationService = new AutomationTimerService();

// Tu regla de ejemplo
const testRule = {
  type: 'schedule',
  schedule: [
    {
      id: 2,
      days: [0, 1, 2, 3, 4, 5, 6],
      endTime: '18:00',
      startTime: '12:00'
    }
  ]
};

// Casos de test
const testCases = [
  {
    name: 'Día 1 (lunes) a las 16:21 - Debería ser TRUE',
    currentDay: 1,
    currentTimeString: '16:21',
    expected: true
  },
  {
    name: 'Día 1 (lunes) a las 11:59 - Debería ser FALSE (antes del inicio)',
    currentDay: 1,
    currentTimeString: '11:59',
    expected: false
  },
  {
    name: 'Día 1 (lunes) a las 12:00 - Debería ser TRUE (inicio exacto)',
    currentDay: 1,
    currentTimeString: '12:00',
    expected: true
  },
  {
    name: 'Día 1 (lunes) a las 18:00 - Debería ser TRUE (fin exacto)',
    currentDay: 1,
    currentTimeString: '18:00',
    expected: true
  },
  {
    name: 'Día 1 (lunes) a las 18:01 - Debería ser FALSE (después del fin)',
    currentDay: 1,
    currentTimeString: '18:01',
    expected: false
  },
  {
    name: 'Día 0 (domingo) a las 16:21 - Debería ser TRUE (domingo incluido)',
    currentDay: 0,
    currentTimeString: '16:21',
    expected: true
  },
  {
    name: 'Día 6 (sábado) a las 16:21 - Debería ser TRUE (sábado incluido)',
    currentDay: 6,
    currentTimeString: '16:21',
    expected: true
  }
];

console.log('🧪 Iniciando tests de evaluateScheduleAutomation...\n');

let passedTests = 0;
let totalTests = testCases.length;

testCases.forEach((testCase, index) => {
  console.log(`Test ${index + 1}: ${testCase.name}`);
  
  const result = automationService.evaluateScheduleAutomation(
    testRule,
    testCase.currentDay,
    testCase.currentTimeString
  );
  
  const passed = result === testCase.expected;
  
  console.log(`  📅 Día: ${testCase.currentDay} | ⏰ Hora: ${testCase.currentTimeString}`);
  console.log(`  🎯 Esperado: ${testCase.expected} | 📊 Resultado: ${result}`);
  console.log(`  ${passed ? '✅ PASS' : '❌ FAIL'}\n`);
  
  if (passed) {
    passedTests++;
  }
});

console.log('📋 Resumen de tests:');
console.log(`✅ Pasados: ${passedTests}/${totalTests}`);
console.log(`❌ Fallidos: ${totalTests - passedTests}/${totalTests}`);

if (passedTests === totalTests) {
  console.log('🎉 ¡Todos los tests pasaron! La función está funcionando correctamente.');
} else {
