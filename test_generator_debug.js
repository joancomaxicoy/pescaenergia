require('dotenv').config();
const database = require('./src/utils/database');

async function debugGeneratorIssue() {
  try {
    console.log('🔍 Investigando problema con assignedGeneration...');
    
    // Inicializar conexión a la base de datos
    await database.connect();
    
    // 1. Verificar si existe el dispositivo generador "residencia"
    console.log('\n1. Buscando dispositivo generador "residencia"...');
    const generatorQuery = `
      SELECT * FROM devices 
      WHERE device_type = 'GENERATOR' AND shelly_device_id = 'Generacio-Residencia'
    `;
    const generatorResult = await database.query(generatorQuery);
    console.log('Dispositivo generador encontrado:', generatorResult.rows);
    
    // 2. Listar todos los generadores
    console.log('\n2. Listando todos los dispositivos GENERATOR...');
    const allGeneratorsQuery = `SELECT * FROM devices WHERE device_type = 'GENERATOR'`;
    const allGeneratorsResult = await database.query(allGeneratorsQuery);
    console.log('Todos los generadores:', allGeneratorsResult.rows);
    
    // 3. Verificar participación del usuario
    console.log('\n3. Verificando participación del usuario...');
    const participationQuery = `
      SELECT * FROM user_participation 
      WHERE user_id = 'd48b3382-8d4b-4206-9daf-aed88dfa16ea' AND generator_code = 'residencia'
    `;
    const participationResult = await database.query(participationQuery);
    console.log('Participación encontrada:', participationResult.rows);
    
    // 4. Si existe el generador, verificar métricas de potencia
    if (generatorResult.rows.length > 0) {
      const deviceId = generatorResult.rows[0].id;
      console.log('\n4. Verificando métricas de potencia para el generador...');
      const metricsQuery = `
        SELECT * FROM energy_metrics 
        WHERE device_id = $1 
        AND metric_name LIKE '%power%' 
        AND timestamp >= NOW() - INTERVAL '1 hour'
        ORDER BY timestamp DESC 
        LIMIT 10
      `;
      const metricsResult = await database.query(metricsQuery, [deviceId]);
      console.log('Métricas de potencia encontradas:', metricsResult.rows);
    }
    
    console.log('\n✅ Diagnóstico completado');
    
  } catch (error) {
    console.error('❌ Error en diagnóstico:', error);
  }
}

debugGeneratorIssue();
