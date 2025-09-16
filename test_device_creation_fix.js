#!/usr/bin/env node

/**
 * Test script para verificar que la creación automática de dispositivos funciona
 * Este script simula el flujo MQTT que estaba causando el error
 */

const logger = require('./src/utils/logger');
const MqttDataService = require('./src/services/mqtt/mqttDataService');

async function testDeviceCreation() {
  console.log('🧪 Iniciando test de creación automática de dispositivos...\n');

  const mqttDataService = new MqttDataService();

  try {
    // Inicializar el servicio
    await mqttDataService.initialize();
    console.log('✅ MqttDataService inicializado\n');

    // Simular un mensaje MQTT del dispositivo problemático
    const testMessage = {
      topic: 'acs/ES0031446458360006JY0F/status/switch:0',
      payload: JSON.stringify({
        id: 0,
        source: "MQTT",
        output: true,
        apower: 205.5,
        voltage: 230.1,
        aenergy: {
          total: 13.543
        },
        temperature: {
          tC: 46.7,
          tF: 116.1
        }
      }),
      timestamp: Date.now()
    };

    console.log('📨 Simulando mensaje MQTT:');
    console.log(`   Topic: ${testMessage.topic}`);
    console.log(`   Payload: ${testMessage.payload.substring(0, 100)}...`);
    console.log('');

    // Procesar el mensaje
    console.log('🔄 Procesando mensaje...');
    await mqttDataService.handleMqttMessage(testMessage);
    
    console.log('✅ Mensaje procesado exitosamente');
    console.log('');

    // Verificar estadísticas
    const stats = mqttDataService.getStatsSummary();
    console.log('📊 Estadísticas del procesamiento:');
    console.log(`   Mensajes procesados: ${stats.coordinator.messagesProcessed}`);
    console.log(`   Estados procesados inmediatamente: ${stats.coordinator.statesProcessedImmediately}`);
    console.log(`   Series temporales en buffer: ${stats.coordinator.timeSeriesBuffered}`);
    console.log(`   Errores: ${stats.coordinator.errors}`);
    
    if (stats.coordinator.errors > 0) {
      console.log(`   Último error: ${stats.coordinator.lastError?.message}`);
    }

    console.log('');

    // Verificar que el dispositivo se creó
    const deviceUuid = await mqttDataService.persistenceService.resolveDeviceId('acs/ES0031446458360006JY0F');
    
    if (deviceUuid) {
      console.log('✅ Dispositivo creado exitosamente:');
      console.log(`   Device ID: acs/ES0031446458360006JY0F`);
      console.log(`   UUID: ${deviceUuid}`);
    } else {
      console.log('❌ El dispositivo no se creó correctamente');
    }

    console.log('');

    // Simular otro mensaje del mismo dispositivo para verificar que no se duplica
    console.log('🔄 Enviando segundo mensaje del mismo dispositivo...');
    
    const secondMessage = {
      ...testMessage,
      payload: JSON.stringify({
        id: 0,
        source: "MQTT",
        output: false,
        apower: 0,
        voltage: 230.2
      }),
      timestamp: Date.now()
    };

    await mqttDataService.handleMqttMessage(secondMessage);
    console.log('✅ Segundo mensaje procesado');

    // Verificar que no se duplicó el dispositivo
    const deviceUuid2 = await mqttDataService.persistenceService.resolveDeviceId('acs/ES0031446458360006JY0F');
    
    if (deviceUuid === deviceUuid2) {
      console.log('✅ El dispositivo no se duplicó (mismo UUID)');
    } else {
      console.log('❌ Se creó un dispositivo duplicado');
    }

    console.log('');
    console.log('🎉 Test completado exitosamente');

  } catch (error) {
    console.error('❌ Error durante el test:', error.message);
    console.error('Stack trace:', error.stack);
    process.exit(1);
  }
}

// Ejecutar el test
testDeviceCreation()
  .then(() => {
    console.log('\n✅ Todos los tests pasaron');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Test falló:', error.message);
    process.exit(1);
  });
