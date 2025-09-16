/**
 * Script de prueba para los endpoints de automatización de plugs
 * Prueba tanto la funcionalidad de guardar como de rescatar configuraciones
 */

const axios = require('axios');

// Configuración
const BASE_URL = 'http://localhost:3000';
const TEST_EMAIL = 'test@example.com';
const TEST_PASSWORD = 'password123';

// Variables globales
let authToken = null;
let testPlugId = null;

/**
 * Función para hacer login y obtener token
 */
async function login() {
  try {
    console.log('🔐 Iniciando sesión...');
    
    const response = await axios.post(`${BASE_URL}/api/auth/login`, {
      email: TEST_EMAIL,
      password: TEST_PASSWORD
    });

    authToken = response.data.token;
    console.log('✅ Login exitoso');
    return true;
  } catch (error) {
    console.error('❌ Error en login:', error.response?.data || error.message);
    return false;
  }
}

/**
 * Función para obtener la lista de plugs del usuario
 */
async function getPlugs() {
  try {
    console.log('🔌 Obteniendo lista de plugs...');
    
    const response = await axios.get(`${BASE_URL}/api/plugs`, {
      headers: {
        'Authorization': `Bearer ${authToken}`
      }
    });

    const plugs = response.data.plugs;
    console.log(`✅ Se encontraron ${plugs.length} plugs`);
    
    if (plugs.length > 0) {
      testPlugId = plugs[0].id;
      console.log(`📌 Usando plug de prueba: ${plugs[0].device_name} (${testPlugId})`);
      return true;
    } else {
      console.log('⚠️  No se encontraron plugs para probar');
      return false;
    }
  } catch (error) {
    console.error('❌ Error obteniendo plugs:', error.response?.data || error.message);
    return false;
  }
}

/**
 * Función para probar GET /api/plugs/:plugId/automation (configuración inicial)
 */
async function testGetAutomationInitial() {
  try {
    console.log('\n📖 Probando GET /api/plugs/:plugId/automation (configuración inicial)...');
    
    const response = await axios.get(`${BASE_URL}/api/plugs/${testPlugId}/automation`, {
      headers: {
        'Authorization': `Bearer ${authToken}`
      }
    });

    console.log('✅ Configuración inicial obtenida:');
    console.log(JSON.stringify(response.data, null, 2));
    return true;
  } catch (error) {
    console.error('❌ Error obteniendo configuración inicial:', error.response?.data || error.message);
    return false;
  }
}

/**
 * Función para probar POST /api/plugs/:plugId/automation (modo manual)
 */
async function testSaveAutomationManual() {
  try {
    console.log('\n💾 Probando POST /api/plugs/:plugId/automation (modo manual)...');
    
    const manualConfig = {
      type: 'manual',
      power: 15,
      schedule: []
    };

    const response = await axios.post(`${BASE_URL}/api/plugs/${testPlugId}/automation`, manualConfig, {
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json'
      }
    });

    console.log('✅ Configuración manual guardada:');
    console.log(JSON.stringify(response.data, null, 2));
    return true;
  } catch (error) {
    console.error('❌ Error guardando configuración manual:', error.response?.data || error.message);
    return false;
  }
}

/**
 * Función para probar POST /api/plugs/:plugId/automation (modo por potencia)
 */
async function testSaveAutomationPower() {
  try {
    console.log('\n💾 Probando POST /api/plugs/:plugId/automation (modo por potencia)...');
    
    const powerConfig = {
      type: 'power',
      power: 25,
      schedule: []
    };

    const response = await axios.post(`${BASE_URL}/api/plugs/${testPlugId}/automation`, powerConfig, {
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json'
      }
    });

    console.log('✅ Configuración por potencia guardada:');
    console.log(JSON.stringify(response.data, null, 2));
    return true;
  } catch (error) {
    console.error('❌ Error guardando configuración por potencia:', error.response?.data || error.message);
    return false;
  }
}

/**
 * Función para probar POST /api/plugs/:plugId/automation (modo horario)
 */
async function testSaveAutomationSchedule() {
  try {
    console.log('\n💾 Probando POST /api/plugs/:plugId/automation (modo horario)...');
    
    const scheduleConfig = {
      type: 'schedule',
      power: 10,
      schedule: [
        {
          id: 1,
          days: [1, 2, 3, 4, 5], // Lunes a Viernes
          startTime: '08:00',
          endTime: '18:00',
          enabled: true
        },
        {
          id: 2,
          days: [6, 0], // Sábado y Domingo
          startTime: '10:00',
          endTime: '16:00',
          enabled: true
        }
      ]
    };

    const response = await axios.post(`${BASE_URL}/api/plugs/${testPlugId}/automation`, scheduleConfig, {
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json'
      }
    });

    console.log('✅ Configuración horaria guardada:');
    console.log(JSON.stringify(response.data, null, 2));
    return true;
  } catch (error) {
    console.error('❌ Error guardando configuración horaria:', error.response?.data || error.message);
    return false;
  }
}

/**
 * Función para probar GET /api/plugs/:plugId/automation (después de guardar)
 */
async function testGetAutomationAfterSave() {
  try {
    console.log('\n📖 Probando GET /api/plugs/:plugId/automation (después de guardar)...');
    
    const response = await axios.get(`${BASE_URL}/api/plugs/${testPlugId}/automation`, {
      headers: {
        'Authorization': `Bearer ${authToken}`
      }
    });

    console.log('✅ Configuración final obtenida:');
    console.log(JSON.stringify(response.data, null, 2));
    return true;
  } catch (error) {
    console.error('❌ Error obteniendo configuración final:', error.response?.data || error.message);
    return false;
  }
}

/**
 * Función para probar validaciones (datos inválidos)
 */
async function testValidations() {
  try {
    console.log('\n🔍 Probando validaciones...');
    
    // Prueba 1: Tipo inválido
    try {
      await axios.post(`${BASE_URL}/api/plugs/${testPlugId}/automation`, {
        type: 'invalid_type',
        power: 10,
        schedule: []
      }, {
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json'
        }
      });
      console.log('❌ Debería haber fallado con tipo inválido');
    } catch (error) {
      if (error.response?.status === 400) {
        console.log('✅ Validación de tipo inválido funcionando correctamente');
      } else {
        console.log('⚠️  Error inesperado en validación de tipo:', error.response?.data);
      }
    }

    // Prueba 2: Potencia fuera de rango
    try {
      await axios.post(`${BASE_URL}/api/plugs/${testPlugId}/automation`, {
        type: 'power',
        power: 150, // Fuera del rango 1-100
        schedule: []
      }, {
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json'
        }
      });
      console.log('❌ Debería haber fallado con potencia fuera de rango');
    } catch (error) {
      if (error.response?.status === 400) {
        console.log('✅ Validación de potencia fuera de rango funcionando correctamente');
      } else {
        console.log('⚠️  Error inesperado en validación de potencia:', error.response?.data);
      }
    }

    // Prueba 3: Horario inválido
    try {
      await axios.post(`${BASE_URL}/api/plugs/${testPlugId}/automation`, {
        type: 'schedule',
        power: 10,
        schedule: [
          {
            id: 1,
            days: [], // Sin días seleccionados
            startTime: '08:00',
            endTime: '18:00',
            enabled: true
          }
        ]
      }, {
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json'
        }
      });
      console.log('❌ Debería haber fallado con días vacíos');
    } catch (error) {
      if (error.response?.status === 400) {
        console.log('✅ Validación de días vacíos funcionando correctamente');
      } else {
        console.log('⚠️  Error inesperado en validación de días:', error.response?.data);
      }
    }

    return true;
  } catch (error) {
    console.error('❌ Error en pruebas de validación:', error.message);
    return false;
  }
}

/**
 * Función principal
 */
async function main() {
  console.log('🚀 Iniciando pruebas de endpoints de automatización de plugs\n');

  // 1. Login
  const loginSuccess = await login();
  if (!loginSuccess) {
    console.log('❌ No se pudo hacer login. Terminando pruebas.');
    return;
  }

  // 2. Obtener plugs
  const plugsSuccess = await getPlugs();
  if (!plugsSuccess) {
    console.log('❌ No se pudieron obtener plugs. Terminando pruebas.');
    return;
  }

  // 3. Probar GET inicial
  await testGetAutomationInitial();

  // 4. Probar POST con diferentes configuraciones
  await testSaveAutomationManual();
  await testSaveAutomationPower();
  await testSaveAutomationSchedule();

  // 5. Probar GET después de guardar
  await testGetAutomationAfterSave();

  // 6. Probar validaciones
  await testValidations();

  console.log('\n🎉 Pruebas completadas');
}

// Ejecutar si se llama directamente
if (require.main === module) {
  main().catch(console.error);
}

module.exports = {
  login,
  getPlugs,
  testGetAutomationInitial,
  testSaveAutomationManual,
  testSaveAutomationPower,
  testSaveAutomationSchedule,
  testGetAutomationAfterSave,
  testValidations
};
