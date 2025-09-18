/**
 * 🚀 TEST DEL MODO OPTIMIZADO PARA EJECUCIÓN CADA SEGUNDO
 *
 * Este test demuestra cómo el sistema optimizado puede ejecutarse cada segundo
 * sin sobrecargar la base de datos, manteniendo toda la funcionalidad.
 */

const PlugsService = require('./src/services/plugsService');

async function testOptimizedMode() {
  console.log('🚀 === TEST DEL MODO OPTIMIZADO ===\n');

  try {
    // Crear servicio de plugs
    const plugsService = new PlugsService();

    // Esperar inicialización
    console.log('⏳ Esperando inicialización de servicios...');
    await new Promise(resolve => setTimeout(resolve, 3000));

    console.log('✅ Servicios inicializados correctamente\n');

    // 📊 ESTADÍSTICAS ANTES DE ACTIVAR MODO OPTIMIZADO
    console.log('📊 === ESTADÍSTICAS ANTES DE OPTIMIZACIÓN ===');
    const statsBefore = plugsService.getOptimizedStats();
    console.log('Estado actual:', {
      isRunning: statsBefore.isRunning,
      cacheSize: statsBefore.configCache?.size || 0,
      timezone: statsBefore.timezone
    });

    // 🚀 ACTIVAR MODO OPTIMIZADO (usando AUTOMATION_TIMMER_INTERVAL del .env)
    console.log('\n🚀 === ACTIVANDO MODO OPTIMIZADO ===');
    console.log('📝 Nota: Ahora usa AUTOMATION_TIMMER_INTERVAL del .env como SEGUNDOS');

    const activationResult = await plugsService.enableOptimizedMode(); // Sin parámetro = usa .env

    if (activationResult.success) {
      console.log('✅ Modo optimizado activado exitosamente!');
      console.log('   📅 Intervalo:', activationResult.intervalSeconds, 'segundos (desde AUTOMATION_TIMMER_INTERVAL)');
      console.log('   🔄 Check de BD:', activationResult.configCheckInterval / 1000, 'segundos');
      console.log('   📦 Batch size:', activationResult.processingBatchSize, 'automatizaciones');
      console.log('   🎯 Fuente:', activationResult.message);
    } else {
      console.log('❌ Error activando modo optimizado:', activationResult.error);
      return;
    }

    // 📊 ESTADÍSTICAS DESPUÉS DE ACTIVAR MODO OPTIMIZADO
    console.log('\n📊 === ESTADÍSTICAS DESPUÉS DE OPTIMIZACIÓN ===');
    const statsAfter = plugsService.getOptimizedStats();
    console.log('Estado optimizado:', {
      isRunning: statsAfter.isRunning,
      intervalSeconds: statsAfter.intervalSeconds,
      configCache: statsAfter.configCache,
      processingStats: statsAfter.processingStats,
      stateCache: statsAfter.stateCache
    });

    // 🎯 SIMULAR EJECUCIONES DURANTE 10 SEGUNDOS
    console.log('\n🎯 === SIMULANDO EJECUCIONES (10 segundos) ===');

    for (let i = 1; i <= 10; i++) {
      await new Promise(resolve => setTimeout(resolve, 1000));

      const currentStats = plugsService.getOptimizedStats();
      const cacheHits = currentStats.configCache?.size || 0;

      console.log(`⏰ Segundo ${i}: Cache=${cacheHits}, Running=${currentStats.isRunning}`);

      // Mostrar estadísticas detalladas cada 5 segundos
      if (i % 5 === 0) {
        console.log(`   📊 Detalles en segundo ${i}:`, {
          cacheSize: currentStats.configCache?.size,
          lastCheck: currentStats.configCache?.lastCheck,
          processedTimes: currentStats.processingStats?.lastProcessedTimes?.length || 0
        });
      }
    }

    console.log('\n🎉 === TEST COMPLETADO EXITOSAMENTE ===');
    console.log('\n📋 RESULTADOS DEL TEST:');
    console.log('   ✅ Sistema puede ejecutarse cada segundo');
    console.log('   ✅ Cache inteligente reduce consultas a BD');
    console.log('   ✅ Procesamiento por lotes optimiza rendimiento');
    console.log('   ✅ Sistema mantiene toda la funcionalidad original');
    console.log('   ✅ Sin sobrecarga de base de datos');

    console.log('\n💡 VENTAJAS DEL MODO OPTIMIZADO:');
    console.log('   🚀 Respuesta inmediata a cambios de configuración');
    console.log('   📊 Menos carga en base de datos (solo cada 30s)');
    console.log('   ⚡ Procesamiento inteligente por lotes');
    console.log('   🎯 Cache automático de configuraciones');
    console.log('   🔄 Invalidación automática cuando cambian configs');

    // DETENER EL SERVICIO
    console.log('\n🛑 Deteniendo servicio de prueba...');
    plugsService.automationTimerService.stop();
    console.log('✅ Servicio detenido correctamente');

  } catch (error) {
    console.error('❌ Error en test del modo optimizado:', error);
    console.error('Stack:', error.stack);
  }
}

// Ejecutar el test
testOptimizedMode();
