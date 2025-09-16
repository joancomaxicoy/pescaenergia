/**
 * ToggleSwitch Web Component
 * Componente reutilizable de switch con Shadow DOM
 * Soporta dos tamaños: normal y mini
 */
class ToggleSwitch extends HTMLElement {
    constructor() {
        super();
        
        // Crear Shadow DOM
        this.attachShadow({ mode: 'open' });
        
        // Estado interno
        this._checked = false;
        this._disabled = false;
        this._loading = false;
        this._size = 'normal'; // 'normal' o 'mini'
        
        // Bind methods
        this.handleChange = this.handleChange.bind(this);
    }

    static get observedAttributes() {
        return ['checked', 'disabled', 'loading', 'size'];
    }

    connectedCallback() {
        this.render();
        this.setupEventListeners();
    }

    attributeChangedCallback(name, oldValue, newValue) {
        switch (name) {
            case 'checked':
                this._checked = newValue !== null;
                break;
            case 'disabled':
                this._disabled = newValue !== null;
                break;
            case 'loading':
                this._loading = newValue !== null;
                break;
            case 'size':
                this._size = newValue || 'normal';
                break;
        }
        
        if (this.shadowRoot) {
            this.updateState();
        }
    }

    render() {
        const isNormal = this._size === 'normal';
        
        // Dimensiones según el tamaño
        const dimensions = isNormal ? {
            width: '50px',
            height: '24px',
            circleSize: '18px',
            circleOffset: '3px',
            translateX: '26px'
        } : {
            width: '32px',
            height: '16px',
            circleSize: '12px',
            circleOffset: '2px',
            translateX: '16px'
        };

        this.shadowRoot.innerHTML = `
            <style>
                :host {
                    display: inline-block;
                    position: relative;
                }

                .switch {
                    position: relative;
                    display: inline-block;
                    width: ${dimensions.width};
                    height: ${dimensions.height};
                }

                .switch input {
                    opacity: 0;
                    width: 0;
                    height: 0;
                    position: absolute;
                }

                .slider {
                    position: absolute;
                    cursor: pointer;
                    top: 0;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    background-color: #ccc; /* Color cuando está apagado */
                    border-radius: ${dimensions.height};
                    transition: background-color 0.3s ease, transform 0.3s ease;
                    box-shadow: inset 0 0 5px rgba(0,0,0,0.1); /* Sombra interna para profundidad */
                }

                .slider::before {
                    position: absolute;
                    content: "";
                    height: ${dimensions.circleSize};
                    width: ${dimensions.circleSize};
                    left: ${dimensions.circleOffset};
                    bottom: ${dimensions.circleOffset};
                    background-color: white;
                    border-radius: 50%;
                    transition: transform 0.3s ease; /* Transición solo para el movimiento */
                    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
                }

                /* Estado checked */
                .switch input:checked + .slider {
                    background-color: #459f49; /* Verde cuando está encendido */
                }

                .switch input:checked + .slider::before {
                    transform: translateX(${dimensions.translateX});
                }

                /* Estados hover */
                .switch:not(.disabled):not(.loading):hover .slider {
                    /*background-color: #bbb;*/
                }

                .switch:not(.disabled):not(.loading):hover input:checked + .slider {
                   /* background-color: #3d8b40;*/
                }
                
                /* Estado disabled */
                .switch.disabled {
                    pointer-events: none;
                    opacity: 0.6;
                }

                .switch.disabled .slider {
                    cursor: not-allowed;
                }

                /* Estado loading */
                .switch.loading .slider {
                    /* background-color: #fcbd25;  Naranja cuando está cargando */
                }

                .switch.loading .slider::before {
                    /* No hay animación de pulso, solo se mantiene en su posición */
                    animation: none;
                }

                /* Focus styles para accesibilidad */
                .switch input:focus + .slider {
                    box-shadow: 0 0 0 2px rgba(69, 159, 73, 0.3);
                }
            </style>

            <label class="switch" id="switch">
                <input type="checkbox" id="input" ${this._checked ? 'checked' : ''} ${this._disabled ? 'disabled' : ''}>
                <span class="slider"></span>
            </label>
        `;
    }

    setupEventListeners() {
        const input = this.shadowRoot.querySelector('#input');
        if (input) {
            input.addEventListener('change', this.handleChange);
        }
    }

    handleChange(event) {
        if (this._disabled || this._loading) {
            event.preventDefault();
            return;
        }

        const newChecked = event.target.checked;
        
        const changeEvent = new CustomEvent('toggle-change', {
            detail: {
                checked: newChecked,
                previousChecked: this._checked
            },
            bubbles: true,
            cancelable: true
        });

        const eventNotCanceled = this.dispatchEvent(changeEvent);
        
        if (!eventNotCanceled) {
            event.target.checked = this._checked;
            return;
        }

        this._checked = newChecked;
        
        if (this._checked) {
            this.setAttribute('checked', '');
        } else {
            this.removeAttribute('checked');
        }
        this.updateState(); // Asegura que el estado visual se actualice
    }

    updateState() {
        const switchElement = this.shadowRoot.querySelector('#switch');
        const input = this.shadowRoot.querySelector('#input');
        
        if (!switchElement || !input) return;

        switchElement.classList.toggle('disabled', this._disabled || this._loading);
        switchElement.classList.toggle('loading', this._loading);
        
        input.checked = this._checked;
        input.disabled = this._disabled || this._loading;
    }

    // Métodos públicos (getters y setters)
    get checked() {
        return this._checked;
    }

    set checked(value) {
        const newValue = Boolean(value);
        if (newValue !== this._checked) {
            this._checked = newValue;
            if (newValue) {
                this.setAttribute('checked', '');
            } else {
                this.removeAttribute('checked');
            }
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

    get loading() {
        return this._loading;
    }

    set loading(value) {
        const newValue = Boolean(value);
        if (newValue !== this._loading) {
            this._loading = newValue;
            if (newValue) {
                this.setAttribute('loading', '');
            } else {
                this.removeAttribute('loading');
            }
            this.updateState();
        }
    }

    get size() {
        return this._size;
    }

    set size(value) {
        const newValue = value === 'mini' ? 'mini' : 'normal';
        if (newValue !== this._size) {
            this._size = newValue;
            this.setAttribute('size', newValue);
            this.render(); // Re-render para aplicar nuevas dimensiones
            this.setupEventListeners(); // Re-setup event listeners
        }
    }

    // Método para establecer el estado programáticamente sin emitir eventos
    setCheckedSilently(value) {
        this._checked = Boolean(value);
        if (this._checked) {
            this.setAttribute('checked', '');
        } else {
            this.removeAttribute('checked');
        }
        this.updateState();
    }
}

// Registrar el componente
customElements.define('toggle-switch', ToggleSwitch);

// Exportar para uso en módulos
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ToggleSwitch;
}