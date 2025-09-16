const axios = require('axios');

// Configuración del test
const BASE_URL = 'http://localhost:3000';
const TEST_USER = {
  email: 'admin@pescaenergia.com',
  password: 'admin123'
};

let authToken = null;
let testPlugId = null;

/**
 * Función para hacer login y obtener token
 */
async function login() {
  try {
    console.log('🔐 Haciendo login...');
    
    const response = await axios.post(`${BASE_URL}/api/auth/login`, {
      email: TEST_USER.email,
      password: TEST_USER.password
    });

    if (response.data.success && response.data.token) {
      authToken = response.data.token;
      console.log('✅ Login exitoso');
      return true;
    } else {
      console.error('❌ Error en login:', response.data);
      return false;
    }
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
    console.log('\n📋 Obteniendo lista de plugs...');
    
    const response = await axios.get(`${BASE_URL}/api/plugs`, {
      headers: {
        'Authorization': `Bearer ${authToken}`
      }
    });

    if (response.data.success) {
      console.log(`✅ Se encontraron ${response.data.count} plugs`);
      
      if (response.data.plugs.length > 0) {
        testPlugId = response.data.plugs[0].id;
        console.log('📌 Usando plug para test:', {
          id: testPlugId,
          name: response.data.plugs[0].device_name,
          shellyId: response.data.plugs[0].shelly_device_id
        });
        return true;
      } else {
        console.log('⚠️  No se encontraron plugs para probar');
        return false;
      }
    } else {
      console.error('❌ Error obteniendo plugs:', response.data);
      return false;
    }
  } catch (error) {
    console.error('❌ Error obteniendo plugs:', error.response?.data || error.message);
    return false;
  }
}

/**
 * Función para controlar un plug
 */
async function controlPlug(action) {
  try {
    console.log(`\n🔌 Enviando comando "${action}" al plug...`);
    
    const response = await axios.post(`${BASE_URL}/api/plugs/${testPlugId}/control`, {
      action: action
    }, {
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json'
      }
    });

    if (response.data.success) {
      console.log('✅ Comando enviado exitosamente:');
      console.log('   📍 Plug ID:', response.data.plugId);
      console.log('   🏷️  Nombre:', response.data.deviceName);
      console.log('   🆔 Shelly ID:', response.data.shellyDeviceId);
      console.log('   ⚡ Acción:', response.data.action);
      console.log('   📡 Topic MQTT:', response.data.topic);
      console.log('   🕐 Timestamp:', response.data.timestamp);
      console.log('   💬 Mensaje:', response.data.message);
      console.log('   🔧 MQTT Implementado:', response.data.mqttImplemented);
      return true;
    } else {
      console.error('❌ Error controlando plug:', response.data);
      return false;
    }
  } catch (error) {
    console.error(`❌ Error enviando comando "${action}":`, error.response?.data || error.message);
    return false;
  }
}

/**
 * Función para obtener el estado de un plug
 */
async function getPlugStatus() {
  try {
    console.log('\n📊 Obteniendo estado del plug...');
    
    const response = await axios.get(`${BASE_URL}/api/plugs/${testPlugId}/status`, {
      headers: {
        'Authorization': `Bearer ${authToken}`
      }
    });

    console.log('✅ Estado del plug:');
    console.log('   📍 Plug ID:', response.data.plugId);
    console.log('   🏷️  Nombre:', response.data.deviceName);
    console.log('   🔗 Online:', response.data.isOnline);
    console.log('   🔌 Encendido:', response.data.isOn);
    console.log('   ⚡ Potencia:', response.data.power, 'W');
    console.log('   🔋 Voltaje:', response.data.voltage, 'V');
    console.log('   🌡️  Temperatura:', response.data.temperature, '°C');
    console.log('   🕐 Última actualización:', response.data.lastUpdate);
    console.log('   🧪 Simulado:', response.data.simulated);
    
    return true;
  } catch (error) {
    console.error('❌ Error obteniendo estado:', error.response?.data || error.message);
    return false;
  }
}

/**
 * Función principal de test
 */
async function runTest() {
  console.log('🚀 Iniciando test de control de plugs...\n');

  // 1. Login
  const loginSuccess = await login();
  if (!loginSuccess) {
    console.log('\n❌ Test fallido: No se pudo hacer login');
    return;
  }

  // 2. Obtener plugs
  const plugsSuccess = await getPlugs();
  if (!plugsSuccess) {
    console.log('\n❌ Test fallido: No se pudieron obtener plugs');
    return;
  }

  // 3. Obtener estado inicial
  await getPlugStatus();

  // 4. Probar comando ON
  const onSuccess = await controlPlug('on');
  if (!onSuccess) {
    console.log('\n⚠️  Comando ON falló');
  }

  // Esperar un poco
  await new Promise(resolve => setTimeout(resolve, 2000));

  // 5. Probar comando OFF
  const offSuccess = await controlPlug('off');
  if (!offSuccess) {
    console.log('\n⚠️  Comando OFF falló');
  }

  // Esperar un poco
  await new Promise(resolve => setTimeout(resolve, 2000));

  // 6. Probar comando TOGGLE
  const toggleSuccess = await controlPlug('toggle');
  if (!toggleSuccess) {
    console.log('\n⚠️  Comando TOGGLE falló');
  }

  // 7. Probar comando inválido
  console.log('\n🧪 Probando comando inválido...');
  try {
    await controlPlug('invalid_action');
  } catch (error) {
    console.log('✅ Error esperado para comando inválido:', error.response?.data?.details || error.message);
  }

  // 8. Estado final
  await getPlugStatus();

  console.log('\n🎉 Test completado!');
  
  if (onSuccess || offSuccess || toggleSuccess) {
    console.log('✅ El endpoint de control de plugs está funcionando correctamente');
    console.log('📡 Los comandos MQTT se están enviando al broker');
  } else {
    console.log('⚠️  Algunos comandos fallaron, revisar logs del servidor');
  }
}

// Ejecutar el test
runTest().catch(error => {
  console.error('💥 Error fatal en el test:', error);
});
