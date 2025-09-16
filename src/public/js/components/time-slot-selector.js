/**
 * TimeSlotSelector Web Component
 * Componente para seleccionar franjas horarias y días de la semana
 * Funciona como un botón transparente que abre un modal
 */
class TimeSlotSelector extends HTMLElement {
    constructor() {
        super();
        
        // Estado interno
        this.selectedDays = []; // Array de números 0-6 (0=Domingo, 1=Lunes, etc.)
        this.startTime = '';
        this.endTime = '';
        this.isModalOpen = false;
        
        // Mapeo de días siguiendo el estándar de JavaScript (domingo=0, lunes=1, etc.)
        // Pero mostramos empezando por lunes en la UI
        this.dayLabels = ['Dl', 'Dm', 'Dx', 'Dj', 'Dv', 'Ds', 'Dg']; // Lunes a Domingo en UI
        this.dayNames = ['Dilluns', 'Dimarts', 'Dimecres', 'Dijous', 'Divendres', 'Dissabte', 'Diumenge']; // Lunes a Domingo en UI
        // Mapeo de índices UI (0=Lunes) a índices JavaScript estándar (0=Domingo, 1=Lunes, etc.)
        this.uiToJsIndexMap = [1, 2, 3, 4, 5, 6, 0]; // UI: Lunes=0 -> JS: Lunes=1, UI: Domingo=6 -> JS: Domingo=0
        
        // Bind methods
        this.openModal = this.openModal.bind(this);
        this.closeModal = this.closeModal.bind(this);
        this.handleSave = this.handleSave.bind(this);
        this.handleModalClick = this.handleModalClick.bind(this);
        this.handleKeyDown = this.handleKeyDown.bind(this);
    }

    static get observedAttributes() {
        return ['selected-days', 'start-time', 'end-time'];
    }

    connectedCallback() {
        this.render();
        this.setupEventListeners();
    }

    disconnectedCallback() {
        this.removeEventListeners();
    }

    attributeChangedCallback(name, oldValue, newValue) {
        switch (name) {
            case 'selected-days':
                if (newValue) {
                    try {
                        this.selectedDays = JSON.parse(newValue);
                    } catch (e) {
                        this.selectedDays = [];
                    }
                } else {
                    this.selectedDays = [];
                }
                break;
            case 'start-time':
                this.startTime = newValue || '';
                break;
            case 'end-time':
                this.endTime = newValue || '';
                break;
        }
        
        if (this.querySelector('.time-slot-row')) {
            this.updateDisplay();
        }
    }

    render() {
        this.innerHTML = `
            <style>
                time-slot-selector {
                    display: block;
                    width: 100%;
                }

                time-slot-selector > .time-slot-row {
                    display: flex;
                    align-items: center;
                    padding: 12px 16px;
                    background: transparent;
                    border: 2px dashed transparent;
                    border-radius: 8px;
                    cursor: pointer;
                    transition: all 0.3s ease;
                    font-family: 'Poppins', Arial, sans-serif;
                    margin-bottom: 8px;
                    min-height: 60px;
                }

                time-slot-selector > .time-slot-row:hover {
                    border-color: #fcbd25;
                    background-color: rgba(252, 189, 37, 0.05);
                }

                time-slot-selector > .time-slot-row.has-data {
                    
                    background-color: rgba(27, 68, 68, 0.02);
                }

                time-slot-selector > .time-slot-row.has-data:hover {
                    border-color: #fcbd25;
                    background-color: rgba(252, 189, 37, 0.08);
                }

                time-slot-selector .days-display {
                    display: flex;
                    gap: 12px;
                    flex: 1;
                    align-items: center;
                }

                time-slot-selector .day-column {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    min-width: 24px;
                }

                time-slot-selector .day-label {
                    font-size: 12px;
                    font-weight: 600;
                    color: #666;
                    margin-bottom: 4px;
                    letter-spacing: -0.5px;
                }

                time-slot-selector .day-tick {
                    width: 18px;
                    height: 18px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 16px;
                    font-weight: bold;
                    color: #459f49;
                    background-color: rgba(69, 159, 73, 0.1);
                    border-radius: 50%;
                    border: 2px solid transparent;
                }

                time-slot-selector .day-tick.active {
                    background-color: #459f49;
                    color: white;
                    border-color: #459f49;
                }

                time-slot-selector .time-display {
                    font-size: 14px;
                    font-weight: 600;
                    color: #1b4444;
                    margin-left: 20px;
                    letter-spacing: -0.5px;
                }

                time-slot-selector .empty-state {
                    color: #999;
                    font-style: italic;
                    font-size: 14px;
                    text-align: center;
                    flex: 1;
                    pointer-events: none;
                }

                time-slot-selector .add-icon {
                    color: #fcbd25;
                    font-size: 20px;
                    margin-right: 12px;
                }

                /* Modal styles */
                time-slot-selector .modal {
                    position: fixed;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    background-color: rgba(0, 0, 0, 0.5);
                    z-index: 2000;
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    opacity: 0;
                    visibility: hidden;
                    transition: all 0.3s ease;
                }

                time-slot-selector .modal.show {
                    opacity: 1;
                    visibility: visible;
                }

                time-slot-selector .modal-content {
                    background: white;
                    border-radius: 12px;
                    width: 90%;
                    max-width: 500px;
                    max-height: 90vh;
                    overflow-y: auto;
                    transform: translateY(-20px);
                    transition: transform 0.3s ease;
                }

                time-slot-selector .modal.show .modal-content {
                    transform: translateY(0);
                }

                time-slot-selector .modal-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    padding: 20px 30px;
                    border-bottom: 1px solid #e9ecef;
                }

                time-slot-selector .modal-header h3 {
                    color: #1b4444;
                    font-weight: 600;
                    margin: 0;
                    font-size: 20px;
                    letter-spacing: -1px;
                }

                time-slot-selector .modal-close {
                    background: none;
                    border: none;
                    font-size: 24px;
                    color: #666;
                    cursor: pointer;
                    padding: 0;
                    width: 30px;
                    height: 30px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    border-radius: 50%;
                    transition: all 0.3s ease;
                }

                time-slot-selector .modal-close:hover {
                    color: #333;
                    background-color: #f8f9fa;
                }

                time-slot-selector .modal-body {
                    padding: 30px;
                }

                time-slot-selector .form-section {
                    margin-bottom: 25px;
                }

                time-slot-selector .form-section:last-child {
                    margin-bottom: 0;
                }

                time-slot-selector .form-label {
                    display: block;
                    color: #1b4444;
                    font-weight: 600;
                    margin-bottom: 12px;
                    font-size: 16px;
                    letter-spacing: -0.5px;
                }

                time-slot-selector .days-grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
                    gap: 10px;
                }

                time-slot-selector .day-checkbox {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    padding: 10px 12px;
                    border: 2px solid #e9ecef;
                    border-radius: 8px;
                    cursor: pointer;
                    transition: all 0.3s ease;
                    background: white;
                }

                time-slot-selector .day-checkbox:hover {
                    border-color: #fcbd25;
                    background-color: rgba(252, 189, 37, 0.05);
                }

                time-slot-selector .day-checkbox.selected {
                    border-color: #1b4444;
                    background-color: rgba(27, 68, 68, 0.05);
                }

                time-slot-selector .day-checkbox input[type="checkbox"] {
                    margin: 0;
                    width: 16px;
                    height: 16px;
                    accent-color: #1b4444;
                }

                time-slot-selector .day-checkbox label {
                    cursor: pointer;
                    font-weight: 500;
                    color: #333;
                    font-size: 14px;
                    letter-spacing: -0.5px;
                    pointer-events: none;
                }

                time-slot-selector .time-inputs {
                    display: grid;
                    grid-template-columns: 1fr auto 1fr;
                    gap: 15px;
                    align-items: end;
                }

                time-slot-selector .time-input-group {
                    display: flex;
                    flex-direction: column;
                }

                time-slot-selector .time-input-label {
                    font-size: 14px;
                    color: #666;
                    margin-bottom: 5px;
                    font-weight: 500;
                }

                time-slot-selector .time-input {
                    width: 100%;
                    padding: 12px 16px;
                    border: 2px solid #e9ecef;
                    border-radius: 8px;
                    font-size: 16px;
                    font-family: 'Poppins', sans-serif;
                    transition: border-color 0.3s ease;
                }

                time-slot-selector .time-input:focus {
                    outline: none;
                    border-color: #fcbd25;
                }

                time-slot-selector .time-separator {
                    font-size: 18px;
                    font-weight: 600;
                    color: #666;
                    text-align: center;
                    padding-bottom: 12px;
                }

                time-slot-selector .modal-footer {
                    display: flex;
                    gap: 12px;
                    justify-content: flex-end;
                    padding: 20px 30px;
                    border-top: 1px solid #e9ecef;
                    background-color: #f8f9fa;
                    border-radius: 0 0 12px 12px;
                }

                time-slot-selector .btn {
                    padding: 12px 24px;
                    border: none;
                    border-radius: 8px;
                    font-size: 14px;
                    font-weight: 600;
                    cursor: pointer;
                    transition: all 0.3s ease;
                    font-family: 'Poppins', sans-serif;
                    letter-spacing: -0.5px;
                }

                time-slot-selector .btn-secondary {
                    background-color: #e9ecef;
                    color: #666;
                }

                time-slot-selector .btn-secondary:hover {
                    background-color: #dee2e6;
                    color: #333;
                }

                time-slot-selector .btn-primary {
                    background-color: #fcbd25;
                    color: #1b4444;
                }

                time-slot-selector .btn-primary:hover {
                    background-color: #e6a820;
                    transform: translateY(-1px);
                }

                time-slot-selector .btn-danger {
                    background-color: #dc3545;
                    color: white;
                }

                time-slot-selector .btn-danger:hover {
                    background-color: #c82333;
                    transform: translateY(-1px);
                }

                time-slot-selector .error-message {
                    color: #dc3545;
                    font-size: 12px;
                    margin-top: 5px;
                    font-weight: 500;
                }

                /* Responsive */
                @media (max-width: 768px) {
                    time-slot-selector .modal-content {
                        width: 95%;
                        margin: 10px;
                    }

                    time-slot-selector .modal-header,
                    time-slot-selector .modal-body,
                    time-slot-selector .modal-footer {
                        padding: 20px;
                    }

                    time-slot-selector .days-grid {
                        grid-template-columns: 1fr;
                    }

                    time-slot-selector .time-inputs {
                        grid-template-columns: 1fr;
                        gap: 10px;
                    }

                    time-slot-selector .time-separator {
                        display: none;
                    }

                    time-slot-selector .days-display {
                        gap: 8px;
                    }

                    time-slot-selector .day-column {
                        min-width: 20px;
                    }

                    time-slot-selector .day-label {
                        font-size: 11px;
                    }

                    time-slot-selector .time-display {
                        font-size: 12px;
                        margin-left: 10px;
                    }
                }
            </style>

            <div class="time-slot-row" id="time-slot-row">
                <div class="add-icon" id="add-icon">+</div>
                <div class="days-display" id="days-display">
                    ${this.renderDaysDisplay()}
                </div>
                <div class="time-display" id="time-display">
                    ${this.renderTimeDisplay()}
                </div>
            </div>

            <div class="modal" id="modal">
                <div class="modal-content">
                    <div class="modal-header">
                        <h3>Configurar franja horària</h3>
                        <button class="modal-close" id="modal-close" type="button">&times;</button>
                    </div>
                    <div class="modal-body">
                        <div class="form-section">
                            <label class="form-label">Dies de la setmana</label>
                            <div class="days-grid" id="days-grid">
                                ${this.renderDaysCheckboxes()}
                            </div>
                        </div>
                        <div class="form-section">
                            <label class="form-label">Franja horària</label>
                            <div class="time-inputs">
                                <div class="time-input-group">
                                    <label class="time-input-label">Hora d'inici</label>
                                    <input type="time" class="time-input" id="start-time-input" value="${this.startTime}">
                                </div>
                                <div class="time-separator">-</div>
                                <div class="time-input-group">
                                    <label class="time-input-label">Hora de fi</label>
                                    <input type="time" class="time-input" id="end-time-input" value="${this.endTime}">
                                </div>
                            </div>
                            <div class="error-message" id="time-error" style="display: none;"></div>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button class="btn btn-danger" id="clear-btn" type="button">Esborrar</button>
                        <button class="btn btn-secondary" id="cancel-btn" type="button">Cancel·lar</button>
                        <button class="btn btn-primary" id="save-btn" type="button">Guardar</button>
                    </div>
                </div>
            </div>
        `;
    }

    renderDaysDisplay() {
        return this.dayLabels.map((label, uiIndex) => {
            // Convertir índice UI a índice JavaScript estándar para comparar
            const jsIndex = this.uiToJsIndexMap[uiIndex];
            const isSelected = this.selectedDays.includes(jsIndex);
            
            return `
                <div class="day-column">
                    <div class="day-label">${label}</div>
                    <div class="day-tick">${isSelected ? '●' : ''}</div>
                </div>
            `;
        }).join('');
    }

    renderTimeDisplay() {
        if (this.hasData()) {
            return `${this.startTime} - ${this.endTime}`;
        }
        return '<span class="empty-state">Feu clic per configurar una franja horària</span>';
    }

    renderDaysCheckboxes() {
        return this.dayNames.map((name, uiIndex) => {
            // Convertir índice UI a índice JavaScript estándar para comparar
            const jsIndex = this.uiToJsIndexMap[uiIndex];
            const isSelected = this.selectedDays.includes(jsIndex);
            
            return `
                <div class="day-checkbox ${isSelected ? 'selected' : ''}" data-day="${uiIndex}">
                    <input type="checkbox" id="day-${uiIndex}" ${isSelected ? 'checked' : ''}>
                    <label for="day-${uiIndex}">${name}</label>
                </div>
            `;
        }).join('');
    }

    setupEventListeners() {
        const timeSlotRow = this.querySelector('#time-slot-row');
        const modal = this.querySelector('#modal');
        const modalClose = this.querySelector('#modal-close');
        const cancelBtn = this.querySelector('#cancel-btn');
        const saveBtn = this.querySelector('#save-btn');
        const clearBtn = this.querySelector('#clear-btn');

        if (timeSlotRow) {
            timeSlotRow.addEventListener('click', this.openModal);
        }

        if (modalClose) {
            modalClose.addEventListener('click', this.closeModal);
        }

        if (cancelBtn) {
            cancelBtn.addEventListener('click', this.closeModal);
        }

        if (saveBtn) {
            saveBtn.addEventListener('click', this.handleSave);
        }

        if (clearBtn) {
            clearBtn.addEventListener('click', this.handleClear.bind(this));
        }

        if (modal) {
            modal.addEventListener('click', this.handleModalClick);
        }

        // Event listeners para checkboxes de días
        const dayCheckboxes = this.querySelectorAll('.day-checkbox');
        dayCheckboxes.forEach(checkbox => {
            checkbox.addEventListener('click', this.handleDayToggle.bind(this));
        });

        // Event listeners para validación de tiempo
        const startTimeInput = this.querySelector('#start-time-input');
        const endTimeInput = this.querySelector('#end-time-input');
        
        if (startTimeInput) {
            startTimeInput.addEventListener('change', this.validateTimes.bind(this));
        }
        
        if (endTimeInput) {
            endTimeInput.addEventListener('change', this.validateTimes.bind(this));
        }

        // Keyboard navigation
        document.addEventListener('keydown', this.handleKeyDown);
    }

    removeEventListeners() {
        document.removeEventListener('keydown', this.handleKeyDown);
    }

    openModal() {
        const modal = this.querySelector('#modal');
        if (modal) {
            this.isModalOpen = true;
            
            // Actualizar el formulario con los valores actuales ANTES de mostrar el modal
            this.updateModalForm();
            
            modal.classList.add('show');
            document.body.style.overflow = 'hidden';
            
            // Focus en el primer input
            const firstInput = modal.querySelector('input[type="checkbox"]:first-of-type');
            if (firstInput) {
                setTimeout(() => firstInput.focus(), 100);
            }
        }
    }

    closeModal() {
        const modal = this.querySelector('#modal');
        if (modal) {
            this.isModalOpen = false;
            modal.classList.remove('show');
            document.body.style.overflow = '';
        }
    }

    updateModalForm() {
        // Actualizar los checkboxes de días
        const dayCheckboxes = this.querySelectorAll('.day-checkbox');
        dayCheckboxes.forEach((dayCheckbox, uiIndex) => {
            const checkbox = dayCheckbox.querySelector('input[type="checkbox"]');
            // Convertir índice UI a índice JavaScript estándar para comparar
            const jsIndex = this.uiToJsIndexMap[uiIndex];
            const isSelected = this.selectedDays.includes(jsIndex);
            
            if (checkbox) {
                checkbox.checked = isSelected;
            }
            dayCheckbox.classList.toggle('selected', isSelected);
        });

        // Actualizar los inputs de tiempo
        const startTimeInput = this.querySelector('#start-time-input');
        const endTimeInput = this.querySelector('#end-time-input');
        
        if (startTimeInput) {
            startTimeInput.value = this.startTime || '';
        }
        
        if (endTimeInput) {
            endTimeInput.value = this.endTime || '';
        }

        // Limpiar cualquier mensaje de error
        const errorElement = this.querySelector('#time-error');
        if (errorElement) {
            errorElement.style.display = 'none';
        }
    }

    handleModalClick(event) {
        if (event.target.classList.contains('modal')) {
            this.closeModal();
        }
    }

    handleKeyDown(event) {
        if (this.isModalOpen && event.key === 'Escape') {
            this.closeModal();
        }
    }

    handleDayToggle(event) {
        const dayCheckbox = event.currentTarget;
        const dayIndex = parseInt(dayCheckbox.dataset.day);
        const checkbox = dayCheckbox.querySelector('input[type="checkbox"]');
        
        // Toggle checkbox if clicked on the container
        if (event.target !== checkbox) {
            checkbox.checked = !checkbox.checked;
        }
        
        // Update visual state
        dayCheckbox.classList.toggle('selected', checkbox.checked);
    }

    validateTimes() {
        const startTimeInput = this.querySelector('#start-time-input');
        const endTimeInput = this.querySelector('#end-time-input');
        const errorElement = this.querySelector('#time-error');
        
        if (!startTimeInput || !endTimeInput || !errorElement) return true;
        
        const startTime = startTimeInput.value;
        const endTime = endTimeInput.value;
        
        if (startTime && endTime && startTime >= endTime) {
            errorElement.textContent = "L'hora de fi ha de ser posterior a l'hora d'inici";
            errorElement.style.display = 'block';
            return false;
        }
        
        errorElement.style.display = 'none';
        return true;
    }

    handleSave() {
        // Validar tiempos
        if (!this.validateTimes()) {
            return;
        }

        // Recoger días seleccionados (índices UI: 0=Lunes, 1=Martes, etc.)
        const selectedUIIndices = [];
        const dayCheckboxes = this.querySelectorAll('.day-checkbox input[type="checkbox"]');
        dayCheckboxes.forEach((checkbox, index) => {
            if (checkbox.checked) {
                selectedUIIndices.push(index);
            }
        });

        // Convertir índices UI a índices JavaScript estándar (0=Domingo, 1=Lunes, etc.)
        const selectedJSIndices = selectedUIIndices.map(uiIndex => this.uiToJsIndexMap[uiIndex]);

        // Recoger tiempos
        const startTimeInput = this.querySelector('#start-time-input');
        const endTimeInput = this.querySelector('#end-time-input');
        const startTime = startTimeInput ? startTimeInput.value : '';
        const endTime = endTimeInput ? endTimeInput.value : '';

        // Validar que hay al menos un día y ambos tiempos
        if (selectedUIIndices.length === 0) {
            alert('Seleccioneu almenys un dia de la setmana');
            return;
        }

        if (!startTime || !endTime) {
            alert('Seleccioneu una franja horària completa');
            return;
        }

        // Actualizar estado interno (guardamos los índices JavaScript estándar)
        const previousData = {
            selectedDays: [...this.selectedDays],
            startTime: this.startTime,
            endTime: this.endTime
        };

        this.selectedDays = selectedJSIndices; // Usar índices JavaScript estándar
        this.startTime = startTime;
        this.endTime = endTime;

        // Actualizar atributos
        this.setAttribute('selected-days', JSON.stringify(this.selectedDays));
        this.setAttribute('start-time', this.startTime);
        this.setAttribute('end-time', this.endTime);

        // Actualizar display
        this.updateDisplay();

        // Emitir evento con índices JavaScript estándar
        this.dispatchEvent(new CustomEvent('time-slot-changed', {
            detail: {
                selectedDays: this.selectedDays, // Índices JavaScript estándar
                startTime: this.startTime,
                endTime: this.endTime,
                previousData: previousData,
                dayLabels: selectedUIIndices.map(index => this.dayLabels[index]), // Para mostrar en UI
                dayNames: selectedUIIndices.map(index => this.dayNames[index]) // Para mostrar en UI
            },
            bubbles: true
        }));

        this.closeModal();
    }

    handleClear() {
        const previousData = {
            selectedDays: [...this.selectedDays],
            startTime: this.startTime,
            endTime: this.endTime
        };

        // Limpiar estado
        this.selectedDays = [];
        this.startTime = '';
        this.endTime = '';

        // Limpiar atributos
        this.removeAttribute('selected-days');
        this.removeAttribute('start-time');
        this.removeAttribute('end-time');

        // Actualizar display
        this.updateDisplay();

        // Emitir evento
        this.dispatchEvent(new CustomEvent('time-slot-cleared', {
            detail: {
                previousData: previousData
            },
            bubbles: true
        }));

        this.closeModal();
    }

    updateDisplay() {
        const daysDisplay = this.querySelector('#days-display');
        const timeDisplay = this.querySelector('#time-display');
        const timeSlotRow = this.querySelector('#time-slot-row');
        const addIcon = this.querySelector('#add-icon');

        if (daysDisplay) {
            daysDisplay.innerHTML = this.renderDaysDisplay();
        }

        if (timeDisplay) {
            timeDisplay.innerHTML = this.renderTimeDisplay();
        }

        if (timeSlotRow) {
            timeSlotRow.classList.toggle('has-data', this.hasData());
        }

        if (addIcon) {
            addIcon.textContent = this.hasData() ? '✎' : '+';
        }

        // Re-render modal footer to always show clear button
        const modalFooter = this.querySelector('.modal-footer');
        if (modalFooter) {
            modalFooter.innerHTML = `
                <button class="btn btn-danger" id="clear-btn" type="button">Esborrar</button>
                <button class="btn btn-secondary" id="cancel-btn" type="button">Cancel·lar</button>
                <button class="btn btn-primary" id="save-btn" type="button">Guardar</button>
            `;
            
            // Re-setup event listeners for new buttons
            const clearBtn = modalFooter.querySelector('#clear-btn');
            const cancelBtn = modalFooter.querySelector('#cancel-btn');
            const saveBtn = modalFooter.querySelector('#save-btn');
            
            if (clearBtn) {
                clearBtn.addEventListener('click', this.handleClear.bind(this));
            }
            if (cancelBtn) {
                cancelBtn.addEventListener('click', this.closeModal);
            }
            if (saveBtn) {
                saveBtn.addEventListener('click', this.handleSave);
            }
        }
    }

    hasData() {
        return this.selectedDays.length > 0 && this.startTime && this.endTime;
    }

    // Métodos públicos
    getTimeSlotData() {
        return {
            selectedDays: [...this.selectedDays],
            startTime: this.startTime,
            endTime: this.endTime,
            dayLabels: this.selectedDays.map(index => this.dayLabels[index]),
            dayNames: this.selectedDays.map(index => this.dayNames[index]),
            hasData: this.hasData()
        };
    }

    setTimeSlotData(data) {
        if (data.selectedDays) {
            this.selectedDays = [...data.selectedDays];
            this.setAttribute('selected-days', JSON.stringify(this.selectedDays));
        }
        
        if (data.startTime) {
            this.startTime = data.startTime;
            this.setAttribute('start-time', this.startTime);
        }
        
        if (data.endTime) {
            this.endTime = data.endTime;
            this.setAttribute('end-time', this.endTime);
        }
        
        this.updateDisplay();
    }

    clearTimeSlot() {
        this.handleClear();
    }
}

// Registrar el componente
customElements.define('time-slot-selector', TimeSlotSelector);

// Exportar para uso en módulos
if (typeof module !== 'undefined' && module.exports) {
    module.exports = TimeSlotSelector;
}
