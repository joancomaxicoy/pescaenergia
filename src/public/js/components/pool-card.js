class PoolCard extends HTMLElement {
    constructor() {
        super();

        this.poolData = null;
        this.isLoading = false;

        this.elements = {
            bombaDepuradora: { isOn: false, power: 0, isOnline: true, minutesToday: 0 },
            bombaNeteja: { isOn: false, power: 0, isOnline: true, minutesToday: 0 },
            cloradorSali: { isOn: false, power: 0, isOnline: true, minutesToday: 0 }
        };

        this.totalPower = 0;
        this.solarExcedent = 0;
        this.mode = 'manual';

        this.schedule = {
            bombaDepuradora: { start: '09:00', end: '15:00' },
            bombaNeteja: { start: '09:00', end: '12:00' },
            cloradorSali: { start: '11:00', end: '15:00' }
        };
        this.automatic = {
            maxHours: { bombaDepuradora: 5, bombaNeteja: 1, cloradorSali: 4 },
            thresholds: { bombaDepuradora: 0.5, bombaNeteja: 1.2, cloradorSali: 0.8 },
            offThresholds: { bombaDepuradora: 0.1, bombaNeteja: 0.3, cloradorSali: 0.2 }
        };
        this.lastUpdate = null;

        this.statusCheckInterval = null;
        this.excedentInterval = null;

        this.handleToggle = this.handleToggle.bind(this);
        this.setMode = this.setMode.bind(this);
        this.saveAutomation = this.saveAutomation.bind(this);
        this.requestStatusUpdate = this.requestStatusUpdate.bind(this);
        this.fetchPoolHours = this.fetchPoolHours.bind(this);
        this.hoursInterval = null;
    }

    static get observedAttributes() {
        return ['pool-data'];
    }

    connectedCallback() {
        if (this._initialized) return;
        this._initialized = true;

        if (!this.poolData) {
            const attr = this.getAttribute('pool-data');
            if (attr) {
                try { this.poolData = JSON.parse(attr); } catch { /* ignore */ }
            }
        }

        this.render();
        this.setupEventListeners();
        this.fetchInitialStatus(true);
        this.loadAutomationConfig();
        this.fetchPoolHours();
        this.startPolling();
    }

    disconnectedCallback() {
        if (this.statusCheckInterval) {
            clearInterval(this.statusCheckInterval);
            this.statusCheckInterval = null;
        }
        if (this.excedentInterval) {
            clearInterval(this.excedentInterval);
            this.excedentInterval = null;
        }
        if (this.hoursInterval) {
            clearInterval(this.hoursInterval);
            this.hoursInterval = null;
        }
        this._initialized = false;
    }

    attributeChangedCallback(name, oldValue, newValue) {
        if (name === 'pool-data' && newValue) {
            try {
                this.poolData = JSON.parse(newValue);
            } catch (error) {
                console.error('Error parsing pool data:', error);
            }
        }
    }

    // ===== HOURS FROM SERVER =====
    async fetchPoolHours() {
        if (!this.poolData?.deviceId) return;
        try {
            const deviceId = encodeURIComponent(this.poolData.deviceId);
            const { data } = await window.apiClient.get(`/api/pool/hours?deviceId=${deviceId}`);
            const hoursData = data?.data || data;
            if (!hoursData?.date) return;
            for (const [key, el] of Object.entries(this.elements)) {
                if (hoursData[key] !== undefined) {
                    el.minutesToday = hoursData[key];
                }
            }
            this.updateUI();
        } catch (e) {
            console.warn('No s\'han pogut carregar hores del servidor:', e.message);
        }
    }

    // ===== RENDER =====
    render() {
        const deviceId = this.poolData?.deviceId || 'DepuradoraPiscina/----';
        const deviceName = this.poolData?.deviceName || 'Depuradora Piscina';
        const cups = deviceId.split('/')[1] || '----';

        this.innerHTML = `
            <style>
                pool-card {
                    display: block;
                    font-family: 'Poppins', Arial, sans-serif;
                    color: #1b4444;
                }

                pool-card .pool-card {
                    background: white;
                    border-radius: 16px;
                    padding: 25px;
                    box-shadow: 0 2px 10px rgba(0,0,0,0.08);
                    margin-bottom: 20px;
                }

                pool-card .pool-card-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 20px;
                    flex-wrap: wrap;
                    gap: 15px;
                }

                pool-card .device-info {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                }

                pool-card .device-icon-box {
                    font-size: 28px;
                    background: #1b4444;
                    color: white;
                    width: 45px;
                    height: 45px;
                    border-radius: 10px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }

                pool-card .device-name {
                    font-size: 18px;
                    font-weight: 600;
                    letter-spacing: -0.5px;
                }

                pool-card .device-id {
                    font-size: 12px;
                    color: #999;
                    font-family: monospace;
                }

                pool-card .device-stats {
                    display: flex;
                    gap: 25px;
                    flex-wrap: wrap;
                }

                pool-card .stat-item {
                    text-align: center;
                }

                pool-card .stat-value {
                    font-size: 20px;
                    font-weight: 700;
                    color: #1b4444;
                }

                pool-card .stat-label {
                    font-size: 11px;
                    color: #999;
                    text-transform: uppercase;
                    letter-spacing: 0.5px;
                }

                pool-card .stat-value.positive {
                    color: #459f49;
                }

                pool-card .stat-value.negative {
                    color: #d32f2f;
                }

                pool-card .mode-selector {
                    display: flex;
                    gap: 10px;
                    margin-bottom: 25px;
                    padding: 15px;
                    background: #f8f9fa;
                    border-radius: 12px;
                    flex-wrap: wrap;
                }

                pool-card .mode-btn {
                    flex: 1;
                    min-width: 120px;
                    padding: 12px 20px;
                    border: 2px solid transparent;
                    border-radius: 10px;
                    background: white;
                    cursor: pointer;
                    transition: all 0.3s ease;
                    font-family: 'Poppins', sans-serif;
                    font-weight: 500;
                    font-size: 13px;
                    color: #666;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    gap: 8px;
                }

                pool-card .mode-btn:hover {
                    transform: translateY(-2px);
                    box-shadow: 0 4px 12px rgba(0,0,0,0.08);
                }

                pool-card .mode-btn.active {
                    border-color: #1b4444;
                    background: #1b4444;
                    color: white;
                    box-shadow: 0 4px 12px rgba(27,68,68,0.2);
                }

                pool-card .mode-btn .mode-badge {
                    font-size: 10px;
                    background: rgba(0,0,0,0.06);
                    padding: 2px 8px;
                    border-radius: 10px;
                }

                pool-card .mode-btn.active .mode-badge {
                    background: rgba(255,255,255,0.2);
                }

                pool-card .elements-grid {
                    display: grid;
                    grid-template-columns: repeat(3, 1fr);
                    gap: 15px;
                    margin-bottom: 20px;
                }

                pool-card .element-card {
                    background: #f8f9fa;
                    border-radius: 12px;
                    padding: 18px;
                    transition: all 0.3s ease;
                    border: 2px solid transparent;
                    position: relative;
                    overflow: hidden;
                }

                pool-card .element-card:hover {
                    transform: translateY(-2px);
                    box-shadow: 0 4px 15px rgba(0,0,0,0.06);
                }

                pool-card .element-card.on {
                    border-color: #459f49;
                    background: #f0f7f0;
                }

                pool-card .element-card.off {
                    border-color: #e0e0e0;
                }

                pool-card .element-card .element-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 10px;
                }

                pool-card .element-card .element-name {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    font-weight: 600;
                    font-size: 14px;
                }

                pool-card .element-card .element-name .element-icon {
                    font-size: 20px;
                }

                pool-card .element-card .status-indicator {
                    width: 10px;
                    height: 10px;
                    border-radius: 50%;
                    display: inline-block;
                    transition: all 0.3s ease;
                }

                pool-card .element-card .status-indicator.on {
                    background: #459f49;
                    box-shadow: 0 0 10px rgba(69,159,73,0.4);
                    animation: poolPulse 1.5s infinite;
                }

                pool-card .element-card .status-indicator.off {
                    background: #ccc;
                }

                @keyframes poolPulse {
                    0%, 100% { opacity: 1; transform: scale(1); }
                    50% { opacity: 0.6; transform: scale(1.2); }
                }

                pool-card .element-card .status-text {
                    font-size: 11px;
                    font-weight: 500;
                }

                pool-card .element-card .status-text.on {
                    color: #459f49;
                }

                pool-card .element-card .status-text.off {
                    color: #999;
                }

                pool-card .element-card .element-metrics {
                    display: grid;
                    grid-template-columns: 1fr 1fr;
                    gap: 6px;
                    margin: 10px 0;
                }

                pool-card .element-card .metric {
                    background: white;
                    padding: 6px 10px;
                    border-radius: 8px;
                    text-align: center;
                }

                pool-card .element-card .metric .metric-value {
                    font-weight: 700;
                    font-size: 15px;
                    color: #1b4444;
                }

                pool-card .element-card .metric .metric-value.off {
                    color: #ccc;
                }

                pool-card .element-card .metric .metric-label {
                    font-size: 9px;
                    color: #999;
                    text-transform: uppercase;
                    letter-spacing: 0.5px;
                }

                pool-card .element-card .element-control {
                    display: flex;
                    justify-content: center;
                    margin-top: 8px;
                    padding-top: 8px;
                    border-top: 1px solid #e9ecef;
                }

                pool-card .toggle-wrapper {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                }

                pool-card .toggle-switch {
                    position: relative;
                    width: 44px;
                    height: 24px;
                    cursor: pointer;
                }

                pool-card .toggle-switch input {
                    opacity: 0;
                    width: 0;
                    height: 0;
                }

                pool-card .toggle-slider {
                    position: absolute;
                    top: 0;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    background: #ccc;
                    border-radius: 24px;
                    transition: all 0.3s ease;
                }

                pool-card .toggle-slider:before {
                    content: '';
                    position: absolute;
                    height: 18px;
                    width: 18px;
                    left: 3px;
                    bottom: 3px;
                    background: white;
                    border-radius: 50%;
                    transition: all 0.3s ease;
                    box-shadow: 0 2px 4px rgba(0,0,0,0.1);
                }

                pool-card .toggle-switch input:checked + .toggle-slider {
                    background: #459f49;
                }

                pool-card .toggle-switch input:checked + .toggle-slider:before {
                    transform: translateX(20px);
                }

                pool-card .toggle-switch.disabled {
                    opacity: 0.4;
                    cursor: not-allowed;
                }

                pool-card .toggle-switch.disabled input {
                    cursor: not-allowed;
                }

                pool-card .toggle-label {
                    font-size: 11px;
                    font-weight: 500;
                    color: #666;
                    min-width: 35px;
                }

                pool-card .dependency-warning {
                    font-size: 10px;
                    color: #fcbd25;
                    font-weight: 500;
                    display: none;
                }

                pool-card .element-card.off .dependency-warning.visible {
                    display: block;
                }

                pool-card .pool-card-actions {
                    display: flex;
                    gap: 10px;
                    flex-wrap: wrap;
                    padding-top: 15px;
                    border-top: 1px solid #e9ecef;
                }

                pool-card .action-btn {
                    padding: 8px 18px;
                    border: none;
                    border-radius: 10px;
                    font-family: 'Poppins', sans-serif;
                    font-weight: 500;
                    font-size: 12px;
                    cursor: pointer;
                    transition: all 0.3s ease;
                    display: flex;
                    align-items: center;
                    gap: 6px;
                }

                pool-card .action-btn:hover {
                    transform: translateY(-2px);
                    box-shadow: 0 4px 12px rgba(0,0,0,0.1);
                }

                pool-card .action-btn.primary {
                    background: #1b4444;
                    color: white;
                }

                pool-card .action-btn.success {
                    background: #459f49;
                    color: white;
                }

                pool-card .action-btn.outline {
                    background: transparent;
                    border: 2px solid #1b4444;
                    color: #1b4444;
                }

                pool-card .config-section {
                    margin-top: 15px;
                    padding-top: 15px;
                    border-top: 1px solid #e9ecef;
                    display: none;
                }

                pool-card .config-section.visible {
                    display: block;
                }

                pool-card .config-panel {
                    background: #f8f9fa;
                    border-radius: 12px;
                    padding: 18px;
                    border: 1px solid #e9ecef;
                    margin-bottom: 12px;
                }

                pool-card .config-panel h4 {
                    font-size: 13px;
                    font-weight: 600;
                    margin-bottom: 12px;
                    display: flex;
                    align-items: center;
                    gap: 6px;
                }

                pool-card .config-row {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    margin-bottom: 8px;
                    font-size: 12px;
                    flex-wrap: wrap;
                }

                pool-card .config-row label {
                    min-width: 110px;
                    color: #666;
                    font-size: 12px;
                }

                pool-card .config-row input[type="time"],
                pool-card .config-row input[type="number"] {
                    padding: 5px 10px;
                    border: 1px solid #ddd;
                    border-radius: 6px;
                    font-family: 'Poppins', sans-serif;
                    font-size: 12px;
                    background: white;
                }

                pool-card .config-row input[type="time"] {
                    width: 100px;
                }

                pool-card .config-row input[type="number"] {
                    width: 65px;
                }

                pool-card .config-row .hint {
                    font-size: 10px;
                    color: #999;
                    font-style: italic;
                }

                pool-card .config-row .dependency-badge {
                    font-size: 9px;
                    background: #fcbd25;
                    padding: 2px 6px;
                    border-radius: 8px;
                    color: #1b4444;
                    font-weight: 500;
                }

                pool-card .config-row .validation-error {
                    font-size: 10px;
                    color: #d32f2f;
                    font-weight: 500;
                }

                pool-card .config-test-row {
                    margin-top: 12px;
                    padding-top: 12px;
                    border-top: 1px dashed #ddd;
                }

                pool-card .config-test-row label {
                    font-style: italic;
                    color: #999;
                }

                pool-card .test-btn {
                    padding: 4px 10px;
                    border: 1px solid #ddd;
                    border-radius: 6px;
                    background: white;
                    font-family: 'Poppins', sans-serif;
                    font-size: 11px;
                    cursor: pointer;
                    color: #1b4444;
                    transition: all 0.15s;
                }

                pool-card .test-btn:hover {
                    background: #1b4444;
                    color: white;
                    border-color: #1b4444;
                }

                pool-card .loading-overlay {
                    position: absolute;
                    top: 0;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    background: rgba(255,255,255,0.7);
                    display: none;
                    align-items: center;
                    justify-content: center;
                    border-radius: 16px;
                    z-index: 10;
                }

                pool-card .loading-overlay.active {
                    display: flex;
                }

                pool-card .spinner {
                    width: 30px;
                    height: 30px;
                    border: 3px solid #e9ecef;
                    border-top: 3px solid #1b4444;
                    border-radius: 50%;
                    animation: spin 0.8s linear infinite;
                }

                @keyframes spin {
                    to { transform: rotate(360deg); }
                }

                pool-card .toast-container {
                    position: fixed;
                    bottom: 20px;
                    right: 20px;
                    z-index: 1000;
                }

                pool-card .toast {
                    padding: 10px 18px;
                    background: #1b4444;
                    color: white;
                    border-radius: 10px;
                    font-family: 'Poppins', sans-serif;
                    font-size: 13px;
                    box-shadow: 0 4px 15px rgba(0,0,0,0.15);
                    animation: slideIn 0.3s ease;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    margin-top: 8px;
                }

                pool-card .toast.error {
                    background: #d32f2f;
                }

                pool-card .toast.success {
                    background: #459f49;
                }

                @keyframes slideIn {
                    from { transform: translateX(100px); opacity: 0; }
                    to { transform: translateX(0); opacity: 1; }
                }

                @media (max-width: 992px) {
                    pool-card .elements-grid {
                        grid-template-columns: repeat(2, 1fr);
                    }
                }

                @media (max-width: 768px) {
                    pool-card .pool-card-header {
                        flex-direction: column;
                        align-items: flex-start;
                    }
                    pool-card .device-stats {
                        width: 100%;
                        justify-content: space-around;
                    }
                    pool-card .elements-grid {
                        grid-template-columns: 1fr;
                    }
                    pool-card .mode-selector {
                        flex-direction: column;
                    }
                    pool-card .mode-btn {
                        width: 100%;
                        justify-content: center;
                    }
                    pool-card .pool-card-actions {
                        flex-direction: column;
                    }
                    pool-card .action-btn {
                        width: 100%;
                        justify-content: center;
                    }
                }
            </style>

            <div class="pool-card" id="poolCard">
                <div class="loading-overlay" id="loadingOverlay">
                    <div class="spinner"></div>
                </div>

                <div class="pool-card-header">
                    <div class="device-info">
                        <div class="device-icon-box">&#x1F3CA;</div>
                        <div>
                            <div class="device-name">${deviceName}</div>
                            <div class="device-id">CUPS: ${cups}</div>
                        </div>
                    </div>
                    <div class="device-stats">
                        <div class="stat-item">
                            <div class="stat-value" id="totalPower">0 W</div>
                            <div class="stat-label">Consum total</div>
                        </div>
                        <div class="stat-item">
                            <div class="stat-value positive" id="solarExcedent">0 W</div>
                            <div class="stat-label">Excedent solar</div>
                        </div>
                        <div class="stat-item">
                            <div class="stat-value" id="elementsOn">0/3</div>
                            <div class="stat-label">Elements actius</div>
                        </div>
                    </div>
                </div>

                <div class="mode-selector">
                    <button class="mode-btn active" data-mode="manual">
                        &#x1F446; Manual
                        <span class="mode-badge">Individual</span>
                    </button>
                    <button class="mode-btn" data-mode="schedule">
                        &#x23F0; Horari
                        <span class="mode-badge">Programat</span>
                    </button>
                    <button class="mode-btn" data-mode="automatic">
                        &#x2600;&#xFE0F; Automàtic
                        <span class="mode-badge">Solar</span>
                    </button>
                </div>

                <div class="elements-grid">
                    <div class="element-card off" data-element="bombaDepuradora">
                        <div class="element-header">
                            <div class="element-name">
                                <span class="element-icon">&#x1F504;</span>
                                Bomba Depuradora
                            </div>
                            <div class="element-status">
                                <span class="status-indicator off"></span>
                                <span class="status-text off">Apagat</span>
                            </div>
                        </div>
                        <div class="element-metrics">
                            <div class="metric">
                                <div class="metric-value off power-value">0 W</div>
                                <div class="metric-label">Potència</div>
                            </div>
                            <div class="metric">
                                <div class="metric-value off hours-value">0.00 h</div>
                                <div class="metric-label">Avui</div>
                            </div>
                        </div>
                        <div class="element-control">
                            <div class="toggle-wrapper">
                                <span class="toggle-label">Control</span>
                                <label class="toggle-switch">
                                    <input type="checkbox">
                                    <span class="toggle-slider"></span>
                                </label>
                            </div>
                        </div>
                    </div>

                    <div class="element-card off" data-element="bombaNeteja">
                        <div class="element-header">
                            <div class="element-name">
                                <span class="element-icon">&#x1F9F9;</span>
                                Bomba Neteja Fons
                            </div>
                            <div class="element-status">
                                <span class="status-indicator off"></span>
                                <span class="status-text off">Apagat</span>
                            </div>
                        </div>
                        <div class="element-metrics">
                            <div class="metric">
                                <div class="metric-value off power-value">0 W</div>
                                <div class="metric-label">Potència</div>
                            </div>
                            <div class="metric">
                                <div class="metric-value off hours-value">0.00 h</div>
                                <div class="metric-label">Avui</div>
                            </div>
                        </div>
                        <div class="element-control">
                            <div class="toggle-wrapper">
                                <span class="toggle-label">Control</span>
                                <label class="toggle-switch">
                                    <input type="checkbox">
                                    <span class="toggle-slider"></span>
                                </label>
                            </div>
                        </div>
                    </div>

                    <div class="element-card off" data-element="cloradorSali">
                        <div class="element-header">
                            <div class="element-name">
                                <span class="element-icon">&#x1F9EA;</span>
                                Clorador Salí
                            </div>
                            <div class="element-status">
                                <span class="status-indicator off"></span>
                                <span class="status-text off">Apagat</span>
                            </div>
                        </div>
                        <div class="element-metrics">
                            <div class="metric">
                                <div class="metric-value off power-value">0 W</div>
                                <div class="metric-label">Potència</div>
                            </div>
                            <div class="metric">
                                <div class="metric-value off hours-value">0.00 h</div>
                                <div class="metric-label">Avui</div>
                            </div>
                        </div>
                        <div class="element-control">
                            <div class="toggle-wrapper">
                                <span class="toggle-label">Control</span>
                                <label class="toggle-switch">
                                    <input type="checkbox">
                                    <span class="toggle-slider"></span>
                                </label>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="pool-card-actions">
                    <button class="action-btn primary" id="btnRefresh">
                        &#x1F504; Actualitzar estat
                    </button>
                    <button class="action-btn success" id="btnSaveConfig">
                        &#x1F4BE; Guardar configuració
                    </button>
                    <button class="action-btn outline" id="btnToggleConfig">
                        &#x2699;&#xFE0F; Configuració avançada
                    </button>
                </div>

                <div class="config-section" id="configSection">
                    <div class="config-panel" id="panelSchedule">
                        <h4>&#x23F0; Configuració Horària</h4>
                        <div class="config-row">
                            <label>Bomba Depuradora</label>
                            <input type="time" class="schedule-start" data-element="bombaDepuradora" value="09:00">
                            <span>-</span>
                            <input type="time" class="schedule-end" data-element="bombaDepuradora" value="15:00">
                            <span class="dependency-badge">Principal</span>
                        </div>
                        <div class="config-row">
                            <label>Bomba Neteja Fons</label>
                            <input type="time" class="schedule-start" data-element="bombaNeteja" value="09:00">
                            <span>-</span>
                            <input type="time" class="schedule-end" data-element="bombaNeteja" value="12:00">
                            <span class="dependency-badge">Depèn</span>
                        </div>
                        <div class="config-row">
                            <label>Clorador Salí</label>
                            <input type="time" class="schedule-start" data-element="cloradorSali" value="11:00">
                            <span>-</span>
                            <input type="time" class="schedule-end" data-element="cloradorSali" value="15:00">
                            <span class="dependency-badge">Depèn</span>
                        </div>
                    </div>

                    <div class="config-panel" id="panelAutomatic">
                        <h4>&#x2600;&#xFE0F; Configuració Solar</h4>
                        <div class="config-row">
                            <label>Bomba Depuradora</label>
                            <span>Màx: <input type="number" class="max-hours" data-element="bombaDepuradora" value="5" min="0.5" max="12" step="0.5"> h</span>
                            <span>Encesa: <input type="number" class="threshold" data-element="bombaDepuradora" value="0.50" step="0.05" min="0"> kW</span>
                            <span>Apagada: <input type="number" class="off-threshold" data-element="bombaDepuradora" value="0.10" step="0.05"> kW</span>
                        </div>
                        <div class="config-row">
                            <label>Bomba Neteja Fons</label>
                            <span>Màx: <input type="number" class="max-hours" data-element="bombaNeteja" value="1" min="0.5" max="12" step="0.5"> h</span>
                            <span>Encesa: <input type="number" class="threshold" data-element="bombaNeteja" value="1.20" step="0.05" min="0"> kW</span>
                            <span>Apagada: <input type="number" class="off-threshold" data-element="bombaNeteja" value="0.30" step="0.05"> kW</span>
                        </div>
                        <div class="config-row">
                            <label>Clorador Salí</label>
                            <span>Màx: <input type="number" class="max-hours" data-element="cloradorSali" value="4" min="0.5" max="12" step="0.5"> h</span>
                            <span>Encesa: <input type="number" class="threshold" data-element="cloradorSali" value="0.80" step="0.05" min="0"> kW</span>
                            <span>Apagada: <input type="number" class="off-threshold" data-element="cloradorSali" value="0.20" step="0.05"> kW</span>
                        </div>
                        <div class="config-row">
                            <label>Excedent actual</label>
                            <span style="font-weight:600; color:#459f49;" id="configExcedent">0 W</span>
                            <span class="hint">(actualització automàtica)</span>
                        </div>
                        <div class="config-row config-test-row">
                            <label>Proves</label>
                            <button type="button" class="test-btn" data-excedent="2.0">+2 kW</button>
                            <button type="button" class="test-btn" data-excedent="0.5">+0.5 kW</button>
                            <button type="button" class="test-btn" data-excedent="0.1">+0.1 kW</button>
                            <button type="button" class="test-btn" data-excedent="-0.5">-0.5 kW</button>
                            <button type="button" class="test-btn" data-excedent="-1.0">-1 kW</button>
                        </div>
                    </div>
                </div>

                <div class="toast-container" id="toastContainer"></div>
            </div>
        `;

        if (window.lucide) {
            window.lucide.createIcons();
        }
    }

    setupEventListeners() {
        const card = this.querySelector('.pool-card');
        if (!card) return;

        card.querySelectorAll('.mode-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                this.setMode(btn.dataset.mode);
                this.saveAutomation();
            });
        });

        card.querySelectorAll('.toggle-switch input[type="checkbox"]').forEach(toggle => {
            toggle.addEventListener('change', (e) => {
                const elementCard = e.target.closest('[data-element]');
                if (elementCard) {
                    this.handleToggle(elementCard.dataset.element, e.target.checked);
                }
            });
        });

        card.querySelector('#btnRefresh').addEventListener('click', () => this.requestStatusUpdate());
        card.querySelector('#btnSaveConfig').addEventListener('click', () => this.saveAutomation());
        card.querySelectorAll('.test-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const valueKW = parseFloat(btn.dataset.excedent);
                this.solarExcedent = valueKW * 1000;
                this.updateUI();
                if (this.mode === 'automatic') {
                    try {
                        await window.apiClient.post('/api/pool/test-automation', {
                            deviceId: this.poolData?.deviceId,
                            simulatedExcedentKW: valueKW
                        });
                        this.showToast(`✅ Test: excedent ${valueKW >= 0 ? '+' : ''}${valueKW} kW enviat al backend`);
                    } catch (err) {
                        console.warn('Error en test automation:', err);
                        this.showToast(`⚠️ Error en backend: ${err.message}`);
                    }
                } else {
                    this.showToast(`🧪 Excedent simulat (UI): ${valueKW >= 0 ? '+' : ''}${valueKW} kW`);
                }
            });
        });

        card.querySelector('#btnToggleConfig').addEventListener('click', () => {
            const section = card.querySelector('#configSection');
            section.classList.toggle('visible');
        });
    }

    // ===== FETCH INITIAL STATUS =====
    async fetchInitialStatus(showLoader = false) {
        if (!this.poolData?.deviceId) return;
        if (showLoader) this.showLoading(true);

        try {
            const deviceId = encodeURIComponent(this.poolData.deviceId);
            const { data } = await window.apiClient.get(`/api/pool/status?deviceId=${deviceId}`);
            const statusData = data?.data || data;

            if (statusData) {
                this.updateFromStatus(statusData);
            }
        } catch (error) {
            console.warn('No s\'ha pogut obtenir l\'estat inicial, es pot simular:', error.message);
        } finally {
            if (showLoader) this.showLoading(false);
        }
    }

    updateFromStatus(data) {
        if (data.elements) {
            for (const [key, element] of Object.entries(data.elements)) {
                if (this.elements[key]) {
                    const el = this.elements[key];
                    el.isOn = element.isOn;
                    el.power = element.power || 0;
                    el.isOnline = element.isOnline !== false;
                }
            }
        }
        if (data.totalPower !== undefined) this.totalPower = data.totalPower;
        if (data.lastUpdate) this.lastUpdate = data.lastUpdate;

        this.updateUI();
    }

    // ===== LOAD AUTOMATION CONFIG =====
    async loadAutomationConfig() {
        if (!this.poolData?.deviceId) return;

        try {
            const deviceId = encodeURIComponent(this.poolData.deviceId);
            const { data } = await window.apiClient.get(`/api/pool/automation?deviceId=${deviceId}`);
            const configData = data?.data || data;

            if (configData) {
                if (configData.mode) this.mode = configData.mode;
                if (configData.schedule) {
                    Object.assign(this.schedule, configData.schedule);
                }
                if (configData.automatic) {
                    if (configData.automatic.maxHours) Object.assign(this.automatic.maxHours, configData.automatic.maxHours);
                    if (configData.automatic.thresholds) Object.assign(this.automatic.thresholds, configData.automatic.thresholds);
                    if (configData.automatic.offThresholds) Object.assign(this.automatic.offThresholds, configData.automatic.offThresholds);
                }
                this.updateConfigUI();
                this.setMode(this.mode, true);
            }
        } catch (error) {
            console.warn('No s\'ha pogut carregar la config d\'automatització:', error.message);
        }
    }

    // ===== SAVE AUTOMATION CONFIG =====
    async saveAutomation() {
        if (!this.poolData?.deviceId) return;
        this.readConfigFromUI();

        try {
            const deviceId = encodeURIComponent(this.poolData.deviceId);
            const body = {
                deviceId: this.poolData.deviceId,
                mode: this.mode,
                schedule: this.schedule,
                automatic: this.automatic
            };

            await window.apiClient.post(`/api/pool/automation?deviceId=${deviceId}`, body);
            this.showToast('&#x2705; Configuració guardada correctament', 'success');
        } catch (error) {
            this.showToast('&#x274C; Error en guardar la configuració', 'error');
            console.error('Error saving automation config:', error);
        }
    }

    readConfigFromUI() {
        const card = this.querySelector('.pool-card');
        if (!card) return;

        card.querySelectorAll('.schedule-start').forEach(input => {
            const el = input.dataset.element;
            if (this.schedule[el]) this.schedule[el].start = input.value;
        });
        card.querySelectorAll('.schedule-end').forEach(input => {
            const el = input.dataset.element;
            if (this.schedule[el]) this.schedule[el].end = input.value;
        });
        card.querySelectorAll('.max-hours').forEach(input => {
            const el = input.dataset.element;
            if (this.automatic.maxHours[el]) this.automatic.maxHours[el] = parseFloat(input.value) || 0;
        });
        card.querySelectorAll('.threshold').forEach(input => {
            const el = input.dataset.element;
            if (this.automatic.thresholds[el] !== undefined) this.automatic.thresholds[el] = parseFloat(input.value) || 0;
        });
        card.querySelectorAll('.off-threshold').forEach(input => {
            const el = input.dataset.element;
            if (this.automatic.offThresholds[el] !== undefined) this.automatic.offThresholds[el] = parseFloat(input.value) || 0;
        });
    }

    // ===== MODE MANAGEMENT =====
    setMode(mode, silent = false) {
        if (!['manual', 'schedule', 'automatic'].includes(mode)) return;
        this.mode = mode;

        const card = this.querySelector('.pool-card');
        if (card) {
            card.querySelectorAll('.mode-btn').forEach(btn => {
                btn.classList.toggle('active', btn.dataset.mode === mode);
            });

            const configSection = card.querySelector('#configSection');
            if (mode === 'manual') {
                configSection?.classList.remove('visible');
            }

            const panelSchedule = card.querySelector('#panelSchedule');
            const panelAutomatic = card.querySelector('#panelAutomatic');
            if (panelSchedule) panelSchedule.style.display = mode === 'schedule' ? 'block' : 'none';
            if (panelAutomatic) panelAutomatic.style.display = mode === 'automatic' ? 'block' : 'none';
        }

        if (!silent) {
            const modeNames = { manual: 'Manual', schedule: 'Horari', automatic: 'Automàtic' };
            this.showToast(`&#x1F4CB; Mode ${modeNames[mode]} activat`, 'success');
        }
        this.dispatchEvent(new CustomEvent('pool-mode-changed', {
            detail: { mode },
            bubbles: true
        }));
    }

    // ===== TOGGLE ELEMENT (MANUAL MODE) =====
    async handleToggle(elementKey, isOn) {
        if (this.elements[elementKey]?.isOn === isOn) return;
        if (this.mode !== 'manual') {
            this.showToast(`&#x26A0;&#xFE0F; En mode ${this.mode === 'schedule' ? 'horari' : 'automàtic'}, el control és automàtic`, 'error');
            this.updateUI();
            return;
        }

        if (isOn && (elementKey === 'bombaNeteja' || elementKey === 'cloradorSali')) {
            if (!this.elements.bombaDepuradora.isOn) {
                this.showToast('&#x26A0;&#xFE0F; La bomba de depuradora ha d\'estar encesa primer!', 'error');
                this.updateUI();
                return;
            }
        }

        if (!isOn && elementKey === 'bombaDepuradora') {
            if (this.elements.bombaNeteja.isOn || this.elements.cloradorSali.isOn) {
                const dependentNames = [];
                if (this.elements.bombaNeteja.isOn) dependentNames.push('Bomba Neteja');
                if (this.elements.cloradorSali.isOn) dependentNames.push('Clorador Salí');
                this.showToast(`&#x26A0;&#xFE0F; Primer apaga: ${dependentNames.join(' i ')}`, 'error');
                this.updateUI();
                return;
            }
        }

        this.elements[elementKey].isOn = isOn;
        if (!isOn) {
            this.elements[elementKey].power = 0;
        }

        this.updateUI();

        try {
            const deviceId = encodeURIComponent(this.poolData?.deviceId || '');
            await window.apiClient.post(`/api/pool/control`, {
                deviceId: this.poolData?.deviceId,
                element: elementKey,
                action: isOn ? 'on' : 'off'
            });
            this.showToast(`${isOn ? '&#x2705;' : '&#x1F504;'} ${this.getElementName(elementKey)} ${isOn ? 'encès' : 'apagat'}`);
            setTimeout(() => this.fetchPoolHours(), 2000);
        } catch (error) {
            this.showToast(`&#x274C; Error en controlar ${this.getElementName(elementKey)}`, 'error');
            console.error('Error controlling element:', error);
        }
    }

    getElementName(key) {
        const names = {
            bombaDepuradora: 'Bomba Depuradora',
            bombaNeteja: 'Bomba Neteja Fons',
            cloradorSali: 'Clorador Salí'
        };
        return names[key] || key;
    }

    // ===== EVALUATE AUTOMATION (server-side - no-op al client) =====
    async evaluateAutomation() {}

    // ===== UI UPDATE =====
    updateUI() {
        const card = this.querySelector('.pool-card');
        if (!card) return;

        let onCount = 0;
        let totalPower = 0;

        for (const [key, el] of Object.entries(this.elements)) {
            const elementCard = card.querySelector(`[data-element="${key}"]`);
            if (!elementCard) {
                console.warn('⚠️ elementCard NOT found for', key);
                continue;
            }

            elementCard.className = `element-card ${el.isOn ? 'on' : 'off'}`;

            const indicator = elementCard.querySelector('.status-indicator');
            const statusText = elementCard.querySelector('.status-text');
            const metricValues = elementCard.querySelectorAll('.metric-value');
            const powerEl = metricValues[0] || null;
            const hoursEl = metricValues[1] || null;
            const toggle = elementCard.querySelector('.toggle-switch input');

            if (indicator) indicator.className = `status-indicator ${el.isOn ? 'on' : 'off'}`;
            if (statusText) {
                statusText.textContent = el.isOn ? 'Ences' : 'Apagat';
                statusText.className = `status-text ${el.isOn ? 'on' : 'off'}`;
                console.log('✅ updateUI status for', key, '=', statusText.textContent);
            }
            if (powerEl) {
                const displayPower = el.isOn ? el.power.toFixed(1) : '0.0';
                console.log(`✅ updateUI: [${key}] metric[0] → "${displayPower} W" (raw=${el.power}, isOn=${el.isOn})`);
                powerEl.textContent = `${displayPower} W`;
                powerEl.className = `metric-value ${el.isOn ? '' : 'off'}`;
            } else {
                console.warn(`⚠️ updateUI: metric[0] NOT found for [${key}]`);
            }
            if (hoursEl) {
                const totalMinutes = el.minutesToday || 0;
                const h = Math.floor(totalMinutes / 60);
                const m = totalMinutes % 60;
                hoursEl.textContent = `${h}h ${m.toString().padStart(2, '0')}min`;
                hoursEl.className = `metric-value ${el.isOn ? '' : 'off'}`;
            }

            if (toggle) {
                const isDisabled = this.mode !== 'manual';
                toggle.checked = el.isOn;
                toggle.disabled = isDisabled;
                const toggleWrap = toggle.closest('.toggle-switch');
                if (toggleWrap) {
                    toggleWrap.classList.toggle('disabled', isDisabled);
                }
            }

            if (el.isOn) onCount++;
            if (el.isOn) totalPower += el.power;
        }

        console.log(`📊 updateUI: onCount=${onCount}, totalPower=${totalPower.toFixed(1)}W, elements=${JSON.stringify(Object.fromEntries(Object.entries(this.elements).map(([k, v]) => [k, { power: v.power, isOn: v.isOn }])))}`);

        this.totalPower = totalPower;

        const totalPowerEl = card.querySelector('#totalPower');
        const excedentEl = card.querySelector('#solarExcedent');
        const elementsOnEl = card.querySelector('#elementsOn');
        const configExcedent = card.querySelector('#configExcedent');

        if (totalPowerEl) {
            totalPowerEl.textContent = `${totalPower.toFixed(1)} W`;
            console.log(`📊 totalPower# = ${totalPower.toFixed(1)} W`);
        }
        if (excedentEl) {
            excedentEl.textContent = `${this.solarExcedent.toFixed(0)} W`;
            excedentEl.className = `stat-value ${this.solarExcedent >= 0 ? 'positive' : 'negative'}`;
        }
        if (elementsOnEl) elementsOnEl.textContent = `${onCount}/3`;
        if (configExcedent) {
            configExcedent.textContent = `${this.solarExcedent.toFixed(0)} W`;
        }
    }

    testPowerUpdate() {
        console.log('🧪 testPowerUpdate: Simulating power values...');
        this.elements.bombaDepuradora.power = 1523.45;
        this.elements.bombaDepuradora.isOn = true;
        this.elements.bombaNeteja.power = 823.12;
        this.elements.bombaNeteja.isOn = true;
        this.elements.cloradorSali.power = 245.67;
        this.elements.cloradorSali.isOn = true;
        this.updateUI();
        console.log('🧪 testPowerUpdate: Done. Check DOM values.');
    }

    updateConfigUI() {
        const card = this.querySelector('.pool-card');
        if (!card) return;

        card.querySelectorAll('.schedule-start').forEach(input => {
            const el = input.dataset.element;
            if (this.schedule[el]) input.value = this.schedule[el].start;
        });
        card.querySelectorAll('.schedule-end').forEach(input => {
            const el = input.dataset.element;
            if (this.schedule[el]) input.value = this.schedule[el].end;
        });
        card.querySelectorAll('.max-hours').forEach(input => {
            const el = input.dataset.element;
            if (this.automatic.maxHours[el] !== undefined) input.value = this.automatic.maxHours[el];
        });
        card.querySelectorAll('.threshold').forEach(input => {
            const el = input.dataset.element;
            if (this.automatic.thresholds[el] !== undefined) input.value = this.automatic.thresholds[el].toFixed(2);
        });
        card.querySelectorAll('.off-threshold').forEach(input => {
            const el = input.dataset.element;
            if (this.automatic.offThresholds[el] !== undefined) input.value = this.automatic.offThresholds[el].toFixed(2);
        });
    }

    // ===== POLLING =====
    startPolling() {
        this.statusCheckInterval = setInterval(() => {
            this.fetchInitialStatus();
        }, 3000);

        this.fetchSolarExcedent();
        this.excedentInterval = setInterval(() => this.fetchSolarExcedent(), 10000);
        this.hoursInterval = setInterval(() => this.fetchPoolHours(), 60000);
    }

    async fetchSolarExcedent() {
        try {
            if (!window.apiClient) return;
            const res = await window.apiClient.get('/api/dashboard/power/difference');
            const data = res.data;
            if (data?.difference !== undefined) {
                this.solarExcedent = data.difference * 1000;
                this.updateUI();
            }
        } catch (error) {
            console.warn('Error obtenint excedent solar:', error.message);
        }
    }

    async requestStatusUpdate() {
        this.showLoading(true);
        try {
            const deviceId = encodeURIComponent(this.poolData?.deviceId || '');
            await window.apiClient.post(`/api/pool/status_update`, {
                deviceId: this.poolData?.deviceId
            });
            this.showToast('&#x1F504; Estat actualitzat', 'success');
        } catch (error) {
            console.error('Error requesting status update:', error);
        } finally {
            this.showLoading(false);
        }
    }

    // ===== UI HELPERS =====
    showLoading(active) {
        const overlay = this.querySelector('#loadingOverlay');
        if (overlay) overlay.classList.toggle('active', active);
    }

    showToast(message, type = 'info') {
        const container = this.querySelector('#toastContainer');
        if (!container) return;

        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.innerHTML = message;
        container.appendChild(toast);

        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(100px)';
            toast.style.transition = 'all 0.3s ease';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }
}

if (typeof window !== 'undefined') {
    customElements.define('pool-card', PoolCard);
    window.PoolCard = PoolCard;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = PoolCard;
}
