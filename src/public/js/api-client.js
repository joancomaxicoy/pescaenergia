/**
 * Cliente API centralizado para todas las peticiones al backend
 * Maneja autenticación, tokens y errores de forma consistente
 */

class ApiClient {
    constructor() {
        this.baseUrl = '';
        this.tokenKey = 'authToken';
    }

    /**
     * Obtiene el token de autenticación desde localStorage o cookies
     */
    getAuthToken() {
        // Primero intentar localStorage
        let token = localStorage.getItem(this.tokenKey);
        
        if (!token) {
            // Si no está en localStorage, buscar en cookies
            const cookies = document.cookie.split(';');
            for (let cookie of cookies) {
                const [name, value] = cookie.trim().split('=');
                if (name === this.tokenKey) {
                    token = value;
                    break;
                }
            }
        }
        
        return token;
    }

    /**
     * Realiza una petición autenticada al backend
     */
    async makeAuthenticatedRequest(url, options = {}) {
        const token = this.getAuthToken();
        
        if (!token) {
            throw new Error('No hi ha token d\'autenticació');
        }

        const defaultOptions = {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            }
        };

        // Merge options
        const finalOptions = {
            ...defaultOptions,
            ...options,
            headers: {
                ...defaultOptions.headers,
                ...(options.headers || {})
            }
        };

        try {
            const response = await fetch(url, finalOptions);
            const data = await response.json();

            if (!response.ok) {
                // Manejar errores específicos
                if (response.status === 401) {
                    this.handleUnauthorized();
                    throw new Error('Sessió expirada. Torna a iniciar sessió.');
                }
                
                throw new Error(data.details || data.error || `Error ${response.status}`);
            }

            return { response, data };
        } catch (error) {
            if (error.name === 'TypeError' && error.message.includes('fetch')) {
                throw new Error('Error de connexió. Comprova la teva connexió a internet.');
            }
            throw error;
        }
    }

    /**
     * Realiza una petición GET autenticada
     */
    async get(url, options = {}) {
        return this.makeAuthenticatedRequest(url, {
            method: 'GET',
            ...options
        });
    }

    /**
     * Realiza una petición POST autenticada
     */
    async post(url, data = null, options = {}) {
        return this.makeAuthenticatedRequest(url, {
            method: 'POST',
            body: data ? JSON.stringify(data) : null,
            ...options
        });
    }

    /**
     * Realiza una petición PUT autenticada
     */
    async put(url, data = null, options = {}) {
        return this.makeAuthenticatedRequest(url, {
            method: 'PUT',
            body: data ? JSON.stringify(data) : null,
            ...options
        });
    }

    /**
     * Realiza una petición DELETE autenticada
     */
    async delete(url, options = {}) {
        return this.makeAuthenticatedRequest(url, {
            method: 'DELETE',
            ...options
        });
    }

    /**
     * Maneja errores de autorización (401)
     */
    handleUnauthorized() {
        // Limpiar token
        localStorage.removeItem(this.tokenKey);
        
        // Limpiar cookie si existe
        document.cookie = `${this.tokenKey}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;`;
        
        // Redirigir al login después de un breve delay
        setTimeout(() => {
            window.location.href = '/login';
        }, 1500);
    }

    /**
     * Verifica si el usuario está autenticado
     */
    isAuthenticated() {
        return !!this.getAuthToken();
    }

    /**
     * Cierra la sesión del usuario
     */
    logout() {
        localStorage.removeItem(this.tokenKey);
        document.cookie = `${this.tokenKey}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;`;
        window.location.href = '/login';
    }
}

// Crear instancia global
window.apiClient = new ApiClient();

// Exportar para uso en módulos
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ApiClient;
}
