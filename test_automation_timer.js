/**
 * Script de prueba para el AutomationTimerService
 * Prueba la funcionalidad del timer de automatización
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
 * Función para configurar una automatización de prueba
 */
async function setupTestAutomation() {
  try {
    console.log('\n⚙️  Configurando automatización de prueba...');
    
    // Obtener hora actual + 1 minuto para startTime
    const now = new Date();
    const startTime = new Date(now.getTime() + 1 * 60 * 1000); // +1 minuto
    const endTime = new Date(now.getTime() + 10 * 60 * 1000); // +10 minutos
    
    const startTimeStr = `${startTime.getHours().toString().padStart(2, '0')}:${startTime.getMinutes().toString().padStart(2, '0')}`;
    const endTimeStr = `${endTime.getHours().toString().padStart(2, '0')}:${endTime.getMinutes().toString().padStart(2, '0')}`;
    
    // Configurar para que esté activo ahora (todos los días de la semana)
    const scheduleConfig = {
      type: 'schedule',
      power: 10,
      schedule: [
        {
          id: 1,
          days: [0, 1, 2, 3, 4, 5, 6], // Todos los días
          startTime: startTimeStr,
          endTime: endTimeStr,
          enabled: true
        }
      ]
    };

    console.log(`📅 Configurando horario: ${startTimeStr} - ${endTimeStr}`);
    console.log(`📅 Días: Todos los días de la semana`);

    const response = await axios.post(`${BASE_URL}/api/plugs/${testPlugId}/automation`, scheduleConfig, {
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json'
      }
    });

    console.log('✅ Automatización configurada exitosamente');
    console.log(`⏰ El plug debería encenderse en ~1 minuto (${startTimeStr})`);
    console.log(`⏰ Y apagarse en ~10 minutos (${endTimeStr})`);
    
    return true;
  } catch (error) {
    console.error('❌ Error configurando automatización:', error.response?.data || error.message);
    return false;
  }
}

/**
 * Función para verificar el estado del plug
 */
async function checkPlugStatus() {
  try {
    const response = await axios.get(`${BASE_URL}/api/plugs/${testPlugId}/status`, {
      headers: {
        'Authorization': `Bearer ${authToken}`
      }
    });

    const status = response.data;
    const timestamp = new Date().toLocaleTimeString();
    
    console.log(`🔍 [${timestamp}] Estado del plug:`, {
      isOn: status.isOn,
      isOnline: status.isOnline,
      power: status.power,
      lastUpdate: status.lastUpdate
    });
    
    return status;
  } catch (error) {
    console.error('❌ Error verificando estado del plug:', error.response?.data || error.message);
    return null;
  }
}

/**
 * Función para monitorear el plug durante un tiempo
 */
async function monitorPlug(durationMinutes = 15) {
  console.log(`\n👀 Monitoreando plug durante ${durationMinutes} minutos...`);
  console.log('📊 Verificando estado cada 30 segundos');
  
  const endTime = Date.now() + (durationMinutes * 60 * 1000);
  
  while (Date.now() < endTime) {
    await checkPlugStatus();
    
    // Esperar 30 segundos
    await new Promise(resolve => setTimeout(resolve, 30000));
  }
  
  console.log('✅ Monitoreo completado');
}

/**
 * Función para limpiar la automatización (volver a manual)
 */
async function cleanupAutomation() {
  try {
    console.log('\n🧹 Limpiando automatización (volviendo a modo manual)...');
    
    const manualConfig = {
      type: 'manual',
      power: 10,
      schedule: []
    };

    await axios.post(`${BASE_URL}/api/plugs/${testPlugId}/automation`, manualConfig, {
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json'
      }
    });

    console.log('✅ Automatización limpiada (modo manual)');
    return true;
  } catch (error) {
    console.error('❌ Error limpiando automatización:', error.response?.data || error.message);
    return false;
  }
}

/**
 * Función para verificar el health check del sistema
 */
async function checkSystemHealth() {
  try {
    console.log('\n🏥 Verificando health check del sistema...');
    
    const response = await axios.get(`${BASE_URL}/health`);
    
    console.log('✅ Sistema saludable:', response.data);
    return true;
  } catch (error) {
    console.error('❌ Error en health check:', error.response?.data || error.message);
    return false;
  }
}

/**
 * Función principal
 */
async function main() {
  console.log('🚀 Iniciando pruebas del AutomationTimerService\n');
  console.log('⚠️  IMPORTANTE: Asegúrate de que el servidor esté ejecutándose');
  console.log('⚠️  IMPORTANTE: Esta prueba configurará una automatización real\n');

  // 1. Verificar health del sistema
  const healthOk = await checkSystemHealth();
  if (!healthOk) {
    console.log('❌ El sistema no está saludable. Terminando pruebas.');
    return;
  }

  // 2. Login
  const loginSuccess = await login();
  if (!loginSuccess) {
    console.log('❌ No se pudo hacer login. Terminando pruebas.');
    return;
  }

  // 3. Obtener plugs
  const plugsSuccess = await getPlugs();
  if (!plugsSuccess) {
    console.log('❌ No se pudieron obtener plugs. Terminando pruebas.');
    return;
  }

  // 4. Verificar estado inicial
  console.log('\n📊 Estado inicial del plug:');
  await checkPlugStatus();

  // 5. Configurar automatización de prueba
  const setupSuccess = await setupTestAutomation();
  if (!setupSuccess) {
    console.log('❌ No se pudo configurar la automatización. Terminando pruebas.');
    return;
  }

  // 6. Monitorear durante 15 minutos
  await monitorPlug(15);

  // 7. Limpiar automatización
  await cleanupAutomation();

  // 8. Verificar estado final
  console.log('\n📊 Estado final del plug:');
  await checkPlugStatus();

  console.log('\n🎉 Pruebas del AutomationTimerService completadas');
  console.log('\n📝 Revisa los logs del servidor para ver la actividad del timer');
  console.log('📝 El timer se ejecuta cada 5 minutos según AUTOMATION_TIMMER_INTERVAL');
}

// Ejecutar si se llama directamente
if (require.main === module) {
  main().catch(console.error);
}

module.exports = {
  login,
  getPlugs,
  setupTestAutomation,
  checkPlugStatus,
  monitorPlug,
  cleanupAutomation,
  checkSystemHealth
};
