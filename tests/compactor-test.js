/**
 * Script de prueba para el CompactorService
 * Este script simula datos MQTT y verifica el funcionamiento completo del sistema
 */

require('dotenv').config();
const logger = require('../src/utils/logger');
const database = require('../src/utils/database');
const MqttDataService = require('../src/services/mqtt/mqttDataService');

class CompactorTest {
  constructor() {
    this.mqttDataService = null;
    this.testPhysicalDevices = [
      'ES0031446450479001ZC0F',
      'ES0031446450479001ZC0G'
    ];
    this.testGenerators = [
      'giravolt',
      'residencia'
    ];
  }

  async initialize() {
    try {
      logger.info('Inicializando test del CompactorService...');

      // Conectar a la base de datos
      await database.connect();

      // Verificar que existen dispositivos de prueba
      await this.ensureTestDevices();

      // Inicializar el servicio de datos MQTT
      this.mqttDataService = new MqttDataService();
      await this.mqttDataService.initialize();
      await this.mqttDataService.start();

      // Configurar intervalo de compactación más rápido para testing
      this.mqttDataService.setCompactionInterval(10000); // 10 segundos

      logger.info('Test inicializado correctamente');

    } catch (error) {
      logger.error('Error inicializando test:', error);
      throw error;
    }
  }

  async ensureTestDevices() {
    logger.info('Verificando dispositivos físicos de prueba...');

    // Solo crear dispositivos físicos en la BD, los generadores se manejan automáticamente
    for (const deviceId of this.testPhysicalDevices) {
      try {
        const result = await database.query(
          'SELECT id FROM devices WHERE shelly_device_id = $1',
          [deviceId]
        );

        if (result.rows.length === 0) {
          logger.warn(`Dispositivo físico ${deviceId} no encontrado en BD. Creando dispositivo de prueba...`);
          
          // Crear un usuario de prueba si no existe
          const userResult = await database.query(
            'SELECT id FROM users WHERE cups = $1',
            ['TEST_CUPS_001']
          );

          let userId;
          if (userResult.rows.length === 0) {
            const newUser = await database.query(
              'INSERT INTO users (cups, correu, nom, contrasenya_hash) VALUES ($1, $2, $3, $4) RETURNING id',
              ['TEST_CUPS_001', 'test@test.com', 'Usuario Test', 'hash_test']
            );
            userId = newUser.rows[0].id;
            logger.info('Usuario de prueba creado');
          } else {
            userId = userResult.rows[0].id;
          }

          // Crear el dispositivo físico
          await database.query(
            'INSERT INTO devices (user_id, shelly_device_id, device_name, device_type) VALUES ($1, $2, $3, $4)',
            [userId, deviceId, `Dispositivo Test ${deviceId}`, 'TEST_DEVICE']
          );
          
          logger.info(`Dispositivo físico de prueba ${deviceId} creado`);
        } else {
          logger.info(`Dispositivo físico ${deviceId} encontrado en BD`);
        }
      } catch (error) {
        logger.error(`Error verificando dispositivo físico ${deviceId}:`, error);
      }
    }

    // Informar sobre los generadores (no necesitan estar en BD)
    logger.info('Generadores de energía configurados:', {
      generators: this.testGenerators,
      note: 'Los generadores se procesan automáticamente sin necesidad de registro en BD'
    });
  }

  async simulateData() {
    logger.info('Iniciando simulación de datos MQTT...');

    // Simular datos cada 2 segundos durante 1 minuto
    const simulationDuration = 60000; // 1 minuto
    const interval = 2000; // 2 segundos
    const iterations = simulationDuration / interval;

    for (let i = 0; i < iterations; i++) {
      await this.generateMockData();
      await this.sleep(interval);
      
      if (i % 5 === 0) {
        logger.info(`Simulación: ${i + 1}/${iterations} iteraciones completadas`);
      }
    }

    logger.info('Simulación de datos completada');
  }

  async generateMockData() {
    const timestamp = new Date();

    // Simular datos de dispositivos Shelly físicos
    for (const deviceId of this.testPhysicalDevices) {
      // Simular mensaje de potencia
      const powerMessage = {
        topic: `shellies/shellyem/${deviceId}/emeter/0/power`,
        payload: (Math.random() * 100 + 50).toFixed(2), // 50-150W
        timestamp,
        receivedAt: Date.now()
      };

      // Simular mensaje de voltaje
      const voltageMessage = {
        topic: `shellies/shellyem/${deviceId}/emeter/0/voltage`,
        payload: (Math.random() * 10 + 230).toFixed(1), // 230-240V
        timestamp,
        receivedAt: Date.now()
      };

      // Enviar al handler del servicio MQTT
      this.mqttDataService.handleMqttMessage(powerMessage);
      this.mqttDataService.handleMqttMessage(voltageMessage);
    }

    // Simular datos de generadores de energía
    for (const generatorId of this.testGenerators) {
      const generationMessage = {
        topic: `Dades-Fotovoltaiques-consum-${generatorId}`,
        payload: JSON.stringify({
          voltatge: (Math.random() * 10 + 230).toFixed(1),
          intensitat: (Math.random() * 15 + 5).toFixed(1),
          frequencia: 50.04,
          potenciaFotovoltaica: (Math.random() * 5 + 1).toFixed(3), // 1-6 kW
          e_total_fotovoltaica: Math.floor(Math.random() * 10000 + 50000),
          e_total_dia_fotovoltaica: (Math.random() * 50 + 10).toFixed(1)
        }),
        timestamp,
        receivedAt: Date.now()
      };

      this.mqttDataService.handleMqttMessage(generationMessage);
    }

    // Simular datos de CUPS
    const cupsMessage = {
      topic: 'ConsumCups/ES0031446450479001ZC0F',
      payload: JSON.stringify({
        voltatge_circutor: (Math.random() * 10 + 230).toFixed(1),
        intensitat_circutor: (Math.random() * 2 + 1).toFixed(1),
        frequencia_circutor: 50,
        potencia_circutor: (Math.random() * 0.5 + 0.2).toFixed(3) // kW
      }),
      timestamp,
      receivedAt: Date.now()
    };

    this.mqttDataService.handleMqttMessage(cupsMessage);
  }

  async showStats() {
    logger.info('=== ESTADÍSTICAS COMPLETAS ===');
    
    const stats = this.mqttDataService.getCompleteStats();
    
    logger.info('Global:', stats.global);
    logger.info('MQTT:', stats.mqtt);
    logger.info('Normalizer:', stats.normalizer);
    logger.info('Buffer:', stats.buffer);
    logger.info('Compactor:', stats.compactor);
    logger.info('Persistence:', stats.persistence);

    // Mostrar información del buffer
    const bufferInfo = this.mqttDataService.getBufferInfo();
    logger.info('Buffer Info:', bufferInfo);

    // Health check
    const health = await this.mqttDataService.healthCheck();
    logger.info('Health Check:', health);
  }

  async runManualCompaction() {
    logger.info('Ejecutando compactación manual...');
    await this.mqttDataService.runManualCompaction();
    logger.info('Compactación manual completada');
  }

  async verifyDatabaseData() {
    logger.info('Verificando datos en la base de datos...');

    try {
      // Contar registros en energy_metrics
      const countResult = await database.query(
        'SELECT COUNT(*) as total FROM energy_metrics WHERE timestamp >= NOW() - INTERVAL \'5 minutes\''
      );
      
      logger.info(`Registros en energy_metrics (últimos 5 min): ${countResult.rows[0].total}`);

      // Mostrar algunos registros de dispositivos físicos
      const physicalDevicesResult = await database.query(`
        SELECT 
          em.timestamp,
          d.device_name,
          em.metric_name,
          em.value
        FROM energy_metrics em
        JOIN devices d ON em.device_id = d.id
        WHERE em.timestamp >= NOW() - INTERVAL '5 minutes'
        ORDER BY em.timestamp DESC
        LIMIT 5
      `);

      logger.info('Registros de dispositivos físicos:');
      for (const row of physicalDevicesResult.rows) {
        logger.info(`  ${row.timestamp} | ${row.device_name} | ${row.metric_name} | ${row.value}`);
      }

      // Mostrar algunos registros de generadores
      const generatorsResult = await database.query(`
        SELECT 
          em.timestamp,
          em.device_id,
          em.metric_name,
          em.value
        FROM energy_metrics em
        WHERE em.device_id LIKE 'gen-%'
          AND em.timestamp >= NOW() - INTERVAL '5 minutes'
        ORDER BY em.timestamp DESC
        LIMIT 5
      `);

      logger.info('Registros de generadores de energía:');
      for (const row of generatorsResult.rows) {
        logger.info(`  ${row.timestamp} | ${row.device_id} | ${row.metric_name} | ${row.value}`);
      }

      // Estadísticas por dispositivos físicos
      const physicalStats = await database.query(`
        SELECT 
          d.device_name,
          COUNT(*) as total_metrics,
          COUNT(DISTINCT em.metric_name) as unique_metrics
        FROM energy_metrics em
        JOIN devices d ON em.device_id = d.id
        WHERE em.timestamp >= NOW() - INTERVAL '5 minutes'
        GROUP BY d.device_name
        ORDER BY total_metrics DESC
      `);

      logger.info('Estadísticas por dispositivos físicos:');
      for (const row of physicalStats.rows) {
        logger.info(`  ${row.device_name}: ${row.total_metrics} métricas, ${row.unique_metrics} tipos únicos`);
      }

      // Estadísticas por generadores
      const generatorStats = await database.query(`
        SELECT 
          em.device_id,
          COUNT(*) as total_metrics,
          COUNT(DISTINCT em.metric_name) as unique_metrics
        FROM energy_metrics em
        WHERE em.device_id LIKE 'gen-%'
          AND em.timestamp >= NOW() - INTERVAL '5 minutes'
        GROUP BY em.device_id
        ORDER BY total_metrics DESC
      `);

      logger.info('Estadísticas por generadores:');
      for (const row of generatorStats.rows) {
        logger.info(`  ${row.device_id}: ${row.total_metrics} métricas, ${row.unique_metrics} tipos únicos`);
      }

      // Resumen general
      const summaryResult = await database.query(`
        SELECT 
          CASE 
            WHEN device_id LIKE 'gen-%' THEN 'Generadores'
            ELSE 'Dispositivos Físicos'
          END as tipo,
          COUNT(*) as total_registros
        FROM energy_metrics 
        WHERE timestamp >= NOW() - INTERVAL '5 minutes'
        GROUP BY CASE WHEN device_id LIKE 'gen-%' THEN 'Generadores' ELSE 'Dispositivos Físicos' END
      `);

      logger.info('Resumen por tipo:');
      for (const row of summaryResult.rows) {
        logger.info(`  ${row.tipo}: ${row.total_registros} registros`);
      }

    } catch (error) {
      logger.error('Error verificando datos de BD:', error);
    }
  }

  async cleanup() {
    logger.info('Limpiando recursos del test...');

    try {
      if (this.mqttDataService) {
        await this.mqttDataService.stop();
      }

      await database.close();
      logger.info('Cleanup completado');

    } catch (error) {
      logger.error('Error en cleanup:', error);
    }
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async runFullTest() {
    try {
      await this.initialize();
      
      logger.info('=== INICIANDO TEST COMPLETO ===');
      
      // Mostrar estadísticas iniciales
      await this.showStats();
      
      // Simular datos
      await this.simulateData();
      
      // Esperar un poco para que se procesen los datos
      logger.info('Esperando procesamiento de datos...');
      await this.sleep(5000);
      
      // Ejecutar compactación manual
      await this.runManualCompaction();
      
      // Esperar un poco más
      await this.sleep(3000);
      
      // Mostrar estadísticas finales
      logger.info('=== ESTADÍSTICAS FINALES ===');
      await this.showStats();
      
      // Verificar datos en BD
      await this.verifyDatabaseData();
      
      logger.info('=== TEST COMPLETADO EXITOSAMENTE ===');

    } catch (error) {
      logger.error('Error en test:', error);
    } finally {
      await this.cleanup();
    }
  }
}

// Ejecutar el test si se llama directamente
if (require.main === module) {
  const test = new CompactorTest();
  test.runFullTest().catch(error => {
    logger.error('Error fatal en test:', error);
    process.exit(1);
  });
}

module.exports = CompactorTest;
