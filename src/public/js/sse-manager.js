/**
 * SSEManager - Gestor independiente de conexiones Server-Sent Events
 * Permite conectar a cualquier endpoint SSE con callbacks personalizados
 * Implementa patrón singleton por endpoint para reutilizar conexiones
 */
class SSEManager {
    // Registro estático de conexiones por endpoint
    static connections = new Map();

    constructor(endpoint) {
        this.endpoint = endpoint;
        this.callbacks = new Set();

        // Si no existe conexión para este endpoint, crearla
        if (!SSEManager.connections.has(endpoint)) {
            SSEManager.createConnection(endpoint);
        }

        // Registrar esta instancia en la conexión
        SSEManager.connections.get(endpoint).instances.add(this);
    }

    /**
     * Agrega un callback para recibir datos de este endpoint
     * @param {function} callback - Función que se ejecuta cuando se reciben datos
     * @param {*} reg - Parámetro opcional (mantenido por compatibilidad)
     */
    addCallback(callback, reg = null) {
        if (typeof callback !== 'function') {
            console.error('❌ SSEManager: El callback debe ser una función');
            return;
        }

        this.callbacks.add(callback);
        const connection = SSEManager.connections.get(this.endpoint);
        if (connection) {
            connection.callbacks.add(callback);
            console.log(`📝 SSEManager: Callback agregado para ${this.endpoint}. Total callbacks: ${connection.callbacks.size}`);
        }
    }

    /**
     * Remueve un callback específico
     * @param {function} callback - El callback a remover
     */
    removeCallback(callback) {
        this.callbacks.delete(callback);
        const connection = SSEManager.connections.get(this.endpoint);
        if (connection) {
            connection.callbacks.delete(callback);
            console.log(`🗑️ SSEManager: Callback removido para ${this.endpoint}. Total callbacks: ${connection.callbacks.size}`);
        }
    }

    /**
     * Remueve todos los callbacks de esta instancia
     */
    removeAllCallbacks() {
        const connection = SSEManager.connections.get(this.endpoint);
        if (connection) {
            this.callbacks.forEach(callback => {
                connection.callbacks.delete(callback);
            });
            this.callbacks.clear();
            console.log(`🗑️ SSEManager: Todos los callbacks removidos para ${this.endpoint}. Total callbacks restantes: ${connection.callbacks.size}`);
        }
    }

    /**
     * Crea una nueva conexión para un endpoint específico
     * @param {string} endpoint - El endpoint SSE
     */
    static createConnection(endpoint) {
        const connection = {
            eventSource: null,
            callbacks: new Set(),
            instances: new Set(),
            isConnected: false,
            reconnectAttempts: 0,
            maxReconnectAttempts: 5,
            reconnectDelay: 1000
        };

        SSEManager.connections.set(endpoint, connection);
        SSEManager.establishConnection(endpoint);
    }

    /**
     * Establece la conexión EventSource para un endpoint
     * @param {string} endpoint - El endpoint SSE
     */
    static establishConnection(endpoint) {
        const connection = SSEManager.connections.get(endpoint);
        if (!connection) return;

        try {
            console.log('🔌 SSEManager: Creando conexión para endpoint:', endpoint);
            connection.eventSource = new EventSource(endpoint, { withCredentials: true });

            // Evento cuando se recibe un mensaje
            connection.eventSource.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    console.log('📨 SSEManager: Datos recibidos de', endpoint, ':', data);

                    // Ejecutar todos los callbacks registrados para este endpoint
                    connection.callbacks.forEach(callback => {
                        if (typeof callback === 'function') {
                            try {
                                callback(data);
                            } catch (error) {
                                console.error('❌ SSEManager: Error ejecutando callback:', error);
                            }
                        }
                    });

                    connection.isConnected = true;
                    connection.reconnectAttempts = 0; // Reset contador de reconexión
                } catch (error) {
                    console.error('❌ SSEManager: Error procesando mensaje:', error);
                    console.log('📄 SSEManager: Datos brutos recibidos:', event.data);

                    // Si no es JSON válido, pasar los datos tal como están
                    connection.callbacks.forEach(callback => {
                        if (typeof callback === 'function') {
                            try {
                                callback(event.data);
                            } catch (error) {
                                console.error('❌ SSEManager: Error ejecutando callback con datos brutos:', error);
                            }
                        }
                    });
                }
            };

            // Evento cuando se abre la conexión
            connection.eventSource.onopen = (event) => {
                console.log('✅ SSEManager: Conexión establecida con', endpoint);
                console.log('📊 SSEManager: Estado de conexión:', connection.eventSource.readyState);
                connection.isConnected = true;
                connection.reconnectAttempts = 0;
            };

            // Evento cuando hay un error
            connection.eventSource.onerror = (event) => {
                console.error('❌ SSEManager: Error en conexión con', endpoint, ':', event);
                console.log('📊 SSEManager: Estado de conexión:', connection.eventSource.readyState);

                connection.isConnected = false;

                // Verificar el estado de la conexión
                if (connection.eventSource.readyState === EventSource.CLOSED) {
                    console.log('🔒 SSEManager: Conexión cerrada por el servidor');
                }

                // Intentar reconexión automática solo si no está cerrada permanentemente
                if (connection.reconnectAttempts < connection.maxReconnectAttempts && connection.eventSource.readyState !== EventSource.CLOSED) {
                    SSEManager.scheduleReconnect(endpoint);
                } else {
                    console.error('🚫 SSEManager: Máximo número de intentos de reconexión alcanzado o conexión cerrada');
                }
            };

        } catch (error) {
            console.error('❌ SSEManager: Error creando EventSource:', error);
        }
    }

    /**
     * Programa una reconexión automática para un endpoint
     * @param {string} endpoint - El endpoint SSE
     */
    static scheduleReconnect(endpoint) {
        const connection = SSEManager.connections.get(endpoint);
        if (!connection) return;

        connection.reconnectAttempts++;
        const delay = connection.reconnectDelay * Math.pow(2, connection.reconnectAttempts - 1); // Backoff exponencial

        console.log(`🔄 SSEManager: Intentando reconexión para ${endpoint} en ${delay}ms (intento ${connection.reconnectAttempts}/${connection.maxReconnectAttempts})`);

        setTimeout(() => {
            if (SSEManager.connections.has(endpoint)) {
                SSEManager.establishConnection(endpoint);
            }
        }, delay);
    }



    /**
     * Desconecta esta instancia del endpoint SSE
     * Solo cierra la conexión real si no quedan otras instancias
     */
    disconnect() {
        this.removeAllCallbacks();

        const connection = SSEManager.connections.get(this.endpoint);
        if (connection) {
            connection.instances.delete(this);

            // Si no quedan instancias, cerrar la conexión real
            if (connection.instances.size === 0) {
                if (connection.eventSource) {
                    console.log('🔌 SSEManager: Cerrando conexión real para', this.endpoint, '(sin instancias activas)');
                    connection.eventSource.close();
                }
                SSEManager.connections.delete(this.endpoint);
            } else {
                console.log(`� SSEManager: Instancia desconectada de ${this.endpoint}. Instancias restantes: ${connection.instances.size}`);
            }
        }
    }

    /**
     * Destruye completamente esta instancia (alias de disconnect para claridad)
     */
    destroy() {
        this.disconnect();
    }

    /**
     * Reconecta manualmente
     */
    reconnect() {
        if (this.currentEndpoint && this.currentCallback) {
            console.log('� SSEManager: Reconexión manual solicitada');
            this.connect(this.currentEndpoint, this.currentCallback);
        } else {
            console.warn('⚠️ SSEManager: No hay endpoint o callback configurado para reconectar');
        }
    }

    /**
     * Obtiene el estado de la conexión para este endpoint
     */
    getConnectionState() {
        const connection = SSEManager.connections.get(this.endpoint);
        if (!connection || !connection.eventSource) return 'CLOSED';

        switch (connection.eventSource.readyState) {
            case EventSource.CONNECTING:
                return 'CONNECTING';
            case EventSource.OPEN:
                return 'OPEN';
            case EventSource.CLOSED:
                return 'CLOSED';
            default:
                return 'UNKNOWN';
        }
    }

    /**
     * Verifica si está conectado al endpoint
     */
    isConnectedToEndpoint() {
        const connection = SSEManager.connections.get(this.endpoint);
        return connection && connection.isConnected && connection.eventSource && connection.eventSource.readyState === EventSource.OPEN;
    }

    /**
     * Obtiene información sobre la conexión compartida
     */
    getConnectionInfo() {
        const connection = SSEManager.connections.get(this.endpoint);
        if (!connection) {
            return {
                endpoint: this.endpoint,
                exists: false
            };
        }

        return {
            endpoint: this.endpoint,
            exists: true,
            isConnected: connection.isConnected,
            state: this.getConnectionState(),
            totalInstances: connection.instances.size,
            totalCallbacks: connection.callbacks.size,
            reconnectAttempts: connection.reconnectAttempts
        };
    }

    /**
     * Obtiene estadísticas globales de todas las conexiones
     */
    static getGlobalStats() {
        const stats = {
            totalConnections: SSEManager.connections.size,
            connections: []
        };

        for (const [endpoint, connection] of SSEManager.connections) {
            stats.connections.push({
                endpoint,
                isConnected: connection.isConnected,
                instances: connection.instances.size,
                callbacks: connection.callbacks.size,
                reconnectAttempts: connection.reconnectAttempts
            });
        }

        return stats;
    }

    /**
     * Configura opciones del manager
     */
    configure(options = {}) {
        if (options.maxReconnectAttempts !== undefined) {
            this.maxReconnectAttempts = options.maxReconnectAttempts;
        }
        if (options.reconnectDelay !== undefined) {
            this.reconnectDelay = options.reconnectDelay;
        }
        
        console.log('⚙️ SSEManager: Configuración actualizada:', {
            maxReconnectAttempts: this.maxReconnectAttempts,
            reconnectDelay: this.reconnectDelay
        });
    }
}

// Hacer disponible globalmente
if (typeof window !== 'undefined') {
    window.SSEManager = SSEManager;
}

// Exportar para uso en módulos Node.js si es necesario
if (typeof module !== 'undefined' && module.exports) {
    module.exports = SSEManager;
}
