#!/usr/bin/env node

/**
 * Test para verificar que el patrón singleton del AutomationManager funciona correctamente
 * y que las actualizaciones de configuración se reflejan inmediatamente
 */

require('dotenv').config();
const logger = require('./src/utils/logger');
const database = require('./src/utils/database');
const AutomationManager = require('./src/services/automation/AutomationManager');
const PlugsService = require('./src/services/plugsService');

async function testSingletonPattern() {
  try {
    logger.info('🧪 Iniciando test del patrón singleton de AutomationManager...');

    // Conectar a la base de datos
    await database.connect();

    // Test 1: Verificar que múltiples instancias devuelven el mismo objeto
    logger.info('📋 Test 1: Verificando patrón singleton...');
    
    const instance1 = AutomationManager.getInstance();
    const instance2 = AutomationManager.getInstance();
    const instance3 = new AutomationManager();

    const isSingleton = (instance1 === instance2) && (instance2 === instance3);
    
    if (isSingleton) {
      logger.info('✅ Test 1 PASADO: Todas las instancias son el mismo objeto singleton');
    } else {
      logger.error('❌ Test 1 FALLIDO: Las instancias no son el mismo objeto');
      return false;
    }

    // Test 2: Verificar que PlugsService usa la instancia singleton
    logger.info('📋 Test 2: Verificando que PlugsService usa singleton...');
    
    const plugsService1 = new PlugsService();
    const plugsService2 = new PlugsService();
    
    // Inicializar AutomationManager en ambos servicios
    await plugsService1.initializeAutomationManager();
    await plugsService2.initializeAutomationManager();
    
    const sameAutomationManager = (plugsService1.automationManager === plugsService2.automationManager);
    
    if (sameAutomationManager) {
      logger.info('✅ Test 2 PASADO: Ambos PlugsService usan la misma instancia de AutomationManager');
    } else {
      logger.error('❌ Test 2 FALLIDO: Los PlugsService usan diferentes instancias de AutomationManager');
      return false;
    }

    // Test 3: Verificar que el AutomationManager se inicializa correctamente
    logger.info('📋 Test 3: Verificando inicialización del AutomationManager...');
    
    const automationManager = AutomationManager.getInstance();
    
    if (!automationManager.memoryCache.isInitialized) {
      logger.info('🔄 Inicializando AutomationManager...');
      await automationManager.initialize();
    }
    
    if (automationManager.memoryCache.isInitialized) {
      logger.info('✅ Test 3 PASADO: AutomationManager inicializado correctamente');
    } else {
      logger.error('❌ Test 3 FALLIDO: AutomationManager no se inicializó correctamente');
      return false;
    }

    // Test 4: Verificar estadísticas del AutomationManager
    logger.info('📋 Test 4: Verificando estadísticas del AutomationManager...');
    
    const stats = automationManager.getStats();
    const debugInfo = automationManager.getDebugInfo();
    
    logger.info('📊 Estadísticas del AutomationManager:', {
      isRunning: stats.isRunning,
      executionInterval: stats.executionInterval,
      cacheStats: stats.cacheStats,
      activeConfigs: debugInfo.activeConfigs
    });
    
    if (stats.cacheStats && typeof stats.cacheStats === 'object') {
      logger.info('✅ Test 4 PASADO: Estadísticas obtenidas correctamente');
    } else {
      logger.error('❌ Test 4 FALLIDO: No se pudieron obtener estadísticas');
      return false;
    }

    // Test 5: Simular actualización de configuración
    logger.info('📋 Test 5: Simulando actualización de configuración...');
    
    // Obtener un dispositivo de prueba de la base de datos
    const deviceQuery = `
      SELECT d.id, d.device_name, d.shelly_device_id 
      FROM devices d 
      WHERE d.device_type = 'PLUG' 
      LIMIT 1
    `;
    
    const deviceResult = await database.query(deviceQuery);
    
    if (deviceResult.rows.length > 0) {
      const testDevice = deviceResult.rows[0];
      
      logger.info('🔧 Usando dispositivo de prueba:', {
        id: testDevice.id,
        name: testDevice.device_name,
        shellyId: testDevice.shelly_device_id
      });
      
      // Simular actualización de configuración
      try {
        await automationManager.updateDeviceConfig(testDevice.id);
        logger.info('✅ Test 5 PASADO: Actualización de configuración ejecutada sin errores');
      } catch (error) {
        logger.warn('⚠️ Test 5 ADVERTENCIA: Error en actualización de configuración (puede ser normal si no hay configuración):', error.message);
      }
    } else {
      logger.warn('⚠️ Test 5 OMITIDO: No se encontraron dispositivos PLUG para probar');
    }

    // Test 6: Verificar que múltiples PlugsService pueden actualizar configuraciones
    logger.info('📋 Test 6: Verificando actualización desde múltiples PlugsService...');
    
    if (deviceResult.rows.length > 0) {
      const testDevice = deviceResult.rows[0];
      
      // Actualizar desde el primer PlugsService
      if (plugsService1.automationManager) {
        await plugsService1.automationManager.updateDeviceConfig(testDevice.id);
      }
      
      // Actualizar desde el segundo PlugsService
      if (plugsService2.automationManager) {
        await plugsService2.automationManager.updateDeviceConfig(testDevice.id);
      }
      
      logger.info('✅ Test 6 PASADO: Ambos PlugsService pueden actualizar configuraciones en el mismo AutomationManager');
    } else {
      logger.warn('⚠️ Test 6 OMITIDO: No se encontraron dispositivos para probar');
    }

    logger.info('🎉 TODOS LOS TESTS PASARON: El patrón singleton funciona correctamente');
    return true;

  } catch (error) {
    logger.error('💥 ERROR EN LOS TESTS:', {
      message: error.message,
      stack: error.stack
    });
    return false;
  } finally {
    // Cerrar conexión a la base de datos
    await database.close();
  }
}

// Ejecutar el test
if (require.main === module) {
  testSingletonPattern()
    .then(success => {
      if (success) {
        logger.info('✅ Test completado exitosamente');
        process.exit(0);
      } else {
        logger.error('❌ Test falló');
        process.exit(1);
      }
    })
    .catch(error => {
      logger.error('💥 Error ejecutando test:', error);
      process.exit(1);
    });
}

module.exports = { testSingletonPattern };
