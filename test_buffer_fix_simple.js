const logger = require('./src/utils/logger');
const NormalizerService = require('./src/services/mqtt/normalizerService');
const BufferService = require('./src/services/mqtt/bufferService');

async function testBufferFixSimple() {
  console.log('🧪 Probando corrección del BufferService (sin DB)...\n');

  try {
    // Crear servicios sin conexión a DB
    const normalizerService = new NormalizerService();
    const bufferService = new BufferService();

    console.log('✅ Servicios creados correctamente\n');

    // Simular mensaje MQTT que causaba el error
    const testMessage = {
      topic: 'shellies/shellyem-ES0031446458360006JY0F/emeter/0/power',
      payload: '49.32',
      timestamp: new Date()
    };

    console.log('📨 Simulando mensaje MQTT que causaba error...');
    console.log('Topic:', testMessage.topic);
    console.log('Payload:', testMessage.payload);

    // 1. Normalizar el mensaje
    const normalizedData = normalizerService.normalize(testMessage);
    console.log('\n📋 Datos normalizados:');
    console.log('- Device ID:', normalizedData.deviceId);
    console.log('- Device Type:', normalizedData.deviceType);
    console.log('- Tiene clasificación:', normalizedData.stateMetrics !== undefined);

    if (normalizedData.stateMetrics !== undefined && normalizedData.timeSeriesMetrics !== undefined) {
      console.log('- Estados:', normalizedData.stateMetrics.length);
      console.log('- Series temporales:', normalizedData.timeSeriesMetrics.length);

      // 2. Probar el método correcto del buffer
      if (normalizedData.timeSeriesMetrics.length > 0) {
        console.log('\n🔧 Probando BufferService.addData() con series temporales...');
        
        // Convertir métricas al formato esperado por el buffer
        const metricsForBuffer = normalizedData.timeSeriesMetrics.map(metric => ({
          name: metric.metricName,  // BufferService espera 'name', no 'metricName'
          value: metric.value,
          unit: metric.unit
        }));

        // Crear objeto normalizado para BufferService.addData()
        const bufferData = {
          deviceId: normalizedData.deviceId,
          deviceType: normalizedData.deviceType,
          timestamp: normalizedData.timestamp,
          metrics: metricsForBuffer
        };

        // ESTA ES LA LLAMADA QUE ANTES FALLABA
        bufferService.addData(bufferData);
        
        console.log('✅ BufferService.addData() ejecutado sin errores');
        
        // Verificar que los datos están en el buffer
        const bufferStats = bufferService.getStats();
        console.log('\n📦 Estado del buffer:');
        console.log('- Dispositivos únicos:', bufferStats.currentUniqueDevices);
        console.log('- Métricas en buffer:', bufferStats.currentBufferSize);
        console.log('- Mensajes totales:', bufferStats.totalMessages);
      }
    } else {
      console.log('\n📋 Datos en formato legacy (sin clasificación)');
      console.log('- Métricas:', normalizedData.metrics?.length || 0);
      
      if (normalizedData.metrics && normalizedData.metrics.length > 0) {
        console.log('\n🔧 Probando BufferService.addData() con formato legacy...');
        bufferService.addData(normalizedData);
        console.log('✅ BufferService.addData() ejecutado sin errores');
      }
    }

    // Probar con otro mensaje
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

    console.log('\n📨 Probando segundo mensaje...');
    const normalizedData2 = normalizerService.normalize(testMessage2);
    
    if (normalizedData2) {
      console.log('- Device ID:', normalizedData2.deviceId);
      console.log('- Tiene clasificación:', normalizedData2.stateMetrics !== undefined);
      
      if (normalizedData2.timeSeriesMetrics && normalizedData2.timeSeriesMetrics.length > 0) {
        const metricsForBuffer2 = normalizedData2.timeSeriesMetrics.map(metric => ({
          name: metric.metricName,
          value: metric.value,
          unit: metric.unit
        }));

        const bufferData2 = {
          deviceId: normalizedData2.deviceId,
          deviceType: normalizedData2.deviceType,
          timestamp: normalizedData2.timestamp,
          metrics: metricsForBuffer2
        };

        bufferService.addData(bufferData2);
        console.log('✅ Segundo mensaje procesado sin errores');
      }
    }

    // Estadísticas finales
    const finalStats = bufferService.getStats();
    console.log('\n📊 Estadísticas finales del buffer:');
    console.log('- Dispositivos únicos:', finalStats.currentUniqueDevices);
    console.log('- Métricas en buffer:', finalStats.currentBufferSize);
    console.log('- Mensajes totales:', finalStats.totalMessages);

    console.log('\n🎉 ¡CORRECCIÓN EXITOSA!');
    console.log('✅ No más errores de "addMetrics is not a function"');
    console.log('✅ BufferService.addData() funciona correctamente');
    console.log('✅ El flujo dual está operativo');

  } catch (error) {
    console.error('\n❌ Error en la prueba:', error.message);
    console.error('Stack:', error.stack);
    
    if (error.message.includes('addMetrics is not a function')) {
      console.error('\n🚨 ¡EL ERROR PERSISTE! Revisar la corrección');
    }
  }
}

// Ejecutar la prueba
testBufferFixSimple().catch(console.error);
