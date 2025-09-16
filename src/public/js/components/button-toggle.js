/**
 * ButtonToggle Web Component
 * Componente genérico reutilizable para toggle de múltiples opciones
 * Soporta cualquier número de opciones definidas por atributo
 */
class ButtonToggle extends HTMLElement {
    constructor() {
        super();
        
        // Crear Shadow DOM
        this.attachShadow({ mode: 'open' });
        
        // Estado interno
        this._modes = [];
        this._currentMode = 0;
        this._disabled = false;
        
        // Bind methods
        this.handleButtonClick = this.handleButtonClick.bind(this);
    }

    static get observedAttributes() {
        return ['modes', 'mode', 'disabled'];
    }

    connectedCallback() {
        this.parseAttributes();
        this.render();
        this.setupEventListeners();
    }

    attributeChangedCallback(name, oldValue, newValue) {
        switch (name) {
            case 'modes':
                this._modes = this.parseModes(newValue);
                break;
            case 'mode':
                this._currentMode = parseInt(newValue) || 0;
                break;
            case 'disabled':
                this._disabled = newValue !== null;
                break;
        }
        
        if (this.shadowRoot && this.shadowRoot.innerHTML) {
            this.updateState();
        }
    }

    parseAttributes() {
        const modesAttr = this.getAttribute('modes') || '';
        this._modes = this.parseModes(modesAttr);
        this._currentMode = parseInt(this.getAttribute('mode')) || 0;
        this._disabled = this.hasAttribute('disabled');
    }

    parseModes(modesString) {
        if (!modesString) return [];
        return modesString.split(',').map(mode => mode.trim()).filter(mode => mode.length > 0);
    }

    render() {
        this.shadowRoot.innerHTML = `
            <style>
                :host {
                    display: inline-block;
                    font-family: 'Poppins', Arial, sans-serif;
                }

                .toggle-container {
                    display: flex;
                    gap: 8px;
                    background: #f8f9fa;
                    padding: 4px;
                    border-radius: 8px;
                    transition: opacity 0.3s ease;
                }

                .toggle-container.disabled {
                    opacity: 0.6;
                    pointer-events: none;
                }

                .toggle-btn {
                    background: transparent;
                    border: none;
                    padding: 8px 16px;
                    border-radius: 6px;
                    font-size: 14px;
                    font-weight: 500;
                    color: #666;
                    cursor: pointer;
                    transition: all 0.3s ease;
                    font-family: 'Poppins', sans-serif;
                    white-space: nowrap;
                    min-width: fit-content;
                }

                .toggle-btn:hover:not(.active) {
                    background: #e9ecef;
                    color: #1b4444;
                }

                .toggle-btn.active {
                    background: #fcbd25;
                    color: #1b4444;
                    font-weight: 600;
                }

                .toggle-btn:disabled {
                    cursor: not-allowed;
                    opacity: 0.5;
                }

                /* Responsive adjustments */
                @media (max-width: 480px) {
                    .toggle-btn {
                        padding: 6px 12px;
                        font-size: 12px;
                    }
                }
            </style>

            <div class="toggle-container" id="container">
                ${this._modes.map((mode, index) => `
                    <button 
                        class="toggle-btn ${index === this._currentMode ? 'active' : ''}" 
                        data-index="${index}"
                        data-value="${mode}"
                        ${this._disabled ? 'disabled' : ''}
                    >
                        ${mode}
                    </button>
                `).join('')}
            </div>
        `;
    }

    setupEventListeners() {
        const buttons = this.shadowRoot.querySelectorAll('.toggle-btn');
        buttons.forEach(button => {
            button.addEventListener('click', this.handleButtonClick);
        });
    }

    handleButtonClick(event) {
        if (this._disabled) {
            event.preventDefault();
            return;
        }

        const button = event.target;
        const newIndex = parseInt(button.dataset.index);
        const newValue = button.dataset.value;
        
        // No hacer nada si ya está activo
        if (newIndex === this._currentMode) {
            return;
        }

        const changeEvent = new CustomEvent('mode-change', {
            detail: {
                index: newIndex,
                value: newValue,
                previousIndex: this._currentMode,
                previousValue: this._modes[this._currentMode]
            },
            bubbles: true,
            cancelable: true
        });

        const eventNotCanceled = this.dispatchEvent(changeEvent);
        
        if (!eventNotCanceled) {
            return;
        }

        // Actualizar estado interno
        this._currentMode = newIndex;
        this.setAttribute('mode', newIndex.toString());
        
        this.updateState();
    }

    updateState() {
        const container = this.shadowRoot.querySelector('#container');
        const buttons = this.shadowRoot.querySelectorAll('.toggle-btn');
        
        if (!container || !buttons.length) return;

        // Actualizar estado del contenedor
        container.classList.toggle('disabled', this._disabled);
        
        // Actualizar estado de los botones
        buttons.forEach((button, index) => {
            button.classList.toggle('active', index === this._currentMode);
            button.disabled = this._disabled;
        });
    }

    // Métodos públicos (getters y setters)
    get modes() {
        return [...this._modes];
    }

    set modes(value) {
        if (Array.isArray(value)) {
            this._modes = [...value];
        } else if (typeof value === 'string') {
            this._modes = this.parseModes(value);
        }
        this.setAttribute('modes', this._modes.join(','));
        this.render();
        this.setupEventListeners();
    }

    get mode() {
        return this._currentMode;
    }

    set mode(value) {
        const newMode = parseInt(value) || 0;
        if (newMode !== this._currentMode && newMode >= 0 && newMode < this._modes.length) {
            this._currentMode = newMode;
            this.setAttribute('mode', newMode.toString());
            this.updateState();
        }
    }

    get disabled() {
        return this._disabled;
    }

    set disabled(value) {
        const newValue = Boolean(value);
        if (newValue !== this._disabled) {
            this._disabled = newValue;
            if (newValue) {
                this.setAttribute('disabled', '');
            } else {
                this.removeAttribute('disabled');
            }
            this.updateState();
        }
    }

    get currentValue() {
        return this._modes[this._currentMode] || '';
    }

    // Método para establecer el modo programáticamente sin emitir eventos
    setModeSilently(index) {
        if (index >= 0 && index < this._modes.length) {
            this._currentMode = index;
            this.setAttribute('mode', index.toString());
            this.updateState();
        }
    }

    // Método para obtener el índice de un valor específico
    getIndexByValue(value) {
        return this._modes.indexOf(value);
    }

    // Método para establecer el modo por valor
    setModeByValue(value) {
        const index = this.getIndexByValue(value);
        if (index !== -1) {
            this.mode = index;
        }
    }
}

// Registrar el componente
customElements.define('button-toggle', ButtonToggle);

// Exportar para uso en módulos
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ButtonToggle;
}
