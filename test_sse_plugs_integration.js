/**
 * Script de prueba para verificar la integración SSE en plug-cards
 * Este script simula mensajes MQTT para probar el flujo completo
 */

const testSSEIntegration = () => {
    console.log('🧪 Iniciando prueba de integración SSE para plug-cards...');
    
    // Verificar que las clases están disponibles
    if (typeof SSEManager === 'undefined') {
        console.error('❌ SSEManager no está disponible');
        return;
    }
    
    if (typeof window.endollsManager === 'undefined') {
        console.error('❌ EndollsManager no está disponible');
        return;
    }
    
    console.log('✅ Clases disponibles');
    
    // Verificar estado inicial
    console.log('📊 Estado inicial del EndollsManager:');
    console.log('- SSE conectado:', window.endollsManager.isSSEConnected());
    console.log('- Estado conexión:', window.endollsManager.getSSEConnectionState());
    console.log('- Plug cards registrados:', window.endollsManager.plugCards.size);
    
    // Listar plug cards registrados
    if (window.endollsManager.plugCards.size > 0) {
        console.log('📋 Plug cards registrados:');
        window.endollsManager.plugCards.forEach((plugCard, shellyId) => {
            const plugData = JSON.parse(plugCard.getAttribute('plug-data'));
            console.log(`  - ${shellyId}: ${plugData.device_name}`);
        });
    }
    
    // Simular mensaje SSE si hay plug cards
    if (window.endollsManager.plugCards.size > 0) {
        const firstShellyId = Array.from(window.endollsManager.plugCards.keys())[0];
        const testMessage = {
            topic: `endoll1/${firstShellyId}/status/switch:0`,
            payload: JSON.stringify({
                id: 0,
                source: "mqtt",
                output: true,
                apower: 125.5,
                voltage: 238.2,
                freq: 50.0,
                current: 0.527,
                aenergy: {
                    total: 456.789,
                    by_minute: [125.5, 0.0, 0.0],
                    minute_ts: Math.floor(Date.now() / 1000)
                },
                temperature: {
                    tC: 42.1,
                    tF: 107.8
                }
            }),
            timestamp: new Date().toISOString(),
            receivedAt: Date.now()
        };
        
        console.log('🔄 Simulando mensaje SSE para:', firstShellyId);
        console.log('📨 Mensaje de prueba:', testMessage);
        
        // Simular el mensaje
        window.endollsManager.handleSSEMessage(testMessage);
        
        console.log('✅ Mensaje simulado enviado');
    } else {
        console.log('⚠️ No hay plug cards para probar');
    }
    
    console.log('🧪 Prueba de integración SSE completada');
};

// Función para probar la conexión SSE real
const testRealSSEConnection = () => {
    console.log('🌐 Probando conexión SSE real...');
    
    const testSSE = new SSEManager();
    testSSE.connect("/api/sse/plugs", (data) => {
        console.log('📡 Mensaje SSE real recibido:', data);
        
        // Si es un mensaje de conexión establecida
        if (data.type === 'connection_established') {
            console.log('🎉 Conexión SSE establecida exitosamente');
            console.log('📊 Dispositivos filtrados:', data.filterCount);
            
            // Desconectar después de 10 segundos
            setTimeout(() => {
                console.log('🔌 Desconectando SSE de prueba...');
                testSSE.disconnect();
                console.log('✅ SSE de prueba desconectado');
            }, 10000);
        }
    });
    
    console.log('⏳ Esperando mensajes SSE... (se desconectará automáticamente en 10 segundos)');
};

// Función para verificar el estado de los plug cards
const checkPlugCardsState = () => {
    console.log('🔍 Verificando estado de plug cards...');
    
    if (window.endollsManager.plugCards.size === 0) {
        console.log('⚠️ No hay plug cards cargados');
        return;
    }
    
    window.endollsManager.plugCards.forEach((plugCard, shellyId) => {
        const state = plugCard.getPlugState();
        console.log(`📊 ${shellyId}:`, state);
        
        // Verificar si tiene indicador de tiempo real activo
        const realtimeIndicator = plugCard.querySelector('#realtime-indicator');
        const isRealtimeVisible = realtimeIndicator && realtimeIndicator.style.display !== 'none';
        console.log(`  - Indicador tiempo real: ${isRealtimeVisible ? '✅ Visible' : '❌ Oculto'}`);
    });
};

// Hacer funciones disponibles globalmente para pruebas manuales
window.testSSEIntegration = testSSEIntegration;
window.testRealSSEConnection = testRealSSEConnection;
window.checkPlugCardsState = checkPlugCardsState;

// Ejecutar prueba automáticamente si hay plug cards
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
        if (window.endollsManager && window.endollsManager.plugCards.size > 0) {
            console.log('🚀 Ejecutando prueba automática de integración SSE...');
            testSSEIntegration();
        } else {
            console.log('ℹ️ No hay plug cards para probar automáticamente');
            console.log('💡 Funciones disponibles para pruebas manuales:');
            console.log('  - testSSEIntegration()');
            console.log('  - testRealSSEConnection()');
            console.log('  - checkPlugCardsState()');
        }
    }, 3000); // Esperar 3 segundos para que se carguen los plugs
});

console.log('🧪 Script de prueba SSE cargado');
