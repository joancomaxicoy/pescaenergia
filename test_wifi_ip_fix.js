#!/usr/bin/env node

/**
 * Test específico para verificar que status_wifi_sta_ip se guarda como string
 */

require('dotenv').config();
const logger = require('./src/utils/logger');
const database = require('./src/utils/database');
const NormalizerService = require('./src/services/mqtt/normalizerService');
const DeviceStateService = require('./src/services/mqtt/deviceStateService');
const { classifyMetric, getDeviceTypeFromTopic } = require('./src/config/device-metrics-config');

async function testWifiIpFix() {
  try {
    console.log('🔧 Test específico para status_wifi_sta_ip...\n');

    // 1. Conectar a la base de datos
    await database.connect();
    console.log('✅ Conexión establecida\n');

    // 2. Configurar servicios
    const normalizerService = new NormalizerService();
    const deviceStateService = new DeviceStateService();

    // 3. Crear dispositivo de prueba
    const testDeviceId = 'ES0031446458360006JY0F';
    const testDeviceUuid = '12345678-1234-4567-8901-123456789012';
    
    await database.query(`
      INSERT INTO devices (id, user_id, shelly_device_id, device_name, device_type)
      VALUES ($1, 'not_assigned', $2, 'Test ACS Device', 'PLUG')
      ON CONFLICT (id) DO NOTHING
    `, [testDeviceUuid, testDeviceId]);

    // 4. Simular mensaje con status_wifi_sta_ip
    const mqttMessage = {
      topic: 'acs/ES0031446458360006JY0F/status/wifi',
      payload: '{"sta_ip":"192.168.1.100","ssid":"MiWiFi","rssi":-45,"status":"got ip"}',
      timestamp: Date.now()
    };

    console.log('4. Procesando mensaje con WiFi info...');
    console.log('   Topic:', mqttMessage.topic);
    console.log('   Payload:', mqttMessage.payload);

    // 4.1. Normalizar mensaje
    const normalizedData = normalizerService.normalize(mqttMessage);
    if (!normalizedData) {
      console.error('   ❌ Error: El mensaje no se pudo normalizar');
      return;
    }

    console.log('   ✅ Mensaje normalizado:', {
      deviceId: normalizedData.deviceId,
      deviceType: normalizedData.deviceType,
      metricsCount: normalizedData.metrics.length
    });

    // 4.2. Mostrar métricas extraídas
    console.log('   📊 Métricas extraídas:');
    const stateMetrics = [];
    for (const metric of normalizedData.metrics) {
      const classification = classifyMetric(normalizedData.deviceType, metric.name);
      console.log(`      - ${metric.name}: ${metric.value} (${metric.unit}) -> ${classification}`);
      
      if (classification === 'state') {
        stateMetrics.push({
          stateName: metric.name,
          stateValue: metric.value,
          stateType: typeof metric.value === 'boolean' ? 'boolean' : 
                    typeof metric.value === 'number' ? 'numeric' :
                    typeof metric.value === 'object' ? 'json' : 'string'
        });
      }
    }

    // 5. Actualizar estados
    if (stateMetrics.length > 0) {
      console.log('\n5. Actualizando estados...');
      
      try {
        const results = await deviceStateService.updateMultipleDeviceStates(testDeviceUuid, stateMetrics);
        console.log('   ✅ Estados actualizados:', results.length, 'procesados');
        
        for (const result of results) {
          console.log(`      - ${result.stateName}: ${result.is_new ? 'CREADO' : 'ACTUALIZADO'} (${result.stateType})`);
        }
      } catch (error) {
        console.error('   ❌ Error actualizando estados:', error.message);
      }
    }

    // 6. Verificar que status_wifi_sta_ip se guardó como string
    console.log('\n6. Verificando status_wifi_sta_ip...');
    try {
      const savedStates = await deviceStateService.getDeviceStates(testDeviceUuid);
      
      if (savedStates['status_wifi_sta_ip']) {
        const wifiIpState = savedStates['status_wifi_sta_ip'];
        console.log(`   ✅ status_wifi_sta_ip encontrado:`);
        console.log(`      - Valor: ${wifiIpState.value}`);
        console.log(`      - Tipo: ${wifiIpState.type}`);
        console.log(`      - Actualizado: ${wifiIpState.updated_at}`);
        
        if (wifiIpState.type === 'string' && wifiIpState.value === '192.168.1.100') {
          console.log('   🎉 ¡CORRECTO! status_wifi_sta_ip se guardó como string con el valor esperado');
        } else {
          console.log('   ❌ ERROR: Tipo o valor incorrecto');
        }
      } else {
        console.log('   ❌ status_wifi_sta_ip no encontrado en los estados guardados');
        console.log('   Estados disponibles:', Object.keys(savedStates));
      }
    } catch (error) {
      console.error('   ❌ Error verificando estados:', error.message);
    }

    // 7. Limpiar datos de prueba
    console.log('\n7. Limpiando datos de prueba...');
    await database.query('DELETE FROM device_states WHERE device_id = $1', [testDeviceUuid]);
    console.log('   ✅ Datos de prueba eliminados');

    console.log('\n🎉 Test completado!');

  } catch (error) {
    console.error('❌ Error en el test:', error.message);
    console.error('Stack trace:', error.stack);
  } finally {
    try {
      await database.close();
      console.log('\n🔌 Conexión cerrada');
    } catch (error) {
      console.error('Error cerrando conexión:', error.message);
    }
  }
}

// Ejecutar el test
if (require.main === module) {
  testWifiIpFix().catch((error) => {
    console.error('Error fatal:', error);
    process.exit(1);
  });
}

module.exports = testWifiIpFix;
