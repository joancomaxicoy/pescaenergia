/**
 * Script de debug para probar el endpoint SSE directamente
 */

const http = require('http');

console.log('🔍 Debug del endpoint SSE...\n');

// Primero, probar el endpoint sin token para ver qué responde
console.log('1. Probando endpoint sin token...');
const optionsNoToken = {
    hostname: 'localhost',
    port: 3000,
    path: '/api/sse/time',
    method: 'GET',
    headers: {
        'Accept': 'text/event-stream',
        'Cache-Control': 'no-cache'
    }
};

const reqNoToken = http.request(optionsNoToken, (res) => {
    console.log(`   Status: ${res.statusCode}`);
    console.log(`   Headers:`, res.headers);
    
    res.on('data', (chunk) => {
        console.log(`   Response: ${chunk.toString()}`);
    });
    
    res.on('end', () => {
        console.log('   Conexión terminada\n');
        
        // Ahora probar con un token falso
        console.log('2. Probando endpoint con token falso...');
        const optionsFakeToken = {
            hostname: 'localhost',
            port: 3000,
            path: '/api/sse/time?token=fake-token-123',
            method: 'GET',
            headers: {
                'Accept': 'text/event-stream',
                'Cache-Control': 'no-cache'
            }
        };

        const reqFakeToken = http.request(optionsFakeToken, (res) => {
            console.log(`   Status: ${res.statusCode}`);
            console.log(`   Headers:`, res.headers);
            
            res.on('data', (chunk) => {
                console.log(`   Response: ${chunk.toString()}`);
            });
            
            res.on('end', () => {
                console.log('   Conexión terminada\n');
                console.log('✅ Debug completado');
                console.log('\n📋 Instrucciones para debug manual:');
                console.log('1. Ve a /area-usuari/endolls en el navegador');
                console.log('2. Abre DevTools (F12)');
                console.log('3. Ve a Network tab');
                console.log('4. Filtra por "sse" o "time"');
                console.log('5. Recarga la página');
                console.log('6. Verifica si aparece la petición a /api/sse/time');
                console.log('7. Revisa el status code y response');
                console.log('\n🔍 También revisa la consola del navegador para logs del cliente');
            });
        });

        reqFakeToken.on('error', (error) => {
            console.log(`   Error: ${error.message}`);
        });

        reqFakeToken.end();
    });
});

reqNoToken.on('error', (error) => {
    console.log(`   Error: ${error.message}`);
});

reqNoToken.end();
