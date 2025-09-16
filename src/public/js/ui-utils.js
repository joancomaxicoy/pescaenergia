/**
 * Utilidades comunes para la interfaz de usuario
 * Funciones reutilizables para loading, mensajes, formateo, etc.
 */

class UIUtils {
    constructor() {
        this.loadingElements = new Map();
    }

    /**
     * Muestra el estado de loading en un elemento
     */
    showLoading(elementId, loadingElementId = null) {
        const element = document.getElementById(elementId);
        const loadingElement = loadingElementId ? document.getElementById(loadingElementId) : null;
        
        if (element) {
            element.disabled = true;
            
            // Si es un botón, ocultar el texto y mostrar loading
            const btnText = element.querySelector('.btn-text');
            if (btnText) {
                btnText.style.display = 'none';
            }
        }
        
        if (loadingElement) {
            loadingElement.classList.remove('loading-hidden');
        }
        
        // Guardar estado para poder restaurarlo
        this.loadingElements.set(elementId, {
            element,
            loadingElement,
            originalDisabled: element ? element.disabled : false
        });
    }

    /**
     * Oculta el estado de loading de un elemento
     */
    hideLoading(elementId) {
        const state = this.loadingElements.get(elementId);
        
        if (state) {
            const { element, loadingElement, originalDisabled } = state;
            
            if (element) {
                element.disabled = originalDisabled;
                
                // Restaurar texto del botón
                const btnText = element.querySelector('.btn-text');
                if (btnText) {
                    btnText.style.display = 'flex';
                }
            }
            
            if (loadingElement) {
                loadingElement.classList.add('loading-hidden');
            }
            
            this.loadingElements.delete(elementId);
        }
    }

    /**
     * Muestra un mensaje en un contenedor específico
     */
    showMessage(message, type = 'info', containerId = null) {
        let messageContainer;
        
        if (containerId) {
            messageContainer = document.getElementById(containerId);
        } else {
            // Buscar contenedor de mensaje genérico
            messageContainer = document.querySelector('.message-container, .alert, [id*="Message"]');
        }
        
        if (!messageContainer) {
            console.warn('No se encontró contenedor de mensaje');
            return;
        }
        
        // Actualizar contenido del mensaje
        const messageText = messageContainer.querySelector('.message-text, .alert-text') || messageContainer;
        if (messageText !== messageContainer) {
            messageText.textContent = message;
        } else {
            messageContainer.textContent = message;
        }
        
        // Actualizar clases de tipo
        messageContainer.className = messageContainer.className
            .replace(/\b(alert-|message-)(success|error|warning|info)\b/g, '');
        messageContainer.classList.add(`alert-${type}`, `message-${type}`);
        
        // Actualizar icono si existe
        const icon = messageContainer.querySelector('.message-icon, .alert-icon');
        if (icon) {
            const iconName = this.getIconForMessageType(type);
            icon.setAttribute('data-lucide', iconName);
            this.initializeLucideIcons();
        }
        
        // Mostrar mensaje
        messageContainer.style.display = 'block';
        
        // Auto-ocultar después de 5 segundos para ciertos tipos
        if (type === 'success' || type === 'info') {
            setTimeout(() => {
                this.hideMessage(containerId);
            }, 5000);
        }
    }

    /**
     * Oculta un mensaje
     */
    hideMessage(containerId = null) {
        let messageContainer;
        
        if (containerId) {
            messageContainer = document.getElementById(containerId);
        } else {
            messageContainer = document.querySelector('.message-container, .alert, [id*="Message"]');
        }
        
        if (messageContainer) {
            messageContainer.style.display = 'none';
        }
    }

    /**
     * Obtiene el icono apropiado para un tipo de mensaje
     */
    getIconForMessageType(type) {
        const iconMap = {
            'success': 'check-circle',
            'error': 'alert-circle',
            'warning': 'alert-triangle',
            'info': 'info'
        };
        return iconMap[type] || 'info';
    }

    /**
     * Inicializa los iconos de Lucide
     */
    initializeLucideIcons() {
        if (typeof lucide !== 'undefined') {
            lucide.createIcons();
        }
    }

    /**
     * Formatea una fecha relativa (ej: "Fa 5 min", "Fa 2h")
     */
    formatRelativeTime(date) {
        const now = new Date();
        const diffMs = now - date;
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMs / 3600000);
        const diffDays = Math.floor(diffMs / 86400000);

        if (diffMins < 1) return 'Ara mateix';
        if (diffMins < 60) return `Fa ${diffMins} min`;
        if (diffHours < 24) return `Fa ${diffHours}h`;
        if (diffDays < 7) return `Fa ${diffDays} dies`;
        
        return date.toLocaleDateString('ca-ES', {
            day: 'numeric',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    /**
     * Formatea una fecha en formato local catalán
     */
    formatDate(date, options = {}) {
        const defaultOptions = {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        };
        
        return new Date(date).toLocaleDateString('ca-ES', { ...defaultOptions, ...options });
    }

    /**
     * Muestra un estado de loading global en una sección
     */
    showSectionLoading(sectionId) {
        const section = document.getElementById(sectionId);
        if (!section) return;

        const loadingHtml = `
            <div class="loading-container">
                <div class="loading-spinner"></div>
                <p>Carregant...</p>
            </div>
        `;
        
        section.innerHTML = loadingHtml;
    }

    /**
     * Muestra un estado de error en una sección
     */
    showSectionError(sectionId, message, retryCallback = null) {
        const section = document.getElementById(sectionId);
        if (!section) return;

        const retryButton = retryCallback ? 
            `<button class="btn btn-primary" onclick="${retryCallback}">Tornar a intentar</button>` : '';

        const errorHtml = `
            <div class="error-container">
                <div class="error-icon"><i data-lucide="alert-triangle"></i></div>
                <h3>Error</h3>
                <p>${message}</p>
                ${retryButton}
            </div>
        `;
        
        section.innerHTML = errorHtml;
        this.initializeLucideIcons();
    }

    /**
     * Muestra un estado vacío en una sección
     */
    showEmptyState(sectionId, title, description, iconName = 'inbox') {
        const section = document.getElementById(sectionId);
        if (!section) return;

        const emptyHtml = `
            <div class="empty-state">
                <div class="empty-state-icon">
                    <i data-lucide="${iconName}"></i>
                </div>
                <h2 class="empty-state-title">${title}</h2>
                <p class="empty-state-description">${description}</p>
            </div>
        `;
        
        section.innerHTML = emptyHtml;
        this.initializeLucideIcons();
    }

    /**
     * Debounce function para limitar la frecuencia de ejecución
     */
    debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    /**
     * Copia texto al portapapeles
     */
    async copyToClipboard(text) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch (err) {
            console.error('Error copiando al portapapeles:', err);
            return false;
        }
    }

    /**
     * Valida si un elemento está visible en el viewport
     */
    isElementInViewport(element) {
        const rect = element.getBoundingClientRect();
        return (
            rect.top >= 0 &&
            rect.left >= 0 &&
            rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
            rect.right <= (window.innerWidth || document.documentElement.clientWidth)
        );
    }

    /**
     * Scroll suave a un elemento
     */
    scrollToElement(elementId, offset = 0) {
        const element = document.getElementById(elementId);
        if (element) {
            const elementPosition = element.offsetTop - offset;
            window.scrollTo({
                top: elementPosition,
                behavior: 'smooth'
            });
        }
    }
}

// Crear instancia global
window.uiUtils = new UIUtils();

// Exportar para uso en módulos
if (typeof module !== 'undefined' && module.exports) {
    module.exports = UIUtils;
}
