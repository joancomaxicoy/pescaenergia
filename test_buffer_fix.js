const logger = require('./src/utils/logger');
const database = require('./src/utils/database');
const MqttDataService = require('./src/services/mqtt/mqttDataService');

async function testBufferFix() {
  console.log('🧪 Probando corrección del BufferService...\n');

  try {
    // Configurar database singleton
    await database.connect();

    // Crear instancia del servicio
    const mqttDataService = new MqttDataService();
    await mqttDataService.initialize();

    console.log('✅ MqttDataService inicializado correctamente\n');

    // Simular mensaje MQTT que causaba el error
    const testMessage = {
      topic: 'shellies/shellyem-ES0031446458360006JY0F/emeter/0/power',
      payload: '49.32',
      timestamp: new Date()
    };

    console.log('📨 Simulando mensaje MQTT que causaba error...');
    console.log('Topic:', testMessage.topic);
    console.log('Payload:', testMessage.payload);

    // Procesar el mensaje
    const startTime = Date.now();
    await mqttDataService.handleMqttMessage(testMessage);
    const processingTime = Date.now() - startTime;

    console.log(`\n⏱️  Mensaje procesado en ${processingTime}ms`);

    // Verificar estadísticas
    const stats = mqttDataService.getStatsSummary();
    console.log('\n📊 Estadísticas del sistema:');
    console.log('- Mensajes procesados:', stats.coordinator.messagesProcessed);
    console.log('- Estados procesados inmediatamente:', stats.coordinator.statesProcessedImmediately);
    console.log('- Series temporales al buffer:', stats.coordinator.timeSeriesBuffered);
    console.log('- Errores:', stats.coordinator.errors);

    if (stats.coordinator.errors === 0) {
      console.log('\n✅ ¡ÉXITO! No hay errores de "addMetrics is not a function"');
    } else {
      console.log('\n❌ Aún hay errores:', stats.coordinator.lastError);
    }

    // Verificar buffer
    const bufferInfo = mqttDataService.getBufferInfo();
    console.log('\n📦 Estado del buffer:');
    console.log('- Dispositivos únicos:', bufferInfo.currentUniqueDevices);
    console.log('- Métricas en buffer:', bufferInfo.currentBufferSize);

    // Simular otro mensaje para verificar flujo dual
    const testMessage2 = {
      topic: 'shellies/shellyplusplugs-ABC123/status/switch:0',
      payload: JSON.stringify({
        id: 0,
        output: true,
        apower: 58.0,
        voltage: 240.7
      }),
      timestamp: new Date()
    };

    console.log('\n📨 Simulando segundo mensaje (estado + series temporales)...');
    await mqttDataService.handleMqttMessage(testMessage2);

    const finalStats = mqttDataService.getStatsSummary();
    console.log('\n📊 Estadísticas finales:');
    console.log('- Mensajes procesados:', finalStats.coordinator.messagesProcessed);
    console.log('- Estados procesados inmediatamente:', finalStats.coordinator.statesProcessedImmediately);
    console.log('- Series temporales al buffer:', finalStats.coordinator.timeSeriesBuffered);
    console.log('- Errores:', finalStats.coordinator.errors);

    if (finalStats.coordinator.errors === 0) {
      console.log('\n🎉 ¡CORRECCIÓN EXITOSA! El sistema funciona sin errores');
      console.log('✅ Estados se procesan inmediatamente');
      console.log('✅ Series temporales van al buffer correctamente');
    } else {
      console.log('\n❌ Aún hay errores que resolver');
    }

  } catch (error) {
    console.error('\n❌ Error en la prueba:', error.message);
    console.error('Stack:', error.stack);
  } finally {
    await database.close();
    console.log('\n🔌 Conexión a base de datos cerrada');
  }
}

// Ejecutar la prueba
testBufferFix().catch(console.error);
