/**
 * SSEManager - Gestor independiente de conexiones Server-Sent Events
 * Permite conectar a cualquier endpoint SSE con callbacks personalizados
 */
class SSEManager {
    constructor() {
        this.eventSource = null;
        this.isConnected = false;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 1000; // 1 segundo inicial
        this.currentEndpoint = null;
        this.currentCallback = null;
    }

    /**
     * Conecta a un endpoint SSE específico con un callback personalizado
     * @param {string} endpoint - El endpoint SSE (ej: '/api/sse/time')
     * @param {function} callback - Función que se ejecuta cuando se reciben datos
     * @param {object} options - Opciones adicionales
     */
    connect(endpoint, callback, options = {}) {
        if (this.eventSource) {
            this.disconnect();
        }

        this.currentEndpoint = endpoint;
        this.currentCallback = callback;

        try {
            // Obtener token de autenticación si está disponible
            let sseUrl = endpoint;
            if (window.apiClient && window.apiClient.getAuthToken) {
                const token = window.apiClient.getAuthToken();
                if (token) {
                    const separator = endpoint.includes('?') ? '&' : '?';
                    sseUrl = `${endpoint}${separator}token=${encodeURIComponent(token)}`;
                }
            }

            console.log('🔌 SSEManager: Conectando a endpoint:', endpoint);
            console.log('🔗 SSEManager: URL completa:', sseUrl);
            
            this.eventSource = new EventSource(sseUrl);

            // Evento cuando se recibe un mensaje
            this.eventSource.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    console.log('📨 SSEManager: Datos recibidos de', endpoint, ':', data);
                    
                    if (this.currentCallback && typeof this.currentCallback === 'function') {
                        this.currentCallback(data);
                    }
                    
                    this.isConnected = true;
                    this.reconnectAttempts = 0; // Reset contador de reconexión
                } catch (error) {
                    console.error('❌ SSEManager: Error procesando mensaje:', error);
                    console.log('📄 SSEManager: Datos brutos recibidos:', event.data);
                    
                    // Si no es JSON válido, pasar los datos tal como están
                    if (this.currentCallback && typeof this.currentCallback === 'function') {
                        this.currentCallback(event.data);
                    }
                }
            };

            // Evento cuando se abre la conexión
            this.eventSource.onopen = (event) => {
                console.log('✅ SSEManager: Conexión establecida con', endpoint);
                console.log('📊 SSEManager: Estado de conexión:', this.eventSource.readyState);
                this.isConnected = true;
                this.reconnectAttempts = 0;
            };

            // Evento cuando hay un error
            this.eventSource.onerror = (event) => {
                console.error('❌ SSEManager: Error en conexión con', endpoint, ':', event);
                console.log('📊 SSEManager: Estado de conexión:', this.eventSource.readyState);
                
                this.isConnected = false;
                
                // Verificar el estado de la conexión
                if (this.eventSource.readyState === EventSource.CLOSED) {
                    console.log('🔒 SSEManager: Conexión cerrada por el servidor');
                }
                
                // Intentar reconexión automática solo si no está cerrada permanentemente
                if (this.reconnectAttempts < this.maxReconnectAttempts && this.eventSource.readyState !== EventSource.CLOSED) {
                    this.scheduleReconnect();
                } else {
                    console.error('🚫 SSEManager: Máximo número de intentos de reconexión alcanzado o conexión cerrada');
                }
            };

        } catch (error) {
            console.error('❌ SSEManager: Error creando EventSource:', error);
        }
    }

    /**
     * Programa una reconexión automática
     */
    scheduleReconnect() {
        this.reconnectAttempts++;
        const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1); // Backoff exponencial
        
        console.log(`🔄 SSEManager: Intentando reconexión en ${delay}ms (intento ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
        
        setTimeout(() => {
            if (this.currentEndpoint && this.currentCallback) {
                this.connect(this.currentEndpoint, this.currentCallback);
            }
        }, delay);
    }

    /**
     * Desconecta del endpoint SSE
     */
    disconnect() {
        if (this.eventSource) {
            console.log('🔌 SSEManager: Desconectando de', this.currentEndpoint);
            this.eventSource.close();
            this.eventSource = null;
            this.isConnected = false;
            this.currentEndpoint = null;
            this.currentCallback = null;
        }
    }

    /**
     * Reconecta manualmente
     */
    reconnect() {
        if (this.currentEndpoint && this.currentCallback) {
            console.log('🔄 SSEManager: Reconexión manual solicitada');
            this.connect(this.currentEndpoint, this.currentCallback);
        } else {
            console.warn('⚠️ SSEManager: No hay endpoint o callback configurado para reconectar');
        }
    }

    /**
     * Obtiene el estado de la conexión
     */
    getConnectionState() {
        if (!this.eventSource) return 'CLOSED';
        
        switch (this.eventSource.readyState) {
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
     * Verifica si está conectado
     */
    isConnectedToEndpoint() {
        return this.isConnected && this.eventSource && this.eventSource.readyState === EventSource.OPEN;
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
