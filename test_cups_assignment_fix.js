// Cargar variables de entorno
require('dotenv').config();

const CupsService = require('./src/services/cupsService');
const logger = require('./src/utils/logger');
const database = require('./src/utils/database');

async function testCupsAssignmentFix() {
  console.log('🧪 Iniciando test de corrección de asignación de CUPS...\n');

  try {
    // Inicializar conexión a la base de datos
    console.log('🔌 Conectando a la base de datos...');
    await database.connect();
    console.log('✅ Conexión establecida\n');
    // Test 1: Obtener información de un CUPS existente
    console.log('📋 Test 1: Obtener información de CUPS...');
    try {
      const cupsInfo = await CupsService.getCupsInfo('TEST_CUPS_001');
      console.log('✅ getCupsInfo funciona correctamente');
      if (cupsInfo) {
        console.log(`   - CUPS encontrado: ${cupsInfo.shelly_device_id}`);
        console.log(`   - Asignado: ${cupsInfo.is_assigned ? 'Sí' : 'No'}`);
      } else {
        console.log('   - CUPS no encontrado (normal si no existe)');
      }
    } catch (error) {
      console.log(`❌ Error en getCupsInfo: ${error.message}`);
    }

    console.log('');

    // Test 2: Listar todos los CUPS
    console.log('📋 Test 2: Listar todos los CUPS...');
    try {
      const cupsList = await CupsService.listAllCups();
      console.log('✅ listAllCups funciona correctamente');
      console.log(`   - Total de CUPS encontrados: ${cupsList.length}`);
      
      if (cupsList.length > 0) {
        const assigned = cupsList.filter(c => c.is_assigned).length;
        const unassigned = cupsList.filter(c => !c.is_assigned).length;
        console.log(`   - Asignados: ${assigned}, No asignados: ${unassigned}`);
      }
    } catch (error) {
      console.log(`❌ Error en listAllCups: ${error.message}`);
    }

    console.log('');

    // Test 3: Verificar que las consultas SQL no fallan por tipo de datos
    console.log('📋 Test 3: Verificar consultas SQL...');
    
    try {
      const testQuery = `
        SELECT 
          d.id,
          d.shelly_device_id,
          d.user_id,
          CASE 
            WHEN d.user_id = 'not_assigned' THEN NULL
            ELSE u.name
          END as user_name
        FROM devices d
        LEFT JOIN users u ON d.user_id != 'not_assigned' AND d.user_id::uuid = u.id
        WHERE d.device_type = 'SHELLY_SHELLYEM'
        LIMIT 5
      `;
      
      const result = await database.query(testQuery);
      console.log('✅ Consulta SQL con JOIN corregido funciona correctamente');
      console.log(`   - Registros obtenidos: ${result.rows.length}`);
      
      if (result.rows.length > 0) {
        console.log('   - Ejemplo de registro:');
        const sample = result.rows[0];
        console.log(`     * ID: ${sample.id}`);
        console.log(`     * Shelly ID: ${sample.shelly_device_id}`);
        console.log(`     * User ID: ${sample.user_id}`);
        console.log(`     * User Name: ${sample.user_name || 'No asignado'}`);
      }
    } catch (error) {
      console.log(`❌ Error en consulta SQL: ${error.message}`);
    }

    console.log('\n🎉 Test completado. Si no hay errores arriba, la corrección fue exitosa.');

  } catch (error) {
    console.error('💥 Error general en el test:', error.message);
    console.error(error.stack);
  }
}

// Ejecutar el test
if (require.main === module) {
  testCupsAssignmentFix()
    .then(() => {
      console.log('\n✨ Test finalizado');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Test falló:', error);
      process.exit(1);
    });
}

module.exports = { testCupsAssignmentFix };
