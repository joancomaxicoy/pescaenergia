/**
 * Módulo de gestión del perfil de usuario
 * Autocontenido y reutilizable en cualquier página
 */

class ProfileManager {
    constructor() {
        this.modal = null;
        this.form = null;
        this.isInitialized = false;
        this.callbacks = {
            onProfileUpdate: null
        };
    }

    /**
     * Inicializa el gestor de perfil
     */
    initialize() {
        if (this.isInitialized) return;

        this.modal = document.getElementById('profileModal');
        this.form = document.getElementById('profileForm');

        if (!this.modal || !this.form) {
            console.warn('Profile modal or form not found');
            return;
        }

        this.setupEventListeners();
        this.isInitialized = true;
    }

    /**
     * Configura los event listeners del modal
     */
    setupEventListeners() {
        // Botón de cerrar
        const closeBtn = document.getElementById('closeProfileBtn');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => this.closeProfile());
        }

        // Cerrar al hacer clic fuera del modal
        this.modal.addEventListener('click', (e) => {
            if (e.target === this.modal) {
                this.closeProfile();
            }
        });

        // Envío del formulario
        this.form.addEventListener('submit', (e) => this.handleFormSubmit(e));

        // Escape key para cerrar
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && !this.modal.classList.contains('modal-hidden')) {
                this.closeProfile();
            }
        });
    }

    /**
     * Muestra el modal de perfil
     */
    showProfile() {
        if (!this.isInitialized) {
            this.initialize();
        }

        if (this.modal) {
            this.modal.classList.remove('modal-hidden');
            this.hideMessage();
            
            // Focus en el campo de nombre
            const nameInput = document.getElementById('profileName');
            if (nameInput) {
                setTimeout(() => nameInput.focus(), 100);
            }
        }
    }

    /**
     * Oculta el modal de perfil
     */
    closeProfile() {
        if (this.modal) {
            this.modal.classList.add('modal-hidden');
            this.hideMessage();
        }
    }

    /**
     * Maneja el envío del formulario
     */
    async handleFormSubmit(e) {
        e.preventDefault();
        
        const name = document.getElementById('profileName').value.trim();
        
        if (!name) {
            this.showMessage('El nom és obligatori', 'error');
            return;
        }

        this.showLoading();

        try {
            const { data } = await window.apiClient.put('/api/auth/profile', { name });
            
            // Actualizar la UI con el nuevo nombre
            this.updateUIWithNewName(data.name);
            
            // Mostrar mensaje de éxito
            this.showMessage('Perfil actualitzat correctament', 'success');
            
            // Ejecutar callback si existe
            if (this.callbacks.onProfileUpdate) {
                this.callbacks.onProfileUpdate(data);
            }
            
            // Cerrar modal después de un delay
            setTimeout(() => {
                this.closeProfile();
            }, 1500);

        } catch (error) {
            console.error('Error updating profile:', error);
            this.showMessage(error.message, 'error');
        } finally {
            this.hideLoading();
        }
    }

    /**
     * Actualiza la UI con el nuevo nombre
     */
    updateUIWithNewName(newName) {
        // Actualizar título del dashboard si existe
        const dashboardTitle = document.querySelector('.dashboard-title');
        if (dashboardTitle && dashboardTitle.textContent.includes('Benvingut')) {
            dashboardTitle.textContent = `Benvingut, ${newName}!`;
        }

        // Actualizar dropdown de usuario en navbar
        const userDropdown = document.querySelector('#userDropdown');
        if (userDropdown) {
            const textNode = userDropdown.childNodes[0];
            if (textNode && textNode.nodeType === Node.TEXT_NODE) {
                textNode.textContent = newName;
            }
        }
    }

    /**
     * Muestra el estado de loading
     */
    showLoading() {
        const submitBtn = this.form.querySelector('button[type="submit"]');
        if (submitBtn) {
            window.uiUtils.showLoading(submitBtn.id || 'profileSubmitBtn', 'profileLoading');
        }
    }

    /**
     * Oculta el estado de loading
     */
    hideLoading() {
        const submitBtn = this.form.querySelector('button[type="submit"]');
        if (submitBtn) {
            window.uiUtils.hideLoading(submitBtn.id || 'profileSubmitBtn');
        }
    }

    /**
     * Muestra un mensaje en el modal
     */
    showMessage(message, type = 'error') {
        const messageContainer = document.getElementById('profileMessage');
        const messageText = messageContainer?.querySelector('.message-text');
        const messageIcon = messageContainer?.querySelector('.message-icon');
        
        if (!messageContainer || !messageText || !messageIcon) return;
        
        // Actualizar contenido
        messageText.textContent = message;
        
        // Actualizar clases
        messageContainer.className = `profile-message ${type}`;
        
        // Actualizar icono
        const iconName = window.uiUtils.getIconForMessageType(type);
        messageIcon.setAttribute('data-lucide', iconName);
        
        // Mostrar mensaje
        messageContainer.style.display = 'block';
        
        // Reinicializar iconos
        window.uiUtils.initializeLucideIcons();
        
        // Auto-ocultar mensajes de error después de 5 segundos
        if (type === 'error') {
            setTimeout(() => {
                this.hideMessage();
            }, 5000);
        }
    }

    /**
     * Oculta el mensaje del modal
     */
    hideMessage() {
        const messageContainer = document.getElementById('profileMessage');
        if (messageContainer) {
            messageContainer.style.display = 'none';
        }
    }

    /**
     * Configura un callback para cuando se actualiza el perfil
     */
    onProfileUpdate(callback) {
        this.callbacks.onProfileUpdate = callback;
    }
}

// Crear instancia global
window.profileManager = new ProfileManager();

// Función global para compatibilidad
window.showProfile = function() {
    window.profileManager.showProfile();
};

// Inicializar cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', function() {
    window.profileManager.initialize();
});

// Exportar para uso en módulos
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ProfileManager;
}
