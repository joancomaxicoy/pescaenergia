/**
 * Script de prueba para verificar la implementación de SSE
 * Este script prueba tanto el endpoint del servidor como la funcionalidad del cliente
 */

const http = require('http');

console.log('🧪 Iniciando pruebas de SSE...\n');

// Test 1: Verificar que el endpoint SSE responde correctamente
function testSSEEndpoint() {
    return new Promise((resolve, reject) => {
        console.log('📡 Test 1: Verificando endpoint SSE...');
        
        const options = {
            hostname: 'localhost',
            port: 3000,
            path: '/api/sse/time',
            method: 'GET',
            headers: {
                'Accept': 'text/event-stream',
                'Cache-Control': 'no-cache'
            }
        };

        const req = http.request(options, (res) => {
            console.log(`   Status: ${res.statusCode}`);
            console.log(`   Headers:`, res.headers);
            
            if (res.statusCode === 200) {
                console.log('   ✅ Endpoint responde correctamente');
                
                let messageCount = 0;
                const maxMessages = 3; // Recibir solo 3 mensajes para la prueba
                
                res.on('data', (chunk) => {
                    const data = chunk.toString();
                    if (data.startsWith('data:')) {
                        messageCount++;
                        const timestamp = data.replace('data: ', '').trim();
                        console.log(`   📨 Mensaje ${messageCount}: ${timestamp}`);
                        
                        if (messageCount >= maxMessages) {
                            req.destroy(); // Cerrar conexión después de recibir suficientes mensajes
                            console.log('   ✅ Test completado - SSE funciona correctamente\n');
                            resolve(true);
                        }
                    }
                });
                
                res.on('error', (error) => {
                    console.log('   ❌ Error en la respuesta:', error.message);
                    reject(error);
                });
                
