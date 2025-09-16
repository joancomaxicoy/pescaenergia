/**
 * Script simple para probar SSE sin autenticación
 */

const express = require('express');
const app = express();

// Endpoint SSE simple sin autenticación para testing
app.get('/test-sse', (req, res) => {
    console.log('📡 Nueva conexión SSE de prueba');
    
    // Configurar headers para SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');
    
    // Enviar status 200
    res.status(200);
    
    console.log('✅ Headers configurados');

    // Función para enviar la hora actual
    const sendTime = () => {
        try {
            const currentTime = new Date().toISOString();
            const data = `data: ${currentTime}\n\n`;
            res.write(data);
            console.log('📤 Enviado:', currentTime);
        } catch (error) {
            console.error('❌ Error enviando:', error);
            clearInterval(timeInterval);
        }
    };

    // Enviar hora inicial inmediatamente
    sendTime();

    // Configurar timer para enviar hora cada segundo
    const timeInterval = setInterval(sendTime, 1000);

    // Manejar desconexión del cliente
    req.on('close', () => {
        clearInterval(timeInterval);
        console.log('🔌 Cliente desconectado');
    });

    req.on('error', (error) => {
        clearInterval(timeInterval);
        console.error('❌ Error de conexión:', error);
    });
});

// Página de prueba
app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Test SSE</title>
        </head>
        <body>
            <h1>Test SSE Simple</h1>
            <div id="messages"></div>
            <script>
                console.log('🚀 Iniciando test SSE...');
                const eventSource = new EventSource('/test-sse');
                
                eventSource.onopen = function(event) {
                    console.log('✅ Conexión SSE abierta');
                    document.getElementById('messages').innerHTML += '<p>✅ Conexión abierta</p>';
                };
                
                eventSource.onmessage = function(event) {
                    console.log('⏰ Mensaje recibido:', event.data);
                    document.getElementById('messages').innerHTML += '<p>⏰ ' + event.data + '</p>';
                };
                
                eventSource.onerror = function(event) {
                    console.error('❌ Error SSE:', event);
                    document.getElementById('messages').innerHTML += '<p>❌ Error en conexión</p>';
                };
            </script>
        </body>
        </html>
    `);
});

const PORT = 3001;
app.listen(PORT, () => {
    console.log(`🚀 Servidor de prueba SSE ejecutándose en http://localhost:${PORT}`);
    console.log('📋 Para probar:');
    console.log('   1. Ve a http://localhost:3001 en el navegador');
    console.log('   2. Abre DevTools (F12)');
    console.log('   3. Deberías ver mensajes cada segundo');
    console.log('   4. Si funciona, el problema está en la autenticación del endpoint principal');
});
