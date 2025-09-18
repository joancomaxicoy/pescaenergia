const ScheduleEvaluator = require('./src/services/automation/ScheduleEvaluator');

/**
 * Test específico para verificar el fix del bug de enabled
 */
function testScheduleFix() {
  console.log('🔧 Probando fix del ScheduleEvaluator...\n');

  const scheduleEvaluator = new ScheduleEvaluator();

  // Configuración problemática original (sin enabled)
  const problematicConfig = {
    type: 'schedule',
    power: 10,
    schedule: [{ 
      id: 1, 
      days: [0,1,2,3,4,5,6], 
