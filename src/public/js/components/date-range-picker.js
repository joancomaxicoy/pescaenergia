/**
 * DateRangePicker Web Component
 * Componente para seleccionar un rango de fechas personalizado
 * Compatible con el estilo de PescaEnergía
 */
class DateRangePicker extends HTMLElement {
    constructor() {
        super();
        
        this.attachShadow({ mode: 'open' });
        
        // Estado interno
        this._isOpen = false;
        this._startDate = null;
        this._endDate = null;
        this._maxRangeDays = 90;
        
        // Bind methods
        this.open = this.open.bind(this);
        this.close = this.close.bind(this);
        this.handleApply = this.handleApply.bind(this);
        this.handleCancel = this.handleCancel.bind(this);
        this.handleBackdropClick = this.handleBackdropClick.bind(this);
        this.handleStartDateChange = this.handleStartDateChange.bind(this);
        this.handleEndDateChange = this.handleEndDateChange.bind(this);
    }

    static get observedAttributes() {
        return ['max-range-days'];
    }

    connectedCallback() {
        this.parseAttributes();
        this.render();
        this.setupEventListeners();
        this.loadSavedDates();
    }

    attributeChangedCallback(name, oldValue, newValue) {
        if (name === 'max-range-days') {
            this._maxRangeDays = parseInt(newValue) || 90;
        }
    }

    parseAttributes() {
        this._maxRangeDays = parseInt(this.getAttribute('max-range-days')) || 90;
    }

    loadSavedDates() {
        try {
            const savedStartDate = localStorage.getItem('dashboard_custom_start_date');
            const savedEndDate = localStorage.getItem('dashboard_custom_end_date');
            
            if (savedStartDate && savedEndDate) {
                this._startDate = savedStartDate;
                this._endDate = savedEndDate;
                this.updateDateInputs();
            }
        } catch (error) {
            console.warn('Error loading saved dates:', error);
        }
    }

    saveDates() {
        try {
            if (this._startDate && this._endDate) {
                localStorage.setItem('dashboard_custom_start_date', this._startDate);
                localStorage.setItem('dashboard_custom_end_date', this._endDate);
            }
        } catch (error) {
            console.warn('Error saving dates:', error);
        }
    }

    render() {
        this.shadowRoot.innerHTML = `
            <style>
                :host {
                    display: block;
                    font-family: 'Poppins', Arial, sans-serif;
                }

                .backdrop {
                    display: none;
                    position: fixed;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    background: rgba(0, 0, 0, 0.5);
                    z-index: 9998;
                    animation: fadeIn 0.2s ease;
                }

                .backdrop.open {
                    display: block;
                }

                @keyframes fadeIn {
                    from { opacity: 0; }
                    to { opacity: 1; }
                }

                .modal {
                    display: none;
                    position: fixed;
                    top: 50%;
                    left: 50%;
                    transform: translate(-50%, -50%);
                    background: #fdf1eb;
                    border-radius: 16px;
                    padding: 32px;
                    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
                    z-index: 9999;
                    min-width: 400px;
                    max-width: 90%;
                    animation: slideIn 0.3s ease;
                }

                .modal.open {
                    display: block;
                }

                @keyframes slideIn {
                    from {
                        opacity: 0;
                        transform: translate(-50%, -45%);
                    }
                    to {
                        opacity: 1;
                        transform: translate(-50%, -50%);
                    }
                }

                .modal-header {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    margin-bottom: 24px;
                }

                .modal-title {
                    font-size: 24px;
                    font-weight: 600;
                    color: #1b4444;
                    margin: 0;
                }

                .close-button {
                    background: none;
                    border: none;
                    font-size: 28px;
                    color: #666;
                    cursor: pointer;
                    padding: 0;
                    width: 32px;
                    height: 32px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    border-radius: 50%;
                    transition: all 0.2s ease;
                }

                .close-button:hover {
                    background: rgba(27, 68, 68, 0.1);
                    color: #1b4444;
                }

                .modal-body {
                    margin-bottom: 24px;
                }

                .date-inputs {
                    display: flex;
                    gap: 16px;
                    margin-bottom: 16px;
                }

                .input-group {
                    flex: 1;
                }

                .input-label {
                    display: block;
                    font-size: 14px;
                    font-weight: 500;
                    color: #1b4444;
                    margin-bottom: 8px;
                }

                .date-input {
                    width: 100%;
                    padding: 12px 16px;
                    border: 2px solid #e9ecef;
                    border-radius: 8px;
                    font-size: 16px;
                    font-family: 'Poppins', Arial, sans-serif;
                    color: #1b4444;
                    background: white;
                    transition: all 0.2s ease;
                    box-sizing: border-box;
                }

                .date-input:focus {
                    outline: none;
                    border-color: #fcbd25;
                    box-shadow: 0 0 0 3px rgba(252, 189, 37, 0.1);
                }

                .date-input:invalid {
                    border-color: #dc3545;
                }

                .error-message {
                    display: none;
                    padding: 12px 16px;
                    background: #fff3cd;
                    border: 1px solid #ffc107;
                    border-radius: 8px;
                    color: #856404;
                    font-size: 14px;
                    margin-top: 12px;
                }

                .error-message.show {
                    display: block;
                }

                .info-message {
                    padding: 12px 16px;
                    background: #e7f3ff;
                    border: 1px solid #b3d9ff;
                    border-radius: 8px;
                    color: #004085;
                    font-size: 14px;
                    margin-top: 12px;
                }

                .modal-footer {
                    display: flex;
                    gap: 12px;
                    justify-content: flex-end;
                }

                .btn {
                    padding: 12px 24px;
                    border: none;
                    border-radius: 8px;
                    font-size: 16px;
                    font-weight: 500;
                    font-family: 'Poppins', Arial, sans-serif;
                    cursor: pointer;
                    transition: all 0.2s ease;
                }

                .btn-primary {
                    background: #fcbd25;
                    color: #1b4444;
                }

                .btn-primary:hover {
                    background: #e5aa20;
                    transform: translateY(-2px);
                    box-shadow: 0 4px 12px rgba(252, 189, 37, 0.3);
                }

                .btn-primary:disabled {
                    background: #e9ecef;
                    color: #999;
                    cursor: not-allowed;
                    transform: none;
                    box-shadow: none;
                }

                .btn-secondary {
                    background: white;
                    color: #1b4444;
                    border: 2px solid #e9ecef;
                }

                .btn-secondary:hover {
                    background: #f8f9fa;
                    border-color: #1b4444;
                }

                @media (max-width: 480px) {
                    .modal {
                        min-width: auto;
                        width: 90%;
                        padding: 24px;
                    }

                    .date-inputs {
                        flex-direction: column;
                    }

                    .modal-footer {
                        flex-direction: column-reverse;
                    }

                    .btn {
                        width: 100%;
                    }
                }
            </style>

            <div class="backdrop" id="backdrop"></div>
            
            <div class="modal" id="modal">
                <div class="modal-header">
                    <h2 class="modal-title">Selecciona el rang de dates</h2>
                    <button class="close-button" id="closeBtn" type="button">&times;</button>
                </div>
                
                <div class="modal-body">
                    <div class="date-inputs">
                        <div class="input-group">
                            <label class="input-label" for="startDate">Des de</label>
                            <input 
                                type="date" 
                                id="startDate" 
                                class="date-input"
                                required
                            >
                        </div>
                        <div class="input-group">
                            <label class="input-label" for="endDate">Fins a</label>
                            <input 
                                type="date" 
                                id="endDate" 
                                class="date-input"
                                required
                            >
                        </div>
                    </div>

                    <div class="info-message">
                        Pots seleccionar un màxim de ${this._maxRangeDays} dies
                    </div>

                    <div class="error-message" id="errorMessage"></div>
                </div>

                <div class="modal-footer">
                    <button class="btn btn-secondary" id="cancelBtn" type="button">Cancel·lar</button>
                    <button class="btn btn-primary" id="applyBtn" type="button">Aplicar</button>
                </div>
            </div>
        `;
    }

    setupEventListeners() {
        const backdrop = this.shadowRoot.getElementById('backdrop');
        const closeBtn = this.shadowRoot.getElementById('closeBtn');
        const cancelBtn = this.shadowRoot.getElementById('cancelBtn');
        const applyBtn = this.shadowRoot.getElementById('applyBtn');
        const startDateInput = this.shadowRoot.getElementById('startDate');
        const endDateInput = this.shadowRoot.getElementById('endDate');

        backdrop.addEventListener('click', this.handleBackdropClick);
        closeBtn.addEventListener('click', this.close);
        cancelBtn.addEventListener('click', this.handleCancel);
        applyBtn.addEventListener('click', this.handleApply);
        startDateInput.addEventListener('change', this.handleStartDateChange);
        endDateInput.addEventListener('change', this.handleEndDateChange);
    }

    open() {
        this._isOpen = true;
        const backdrop = this.shadowRoot.getElementById('backdrop');
        const modal = this.shadowRoot.getElementById('modal');
        
        backdrop.classList.add('open');
        modal.classList.add('open');
        
        // Set default dates if not set
        if (!this._startDate || !this._endDate) {
            const endDate = new Date();
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - 7);
            
            this._startDate = startDate.toISOString().split('T')[0];
            this._endDate = endDate.toISOString().split('T')[0];
        }
        
        this.updateDateInputs();
        this.hideError();
    }

    close() {
        this._isOpen = false;
        const backdrop = this.shadowRoot.getElementById('backdrop');
        const modal = this.shadowRoot.getElementById('modal');
        
        backdrop.classList.remove('open');
        modal.classList.remove('open');
    }

    handleBackdropClick(event) {
        if (event.target.id === 'backdrop') {
            this.close();
        }
    }

    handleCancel() {
        this.close();
    }

    handleStartDateChange(event) {
        this._startDate = event.target.value;
        this.validateDates();
    }

    handleEndDateChange(event) {
        this._endDate = event.target.value;
        this.validateDates();
    }

    validateDates() {
        const errorMessage = this.shadowRoot.getElementById('errorMessage');
        const applyBtn = this.shadowRoot.getElementById('applyBtn');
        
        if (!this._startDate || !this._endDate) {
            this.showError('Selecciona ambdues dates');
            applyBtn.disabled = true;
            return false;
        }

        const start = new Date(this._startDate);
        const end = new Date(this._endDate);
        
        if (end < start) {
            this.showError('La data final ha de ser posterior a la data inicial');
            applyBtn.disabled = true;
            return false;
        }

        const diffTime = Math.abs(end - start);
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        
        if (diffDays > this._maxRangeDays) {
            this.showError(`El rang no pot superar els ${this._maxRangeDays} dies`);
            applyBtn.disabled = true;
            return false;
        }

        this.hideError();
        applyBtn.disabled = false;
        return true;
    }

    showError(message) {
        const errorMessage = this.shadowRoot.getElementById('errorMessage');
        errorMessage.textContent = message;
        errorMessage.classList.add('show');
    }

    hideError() {
        const errorMessage = this.shadowRoot.getElementById('errorMessage');
        errorMessage.classList.remove('show');
    }

    updateDateInputs() {
        const startDateInput = this.shadowRoot.getElementById('startDate');
        const endDateInput = this.shadowRoot.getElementById('endDate');
        
        if (this._startDate) {
            startDateInput.value = this._startDate;
        }
        if (this._endDate) {
            endDateInput.value = this._endDate;
        }
        
        this.validateDates();
    }

    handleApply() {
        if (!this.validateDates()) {
            return;
        }

        this.saveDates();

        const event = new CustomEvent('date-range-selected', {
            detail: {
                startDate: this._startDate,
                endDate: this._endDate
            },
            bubbles: true,
            cancelable: false
        });

        this.dispatchEvent(event);
        this.close();
    }

    // Public API
    get startDate() {
        return this._startDate;
    }

    get endDate() {
        return this._endDate;
    }

    get isOpen() {
        return this._isOpen;
    }

    setDates(startDate, endDate) {
        this._startDate = startDate;
        this._endDate = endDate;
        if (this._isOpen) {
            this.updateDateInputs();
        }
    }
}

// Registrar el componente
customElements.define('date-range-picker', DateRangePicker);

// Exportar para uso en módulos
if (typeof module !== 'undefined' && module.exports) {
    module.exports = DateRangePicker;
}