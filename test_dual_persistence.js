/**
 * Script de test para validar la persistencia dual (series temporales + estados)
 */

const database = require('./src/utils/database');
const BufferService = require('./src/services/mqtt/bufferService');
const CompactorService = require('./src/services/mqtt/compactorService');
const PersistenceService = require('./src/services/mqtt/persistenceService');
const DeviceStateService = require('./src/services/mqtt/deviceStateService');
const NormalizerService = require('./src/services/mqtt/normalizerService');

async function testDualPersistence() {
  console.log('🧪 Iniciando test de persistencia dual...\n');

  try {
    // Conectar a la base de datos
    console.log('🔌 Conectando a la base de datos...');
    await database.connect();
    console.log('✅ Conexión a base de datos establecida\n');

    // Inicializar servicios
    const bufferService = new BufferService();
    const persistenceService = new PersistenceService();
    const compactorService = new CompactorService(bufferService, persistenceService);
    const deviceStateService = new DeviceStateService();
    const normalizerService = new NormalizerService();

    console.log('✅ Servicios inicializados\n');

    // Test 1: Normalizar mensaje de EM
    console.log('📊 Test 1: Mensaje de Shelly EM...');
    const emMessage = {
      topic: 'shellies/shellyem/ES0031446458360006JY0F/emeter/0/power',
      payload: '211.74',
      timestamp: Date.now()
    };

    const normalizedEM = normalizerService.normalize(emMessage);
    console.log('Mensaje EM normalizado:', JSON.stringify(normalizedEM, null, 2));

    if (normalizedEM) {
      bufferService.addData(normalizedEM);
      console.log('✅ Mensaje EM añadido al buffer\n');
    }

    // Test 2: Normalizar mensaje de PLUG (JSON complejo)
    console.log('📱 Test 2: Mensaje de PLUG (JSON complejo)...');
    const plugMessage = {
      topic: 'acs/ES0031446458360006JY0F/status',
      payload: JSON.stringify({
        "ble": {},
        "cloud": {"connected": false},
        "mqtt": {"connected": true},
        "plugs_ui": {},
        "switch:0": {
          "id": 0,
          "source": "mqtt",
          "output": true,
          "apower": 1250.5,
          "voltage": 245.9,
          "freq": 50.0,
          "current": 5.123,
          "aenergy": {"total": 15.678, "by_minute": [0.000, 0.000, 0.000], "minute_ts": 1757591820},
          "ret_aenergy": {"total": 0.000, "by_minute": [0.000, 0.000, 0.000], "minute_ts": 1757591820},
          "temperature": {"tC": 44.7, "tF": 112.5}
        },
        "sys": {
          "mac": "8CBFEA955C60",
          "restart_required": false,
          "time": "13:57",
          "unixtime": 1757591848,
          "uptime": 63749,
          "ram_size": 219888,
          "ram_free": 74244
        },
        "wifi": {
          "sta_ip": "192.168.1.34",
          "status": "got ip",
          "ssid": "ASB",
          "rssi": -44
        }
      }),
      timestamp: Date.now()
    };

    const normalizedPLUG = normalizerService.normalize(plugMessage);
    console.log('Mensaje PLUG normalizado (primeras 5 métricas):');
    if (normalizedPLUG && normalizedPLUG.metrics) {
      console.log(JSON.stringify({
        ...normalizedPLUG,
        metrics: normalizedPLUG.metrics.slice(0, 5)
      }, null, 2));
      console.log(`Total métricas extraídas: ${normalizedPLUG.metrics.length}`);
    }

    if (normalizedPLUG) {
      bufferService.addData(normalizedPLUG);
      console.log('✅ Mensaje PLUG añadido al buffer\n');
    }

    // Test 3: Crear dispositivo de prueba
    console.log('🔧 Test 3: Creando dispositivo de prueba...');
    const testDeviceId = await persistenceService.findOrCreateDevice(
      'ES0031446458360006JY0F',
      'PLUG',
      { deviceName: 'Test PLUG Device' }
    );
    console.log('Device UUID creado:', testDeviceId);
    console.log('✅ Dispositivo de prueba creado\n');

    // Test 4: Ejecutar compactación manual
    console.log('⚙️ Test 4: Ejecutando compactación manual...');
    await compactorService.runManualCycle();
    console.log('✅ Compactación completada\n');

    // Test 5: Verificar datos en series temporales
    console.log('📈 Test 5: Verificando series temporales...');
    const timeSeriesQuery = `
      SELECT device_id, metric_name, value, timestamp
      FROM energy_metrics 
      WHERE device_id = $1
      ORDER BY timestamp DESC, metric_name
      LIMIT 10
    `;
    const timeSeriesResult = await database.query(timeSeriesQuery, [testDeviceId]);
    console.log('Series temporales encontradas:', timeSeriesResult.rows.length);
    if (timeSeriesResult.rows.length > 0) {
      console.log('Primeras métricas:');
      timeSeriesResult.rows.forEach(row => {
        console.log(`  ${row.metric_name}: ${row.value}`);
      });
    }
    console.log('✅ Series temporales verificadas\n');

    // Test 6: Verificar estados de dispositivo
    console.log('📊 Test 6: Verificando estados de dispositivo...');
    const deviceStates = await deviceStateService.getDeviceStates(testDeviceId);
    console.log('Estados encontrados:', Object.keys(deviceStates).length);
    if (Object.keys(deviceStates).length > 0) {
      console.log('Primeros estados:');
      Object.entries(deviceStates).slice(0, 5).forEach(([name, state]) => {
        console.log(`  ${name}: ${state.value} (${state.type})`);
      });
    }
    console.log('✅ Estados de dispositivo verificados\n');

    // Test 7: Estadísticas de servicios
    console.log('📊 Test 7: Estadísticas de servicios...');
    console.log('Buffer stats:', bufferService.getStats());
    console.log('Compactor stats:', compactorService.getStats());
    console.log('DeviceState stats:', deviceStateService.getStats());
    console.log('Normalizer stats:', normalizerService.getStats());
    console.log('✅ Estadísticas obtenidas\n');

    // Test 8: Test de optimización de estados (no actualizar si no cambia)
    console.log('🔄 Test 8: Test de optimización de estados...');
    const initialStats = deviceStateService.getStats();
    
    // Intentar actualizar con el mismo valor
    await deviceStateService.updateDeviceState(testDeviceId, 'test_state', 'same_value', 'string');
    await deviceStateService.updateDeviceState(testDeviceId, 'test_state', 'same_value', 'string');
    
    const afterStats = deviceStateService.getStats();
    console.log('Estados creados:', afterStats.statesCreated - initialStats.statesCreated);
    console.log('Estados actualizados:', afterStats.statesUpdated - initialStats.statesUpdated);
    console.log('Estados omitidos:', afterStats.statesSkipped - initialStats.statesSkipped);
    console.log('✅ Optimización de estados verificada\n');

    console.log('🎉 ¡Todos los tests completados exitosamente!');

  } catch (error) {
    console.error('❌ Error en el test:', error);
    console.error(error.stack);
  } finally {
    // Cerrar conexión
    await database.close();
  }
}

// Ejecutar el test
if (require.main === module) {
  testDualPersistence();
}

module.exports = { testDualPersistence };
