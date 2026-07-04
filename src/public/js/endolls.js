/**
 * Módulo específico para la gestión de endolls
 * Funcionalidades de descubrimiento y control de enchufes inteligentes
 */

class EndollsManager {
    constructor() {
        this.isInitialized = false;
        this.elements = {};
        this.sseManager = null;
        this.plugCards = new Map(); // Map de shelly_device_id -> plug-card element
    }

    /**
     * Inicializa el gestor de endolls
     */
    initialize() {
        if (this.isInitialized) return;

        this.cacheElements();
        this.setupEventListeners();
        this.loadUserPlugs();
        this.loadPoolDevice();
        this.isInitialized = true;

        // Inicializar iconos
        window.uiUtils.initializeLucideIcons();
    }

    /**
     * Cachea referencias a elementos del DOM
     */
    cacheElements() {
        this.elements = {
            discoverBtn: document.getElementById('discoverBtn'),
            discoverLoading: document.getElementById('discoverLoading'),
            discoverMessage: document.getElementById('discoverMessage'),
            plugsList: document.getElementById('plugsList'),
            plugsContainer: document.getElementById('plugsContainer'),
            emptyState: document.getElementById('emptyState'),
            btnText: document.querySelector('#discoverBtn .btn-text'),
            // Modal elements
            discoverModal: document.getElementById('discoverModal'),
            closeDiscoverModal: document.getElementById('closeDiscoverModal'),
            modalLoading: document.getElementById('modalLoading'),
            modalResults: document.getElementById('modalResults'),
            modalMessage: document.getElementById('modalMessage'),
            modalPlugsList: document.getElementById('modalPlugsList'),
            poolSection: document.getElementById('poolSection'),
            poolContainer: document.getElementById('poolContainer')
        };
    }

    /**
     * Configura los event listeners
     */
    setupEventListeners() {
        if (this.elements.discoverBtn) {
            this.elements.discoverBtn.addEventListener('click', () => this.openDiscoverModal());
        }

        if (this.elements.closeDiscoverModal) {
            this.elements.closeDiscoverModal.addEventListener('click', () => this.closeDiscoverModal());
        }

        // Cerrar modal al hacer clic fuera
        if (this.elements.discoverModal) {
            this.elements.discoverModal.addEventListener('click', (e) => {
                if (e.target === this.elements.discoverModal) {
                    this.closeDiscoverModal();
                }
            });
        }
    }

    /**
     * Muestra un mensaje en el contenedor de mensajes
     */
    showMessage(message, type = 'info') {
        if (!this.elements.discoverMessage) return;

        this.elements.discoverMessage.textContent = message;
        this.elements.discoverMessage.className = `alert alert-${type}`;
        this.elements.discoverMessage.style.display = 'block';
        
        // Auto-ocultar después de 5 segundos si es éxito
        if (type === 'success') {
            setTimeout(() => {
                this.hideMessage();
            }, 5000);
        }
    }

    /**
     * Oculta el mensaje
     */
    hideMessage() {
        if (this.elements.discoverMessage) {
            this.elements.discoverMessage.style.display = 'none';
        }
    }

    /**
     * Muestra el estado de loading del botón de descubrir
     */
    showDiscoverLoading() {
        if (this.elements.discoverBtn) {
            this.elements.discoverBtn.disabled = true;
        }
        if (this.elements.btnText) {
            this.elements.btnText.style.display = 'none';
        }
        if (this.elements.discoverLoading) {
            this.elements.discoverLoading.classList.remove('loading-hidden');
        }
    }

    /**
     * Oculta el estado de loading del botón de descubrir
     */
    hideDiscoverLoading() {
        if (this.elements.discoverBtn) {
            this.elements.discoverBtn.disabled = false;
        }
        if (this.elements.btnText) {
            this.elements.btnText.style.display = 'flex';
        }
        if (this.elements.discoverLoading) {
            this.elements.discoverLoading.classList.add('loading-hidden');
        }
    }

    /**
     * Renderiza la lista de endolls usando web components
     * Només mostra plug-card per dispositius ACS (shelly_device_id que comenci per "acs/")
     */
    renderPlugs(plugs) {
        const acsPlugs = (plugs || []).filter(p => p.shelly_device_id && p.shelly_device_id.startsWith('acs/'));

        if (acsPlugs.length === 0) {
            this.showEmptyState();
            this.disconnectSSE();
            return;
        }

        this.showPlugsList();
        
        if (this.elements.plugsContainer) {
            this.elements.plugsContainer.innerHTML = '';
            this.plugCards.clear();
            
            acsPlugs.forEach(plug => {
                const plugCard = document.createElement('plug-card');
                plugCard.setAttribute('plug-data', JSON.stringify(plug));
                
                plugCard.addEventListener('plug-toggled', this.handlePlugToggled.bind(this));
                plugCard.addEventListener('plug-error', this.handlePlugError.bind(this));
                
                this.plugCards.set(plug.shelly_device_id, plugCard);
                
                this.elements.plugsContainer.appendChild(plugCard);
            });
        }
    }

    /**
     * Muestra el estado vacío
     */
    showEmptyState() {
        if (this.elements.plugsList) {
            this.elements.plugsList.style.display = 'none';
        }
        if (this.elements.emptyState) {
            this.elements.emptyState.style.display = 'block';
        }
    }

    /**
     * Muestra la lista de endolls
     */
    showPlugsList() {
        if (this.elements.emptyState) {
            this.elements.emptyState.style.display = 'none';
        }
        if (this.elements.plugsList) {
            this.elements.plugsList.style.display = 'block';
        }
    }

    /**
     * Abre el modal de descubrimiento
     */
    openDiscoverModal() {
        if (this.elements.discoverModal) {
            this.elements.discoverModal.classList.remove('modal-hidden');
            // Resetear estado del modal
            this.elements.modalLoading.style.display = 'none';
            this.elements.modalResults.style.display = 'none';
            // Iniciar descubrimiento automáticamente
            this.discoverPlugsInModal();
            // Inicializar iconos
            window.uiUtils.initializeLucideIcons();
        }
    }

    /**
     * Cierra el modal de descubrimiento
     */
    closeDiscoverModal() {
        if (this.elements.discoverModal) {
            this.elements.discoverModal.classList.add('modal-hidden');
        }
    }

    /**
     * Muestra mensaje en el modal
     */
    showModalMessage(message, type = 'info') {
        if (this.elements.modalMessage) {
            this.elements.modalMessage.textContent = message;
            this.elements.modalMessage.className = `alert alert-${type}`;
        }
    }

    /**
     * Renderiza los resultados del descubrimiento en el modal
     */
    renderModalResults(plugs, discovered = 0) {
        if (this.elements.modalPlugsList) {
            if (!plugs || plugs.length === 0) {
                this.elements.modalPlugsList.innerHTML = `
                    <div style="text-align: center; padding: 20px; color: #666;">
                        <i data-lucide="search" style="width: 48px; height: 48px; margin-bottom: 15px;"></i>
                        <p>No s'han trobat nous endolls associats al teu CUPS.</p>
                    </div>
                `;
            } else {
                this.elements.modalPlugsList.innerHTML = `
                    <h4 style="color: #1b4444; margin-bottom: 15px;">Nous endolls trobats:</h4>
                    ${plugs.map(plug => `
                        <div class="stat-card" style="margin-bottom: 10px;">
                            <div class="stat-icon">
                                <i data-lucide="plug"></i>
                            </div>
                            <div class="stat-content">
                                <div class="stat-value">${plug.device_name}</div>
                                <div class="stat-label">ID: ${plug.shelly_device_id}</div>
                                <div class="stat-label">Tipus: ${plug.device_type}</div>
                            </div>
                            <div style="color: #459f49; font-weight: 600;">
                                <i data-lucide="check-circle" style="width: 20px; height: 20px;"></i>
                            </div>
                        </div>
                    `).join('')}
                `;
            }
            // Reinicializar iconos
            window.uiUtils.initializeLucideIcons();
        }
    }

    /**
     * Descubre endolls en el modal
     */
    async discoverPlugsInModal() {
        // Mostrar loading
        if (this.elements.modalLoading) {
            this.elements.modalLoading.style.display = 'block';
        }
        if (this.elements.modalResults) {
            this.elements.modalResults.style.display = 'none';
        }

        try {
            const { data } = await window.apiClient.get('/api/plugs/discover');

            // Ocultar loading y mostrar resultados
            if (this.elements.modalLoading) {
                this.elements.modalLoading.style.display = 'none';
            }
            if (this.elements.modalResults) {
                this.elements.modalResults.style.display = 'block';
            }

            if (data.success && data.discovered > 0) {
                this.showModalMessage(`Descobriment completat! S'han trobat ${data.discovered} nous endolls.`, 'success');
                this.renderModalResults(data.plugs, data.discovered);
                
                // Actualizar la lista principal después de un breve delay
                setTimeout(() => {
                    this.loadUserPlugs();
                }, 1500);
            } else {
                this.showModalMessage('Descobriment completat. No s\'han trobat nous endolls.', 'info');
                this.renderModalResults([]);
            }

        } catch (error) {
            console.error('Error descobrint endolls:', error);
            
            // Ocultar loading y mostrar error
            if (this.elements.modalLoading) {
                this.elements.modalLoading.style.display = 'none';
            }
            if (this.elements.modalResults) {
                this.elements.modalResults.style.display = 'block';
            }
            
            this.showModalMessage(`Error: ${error.message}`, 'error');
            this.renderModalResults([]);
        }
    }

    /**
     * Descubre endolls automáticamente (función legacy mantenida por compatibilidad)
     */
    async discoverPlugs() {
        this.openDiscoverModal();
    }

    /**
     * Carga los endolls del usuario
     */
    async loadUserPlugs() {
        try {
            const { data } = await window.apiClient.get('/api/plugs');
            this.renderPlugs(data.plugs);
        } catch (error) {
            console.error('Error carregant endolls:', error);
            // No mostrar error aquí, solo en consola
        }
    }

    /**
     * Carrega el dispositiu de piscina i el renderitza
     */
    async loadPoolDevice() {
        try {
            const { data } = await window.apiClient.get('/api/pool/device');
            if (data && data.data) {
                this.renderPoolCard(data.data);
            }
        } catch (error) {
            console.warn('No s\'ha trobat dispositiu de piscina:', error.message);
        }
    }

    /**
     * Renderitza el web component de la piscina
     */
    renderPoolCard(poolDevice) {
        if (!this.elements.poolContainer || !this.elements.poolSection) return;

        this.elements.poolContainer.innerHTML = '';
        const poolCard = document.createElement('pool-card');
        poolCard.setAttribute('pool-data', JSON.stringify(poolDevice));
        this.elements.poolContainer.appendChild(poolCard);
        this.elements.poolSection.style.display = 'block';
        window.uiUtils.initializeLucideIcons();
    }

    /**
     * Maneja el evento de toggle exitoso del web component
     */
    handlePlugToggled(event) {
        const { plugName, success, action } = event.detail;
        if (success) {
            console.log(`Plug ${plugName} ${action} command executed successfully`);
            // No mostrar mensaje de alerta arriba
        }
    }

    /**
     * Maneja el evento de error del web component
     */
    handlePlugError(event) {
        const { plugName, error } = event.detail;
        console.error(`Error controlling plug ${plugName}:`, error);
        // No mostrar mensaje de alerta arriba
    }

    /**
     * Controla un endoll (método legacy mantenido por compatibilidad)
     * @deprecated Usar el web component directamente
     */
    async controlPlug(plugId, action) {
        // Buscar el web component correspondiente
        const plugCard = this.elements.plugsContainer?.querySelector(`plug-card[plug-data*='"id":${plugId}']`);
        if (plugCard && plugCard.handleToggle) {
            await plugCard.handleToggle();
        }
    }

    /**
     * Obtiene el estado de un endoll
     */
    async getPlugStatus(plugId) {
        try {
            const { data } = await window.apiClient.get(`/api/plugs/${plugId}/status`);
            
            const status = data.isOnline ? 'En línia' : 'Fora de línia';
            const state = data.isOn ? 'Encès' : 'Apagat';
            const power = data.power ? `${data.power}W` : 'N/A';
            
            // Mostrar información en un alert (temporal, se puede mejorar con un modal)
            alert(`Estat de ${data.deviceName}:\n- Connexió: ${status}\n- Estat: ${state}\n- Potència: ${power}`);

        } catch (error) {
            console.error('Error obtenint estat:', error);
            this.showMessage(`Error: ${error.message}`, 'error');
        }
    }

    /**
     * Refresca la lista de endolls
     */
    async refreshPlugs() {
        await this.loadUserPlugs();
    }

}

// Crear instancia global
window.endollsManager = new EndollsManager();

// Inicializar cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', function() {
    window.endollsManager.initialize();
});

// Exportar para uso en módulos
if (typeof module !== 'undefined' && module.exports) {
    module.exports = EndollsManager;
}

// ===== FUNCIONALIDAD DE GRÁFICAS DE PLUGS =====

// Variables globales para gráficas
let plugsChart = null;
let currentPlugsPeriod = '24h';

/**
 * Carga los datos históricos de plugs y renderiza la gráfica
 * @param {string} period - Período ('24h', '7d', '30d')
 */
async function loadPlugsChart(period = currentPlugsPeriod) {
    try {
        showPlugsChartLoading();
        
        const { data } = await window.apiClient.get(`/api/plugs/historical-chart?period=${period}`);
        
        renderPlugsChart(data);
        currentPlugsPeriod = period;

    } catch (error) {
        console.error('Error loading plugs chart:', error);
        showPlugsChartError(error.message);
    }
}

/**
 * Muestra el estado de carga de la gráfica de plugs
 */
function showPlugsChartLoading() {
    document.getElementById('plugsChartLoading').style.display = 'flex';
    document.getElementById('plugsChartError').style.display = 'none';
    document.getElementById('plugsChart').style.display = 'none';
}

/**
 * Muestra el error de la gráfica de plugs
 * @param {string} message - Mensaje de error
 */
function showPlugsChartError(message) {
    document.getElementById('plugsChartLoading').style.display = 'none';
    document.getElementById('plugsChartError').style.display = 'flex';
    document.getElementById('plugsChart').style.display = 'none';
    
    const errorElement = document.querySelector('#plugsChartError p');
    if (errorElement) {
        errorElement.textContent = message || 'Error carregant les dades de consum';
    }
}

/**
 * Muestra la gráfica de plugs
 */
function showPlugsChart() {
    document.getElementById('plugsChartLoading').style.display = 'none';
    document.getElementById('plugsChartError').style.display = 'none';
    document.getElementById('plugsChart').style.display = 'block';
}

/**
 * Renderiza la gráfica de plugs con datos históricos
 * @param {Object} data - Datos de la gráfica
 */
function renderPlugsChart(data) {
    const canvas = document.getElementById('plugsChart');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    
    // Destruir gráfica existente si existe
    if (plugsChart) {
        plugsChart.destroy();
    }

    // Separar datasets por tipo
    const generationDatasets = data.datasets.filter(d => d.type === 'generation');
    const plugDatasets = data.datasets.filter(d => d.type === 'plug_consumption');
    const otherDatasets = data.datasets.filter(d => d.type === 'other_consumption');

    // Preparar datasets para Chart.js
    const chartDatasets = [];

    // 1. Datasets de generación (LÍNEA)
    generationDatasets.forEach(dataset => {
        chartDatasets.push({
            label: dataset.label,
            data: dataset.data,
            backgroundColor: 'rgba(69, 159, 73, 0.1)',
            borderColor: '#459f49',
            borderWidth: 2,
            fill: false,
            type: 'line',
            tension: 0.1,
            pointRadius: 0,
            pointHoverRadius: 4,
            yAxisID: 'y'
        });
    });

    // 2. Datasets de plugs individuales (BARRAS APILADAS)
    plugDatasets.forEach(dataset => {
        chartDatasets.push({
            label: dataset.label,
            data: dataset.data,
            backgroundColor: dataset.backgroundColor,
            borderColor: dataset.borderColor,
            borderWidth: 1,
            borderRadius: 4,
            borderSkipped: false,
            stack: 'consumption',
            type: 'bar',
            yAxisID: 'y'
        });
    });

    // 3. Dataset de resto de consumo (BARRAS APILADAS)
    otherDatasets.forEach(dataset => {
        chartDatasets.push({
            label: dataset.label,
            data: dataset.data,
            backgroundColor: dataset.backgroundColor,
            borderColor: dataset.borderColor,
            borderWidth: 0,
            borderRadius: 2,
            borderSkipped: false,
            maxBarThickness: 20,
            borderSkipped: false,
            stack: 'consumption',
            type: 'bar',
            yAxisID: 'y'
        });
    });

    plugsChart = new Chart(ctx, {
        type: 'bar', // Tipo base para las barras
        data: {
            labels: data.labels,
            datasets: chartDatasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false,
            },
            plugins: {
                legend: {
                    display: false // Usamos leyenda personalizada
                },
                tooltip: {
                    backgroundColor: 'rgba(255, 255, 255, 0.95)',
                    titleColor: '#1b4444',
                    bodyColor: '#333',
                    borderColor: '#e9ecef',
                    borderWidth: 1,
                    cornerRadius: 8,
                    displayColors: true,
                    callbacks: {
                        title: function(context) {
                            return `Hora: ${context[0].label}`;
                        },
                        label: function(context) {
                            const value = context.parsed.y;
                            if (value === null) return null;
                            
                            const unit = value >= 1000 ? 'kW' : 'W';
                            const displayValue = value >= 1000 ? (value / 1000).toFixed(1) : value.toFixed(0);
                            
                            return `${context.dataset.label}: ${displayValue} ${unit}`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    display: true,
                    title: {
                        display: true,
                        text: 'Temps',
                        color: '#666',
                        font: {
                            size: 12,
                            weight: 500
                        }
                    },
                    grid: {
                        color: 'rgba(0, 0, 0, 0.1)',
                        drawBorder: false
                    },
                    ticks: {
                        color: '#666',
                        font: {
                            size: 11
                        },
                        maxTicksLimit: 8
                    }
                },
                y: {
                    display: true,
                    title: {
                        display: true,
                        text: 'Potència (W)',
                        color: '#666',
                        font: {
                            size: 12,
                            weight: 500
                        }
                    },
                    grid: {
                        color: 'rgba(0, 0, 0, 0.1)',
                        drawBorder: false
                    },
                    ticks: {
                        color: '#666',
                        font: {
                            size: 11
                        },
                        callback: function(value) {
                            if (value >= 1000) {
                                return (value / 1000).toFixed(1) + 'kW';
                            }
                            return value.toFixed(0) + 'W';
                        }
                    },
                    beginAtZero: true
                }
            },
            animation: {
                duration: 1000,
                easing: 'easeInOutQuart'
            }
        }
    });

    showPlugsChart();
    
    console.log('Plugs chart rendered successfully', {
        period: data.period,
        datasets: data.datasets.length,
        dataPoints: data.totalDataPoints
    });
}

/**
 * Configura los controles de período para la gráfica de plugs
 */
function setupPlugsPeriodControls() {
    const plugsPeriodToggle = document.getElementById('plugs-period-toggle');
    
    if (plugsPeriodToggle) {
        plugsPeriodToggle.addEventListener('mode-change', function(event) {
            const period = event.detail.value;
            loadPlugsChart(period);
            console.log('Plugs period changed to:', period);
        });
    }
}

/**
 * Muestra la sección de gráfica de plugs
 */
function showPlugsChartSection() {
    const chartSection = document.getElementById('plugsChartSection');
    if (chartSection) {
        chartSection.style.display = 'block';
    }
}

/**
 * Oculta la sección de gráfica de plugs
 */
function hidePlugsChartSection() {
    const chartSection = document.getElementById('plugsChartSection');
    if (chartSection) {
        chartSection.style.display = 'none';
    }
}

// Extender la clase EndollsManager para incluir funcionalidad de gráficas
const originalRenderPlugs = window.endollsManager.renderPlugs;
window.endollsManager.renderPlugs = function(plugs) {
    // Llamar al método original
    originalRenderPlugs.call(this, plugs);
    
    // Si hay plugs, mostrar la sección de gráfica y cargar datos
    if (plugs && plugs.length > 0) {
        showPlugsChartSection();
        // Cargar gráfica después de un breve delay para asegurar que el DOM esté listo
        setTimeout(() => {
            loadPlugsChart();
            setupPlugsPeriodControls();
        }, 100);
    } else {
        hidePlugsChartSection();
    }
};

// Hacer funciones disponibles globalmente
window.loadPlugsChart = loadPlugsChart;
window.setupPlugsPeriodControls = setupPlugsPeriodControls;

// ===== FUNCIONALIDAD DE SERVER-SENT EVENTS (SSE) =====

// Crear instancia del gestor SSE (usando la referencia global)

/**
 * Callback para manejar datos del timer SSE
 * @param {Object|string} data - Datos recibidos del endpoint de timer
 */
function handleTimerData(data) {
    console.log('⏰ Timer data received via SSE:', data);
    
    // Si los datos tienen formato de tiempo, mostrar información adicional
    if (data && data.now) {
        const timestamp = new Date(data.now);
        console.log('🕐 Timestamp parsed:', timestamp.toLocaleString());
    }
}

// La conexión SSE ahora se maneja automáticamente en renderPlugs()
// cuando se cargan los plugs del usuario
