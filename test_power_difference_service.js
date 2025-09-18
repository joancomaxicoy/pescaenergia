const PowerDifferenceService = require('./src/services/powerDifferenceService');

async function testPowerDifferenceService() {
  console.log('🧪 Probando PowerDifferenceService...');

  try {
    // Crear instancia del servicio
    const service = new PowerDifferenceService();
    console.log('✅ Servicio instanciado correctamente');

    // Probar con IDs de usuario de ejemplo (estos no existen, pero sirve para probar la estructura)
    const testUserIds = ['user-123', 'user-456'];

    console.log('📊 Probando método getPowerDifference con IDs:', testUserIds);

    const result = await service.getPowerDifference(testUserIds);
    console.log('✅ Método ejecutado sin errores');
    console.log('📋 Resultado:', JSON.stringify(result, null, 2));

  } catch (error) {
    console.error('❌ Error en el test:', error.message);
    console.error('Stack trace:', error.stack);
  }
}

// Ejecutar test si se llama directamente
if (require.main === module) {
  testPowerDifferenceService();
}

module.exports = { testPowerDifferenceService };
