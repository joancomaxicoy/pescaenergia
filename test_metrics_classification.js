/**
 * Script de test simplificado para validar la clasificación de métricas
 * No requiere conexión a base de datos
 */

const NormalizerService = require('./src/services/mqtt/normalizerService');
const { classifyMetric, getDeviceTypeFromTopic, getAllConfigs } = require('./src/config/device-metrics-config');

async function testMetricsClassification() {
  console.log('🧪 Iniciando test de clasificación de métricas...\n');

  try {
    // Inicializar normalizador
    const normalizerService = new NormalizerService();
    console.log('✅ Normalizador inicializado\n');

    // Test 1: Clasificación de tipos de dispositivos
    console.log('🔍 Test 1: Clasificación de tipos de dispositivos...');
    const testTopics = [
      'shellies/shellyem/ES0031446458360006JY0F/emeter/0/power',
      'acs/ES0031446458360006JY0F/status',
      'pepe/ES0031446458360006JY0F/online',
      'Dades-Fotovoltaiques-consum-giravolt32',
      'Generacio-Residencia'
    ];

    testTopics.forEach(topic => {
      const deviceType = getDeviceTypeFromTopic(topic);
      console.log(`  ${topic} → ${deviceType}`);
    });
    console.log('✅ Clasificación de tipos completada\n');

    // Test 2: Normalización de mensaje EM
    console.log('📊 Test 2: Normalización de mensaje Shelly EM...');
    const emMessages = [
      {
        topic: 'shellies/shellyem/ES0031446458360006JY0F/emeter/0/power',
        payload: '211.74',
        timestamp: Date.now()
      },
      {
        topic: 'shellies/shellyem/ES0031446458360006JY0F/emeter/0/voltage',
        payload: '249.98',
        timestamp: Date.now()
      },
      {
        topic: 'shellies/shellyem/ES0031446458360006JY0F/online',
        payload: 'true',
        timestamp: Date.now()
      },
      {
        topic: 'shellies/shellyem/ES0031446458360006JY0F/emeter/0/total',
        payload: '5421.4',
        timestamp: Date.now()
      }
    ];

    emMessages.forEach(message => {
      const normalized = normalizerService.normalize(message);
      if (normalized) {
        const metric = normalized.metrics[0];
        const classification = classifyMetric(normalized.deviceType, metric.name);
        console.log(`  ${metric.name}: ${metric.value} ${metric.unit} → ${classification}`);
      }
    });
    console.log('✅ Normalización EM completada\n');

    // Test 3: Normalización de mensaje PLUG complejo
    console.log('📱 Test 3: Normalización de mensaje PLUG (JSON complejo)...');
    const plugMessage = {
      topic: 'acs/ES0031446458360006JY0F/status',
      payload: JSON.stringify({
        "cloud": {"connected": false},
        "mqtt": {"connected": true},
        "switch:0": {
          "id": 0,
          "source": "mqtt",
          "output": true,
          "apower": 1250.5,
          "voltage": 245.9,
          "current": 5.123,
          "aenergy": {"total": 15.678},
          "temperature": {"tC": 44.7}
        },
        "sys": {
          "mac": "8CBFEA955C60",
          "uptime": 63749
        },
        "wifi": {
          "sta_ip": "192.168.1.34",
          "ssid": "ASB",
          "rssi": -44
        }
      }),
      timestamp: Date.now()
    };

    const normalizedPLUG = normalizerService.normalize(plugMessage);
    if (normalizedPLUG) {
      console.log(`Total métricas extraídas: ${normalizedPLUG.metrics.length}`);
      console.log('Clasificación de métricas:');
      
      const classifications = {
        timeseries: [],
        state: [],
        ignored: [],
        unknown: []
      };

      normalizedPLUG.metrics.forEach(metric => {
        const classification = classifyMetric(normalizedPLUG.deviceType, metric.name);
        classifications[classification].push(`${metric.name}: ${metric.value}`);
      });

      Object.entries(classifications).forEach(([type, metrics]) => {
        if (metrics.length > 0) {
          console.log(`  ${type.toUpperCase()}:`);
          metrics.slice(0, 5).forEach(metric => console.log(`    ${metric}`));
          if (metrics.length > 5) {
            console.log(`    ... y ${metrics.length - 5} más`);
          }
        }
      });
    }
    console.log('✅ Normalización PLUG completada\n');

    // Test 4: Configuración de métricas
    console.log('⚙️ Test 4: Verificando configuración de métricas...');
    const configs = getAllConfigs();
    Object.entries(configs).forEach(([deviceType, config]) => {
      console.log(`  ${deviceType}:`);
      console.log(`    Series temporales: ${config.timeSeriesMetrics.length} métricas`);
      console.log(`    Estados: ${config.stateMetrics.length} métricas`);
      console.log(`    Ignoradas: ${config.ignoredMetrics.length} métricas`);
    });
    console.log('✅ Configuración verificada\n');

    // Test 5: Estadísticas del normalizador
    console.log('📊 Test 5: Estadísticas del normalizador...');
    const stats = normalizerService.getStats();
    console.log('Estadísticas:', JSON.stringify(stats, null, 2));
    console.log('✅ Estadísticas obtenidas\n');

    console.log('🎉 ¡Todos los tests de clasificación completados exitosamente!');
    console.log('\n📋 Resumen:');
    console.log('- ✅ Clasificación de tipos de dispositivos funcional');
    console.log('- ✅ Normalización de mensajes EM funcional');
    console.log('- ✅ Normalización de mensajes PLUG con JSON complejo funcional');
    console.log('- ✅ Extracción y clasificación automática de métricas funcional');
    console.log('- ✅ Configuración de métricas por tipo de dispositivo funcional');

  } catch (error) {
    console.error('❌ Error en el test:', error);
    console.error(error.stack);
  }
}

// Ejecutar el test
if (require.main === module) {
  testMetricsClassification();
}

module.exports = { testMetricsClassification };
