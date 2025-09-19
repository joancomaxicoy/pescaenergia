/**
 * Script de prueba para verificar la corrección del timezone en ScheduleEvaluator
 */

const ScheduleEvaluator = require('./src/services/automation/ScheduleEvaluator');

async function testTimezoneFix() {
  console.log('🧪 Probando corrección de timezone en ScheduleEvaluator\n');

  try {
    // Crear instancia del evaluador
    const evaluator = new ScheduleEvaluator();
    console.log('🌍 Timezone configurado:', evaluator.userTimezone);

    // Obtener tiempo actual en UTC y en timezone del usuario
    const utcNow = new Date();
    const userTime = evaluator.getCurrentTimeInUserTimezone();

    console.log('\n⏰ Comparación de tiempos:');
    console.log('UTC actual:', utcNow.toISOString());
    console.log('Usuario (Europe/Madrid):', userTime.toISOString());

    // Calcular offset
    const offsetMinutes = (userTime.getTime() - utcNow.getTime()) / (1000 * 60);
    const offsetHours = offsetMinutes / 60;

    console.log(`\n📏 Offset calculado: ${offsetHours} horas (${offsetMinutes} minutos)`);

    // Verificar que el offset sea correcto para Europe/Madrid
    // En invierno: +1 hora, en verano: +2 horas
    const isValidOffset = offsetHours === 1 || offsetHours === 2;
    console.log(`✅ Offset válido para Europe/Madrid: ${isValidOffset ? 'SÍ' : 'NO'}`);

    // Probar evaluación de un slot de horario
    console.log('\n📅 Probando evaluación de horario...');

    const testConfig = {
      type: 'schedule',
      schedule: [{
        id: 1,
        days: [userTime.getDay()], // Día actual
        startTime: '08:00',
        endTime: '18:00',
        enabled: true
      }]
    };

    const evaluation = evaluator.evaluate(testConfig);
    console.log('Resultado de evaluación:', evaluation);

    // Obtener debug info
    const debugInfo = evaluator.getDebugInfo(testConfig);
    console.log('\n🐛 Información de debug:');
    console.log(JSON.stringify(debugInfo, null, 2));

    // Verificar que la hora actual esté en el rango esperado
    const currentHour = userTime.getHours();
    const expectedEvaluation = currentHour >= 8 && currentHour <= 18;
    const evaluationCorrect = evaluation === expectedEvaluation;

    console.log(`\n🎯 Evaluación correcta: ${evaluationCorrect ? 'SÍ' : 'NO'}`);
    console.log(`   - Hora actual: ${currentHour}:00`);
    console.log(`   - Rango esperado: 08:00-18:00`);
    console.log(`   - Evaluación esperada: ${expectedEvaluation}`);
    console.log(`   - Evaluación obtenida: ${evaluation}`);

    // Resumen final
    const allTestsPass = isValidOffset && evaluationCorrect;
    console.log(`\n🏁 RESULTADO FINAL: ${allTestsPass ? '✅ TODOS LOS TESTS PASAN' : '❌ ALGÚN TEST FALLÓ'}`);

    if (allTestsPass) {
      console.log('\n🎉 ¡La corrección de timezone funciona correctamente!');
      console.log('Las automatizaciones ahora se evaluarán en la hora correcta de Europe/Madrid.');
    }

  } catch (error) {
    console.error('❌ Error durante las pruebas:', error);
    console.error('Stack trace:', error.stack);
  }
}

// Ejecutar si se llama directamente
if (require.main === module) {
  testTimezoneFix().catch(console.error);
}

module.exports = { testTimezoneFix };
