/**
 * Módulo base para dashboards
 * Contiene funcionalidades comunes para todas las páginas de dashboard
 */

class DashboardBase {
    constructor() {
        this.isInitialized = false;
        this.autoRefreshIntervals = [];
    }

    /**
     * Inicializa las funcionalidades base del dashboard
     */
    initialize() {
        if (this.isInitialized) return;

        this.setupNavbarInteractions();
        this.setupAuthCheck();
        this.initializeLucideIcons();
        this.isInitialized = true;
    }

    /**
     * Configura las interacciones de la navbar
     */
    setupNavbarInteractions() {
        // Usar delegación de eventos para evitar conflictos
        document.addEventListener('click', (e) => {
            const userDropdown = document.getElementById('userDropdown');
            const userDropdownMenu = document.getElementById('userDropdownMenu');
            
            if (!userDropdown || !userDropdownMenu) return;
            
            // Si se hace clic en el botón dropdown
            if (e.target === userDropdown || userDropdown.contains(e.target)) {
                e.preventDefault();
                e.stopPropagation();
                userDropdownMenu.classList.toggle('show');
                return;
            }
            
            // Si se hace clic en el botón de perfil
            if (e.target.id === 'showProfileBtn') {
                e.preventDefault();
                if (window.profileManager) {
                    window.profileManager.showProfile();
                }
                userDropdownMenu.classList.remove('show');
                return;
            }
            
            // Si se hace clic en el botón de logout
            if (e.target.id === 'logoutBtn') {
                e.preventDefault();
                this.handleLogout();
                return;
            }
            
            // Si se hace clic fuera del dropdown, cerrarlo
            if (!userDropdownMenu.contains(e.target)) {
                userDropdownMenu.classList.remove('show');
            }
        });

        // Cerrar dropdown al presionar Escape
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                const userDropdownMenu = document.getElementById('userDropdownMenu');
                if (userDropdownMenu) {
                    userDropdownMenu.classList.remove('show');
                }
            }
        });
    }

    /**
     * Verifica la autenticación del usuario solo en páginas que lo requieren
     */
    setupAuthCheck() {
        // Whitelist de páginas que requieren autenticación
        const protectedPages = [
            '/area-usuari/dashboard',
            '/area-usuari/endolls',
            '/area-usuari/assignar-cups'
        ];
        
        // Verificar si la página actual requiere autenticación
        const currentPath = window.location.pathname;
        const requiresAuth = protectedPages.some(page => currentPath.startsWith(page)) || 
                           currentPath === '/area-usuari' || 
                           currentPath === '/area-usuari/';
        
        if (!requiresAuth) {
            console.log('Página pública, no se requiere autenticación');
            return;
        }

        if (!window.apiClient.isAuthenticated()) {
            console.warn('Usuario no autenticado, redirigiendo al login');
            window.location.href = '/area-usuari/login';
            return;
        }

        // Verificar token periódicamente (cada 5 minutos) solo en páginas protegidas
        this.addAutoRefresh(() => {
            if (!window.apiClient.isAuthenticated()) {
                this.handleLogout();
            }
        }, 300000); // 5 minutos
    }

    /**
     * Maneja el cierre de sesión
     */
    handleLogout() {
        // Limpiar intervalos
        this.clearAutoRefresh();
        
        // Mostrar mensaje de confirmación
        if (confirm('Estàs segur que vols tancar la sessió?')) {
            window.apiClient.logout();
        }
    }

    /**
     * Inicializa los iconos de Lucide
     */
    initializeLucideIcons() {
        window.uiUtils.initializeLucideIcons();
    }

    /**
     * Añade un intervalo de auto-refresh
     */
    addAutoRefresh(callback, interval) {
        const intervalId = setInterval(callback, interval);
        this.autoRefreshIntervals.push(intervalId);
        return intervalId;
    }

    /**
     * Limpia todos los intervalos de auto-refresh
     */
    clearAutoRefresh() {
        this.autoRefreshIntervals.forEach(intervalId => {
            clearInterval(intervalId);
        });
        this.autoRefreshIntervals = [];
    }

    /**
     * Muestra un estado de loading global
     */
    showGlobalLoading(message = 'Carregant...') {
        const loadingHtml = `
            <div id="globalLoading" class="loading-container">
                <div class="loading-spinner"></div>
                <p>${message}</p>
            </div>
        `;
        
        // Buscar contenedor principal
        const mainContent = document.querySelector('.dashboard-content, .main-content');
        if (mainContent) {
            mainContent.innerHTML = loadingHtml;
        }
    }

    /**
     * Oculta el estado de loading global
     */
    hideGlobalLoading() {
        const globalLoading = document.getElementById('globalLoading');
        if (globalLoading) {
            globalLoading.remove();
        }
    }

    /**
     * Muestra un error global
     */
    showGlobalError(message, retryCallback = null) {
        const retryButton = retryCallback ? 
            `<button class="btn btn-primary" onclick="${retryCallback}">Tornar a intentar</button>` : '';

        const errorHtml = `
            <div id="globalError" class="error-container">
                <div class="error-icon"><i data-lucide="alert-triangle"></i></div>
                <h3>Error</h3>
                <p>${message}</p>
                ${retryButton}
            </div>
        `;
        
        const mainContent = document.querySelector('.dashboard-content, .main-content');
        if (mainContent) {
            mainContent.innerHTML = errorHtml;
            this.initializeLucideIcons();
        }
    }

    /**
     * Configura el manejo de errores globales
     */
    setupGlobalErrorHandling() {
        window.addEventListener('unhandledrejection', (event) => {
            console.error('Unhandled promise rejection:', event.reason);
            
            // Si es un error de autenticación, manejar logout
            if (event.reason?.message?.includes('Sessió expirada')) {
                this.handleLogout();
            }
        });

        window.addEventListener('error', (event) => {
            console.error('Global error:', event.error);
        });
    }

    /**
     * Utilidad para hacer peticiones con manejo de errores común
     */
    async makeRequest(requestFn, errorMessage = 'Error en la petició') {
        try {
            return await requestFn();
        } catch (error) {
            console.error(errorMessage, error);
            
            // Si es error de autenticación, manejar logout
            if (error.message?.includes('Sessió expirada')) {
                this.handleLogout();
                return null;
            }
            
            throw error;
        }
    }

    /**
     * Configura el título de la página
     */
    setPageTitle(title) {
        document.title = `${title} - PescaEnergia`;
    }

    /**
     * Actualiza la información del usuario en la UI
     */
    updateUserInfo(userData) {
        // Actualizar nombre en dropdown
        const userDropdown = document.getElementById('userDropdown');
        if (userDropdown) {
            const textNode = userDropdown.childNodes[0];
            if (textNode && textNode.nodeType === Node.TEXT_NODE) {
                textNode.textContent = userData.name;
            }
        }

        // Actualizar CUPS si existe
        const cupsElements = document.querySelectorAll('[data-user-cups]');
        cupsElements.forEach(element => {
            element.textContent = userData.cups;
        });

        // Actualizar campos del modal de perfil
        const profileName = document.getElementById('profileName');
        const profileEmail = document.getElementById('profileEmail');
        const profileCups = document.getElementById('profileCups');

        if (profileName) profileName.value = userData.name;
        if (profileEmail) profileEmail.value = userData.email;
        if (profileCups) profileCups.value = userData.cups;
    }

    /**
     * Obtiene información del usuario actual
     */
    async getCurrentUser() {
        try {
            const { data } = await window.apiClient.get('/api/auth/me');
            this.updateUserInfo(data);
            return data;
        } catch (error) {
            console.error('Error obteniendo información del usuario:', error);
            return null;
        }
    }

    /**
     * Configura callbacks para el perfil
     */
    setupProfileCallbacks() {
        if (window.profileManager) {
            window.profileManager.onProfileUpdate((userData) => {
                this.updateUserInfo(userData);
            });
        }
    }

    /**
     * Destructor - limpia recursos
     */
    destroy() {
        this.clearAutoRefresh();
        this.isInitialized = false;
    }
}

// Crear instancia global
window.dashboardBase = new DashboardBase();

// Inicializar automáticamente cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', function() {
    window.dashboardBase.initialize();
    window.dashboardBase.setupGlobalErrorHandling();
    window.dashboardBase.setupProfileCallbacks();
});

// Exportar para uso en módulos
if (typeof module !== 'undefined' && module.exports) {
    module.exports = DashboardBase;
}
