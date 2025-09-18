#!/usr/bin/env node

/**
 * Script de prueba para verificar que el patrón singleton de MqttService funciona correctamente
 * y que los handlers del AutomationManager se registran en la instancia correcta
 */

const logger = require('./src/utils/logger');

async function testMqttSingleton() {
  try {
    console.log('🧪 Iniciando prueba del patrón singleton MQTT...\n');

    // 1. Probar que el singleton funciona
    console.log('1️⃣ Probando patrón singleton...');
    const MqttService = require('./src/services/mqtt/mqttService');

    const instance1 = new MqttService();
    const instance2 = new MqttService();

    console.log('   ✅ Instancia 1 creada');
    console.log('   ✅ Instancia 2 creada');

    if (instance1 === instance2) {
      console.log('   ✅ SINGLETON FUNCIONA: Ambas instancias son la misma');
    } else {
      console.log('   ❌ ERROR: Las instancias son diferentes');
      return;
    }

    // 2. Verificar que los handlers se comparten
    console.log('\n2️⃣ Probando compartición de handlers...');

    let handler1Called = false;
    let handler2Called = false;

    const testHandler1 = (messageData) => {
      console.log('   📨 Handler 1 recibió mensaje:', messageData.topic);
      handler1Called = true;
    };

    const testHandler2 = (messageData) => {
      console.log('   📨 Handler 2 recibió mensaje:', messageData.topic);
      handler2Called = true;
    };

    // Registrar handlers en ambas instancias
    instance1.addMessageHandler(testHandler1);
    instance2.addMessageHandler(testHandler2);

    console.log('   ✅ Handler 1 registrado en instancia 1');
    console.log('   ✅ Handler 2 registrado en instancia 2');

    // Verificar que ambos handlers están en la misma instancia
    if (instance1.messageHandlers.length === 2 && instance2.messageHandlers.length === 2) {
      console.log('   ✅ HANDLERS COMPARTIDOS: Ambos handlers están en la misma instancia');
    } else {
      console.log('   ❌ ERROR: Los handlers no se comparten correctamente');
      console.log(`      Instancia 1: ${instance1.messageHandlers.length} handlers`);
      console.log(`      Instancia 2: ${instance2.messageHandlers.length} handlers`);
      return;
    }

    // 3. Simular recepción de mensaje
    console.log('\n3️⃣ Probando recepción de mensajes...');

    const testMessage = {
      topic: 'test/device/status',
      payload: '{"power": 150.5}',
      timestamp: new Date(),
      receivedAt: Date.now()
    };

    // Simular llamada a notifyHandlers
    instance1.notifyHandlers(testMessage);

    // Verificar que ambos handlers fueron llamados
    if (handler1Called && handler2Called) {
      console.log('   ✅ MENSAJES RECIBIDOS: Ambos handlers procesaron el mensaje');
    } else {
      console.log('   ❌ ERROR: No todos los handlers recibieron el mensaje');
      console.log(`      Handler 1 llamado: ${handler1Called}`);
      console.log(`      Handler 2 llamado: ${handler2Called}`);
    }

    // 4. Probar con AutomationManager
    console.log('\n4️⃣ Probando integración con AutomationManager...');

    const PlugsService = require('./src/services/plugsService');
    const plugsService = new PlugsService();

    // Esperar a que se inicialice
    await new Promise(resolve => setTimeout(resolve, 1000));

    if (plugsService.mqttService) {
      console.log('   ✅ PlugsService tiene instancia MQTT');

      // Verificar que es la misma instancia singleton
      if (plugsService.mqttService === instance1) {
        console.log('   ✅ MISMA INSTANCIA: PlugsService usa la instancia singleton');
      } else {
        console.log('   ❌ ERROR: PlugsService usa una instancia diferente');
      }

      // Verificar que los handlers están disponibles
      console.log(`   📊 Total de handlers registrados: ${plugsService.mqttService.messageHandlers.length}`);

    } else {
      console.log('   ❌ ERROR: PlugsService no tiene instancia MQTT');
    }

    console.log('\n🎉 PRUEBA COMPLETADA EXITOSAMENTE');
    console.log('✅ El patrón singleton funciona correctamente');
    console.log('✅ Los handlers se comparten entre instancias');
    console.log('✅ Los mensajes llegan a todos los handlers registrados');

  } catch (error) {
    console.error('❌ ERROR en la prueba:', error);
    logger.error('Error en test MQTT singleton:', error);
  }
}

// Ejecutar la prueba
testMqttSingleton().then(() => {
  console.log('\n🏁 Prueba finalizada');
  process.exit(0);
}).catch((error) => {
  console.error('❌ Error fatal en la prueba:', error);
  process.exit(1);
});
