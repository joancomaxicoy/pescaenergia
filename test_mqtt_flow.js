#!/usr/bin/env node

/**
 * Test específico para verificar el flujo completo de procesamiento MQTT
 * con el mensaje que no está funcionando
 */

require('dotenv').config();
const logger = require('./src/utils/logger');
const database = require('./src/utils/database');
const NormalizerService = require('./src/services/mqtt/normalizerService');
const CompactorService = require('./src/services/mqtt/compactorService');
const DeviceStateService = require('./src/services/mqtt/deviceStateService');
const BufferService = require('./src/services/mqtt/bufferService');
const PersistenceService = require('./src/services/mqtt/persistenceService');
const { classifyMetric, getDeviceTypeFromTopic } = require('./src/config/device-metrics-config');

async function testMqttFlow() {
  try {
    console.log('🔧 Iniciando test del flujo MQTT completo...\n');

    // 1. Conectar a la base de datos
    console.log('1. Conectando a la base de datos...');
    await database.connect();
    console.log('✅ Conexión establecida\n');

    // 2. Configurar servicios
    console.log('2. Configurando servicios...');
    const bufferService = new BufferService();
    const persistenceService = new PersistenceService();
    const normalizerService = new NormalizerService();
    const compactorService = new CompactorService(bufferService, persistenceService);
    const deviceStateService = new DeviceStateService();
    console.log('✅ Servicios configurados\n');

    // 3. Crear dispositivo de prueba
    const testDeviceId = 'ES0031446458360006JY0F';
    const testDeviceUuid = '12345678-1234-4567-8901-123456789012';
    
    console.log('3. Creando dispositivo de prueba...');
    await database.query(`
      INSERT INTO devices (id, user_id, shelly_device_id, device_name, device_type)
      VALUES ($1, 'not_assigned', $2, 'Test ACS Device', 'PLUG')
      ON CONFLICT (id) DO NOTHING
    `, [testDeviceUuid, testDeviceId]);
    console.log('✅ Dispositivo creado\n');

    // 4. Simular mensaje MQTT problemático
    const mqttMessage = {
      topic: 'acs/ES0031446458360006JY0F/status/switch:0',
      payload: '{"id":0, "source":"mqtt", "output":false, "apower":0.0, "voltage":250.2, "freq":50.0, "current":0.000, "aenergy":{"total":0.000,"by_minute":[0.000,0.000,0.000],"minute_ts":1757599440}, "ret_aenergy":{"total":0.000,"by_minute":[0.000,0.000,0.000],"minute_ts":1757599440},"temperature":{"tC":48.3, "tF":118.9}}',
      timestamp: Date.now()
    };

    console.log('4. Procesando mensaje MQTT...');
    console.log('   Topic:', mqttMessage.topic);
    console.log('   Payload:', mqttMessage.payload.substring(0, 100) + '...');

    // 4.1. Verificar tipo de dispositivo
    const deviceType = getDeviceTypeFromTopic(mqttMessage.topic);
    console.log('   ✅ Tipo de dispositivo detectado:', deviceType);

    // 4.2. Normalizar mensaje
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

    // 4.3. Mostrar métricas extraídas
    console.log('   📊 Métricas extraídas:');
    for (const metric of normalizedData.metrics) {
      const classification = classifyMetric(normalizedData.deviceType, metric.name);
      console.log(`      - ${metric.name}: ${metric.value} (${metric.unit}) -> ${classification}`);
    }

    // 4.4. Agregar al buffer
    bufferService.addData(normalizedData);
    console.log('   ✅ Métricas agregadas al buffer\n');

    // 5. Simular procesamiento del compactador
    console.log('5. Simulando procesamiento del compactador...');
    
    // 5.1. Tomar snapshot del buffer
    const bufferSnapshot = bufferService.takeSnapshot();
    console.log('   📦 Buffer snapshot:', bufferSnapshot.size, 'dispositivos');

    // 5.2. Procesar métricas del dispositivo específico
    const deviceMetrics = bufferSnapshot.get(testDeviceId);
    if (!deviceMetrics) {
      console.error('   ❌ Error: No se encontraron métricas para el dispositivo');
      return;
    }

    console.log('   📊 Procesando', deviceMetrics.length, 'métricas para el dispositivo');

    // 5.3. Separar métricas por tipo
    const timeSeriesMetrics = [];
    const stateMetrics = [];
    const ignoredMetrics = [];

    for (const metric of deviceMetrics) {
      const classification = classifyMetric(normalizedData.deviceType, metric.metricName);
      
      switch (classification) {
        case 'timeseries':
          timeSeriesMetrics.push(metric);
          break;
        case 'state':
          stateMetrics.push({
            stateName: metric.metricName,
            stateValue: metric.value,
            stateType: typeof metric.value === 'boolean' ? 'boolean' : 
                      typeof metric.value === 'number' ? 'numeric' :
                      typeof metric.value === 'object' ? 'json' : 'string'
          });
          break;
        case 'ignored':
          ignoredMetrics.push(metric);
          break;
      }
    }

    console.log('   📈 Series temporales:', timeSeriesMetrics.length);
    console.log('   🏷️  Estados:', stateMetrics.length);
    console.log('   🚫 Ignoradas:', ignoredMetrics.length);

    // 6. Probar actualización de estados
    if (stateMetrics.length > 0) {
      console.log('\n6. Probando actualización de estados...');
      
      try {
        const results = await deviceStateService.updateMultipleDeviceStates(testDeviceUuid, stateMetrics);
        console.log('   ✅ Estados actualizados:', results.length, 'procesados');
        
        // Mostrar resultados detallados
        for (const result of results) {
          if (result.skipped) {
            console.log(`      - ${result.stateName}: OMITIDO (sin cambios)`);
          } else {
            console.log(`      - ${result.stateName}: ${result.is_new ? 'CREADO' : 'ACTUALIZADO'}`);
          }
        }
      } catch (error) {
        console.error('   ❌ Error actualizando estados:', error.message);
      }
    }

    // 7. Verificar estados guardados
    console.log('\n7. Verificando estados guardados...');
    try {
      const savedStates = await deviceStateService.getDeviceStates(testDeviceUuid);
      console.log('   ✅ Estados recuperados:', Object.keys(savedStates).length);
      
      // Mostrar algunos estados importantes
      const importantStates = ['status_switch:0_output', 'status_wifi_sta_ip', 'status_switch:0_apower'];
      for (const stateName of importantStates) {
        if (savedStates[stateName]) {
          console.log(`      - ${stateName}: ${savedStates[stateName].value} (${savedStates[stateName].type})`);
        }
      }
    } catch (error) {
      console.error('   ❌ Error recuperando estados:', error.message);
    }

    // 8. Limpiar datos de prueba
    console.log('\n8. Limpiando datos de prueba...');
    await database.query('DELETE FROM device_states WHERE device_id = $1', [testDeviceUuid]);
    console.log('   ✅ Datos de prueba eliminados');

    console.log('\n🎉 Test completado exitosamente!');

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
  testMqttFlow().catch((error) => {
    console.error('Error fatal:', error);
    process.exit(1);
  });
}

module.exports = testMqttFlow;
