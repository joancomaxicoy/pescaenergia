/**
 * PlugCard Web Component
 * Componente autónomo para gestionar cada plug individual
 */
class PlugCard extends HTMLElement {
    constructor() {
        super();
        
        // Estado interno del plug
        this.plugData = null;
        this.isOnline = false;
        this.isOn = false;
        this.power = 0;
        this.voltage = 0;
        this.temperature = 0;
        this.energy = 0;
        this.isLoading = false;
        this.lastUpdate = null;
        this.hasLoadedInitialStatus = false; // Nueva propiedad para controlar si se ha cargado el estado inicial
        
        // Estado de automatización
        this.automationSlots = []; // Array dinámico de slots de automatización
        this.nextSlotId = 1; // ID incremental para nuevos slots
        this.powerAutomationEnabled = false; // Estado del switch de automatización por potencia
        this.timeAutomationEnabled = false; // Estado del switch de automatización horaria
        this.automationMode = 'manual'; // 'manual', 'power', 'schedule'
        this.powerThreshold = 10; // Porcentaje de potencia por defecto
        
        // Control de visibilidad
        this.visibilityObserver = null;
        this.isVisible = false;
        this.visibilityDebounceTimeout = null;
        
        // SSE para tiempo real
        this.isSSEActive = false;
        this.lastSSEMessage = null;
        this.sseManager = null;
        
        // Bind methods
        this.handleToggle = this.handleToggle.bind(this);
        this.updateStatus = this.updateStatus.bind(this);
        this.handleSSEMessage = this.handleSSEMessage.bind(this);
        this.addNewSlot = this.addNewSlot.bind(this);
        this.handleSlotChange = this.handleSlotChange.bind(this);
        this.handleSlotClear = this.handleSlotClear.bind(this);
        this.handlePowerAutomationToggle = this.handlePowerAutomationToggle.bind(this);
        this.handleTimeAutomationToggle = this.handleTimeAutomationToggle.bind(this);
    }

    static get observedAttributes() {
        return ['plug-data'];
    }

    connectedCallback() {
        this.render();
        this.setupEventListeners();
        
        // Solicitar actualización de estado al dispositivo y luego cargar estado inicial
        this.requestInitialStatusUpdate();
        
        // Cargar configuración de automatización desde el servidor
        this.loadAutomationConfig();
    }

    attributeChangedCallback(name, oldValue, newValue) {
        if (name === 'plug-data' && newValue) {
            try {
                this.plugData = JSON.parse(newValue);
                this.render();
                this.updateStatus();
                this.initializeSSE();
            } catch (error) {
                console.error('Error parsing plug data:', error);
            }
        }
    }

    disconnectedCallback() {
        // Limpiar la conexión SSE cuando el componente se desconecta
        if (this.sseManager) {
            console.log(`🔌 Desconectando SSE para plug ${this.plugData?.device_name || 'unknown'}`);
            this.sseManager.disconnect();
            this.sseManager = null;
        }

        // Limpiar otros recursos
        this.cleanupVisibilityObserver();
    }

    /**
     * Renderiza el componente
     */
    render() {
        if (!this.plugData) return;

        this.innerHTML = `
            <style>
                plug-card .plug-card {
                    background: white;
                    border-radius: 12px;
                    padding: 20px;
                    box-shadow: 0 2px 10px rgba(0,0,0,0.1);
                    display: flex;
                    align-items: stretch;
                    font-family: 'Poppins', Arial, sans-serif;
                    margin-bottom: 15px;
                }

                plug-card .plug-info {
                    flex: 1;
                    display: flex;
                    flex-direction: column;
                    padding-right: 20px;
                }

                plug-card .plug-header {
                    display: flex;
                    align-items: center;
                    margin-bottom: 15px;
                }

                plug-card .plug-icon {
                    font-size: 32px;
                    color: #fcbd25;
                    margin-right: 15px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    width: 48px;
                    height: 48px;
                }

                plug-card .plug-icon i {
                    width: 32px;
                    height: 32px;
                }

                plug-card .plug-title-section {
                    flex: 1;
                }

                plug-card .plug-name {
                    font-size: 18px;
                    font-weight: 600;
                    color: #1b4444;
                    margin-bottom: 2px;
                    letter-spacing: -1.5px;
                }

                plug-card .plug-id {
                    font-size: 12px;
                    color: #999;
                    font-family: monospace;
                }

                plug-card .plug-control-section {
                    display: flex;
                    align-items: center;
                    gap: 15px;
                }

                plug-card .plug-status-section {
                    margin-bottom: 12px;
                }

                plug-card .plug-status {
                    font-size: 14px;
                    color: #666;
                    margin-bottom: 8px;
                }

                plug-card .status-value {
                    font-weight: 600;
                }

                plug-card .status-online {
                    color: #459f49;
                }

                plug-card .status-offline {
                    color: #999;
                }

                plug-card .status-on {
                    color: #459f49;
                }

                plug-card .status-off {
                    color: #666;
                }

                plug-card .status-error {
                    color: #d32f2f;
                }

                /* Estado offline - solo afecta al switch de control */
                plug-card .plug-card.offline .toggle-switch-container {
                    opacity: 0.5;
                }

                plug-card .plug-card.offline .toggle-switch-container toggle-switch {
                    opacity: 0.3;
                    cursor: not-allowed;
                }

                /* La sección de automatización permanece funcional cuando está offline */
                plug-card .plug-card.offline .automation-section {
                    opacity: 1;
                    pointer-events: auto;
                }

                /* Toggle Switch Container */
                plug-card .toggle-switch-container {
                    display: flex;
                    align-items: center;
                }

                /* Información de métricas reorganizada */
                plug-card .plug-metrics {
                    display: grid;
                    grid-template-columns: 1fr 1fr;
                    gap: 8px 15px;
                    font-size: 13px;
                    color: #666;
                    margin-bottom: 10px;
                }

                plug-card .metric-item {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                }

                plug-card .metric-label {
                    color: #888;
                    font-size: 12px;
                }

                plug-card .metric-value {
                    font-weight: 600;
                    color: #1b4444;
                }

                /* Información de última actualización */
                plug-card .plug-last-update {
                    font-size: 11px;
                    color: #aaa;
                    font-style: italic;
                    text-align: center;
                    padding-top: 8px;
                    border-top: 1px solid #f0f0f0;
                }

                plug-card .last-update-text {
                    display: inline-block;
                }

                plug-card .separator {
                    width: 1px;
                    background-color: #e0e0e0;
                    margin: 10px 0;
                }

                plug-card .automation-section {
                    flex: 1;
                    padding-left: 20px;
                    display: flex;
                    flex-direction: column;
                }

                plug-card .automation-title {
                    color: #1b4444;
                    margin: 0 0 15px 0;
                    font-size: 16px;
                    font-weight: 600;
                    letter-spacing: -1.5px;
                }

                plug-card .automation-content {
                    flex: 1;
                }

                plug-card .automation-table {
                    border: 1px solid #e9ecef;
                    border-radius: 8px;
                    overflow: hidden;
                }

                plug-card .automation-table-header {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    padding: 12px 16px;
                    background: #f8f9fa;
                    border-bottom: 1px solid #e9ecef;
                }

                plug-card .automation-header-title {
                    font-size: 13px;
                    font-weight: 600;
                    color: #1b4444;
                    letter-spacing: -0.5px;
                }

                plug-card .automation-table-body {
                    background: white;
                    padding: 8px;
                }

                plug-card .automation-slot {
                    margin-bottom: 4px;
                }

                plug-card .automation-slot:last-child {
                    margin-bottom: 0;
                }

                /* Ajustes específicos para time-slot-selector dentro de plug-card */
                plug-card .automation-slot .time-slot-row {
                    min-height: 40px;
                    padding: 8px 12px;
                    margin-bottom: 0;
                    font-size: 12px;
                }

                plug-card .automation-slot .day-label {
                    font-size: 10px;
                }

                plug-card .automation-slot .day-tick {
                    width: 12px;
                    height: 12px;
                    font-size: 10px;
                }

                plug-card .automation-slot .time-display {
                    font-size: 11px;
                    margin-left: 15px;
                }

                plug-card .automation-slot .empty-state {
                    font-size: 11px;
                }

                plug-card .automation-slot .add-icon {
                    font-size: 16px;
                    margin-right: 8px;
                }

                plug-card .automation-placeholder {
                    color: #999;
                    font-style: italic;
                    font-size: 14px;
                    text-align: center;
                    padding: 20px;
                }

                /* Estilos para el icono de agregar nuevo slot */
                plug-card .add-new-slot {
                    display: flex;
                    justify-content: center;
                    margin-bottom: 4px;
                }

                plug-card .add-slot-icon {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    width: 32px;
                    height: 32px;
                    border-radius: 50%;
                    background-color: #fcbd25;
                    color: white;
                    cursor: pointer;
                    transition: all 0.3s ease;
                    box-shadow: 0 2px 4px rgba(0,0,0,0.1);
                }

                plug-card .add-slot-icon:hover {
                    background-color: #e6a820;
                    transform: translateY(-1px);
                    box-shadow: 0 4px 8px rgba(0,0,0,0.15);
                }

                plug-card .add-slot-icon i {
                    width: 16px;
                    height: 16px;
                }

                /* Estilos para headers de automatización con switches */
                plug-card .automation-header-with-switch {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    width: 100%;
                }

                plug-card .automation-header-switch {
                    margin-left: 10px;
                }

                /* Estados deshabilitados para automatización */
                plug-card .automation-table.disabled .automation-table-body {
                    opacity: 0.5;
                    pointer-events: none;
                }

                plug-card .loading-spinner {
                    width: 14px;
                    height: 14px;
                    border: 2px solid #f3f3f3;
                    border-top: 2px solid #1b4444;
                    border-radius: 50%;
                    animation: plug-spin 1s linear infinite;
                }

                @keyframes plug-spin {
                    0% { transform: rotate(0deg); }
                    100% { transform: rotate(360deg); }
                }

                /* Responsive */
                @media (max-width: 768px) {
                    plug-card .plug-card {
                        flex-direction: column;
                        gap: 20px;
                    }

                    plug-card .plug-info {
                        padding-right: 0;
                    }

                    plug-card .separator {
                        width: 100%;
                        height: 1px;
                        margin: 0;
                    }

                    plug-card .automation-section {
                        padding-left: 0;
                    }
                }
            </style>

            <div class="plug-card" id="plug-card">
                <!-- Información del enchufe a la izquierda -->
                <div class="plug-info">
                    <!-- Header con icono, título y switch -->
                    <div class="plug-header">
                        <div class="plug-icon">
                            <i data-lucide="plug"></i>
                        </div>
                        <div class="plug-title-section">
                            <div class="plug-name">${this.plugData.device_name}</div>
                            <div class="plug-id">${this.plugData.shelly_device_id}</div>
                        </div>
                        <div class="plug-control-section">
                            <div class="toggle-switch-container">
                                <toggle-switch  id="toggle-switch" title="Alternar estat"></toggle-switch>
                            </div>
                        </div>
                    </div>

                    <!-- Sección de estado -->
                    <div class="plug-status-section">
                        <div class="plug-status">
                            Estat: <span class="status-value" id="status-text">Carregant...</span>
                            <span class="realtime-indicator" id="realtime-indicator" style="display: none;" title="Actualització en temps real">
                                <i data-lucide="radio" style="width: 12px; height: 12px; color: #459f49; margin-left: 8px;"></i>
                            </span>
                        </div>
                    </div>

                    <!-- Métricas reorganizadas -->
                    <div class="plug-metrics" id="plug-metrics" style="display: none;">
                        <div class="metric-item" id="power-metric">
                            <span class="metric-label">Potència</span>
                            <span class="metric-value" id="power-value">--W</span>
                        </div>
                        <div class="metric-item" id="voltage-metric">
                            <span class="metric-label">Voltatge</span>
                            <span class="metric-value" id="voltage-value">--V</span>
                        </div>
                        <div class="metric-item" id="temp-metric">
                            <span class="metric-label">Temperatura</span>
                            <span class="metric-value" id="temp-value">--°C</span>
                        </div>
                        <div class="metric-item" id="energy-metric">
                            <span class="metric-label">Energia</span>
                            <span class="metric-value" id="energy-value">--Wh</span>
                        </div>
                    </div>

                    <!-- Información de última actualización -->
                    <div class="plug-last-update" id="plug-last-update" style="display: none;">
                        <span class="last-update-text" id="last-update-text">Última actualització: --</span>
                    </div>
                </div>
                
                <!-- Línea separadora -->
                <div class="separator"></div>
                
                <!-- Sección de automatización a la derecha -->
                <div class="automation-section">
                    <h4 class="automation-title">Automatització</h4>
                    <div class="automation-content">
                        <!-- Selector de modo de automatización -->
                        <div class="automation-mode-selector" style="margin-bottom: 20px;">
                            <button-toggle 
                                id="automation-mode-toggle"
                                modes="Manual,Per potència,Per horari"
                                mode="0">
                            </button-toggle>
                        </div>
                        
                        <!-- Automatización por potencia -->
                        <div class="automation-table" id="power-automation-table" style="margin-bottom: 15px; display: none;">
                            <div class="automation-table-header">
                                <div class="automation-header-title">
                                    Automatització per potència
                                </div>
                            </div>
                            <div class="automation-table-body">
                                <div style="padding: 12px; display: flex; align-items: center; gap: 8px; font-size: 13px;">
                                    <span>Enjegar l'endoll quan hi hagi un excedent del</span>
                                    <select id="power-threshold" style="padding: 4px 8px; border: 1px solid #e9ecef; border-radius: 4px; font-size: 13px;">
                                        <option value="1">1%</option>
                                        <option value="10">10%</option>
                                        <option value="20">20%</option>
                                        <option value="50">50%</option>
                                    </select>
                                </div>
                            </div>
                        </div>
                        
                        <!-- Automatización horaria -->
                        <div class="automation-table" id="time-automation-table" style="display: none;">
                            <div class="automation-table-header">
                                <div class="automation-header-title">
                                    Automatització horària
                                </div>
                            </div>
                            <div class="automation-table-body" id="automation-table-body">
                                ${this.renderAutomationSlots()}
                            </div>
                        </div>
                        
                        <!-- Modo manual -->
                        <div class="automation-manual-mode" id="manual-mode-info" style="display: block;">
                            <div style="padding: 20px; text-align: center; color: #666; font-style: italic;">
                                Mode manual activat. L'endoll es controla manualment.
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        // Inicializar iconos de Lucide después de renderizar
        if (window.lucide) {
            window.lucide.createIcons();
        }
    }

    /**
     * Configura los event listeners
     */
    setupEventListeners() {
        const toggleSwitch = this.querySelector('#toggle-switch');
        if (toggleSwitch) {
            toggleSwitch.addEventListener('toggle-change', this.handleToggle);
        }
        
        // Event listeners para slots de automatización
        this.addEventListener('time-slot-changed', this.handleSlotChange);
        this.addEventListener('time-slot-cleared', this.handleSlotClear);
        
        // Event listener para el toggle de modo de automatización
        const automationModeToggle = this.querySelector('#automation-mode-toggle');
        if (automationModeToggle) {
            automationModeToggle.addEventListener('mode-change', this.handleAutomationModeChange.bind(this));
        }
        
        // Event listener para el selector de potencia
        const powerThresholdSelect = this.querySelector('#power-threshold');
        if (powerThresholdSelect) {
            powerThresholdSelect.addEventListener('change', this.handlePowerThresholdChange.bind(this));
            powerThresholdSelect.value = this.powerThreshold; // Establecer valor inicial
        }
        
        // Inicializar slots de automatización
        this.updateAutomationSlots();
        
        // Actualizar estados de automatización
        this.updateAutomationModeDisplay();
        
        // Generar configuración inicial
        this.generateAutomationConfig();
    }

    /**
     * Maneja el toggle del plug
     */
    async handleToggle(event) {
        // No permitir toggle si no se ha cargado el estado inicial o si está cargando
        if (!this.plugData || this.isLoading || !this.hasLoadedInitialStatus) {
            event.preventDefault();
            return;
        }

        const newState = event.detail.checked;
        const previousState = this.isOn;
        
        // 1. Actualización del estado interno (sin forzar la UI del switch)
        this.isOn = newState;
        this.updateStatusTextOnly(); // Solo actualizar texto de estado, no el switch
        
        // 2. Mostrar brevemente estado "enviando"
        this.setLoading(true);

        try {
            // 3. Determinar la acción específica basada en el nuevo estado
            const action = newState ? 'on' : 'off';
            
            // 4. Enviar comando al endpoint de control
            const response = await window.apiClient.post(`/api/plugs/${this.plugData.id}/control`, { 
                action: action 
            });

            // 5. Emitir evento personalizado de éxito
            this.dispatchEvent(new CustomEvent('plug-toggled', {
                detail: {
                    plugId: this.plugData.id,
                    plugName: this.plugData.device_name,
                    success: true,
                    action: action,
                    previousState: previousState,
                    newState: this.isOn,
                    data: response.data
                },
                bubbles: true
            }));

            console.log(`Plug ${this.plugData.device_name} ${action} command sent successfully`);

        } catch (error) {
            console.error('Error toggling plug:', error);
            
            // 6. Revertir estado visual si hay error
            this.isOn = previousState;
            const toggleSwitch = this.querySelector('#toggle-switch');
            if (toggleSwitch) {
                toggleSwitch.setCheckedSilently(previousState);
            }
            this.updateStatusTextOnly(); // Solo actualizar texto, el switch ya está revertido
            
            // 7. Emitir evento de error
            this.dispatchEvent(new CustomEvent('plug-error', {
                detail: {
                    plugId: this.plugData.id,
                    plugName: this.plugData.device_name,
                    error: error.message,
                    revertedState: previousState
                },
                bubbles: true
            }));
        } finally {
            // 8. Quitar indicador de loading después de un breve delay
            setTimeout(() => {
                this.setLoading(false);
            }, 300);
        }
    }

    /**
     * Actualiza el estado del plug (fallback para cuando SSE no está disponible)
     */
    async updateStatus() {
        if (!this.plugData) return;
        
        // Si SSE está activo, no hacer polling
        if (this.isSSEActive) {
            console.log(`SSE activo para ${this.plugData.device_name}, omitiendo polling`);
            return;
        }
        
        try {
            const response = await window.apiClient.get(`/api/plugs/${this.plugData.id}/status`);
            const data = response.data;
            console.log('Fetched plug status via API:', data);

            // Actualizar estado interno con datos reales de la API
            this.isOnline = data.isOnline;
            this.isOn = data.isOn; // Usar el estado real del dispositivo
            this.power = data.power || 0;
            this.voltage = data.voltage || 0;
            this.temperature = data.temperature || 0;
            this.lastUpdate = data.lastUpdate;

            // Marcar que se ha cargado el estado inicial
            this.hasLoadedInitialStatus = true;

            // Actualizar la visualización con los datos reales
            this.updateStatusDisplay();

            console.log(`Plug ${this.plugData.device_name} status updated via API:`, {
                isOnline: this.isOnline,
                isOn: this.isOn,
                power: this.power
            });

        } catch (error) {
            console.error('Error updating plug status:', error);
            this.isOnline = false;
            this.isOn = false; // Resetear también el estado on/off en caso de error
            this.hasLoadedInitialStatus = true; // Marcar como cargado incluso en error para evitar bloqueo permanente
            this.updateStatusDisplay(true);
        }
    }

    /**
     * Maneja mensajes SSE en tiempo real
     * @param {Object} data - Datos del mensaje SSE
     */
    handleSSEMessage(data) {
       
        if (!this.plugData || !data) return;

        try {
            // Verificar que el mensaje es para este dispositivo
            const expectedTopicPrefix = `${this.plugData.shelly_device_id}/status/switch:0`;
            if (!data.topic || !data.topic.includes(expectedTopicPrefix)) {
                return; // No es para este dispositivo
            }

            console.log(`📡 SSE message received for ${this.plugData.device_name}:`, data);

            // Parsear el payload JSON
            let payloadData;
            try {
                payloadData = JSON.parse(data.payload);
            } catch (parseError) {
                console.error('Error parsing SSE payload:', parseError, data.payload);
                return;
            }

            // Extraer datos del payload
            const wasOnline = this.isOnline;
            const wasOn = this.isOn;
            
            // Actualizar estado interno con datos en tiempo real
            this.isOnline = true; // Si recibimos mensaje MQTT, el dispositivo está online
            this.isOn = payloadData.output || false;
            this.power = payloadData.apower || 0;
            this.voltage = payloadData.voltage || 0;
            
            // Extraer temperatura si está disponible
            if (payloadData.temperature && payloadData.temperature.tC !== undefined) {
                this.temperature = payloadData.temperature.tC;
            }
            
            // Extraer energía total si está disponible
            if (payloadData.aenergy && payloadData.aenergy.total !== undefined) {
                this.energy = payloadData.aenergy.total;
            }
            
            // Actualizar timestamp
            this.lastUpdate = data.timestamp || new Date().toISOString();
            this.lastSSEMessage = data;

            // Marcar que se ha cargado el estado inicial si no estaba marcado
            if (!this.hasLoadedInitialStatus) {
                this.hasLoadedInitialStatus = true;
                console.log(`✅ Estado inicial cargado via SSE para ${this.plugData.device_name}`);
            }

            // Marcar SSE como activo
            this.isSSEActive = true;

            // Mostrar indicador de tiempo real
            this.showRealtimeIndicator();

            // Actualizar la visualización
            this.updateStatusDisplay();

            // Log de cambios significativos
            if (wasOnline !== this.isOnline || wasOn !== this.isOn) {
                console.log(`🔄 Estado cambiado para ${this.plugData.device_name}:`, {
                    online: `${wasOnline} → ${this.isOnline}`,
                    on: `${wasOn} → ${this.isOn}`,
                    power: this.power,
                    timestamp: this.lastUpdate
                });
            }

            // Emitir evento personalizado para notificar cambios
            this.dispatchEvent(new CustomEvent('plug-sse-update', {
                detail: {
                    plugId: this.plugData.id,
                    plugName: this.plugData.device_name,
                    shellyDeviceId: this.plugData.shelly_device_id,
                    isOnline: this.isOnline,
                    isOn: this.isOn,
                    power: this.power,
                    voltage: this.voltage,
                    temperature: this.temperature,
                    lastUpdate: this.lastUpdate,
                    rawData: payloadData
                },
                bubbles: true
            }));

        } catch (error) {
            console.error(`❌ Error procesando mensaje SSE para ${this.plugData.device_name}:`, error, data);
        }
    }

    /**
     * Actualiza la visualización del estado
     */
    updateStatusDisplay(hasError = false) {
        const statusText = this.querySelector('#status-text');
        const plugCard = this.querySelector('#plug-card');
        const plugMetrics = this.querySelector('#plug-metrics');
        const toggleSwitch = this.querySelector('#toggle-switch');
        
        // Elementos de métricas reorganizadas
        const powerValue = this.querySelector('#power-value');
        const voltageValue = this.querySelector('#voltage-value');
        const tempValue = this.querySelector('#temp-value');
        const energyValue = this.querySelector('#energy-value');
        
        const plugLastUpdate = this.querySelector('#plug-last-update');
        const lastUpdateText = this.querySelector('#last-update-text');

        if (!statusText || !plugCard) return;

        // Controlar la disponibilidad del switch basado en si se ha cargado el estado inicial
        if (toggleSwitch) {
            if (!this.hasLoadedInitialStatus) {
                // Switch deshabilitado hasta que se cargue el estado inicial
                toggleSwitch.disabled = true;
                toggleSwitch.title = 'Carregant estat del dispositiu...';
                toggleSwitch.setCheckedSilently(false);
            } else if (this.isLoading) {
                // Switch en estado de loading
                toggleSwitch.loading = true;
                toggleSwitch.disabled = true;
                toggleSwitch.title = 'Enviant comanda...';
            } else if (!this.isOnline || hasError) {
                // Switch deshabilitado si está offline o hay error
                toggleSwitch.disabled = true;
                toggleSwitch.loading = false;
                toggleSwitch.title = 'Dispositiu no disponible';
                toggleSwitch.setCheckedSilently(false);
            } else {
                // Switch habilitado y funcional
                toggleSwitch.disabled = false;
                toggleSwitch.loading = false;
                toggleSwitch.title = 'Alternar estat';
                toggleSwitch.setCheckedSilently(this.isOn);
            }
        }

        // Actualizar información de última actualización SIEMPRE (online o offline)
        if (plugLastUpdate && lastUpdateText && this.lastUpdate) {
            const lastUpdateDate = new Date(this.lastUpdate);
            const formattedDate = lastUpdateDate.toLocaleString('ca-ES', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
            lastUpdateText.textContent = `Última actualització: ${formattedDate}`;
            plugLastUpdate.style.display = 'block';
        }

        if (hasError) {
            statusText.textContent = 'Error';
            statusText.className = 'status-value status-error';
            plugCard.classList.add('offline');
            if (plugMetrics) plugMetrics.style.display = 'none';
            return;
        }

        // Actualizar estado principal
        let text = '';
        let className = 'status-value';

        if (!this.hasLoadedInitialStatus) {
            text = 'Carregant...';
            className += ' status-offline';
            if (plugMetrics) plugMetrics.style.display = 'none';
        } else if (!this.isOnline) {
            text = 'Fora de línia';
            className += ' status-offline';
            // Aplicar clase offline solo para efectos visuales en el switch
            plugCard.classList.add('offline');
            if (plugMetrics) plugMetrics.style.display = 'none';
        } else {
            // Quitar clase offline si está online
            plugCard.classList.remove('offline');
            
            if (this.isOn) {
                text = 'Encès';
                className += ' status-on';
            } else {
                text = 'Apagat';
                className += ' status-off';
            }

            // Mostrar métricas si está online
            if (plugMetrics) {
                plugMetrics.style.display = 'grid';
                
                // Actualizar métricas individuales con la nueva estructura
                if (powerValue) {
                    // Si el dispositivo está apagado, mostrar "-" para potencia
                    if (this.isOn) {
                        powerValue.textContent = `${this.power}W`;
                    } else {
                        powerValue.textContent = `-`;
                    }
                }
                if (voltageValue) {
                    voltageValue.textContent = `${this.voltage}V`;
                }
                if (tempValue) {
                    tempValue.textContent = `${this.temperature}°C`;
                }
                if (energyValue) {
                    // Si el dispositivo está apagado, mostrar "-" para energía
                    if (this.isOn) {
                        // Calcular energía aproximada (esto podría venir del API en el futuro)
                        const energy = Math.round(this.power * 0.1); // Estimación simple
                        energyValue.textContent = `${energy}Wh`;
                    } else {
                        energyValue.textContent = `-`;
                    }
                }
            }
        }

        statusText.textContent = text;
        statusText.className = className;
    }

    /**
     * Actualiza solo el texto de estado y métricas sin afectar el switch
     */
    updateStatusTextOnly() {
        const statusText = this.querySelector('#status-text');
        const powerValue = this.querySelector('#power-value');
        const energyValue = this.querySelector('#energy-value');
        
        if (!statusText) return;

        let text = '';
        let className = 'status-value';

        if (!this.hasLoadedInitialStatus) {
            text = 'Carregant...';
            className += ' status-offline';
        } else if (!this.isOnline) {
            text = 'Fora de línia';
            className += ' status-offline';
        } else {
            if (this.isOn) {
                text = 'Encès';
                className += ' status-on';
                
                // Actualizar métricas cuando está encendido
                if (powerValue) {
                    powerValue.textContent = `${this.power}W`;
                }
                if (energyValue) {
                    const energy = Math.round(this.power * 0.1);
                    energyValue.textContent = `${energy}Wh`;
                }
            } else {
                text = 'Apagat';
                className += ' status-off';
                
                // Mostrar "-" cuando está apagado
                if (powerValue) {
                    powerValue.textContent = `-`;
                }
                if (energyValue) {
                    energyValue.textContent = `-`;
                }
            }
        }

        statusText.textContent = text;
        statusText.className = className;
    }

    /**
     * Establece el estado de loading sin afectar la posición del switch
     */
    setLoading(loading) {
        this.isLoading = loading;
        const toggleSwitch = this.querySelector('#toggle-switch');
        
        if (toggleSwitch) {
            toggleSwitch.loading = loading;
            toggleSwitch.disabled = loading;
            // NO llamar a setCheckedSilently aquí para evitar interferir con la interacción del usuario
        }
    }

    /**
     * Inicializa la conexión SSE para este plug
     */
    initializeSSE() {
        if (!this.plugData?.shelly_device_id) {
            console.warn('No se puede inicializar SSE: faltan datos del plug');
            return;
        }

        // Crear instancia de SSEManager para el endpoint de plugs
        this.sseManager = new SSEManager('/api/sse/plugs');

        // Agregar callback que filtra mensajes para este dispositivo
        this.sseManager.addCallback((data) => {
            // Filtrar mensajes que empiecen con el shelly_device_id de este plug
            if (data.topic && data.topic.startsWith(this.plugData.shelly_device_id)) {
                this.handleSSEMessage(data);
            }
        });

        console.log(`🔌 SSE inicializado para plug ${this.plugData.device_name} (${this.plugData.shelly_device_id})`);
    }

    /**
     * Limpia el Intersection Observer
     */
    cleanupVisibilityObserver() {
        if (this.visibilityObserver) {
            this.visibilityObserver.disconnect();
            this.visibilityObserver = null;
        }

        // Limpiar timeout de debounce si existe
        if (this.visibilityDebounceTimeout) {
            clearTimeout(this.visibilityDebounceTimeout);
            this.visibilityDebounceTimeout = null;
        }

        console.log(`Visibility observer limpiado para plug ${this.plugData?.device_name || 'unknown'}`);
    }

    /**
     * Muestra el indicador de tiempo real
     */
    showRealtimeIndicator() {
        const indicator = this.querySelector('#realtime-indicator');
        if (indicator) {
            indicator.style.display = 'inline';
            // Re-inicializar el icono de Lucide si es necesario
            if (window.lucide) {
                window.lucide.createIcons();
            }
        }
    }

    /**
     * Oculta el indicador de tiempo real
     */
    hideRealtimeIndicator() {
        const indicator = this.querySelector('#realtime-indicator');
        if (indicator) {
            indicator.style.display = 'none';
        }
    }

   
    /**
     * Métodos públicos para control externo
     */
    
    /**
     * Actualiza los datos del plug
     */
    setPlugData(plugData) {
        this.plugData = plugData;
        this.render();
        this.updateStatus();
    }

    /**
     * Obtiene el estado actual del plug
     */
    getPlugState() {
        return {
            id: this.plugData?.id,
            isOnline: this.isOnline,
            isOn: this.isOn,
            power: this.power,
            isLoading: this.isLoading
        };
    }

    /**
     * Fuerza una actualización del estado
     */
    forceStatusUpdate() {
        this.updateStatus();
    }

    /**
     * Solicita actualización inicial del estado al dispositivo
     */
    async requestInitialStatusUpdate() {
        if (!this.plugData) return;

        try {
            console.log(`Requesting initial status update for plug ${this.plugData.device_name}`);
            
            // Enviar comando status_update al dispositivo
            var ret = await window.apiClient.post(`/api/plugs/${this.plugData.id}/status_update`);
            
            console.log(`Status update command sent to plug ${this.plugData.device_name}`);
            
            // Esperar un poco para que el dispositivo procese el comando y luego obtener el estado
            setTimeout(() => {
                this.updateStatus();
            }, 2000); // 2 segundos de delay

        } catch (error) {
            console.error('Error requesting initial status update:', error);
            // Si falla el status_update, intentar obtener el estado de todas formas
            this.updateStatus();
        }
    }

    /**
     * Renderiza los slots de automatización dinámicamente
     */
    renderAutomationSlots() {
        let slotsHtml = '';
        
        // Renderizar slots existentes
        this.automationSlots.forEach(slot => {
            slotsHtml += `<time-slot-selector class="automation-slot" data-slot-id="${slot.id}"></time-slot-selector>`;
        });
        
        // Agregar icono discreto para añadir nuevo slot
        slotsHtml += `
            <div class="add-new-slot" id="add-new-slot">
                <div class="add-slot-icon" title="Afegir nova franja horària">
                    <i data-lucide="plus"></i>
                </div>
            </div>
        `;
        
        return slotsHtml;
    }

    /**
     * Actualiza la visualización de los slots de automatización
     */
    updateAutomationSlots() {
        const automationTableBody = this.querySelector('#automation-table-body');
        if (automationTableBody) {
            automationTableBody.innerHTML = this.renderAutomationSlots();
            
            // Re-configurar event listeners para el botón de agregar
            const addNewSlotBtn = this.querySelector('#add-new-slot');
            if (addNewSlotBtn) {
                addNewSlotBtn.addEventListener('click', this.addNewSlot);
            }
            
            // Inicializar iconos de Lucide
            if (window.lucide) {
                window.lucide.createIcons();
            }
            
            // Configurar datos de slots existentes
            this.automationSlots.forEach(slot => {
                const slotElement = this.querySelector(`[data-slot-id="${slot.id}"]`);
                if (slotElement && slot.data) {
                    slotElement.setTimeSlotData(slot.data);
                }
            });
        }
    }

    /**
     * Agrega un nuevo slot de automatización
     */
    addNewSlot() {
        const newSlot = {
            id: this.nextSlotId++,
            data: null
        };
        
        this.automationSlots.push(newSlot);
        this.updateAutomationSlots();
        
        console.log(`Added new automation slot with ID: ${newSlot.id}`);
    }

    /**
     * Maneja cambios en un slot de automatización
     */
    handleSlotChange(event) {
        const slotElement = event.target;
        const slotId = parseInt(slotElement.dataset.slotId);
        
        if (slotId) {
            const slot = this.automationSlots.find(s => s.id === slotId);
            if (slot) {
                slot.data = event.detail;
                console.log(`Automation slot ${slotId} updated:`, event.detail);
                
                // Verificar si el slot tiene datos válidos, si no, eliminarlo
                if (!this.isValidSlotData(event.detail)) {
                    console.log(`Automation slot ${slotId} has no valid data, removing it`);
                    this.removeSlot(slotId);
                    return;
                }
                
                // Generar y guardar configuración automáticamente
                this.generateAutomationConfig();
                this.saveAutomationConfig();
            }
        }
    }

    /**
     * Maneja la eliminación de un slot de automatización
     */
    handleSlotClear(event) {
        const slotElement = event.target;
        const slotId = parseInt(slotElement.dataset.slotId);
        
        if (slotId) {
            // Eliminar el slot del array
            this.automationSlots = this.automationSlots.filter(s => s.id !== slotId);
            
            // Actualizar la visualización
            this.updateAutomationSlots();
            
            console.log(`Automation slot ${slotId} removed`);
            
            // Aquí podrías enviar los datos actualizados al servidor
            this.saveAutomationConfig();
        }
    }

    /**
     * Guarda la configuración de automatización en el servidor
     */
    async saveAutomationConfig() {
        if (!this.plugData?.id) {
            console.error('No hay plugData disponible para guardar configuración');
            return;
        }

        try { 
            // Generar configuración en el formato esperado por el backend
            const config = this.generateAutomationConfig();
            
            console.log('Guardando configuración de automatización:', config);
            
            // Llamada al API para guardar la configuración
            const response = await window.apiClient.post(`/api/plugs/${this.plugData.id}/automation`, config);
            
            console.log('✅ Configuración de automatización guardada exitosamente:', response.data);
            
            // Emitir evento de éxito
            this.dispatchEvent(new CustomEvent('automation-saved', {
                detail: {
                    plugId: this.plugData.id,
                    plugName: this.plugData.device_name,
                    config: config,
                    response: response.data
                },
                bubbles: true
            }));
            
        } catch (error) {
            console.error('❌ Error guardando configuración de automatización:', error);
            
            // Emitir evento de error
            this.dispatchEvent(new CustomEvent('automation-error', {
                detail: {
                    plugId: this.plugData.id,
                    plugName: this.plugData.device_name,
                    error: error.message,
                    config: this.generateAutomationConfig()
                },
                bubbles: true
            }));
        }
    }

    /**
     * Carga la configuración de automatización desde el servidor
     */
    async loadAutomationConfig() {
        if (!this.plugData?.id) {
            console.error('No hay plugData disponible para cargar configuración');
            // Inicializar con configuración por defecto
            this.initializeDefaultAutomation();
            return;
        }
        
        try {
            console.log('Cargando configuración de automatización desde el servidor...');
            
            // Llamada al API para cargar la configuración
            const response = await window.apiClient.get(`/api/plugs/${this.plugData.id}/automation`);
            const serverConfig = response.data;
            
            console.log('✅ Configuración cargada desde el servidor:', serverConfig);
            
            // Aplicar la configuración cargada
            this.applyServerConfig(serverConfig.automation);
            
        } catch (error) {
            console.error('❌ Error cargando configuración de automatización:', error);
            
            // Si hay error, inicializar con configuración por defecto
            this.initializeDefaultAutomation();
        }
    }

    /**
     * Aplica una configuración cargada desde el servidor
     */
    applyServerConfig(automation) {
        if (!automation) {
            this.initializeDefaultAutomation();
            return;
        }

        // Aplicar tipo de automatización
        this.automationMode = automation.type || 'manual';
        
        // Aplicar umbral de potencia
        this.powerThreshold = automation.power || 10;
        
        // Limpiar slots existentes
        this.automationSlots = [];
        this.nextSlotId = 1;
        
        // Aplicar slots de horario si existen
        if (automation.schedule && Array.isArray(automation.schedule)) {
            automation.schedule.forEach(serverSlot => {
                const slot = {
                    id: this.nextSlotId++,
                    data: {
                        selectedDays: serverSlot.days || [],
                        startTime: serverSlot.startTime || '',
                        endTime: serverSlot.endTime || '',
                        hasData: true
                    }
                };
                this.automationSlots.push(slot);
            });
        }
        
        // Si no hay slots y el modo es schedule, agregar uno vacío
        if (this.automationMode === 'schedule' && this.automationSlots.length === 0) {
            this.addNewSlot();
        }
        
        // Actualizar la UI
        this.updateAutomationModeFromConfig();
        this.updateAutomationSlots();
        
        console.log('Configuración aplicada:', {
            mode: this.automationMode,
            power: this.powerThreshold,
            slots: this.automationSlots.length
        });
    }

    /**
     * Inicializa la automatización con valores por defecto
     */
    initializeDefaultAutomation() {
        this.automationMode = 'manual';
        this.powerThreshold = 10;
        this.automationSlots = [];
        this.nextSlotId = 1;
        
        // Agregar un slot vacío para el modo schedule
        this.addNewSlot();
        
        // Actualizar la UI
        this.updateAutomationModeFromConfig();
        this.updateAutomationSlots();
        
        console.log('Configuración por defecto inicializada');
    }

    /**
     * Actualiza el modo de automatización en la UI basándose en la configuración cargada
     */
    updateAutomationModeFromConfig() {
        const automationModeToggle = this.querySelector('#automation-mode-toggle');
        if (automationModeToggle) {
            let modeIndex = 0;
            switch (this.automationMode) {
                case 'manual':
                    modeIndex = 0;
                    break;
                case 'power':
                    modeIndex = 1;
                    break;
                case 'schedule':
                    modeIndex = 2;
                    break;
            }
            
            // Establecer el modo sin disparar eventos
            automationModeToggle.setAttribute('mode', modeIndex.toString());
            
            // Actualizar la visualización
            this.updateAutomationModeDisplay(modeIndex);
        }
        
        // Actualizar el selector de potencia
        const powerThresholdSelect = this.querySelector('#power-threshold');
        if (powerThresholdSelect) {
            powerThresholdSelect.value = this.powerThreshold;
        }
    }

    /**
     * Valida si un slot tiene datos válidos (días seleccionados y horarios configurados)
     */
    isValidSlotData(slotData) {
        if (!slotData) return false;
        
        // Verificar que tenga días seleccionados
        if (!slotData.selectedDays || slotData.selectedDays.length === 0) {
            return false;
        }
        
        // Verificar que tenga horarios configurados
        if (!slotData.startTime || !slotData.endTime) {
            return false;
        }
        
        return true;
    }

    /**
     * Elimina un slot específico por ID
     */
    removeSlot(slotId) {
        // Eliminar el slot del array
        this.automationSlots = this.automationSlots.filter(s => s.id !== slotId);
        
        // Actualizar la visualización
        this.updateAutomationSlots();
        
        console.log(`Automation slot ${slotId} removed due to invalid data`);
        
        // Guardar configuración actualizada
        this.saveAutomationConfig();
    }

    /**
     * Maneja el toggle de automatización por potencia
     */
    handlePowerAutomationToggle(event) {
        this.powerAutomationEnabled = event.detail.checked;
        console.log(`Power automation ${this.powerAutomationEnabled ? 'enabled' : 'disabled'}`);
        this.updateAutomationStates();
        this.saveAutomationConfig();
    }

    /**
     * Maneja el toggle de automatización horaria
     */
    handleTimeAutomationToggle(event) {
        this.timeAutomationEnabled = event.detail.checked;
        console.log(`Time automation ${this.timeAutomationEnabled ? 'enabled' : 'disabled'}`);
        this.updateAutomationStates();
        this.saveAutomationConfig();
    }

    /**
     * Actualiza los estados visuales de las secciones de automatización
     */
    updateAutomationStates() {
        const powerTable = this.querySelector('#power-automation-table');
        const timeTable = this.querySelector('#time-automation-table');

        if (powerTable) {
            if (this.powerAutomationEnabled) {
                powerTable.classList.remove('disabled');
            } else {
                powerTable.classList.add('disabled');
            }
        }

        if (timeTable) {
            if (this.timeAutomationEnabled) {
                timeTable.classList.remove('disabled');
            } else {
                timeTable.classList.add('disabled');
            }
        }
    }

    /**
     * Maneja el cambio de modo de automatización
     */
    handleAutomationModeChange(event) {
        const mode = event.detail.index;
        const modeValue = event.detail.value;
        
        // Actualizar el modo interno
        switch (mode) {
            case 0:
                this.automationMode = 'manual';
                break;
            case 1:
                this.automationMode = 'power';
                break;
            case 2:
                this.automationMode = 'schedule';
                break;
        }
        
        console.log(`Automation mode changed to: ${modeValue} (${mode})`);
        
        // Actualizar la visualización según el modo seleccionado
        this.updateAutomationModeDisplay(mode);
        
        // Generar y guardar configuración automáticamente
        this.generateAutomationConfig();
        this.saveAutomationConfig();
    }

    /**
     * Maneja el cambio del umbral de potencia
     */
    handlePowerThresholdChange(event) {
        this.powerThreshold = parseInt(event.target.value);
        console.log(`Power threshold changed to: ${this.powerThreshold}%`);
        
        // Generar y guardar configuración automáticamente
        this.generateAutomationConfig();
        this.saveAutomationConfig();
    }

    /**
     * Actualiza la visualización según el modo de automatización seleccionado
     */
    updateAutomationModeDisplay(mode = 0) {
        const manualModeInfo = this.querySelector('#manual-mode-info');
        const powerAutomationTable = this.querySelector('#power-automation-table');
        const timeAutomationTable = this.querySelector('#time-automation-table');
        
        // Ocultar todas las secciones primero
        if (manualModeInfo) manualModeInfo.style.display = 'none';
        if (powerAutomationTable) powerAutomationTable.style.display = 'none';
        if (timeAutomationTable) timeAutomationTable.style.display = 'none';
        
        // Mostrar la sección correspondiente al modo seleccionado
        switch (mode) {
            case 0: // Manual
                if (manualModeInfo) manualModeInfo.style.display = 'block';
                break;
            case 1: // Per potència
                if (powerAutomationTable) powerAutomationTable.style.display = 'block';
                break;
            case 2: // Per horari
                if (timeAutomationTable) timeAutomationTable.style.display = 'block';
                // Asegurar que hay al menos un slot de automatización
                if (this.automationSlots.length === 0) {
                    this.addNewSlot();
                }
                break;
        }
    }

    /**
     * Genera y muestra por consola el JSON de configuración de automatización
     */
    generateAutomationConfig() {
        const config = {
            type: this.automationMode,
            power: this.powerThreshold,
            schedule: this.automationSlots
                .filter(slot => slot.data && this.isValidSlotData(slot.data))
                .map(slot => ({
                    id: slot.id,
                    days: slot.data.selectedDays,
                    startTime: slot.data.startTime,
                    endTime: slot.data.endTime,
                    enabled: slot.data.hasData
                }))
        };

        console.log(`🔧 Configuració d'automatització per ${this.plugData?.device_name || 'Plug'}:`, JSON.stringify(config, null, 2));
        
        return config;
    }
}

// Registrar el web component
customElements.define('plug-card', PlugCard);

// Exportar para uso en módulos
if (typeof module !== 'undefined' && module.exports) {
    module.exports = PlugCard;
}
