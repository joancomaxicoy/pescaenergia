// Dashboard functionality
console.log('Dashboard loaded');

// Global variables
let dashboardData = null;
let gaugeCharts = {};
let historicalChart = null;
let differenceChart = null;
let currentPeriod = '24h';
let energyUtilizationData = {
    totalKwUtilized: 0,
    totalKwWasted: 0,
    utilizationPercentage: 0
};

// Dashboard data loading
async function loadDashboardData() {
    try {
        showLoading();
        
        // First get user participations using the API client
        const { data: participationsData } = await window.apiClient.get('/api/dashboard/user-generators');

        // Now get real-time metrics for each generator using public endpoints
        const generatorsWithMetrics = await Promise.all(
            participationsData.generators.map(async (generator) => {
                try {
                    // Get latest metrics from public generator endpoint
                    const metricsResponse = await fetch(`/api/generators/${generator.generatorCode}/metrics/latest?metrics=voltatge_avg,potenciaFotovoltaica_avg,frequencia_avg`, {
                        method: 'GET',
                        headers: {
                            'Content-Type': 'application/json'
                        }
                    });

                    if (metricsResponse.ok) {
                        const metricsData = await metricsResponse.json();
                        
                        // Update generator with real-time metrics
                        return {
                            ...generator,
                            metrics: {
                                power: metricsData.metrics.potenciaFotovoltaica_avg || 0,
                                voltage: metricsData.metrics.voltatge_avg || 0,
                                frequency: metricsData.metrics.frequencia_avg || 0
                            },
                            lastUpdate: metricsData.timestamp,
                            hasData: metricsData.totalMetrics > 0
                        };
                    } else {
                        // Keep original data if metrics fetch fails
                        return generator;
                    }
                } catch (error) {
                    console.warn(`Error fetching metrics for ${generator.generatorCode}:`, error);
                    return generator;
                }
            })
        );

        const updatedData = {
            ...participationsData,
            generators: generatorsWithMetrics
        };

        dashboardData = updatedData;
        renderDashboard(updatedData);

    } catch (error) {
        console.error('Error loading dashboard data:', error);
        showError(error.message);
    }
}

function showLoading() {
    document.getElementById('dashboardLoading').style.display = 'block';
    document.getElementById('dashboardError').style.display = 'none';
    document.getElementById('noGenerators').style.display = 'none';
    document.getElementById('generatorsDashboard').style.display = 'none';
}

function showError(message) {
    document.getElementById('dashboardLoading').style.display = 'none';
    document.getElementById('dashboardError').style.display = 'block';
    document.getElementById('noGenerators').style.display = 'none';
    document.getElementById('generatorsDashboard').style.display = 'none';
    document.getElementById('errorMessage').textContent = message;
}

function showNoGenerators() {
    document.getElementById('dashboardLoading').style.display = 'none';
    document.getElementById('dashboardError').style.display = 'none';
    document.getElementById('noGenerators').style.display = 'block';
    document.getElementById('generatorsDashboard').style.display = 'none';
}

function showGeneratorsDashboard() {
    document.getElementById('dashboardLoading').style.display = 'none';
    document.getElementById('dashboardError').style.display = 'none';
    document.getElementById('noGenerators').style.display = 'none';
    document.getElementById('generatorsDashboard').style.display = 'block';
}

function renderDashboard(data) {
    if (!data.hasGenerators || data.generators.length === 0) {
        showNoGenerators();
        // Initialize Lucide icons for empty state
        setTimeout(() => {
            if (typeof lucide !== 'undefined') {
                lucide.createIcons();
            }
        }, 100);
        return;
    }

    showGeneratorsDashboard();
    renderStats(data);
    renderGenerators(data.generators);
    
    // Load historical chart for all users (consumption + generation if has participations)
    loadHistoricalChart();
    setupPeriodControls();
    
    // Initialize Lucide icons after rendering
    setTimeout(() => {
        if (typeof lucide !== 'undefined') {
            lucide.createIcons();
        }
    }, 100);
}
function renderStats(data) {
    // Calculate total participation percentage with proper validation
    const totalParticipation = data.generators.reduce((sum, gen) => {
        const participation = parseFloat(gen.participationPercentage) || 0;
        return sum + participation;
    }, 0);

    // Update the wasted energy (this will be calculated when historical chart loads)
    updateUtilizationStats();
}

function renderGenerators(generators) {
    const container = document.getElementById('generatorsList');
    container.innerHTML = '';

    generators.forEach(generator => {
        const generatorCard = createGeneratorCard(generator);
        container.appendChild(generatorCard);
    });
}

function createGeneratorCard(generator) {
    const card = document.createElement('div');
    card.className = generator.hasParticipation ? 'generator-card' : 'generator-card no-participation';
    card.innerHTML = `
        <div class="generator-header">
            <h3 class="generator-title">${generator.generatorName}</h3>
            <div class="generator-participation">
                ${generator.hasParticipation ? `${generator.participationPercentage}%` : 'Sense participació'}
            </div>
        </div>
        <div class="generator-metrics">
            <div class="metric-gauge">
                <div class="gauge-label">Potència</div>
                <div class="gauge-container">
                    <canvas id="powerGauge_${generator.generatorCode}" class="gauge-canvas"></canvas>
                    <div class="gauge-value" id="powerValue_${generator.generatorCode}">
                        ${generator.hasData && generator.metrics.power !== undefined 
                            ? `${(generator.metrics.power / 1000).toFixed(1)}<br><span class="gauge-unit">kW</span>`
                            : '-'
                        }
                    </div>
                </div>
            </div>
            <div class="metric-gauge">
                <div class="gauge-label">Tensió</div>
                <div class="gauge-container">
                    <canvas id="voltageGauge_${generator.generatorCode}" class="gauge-canvas"></canvas>
                    <div class="gauge-value" id="voltageValue_${generator.generatorCode}">
                        ${generator.hasData && generator.metrics.voltage !== undefined 
                            ? `${generator.metrics.voltage.toFixed(0)}<br><span class="gauge-unit">V</span>`
                            : '-'
                        }
                    </div>
                </div>
            </div>
            <div class="metric-gauge">
                <div class="gauge-label">Freqüència</div>
                <div class="gauge-container">
                    <canvas id="frequencyGauge_${generator.generatorCode}" class="gauge-canvas"></canvas>
                    <div class="gauge-value" id="frequencyValue_${generator.generatorCode}">
                        ${generator.hasData && generator.metrics.frequency !== undefined 
                            ? `${generator.metrics.frequency.toFixed(1)}<br><span class="gauge-unit">Hz</span>`
                            : '-'
                        }
                    </div>
                </div>
            </div>
        </div>
        ${generator.lastUpdate ? `
            <div class="last-update">
                Última actualització: ${formatRelativeTime(new Date(generator.lastUpdate))}
            </div>
        ` : ''}
    `;

    // Create gauges after the card is added to DOM
    setTimeout(() => {
        createGauge(`powerGauge_${generator.generatorCode}`, generator.metrics.power || 0, 0, 200000, '#459f49');
        createGauge(`voltageGauge_${generator.generatorCode}`, generator.metrics.voltage || 0, 200, 250, '#fcbd25');
        createGauge(`frequencyGauge_${generator.generatorCode}`, generator.metrics.frequency || 0, 49, 51, '#1b4444');
    }, 100);

    return card;
}

function createGauge(canvasId, value, min, max, color) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    
    // Destroy existing chart if it exists
    if (gaugeCharts[canvasId]) {
        gaugeCharts[canvasId].destroy();
    }

    // Calculate percentage for the gauge
    const percentage = Math.min(Math.max((value - min) / (max - min) * 100, 0), 100);
    
    gaugeCharts[canvasId] = new Chart(ctx, {
        type: 'doughnut',
        data: {
            datasets: [{
                data: [percentage, 100 - percentage],
                backgroundColor: [color, '#f0f0f0'],
                borderWidth: 0,
                cutout: '75%'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    enabled: false
                }
            },
            rotation: -90,
            circumference: 180,
            animation: {
                animateRotate: true,
                duration: 1000
            }
        }
    });
}

// Use the formatRelativeTime from uiUtils
function formatRelativeTime(date) {
    return window.uiUtils.formatRelativeTime(date);
}

// Update only metrics for existing generators
async function updateGeneratorMetrics() {
    if (!dashboardData || !dashboardData.generators) {
        return;
    }

    try {
        // Update metrics for each generator
        const updatedGenerators = await Promise.all(
            dashboardData.generators.map(async (generator) => {
                try {
                    // Get latest metrics from public generator endpoint
                    const metricsResponse = await fetch(`/api/generators/${generator.generatorCode}/metrics/latest?metrics=voltatge_avg,potenciaFotovoltaica_avg,frequencia_avg`, {
                        method: 'GET',
                        headers: {
                            'Content-Type': 'application/json'
                        }
                    });

                    if (metricsResponse.ok) {
                        const metricsData = await metricsResponse.json();
                        
                        // Update generator metrics
                        const updatedGenerator = {
                            ...generator,
                            metrics: {
                                power: metricsData.metrics.potenciaFotovoltaica_avg || 0,
                                voltage: metricsData.metrics.voltatge_avg || 0,
                                frequency: metricsData.metrics.frequencia_avg || 0
                            },
                            lastUpdate: metricsData.timestamp,
                            hasData: metricsData.totalMetrics > 0
                        };

                        // Update the gauge values and charts
                        updateGeneratorGauges(updatedGenerator);
                        
                        return updatedGenerator;
                    } else {
                        return generator;
                    }
                } catch (error) {
                    console.warn(`Error updating metrics for ${generator.generatorCode}:`, error);
                    return generator;
                }
            })
        );

        // Update dashboard data
        dashboardData.generators = updatedGenerators;
        
        // Update stats
        renderStats(dashboardData);

        console.log('Metrics updated successfully');

    } catch (error) {
        console.error('Error updating generator metrics:', error);
    }
}

// Update gauges for a specific generator
function updateGeneratorGauges(generator) {
    // Update gauge values
    const powerValueEl = document.getElementById(`powerValue_${generator.generatorCode}`);
    const voltageValueEl = document.getElementById(`voltageValue_${generator.generatorCode}`);
    const frequencyValueEl = document.getElementById(`frequencyValue_${generator.generatorCode}`);

    if (powerValueEl) {
        powerValueEl.innerHTML = generator.hasData && generator.metrics.power !== undefined 
            ? `${(generator.metrics.power / 1000).toFixed(1)}<br><span class="gauge-unit">kW</span>`
            : '-';
    }

    if (voltageValueEl) {
        voltageValueEl.innerHTML = generator.hasData && generator.metrics.voltage !== undefined 
            ? `${generator.metrics.voltage.toFixed(0)}<br><span class="gauge-unit">V</span>`
            : '-';
    }

    if (frequencyValueEl) {
        frequencyValueEl.innerHTML = generator.hasData && generator.metrics.frequency !== undefined 
            ? `${generator.metrics.frequency.toFixed(1)}<br><span class="gauge-unit">Hz</span>`
            : '-';
    }

    // Update gauge charts
    updateGauge(`powerGauge_${generator.generatorCode}`, generator.metrics.power || 0, 0, 200000);
    updateGauge(`voltageGauge_${generator.generatorCode}`, generator.metrics.voltage || 0, 200, 250);
    updateGauge(`frequencyGauge_${generator.generatorCode}`, generator.metrics.frequency || 0, 49, 51);

    // Update last update time
    const lastUpdateEl = document.querySelector(`#generatorsList .generator-card:has(#powerGauge_${generator.generatorCode}) .last-update`);
    if (lastUpdateEl && generator.lastUpdate) {
        lastUpdateEl.textContent = `Última actualització: ${formatRelativeTime(new Date(generator.lastUpdate))}`;
    }
}

// Update existing gauge chart with new value
function updateGauge(canvasId, value, min, max) {
    const chart = gaugeCharts[canvasId];
    if (!chart) return;

    // Calculate new percentage
    const percentage = Math.min(Math.max((value - min) / (max - min) * 100, 0), 100);
    
    // Update chart data
    chart.data.datasets[0].data = [percentage, 100 - percentage];
    chart.update('none'); // Update without animation for smoother experience
}

// Auto-refresh dashboard data every 60 seconds (1 minute)
function setupAutoRefresh() {
    // Full reload every 5 minutes
    setInterval(() => {
        if (dashboardData && dashboardData.hasParticipations) {
            loadDashboardData();
        }
    }, 300000); // 5 minutes

    // Metrics update every 60 seconds
    setInterval(() => {
        if (dashboardData && dashboardData.hasParticipations) {
            updateGeneratorMetrics();
        }
    }, 60000); // 1 minute

    // Historical chart refresh every 5 minutes
    setInterval(() => {
        if (dashboardData && dashboardData.hasParticipations && historicalChart) {
            loadHistoricalChart(currentPeriod);
        }
    }, 300000); // 5 minutes
}

// Initialize dashboard when DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
    // Initialize dashboard
    initializeDashboard();
});

function initializeDashboard() {
    console.log('Dashboard initialized');
    loadDashboardData();
    setupAutoRefresh();
    
    // Initialize Lucide icons after DOM is ready
    setTimeout(() => {
        if (typeof lucide !== 'undefined') {
            lucide.createIcons();
        }
    }, 100);
}

function initializeLucideIcons() {
    // Replace emoji icons with Lucide icons
    const statIcons = document.querySelectorAll('.stat-icon');
    if (statIcons.length >= 3) {
        statIcons[0].innerHTML = '<i data-lucide="zap"></i>'; // Generadors
        statIcons[1].innerHTML = '<i data-lucide="bar-chart-3"></i>'; // % Total
        statIcons[2].innerHTML = '<i data-lucide="refresh-cw"></i>'; // Última actualització
    }
    
    // Replace error icon
    const errorIcon = document.querySelector('.error-icon');
    if (errorIcon) {
        errorIcon.innerHTML = '<i data-lucide="alert-triangle" style="width: 48px; height: 48px;"></i>';
    }
    
    // Replace empty state icon
    const emptyStateIcon = document.querySelector('.empty-state-icon');
    if (emptyStateIcon) {
        emptyStateIcon.innerHTML = '<i data-lucide="factory" style="width: 64px; height: 64px;"></i>';
    }
    
    // Initialize Lucide icons
    if (typeof lucide !== 'undefined') {
        lucide.createIcons();
    }
}

// Historical Chart Functions
async function loadHistoricalChart(period = currentPeriod) {
    try {
        showChartLoading();
        
        const { data } = await window.apiClient.get(`/api/dashboard/historical-chart?period=${period}`);
        
        renderHistoricalChart(data);
        renderDifferenceChart(data);
        currentPeriod = period;

    } catch (error) {
        console.error('Error loading historical chart:', error);
        showChartError(error.message);
        showDifferenceChartError(error.message);
    }
}

function showChartLoading() {
    document.getElementById('chartLoading').style.display = 'flex';
    document.getElementById('chartError').style.display = 'none';
    document.getElementById('historicalChart').style.display = 'none';
}

function showChartError(message) {
    document.getElementById('chartLoading').style.display = 'none';
    document.getElementById('chartError').style.display = 'flex';
    document.getElementById('historicalChart').style.display = 'none';
    
    const errorElement = document.querySelector('#chartError p');
    if (errorElement) {
        errorElement.textContent = message || 'Error carregant les dades històriques';
    }
}

function showChart() {
    document.getElementById('chartLoading').style.display = 'none';
    document.getElementById('chartError').style.display = 'none';
    document.getElementById('historicalChart').style.display = 'block';
}

function renderHistoricalChart(data) {
    const canvas = document.getElementById('historicalChart');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    
    // Destroy existing chart if it exists
    if (historicalChart) {
        historicalChart.destroy();
    }

    // Filter out difference dataset for the line chart - only show consumption and generation
    const lineDatasets = data.datasets.filter(dataset => dataset.type !== 'difference');
    
    // Prepare datasets with different colors for each type
    const processedDatasets = lineDatasets.map((dataset, index) => {
        let borderColor, backgroundColor;
        
        // Check if it's consumption data by looking at the label
        const isConsumption = dataset.label && dataset.label.toLowerCase().includes('consum');
        
        if (isConsumption) {
            borderColor = '#1b4444';
            backgroundColor = 'rgba(27, 68, 68, 0.1)';
        } else {
            // Use different shades of green for different generators
            const greenShades = [
                '#459f49',
                '#2d7a32',
                '#66bb6a',
                '#4caf50',
                '#388e3c'
            ];
            borderColor = greenShades[index % greenShades.length];
            backgroundColor = borderColor.replace('rgb', 'rgba').replace(')', ', 0.1)');
        }

        // Create a clean dataset without the custom type property
        const cleanDataset = {
            label: dataset.label,
            data: dataset.data,
            borderColor,
            backgroundColor,
            borderWidth: 2,
            pointRadius: 0,
            pointHoverRadius: 4,
            fill: false,
            tension: 0.1
        };

        // Store the type information in a custom property that won't conflict with Chart.js
        cleanDataset._datasetType = dataset.type;

        return cleanDataset;
    });

    historicalChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: data.labels,
            datasets: processedDatasets
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
                    display: false // We use custom legend
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
                            
                            // Check if it's consumption data by looking at the label
                            const isConsumption = context.dataset.label && context.dataset.label.toLowerCase().includes('consum');
                            
                            if (isConsumption) {
                                return `${context.dataset.label}: ${value.toFixed(0)} W`;
                            } else {
                                return `${context.dataset.label}: ${value.toFixed(1)} W`;
                            }
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
            elements: {
                point: {
                    hoverBackgroundColor: '#fcbd25'
                }
            },
            animation: {
                duration: 1000,
                easing: 'easeInOutQuart'
            }
        }
    });

    // Calculate energy utilization after rendering the chart
    calculateEnergyUtilization(data);
    
    showChart();
    
    console.log('Historical chart rendered successfully', {
        period: data.period,
        datasets: data.datasets.length,
        dataPoints: data.totalDataPoints
    });
}

function setupPeriodControls() {
    const periodToggle = document.getElementById('period-toggle');
    const differencePeriodToggle = document.getElementById('difference-period-toggle');
    
    // Function to sync both toggles and load data
    function syncPeriodsAndLoadData(period, sourceToggleId) {
        // Update the other toggle to match
        if (sourceToggleId === 'period-toggle' && differencePeriodToggle) {
            const modeIndex = ['24h', '7d', '30d'].indexOf(period);
            if (modeIndex !== -1) {
                differencePeriodToggle.setAttribute('mode', modeIndex.toString());
            }
        } else if (sourceToggleId === 'difference-period-toggle' && periodToggle) {
            const modeIndex = ['24h', '7d', '30d'].indexOf(period);
            if (modeIndex !== -1) {
                periodToggle.setAttribute('mode', modeIndex.toString());
            }
        }
        
        // Load new data with the selected period
        loadHistoricalChart(period);
        
        console.log('Period changed to:', period);
    }
    
    // Setup event listener for historical chart toggle
    if (periodToggle) {
        periodToggle.addEventListener('mode-change', function(event) {
            const period = event.detail.value;
            syncPeriodsAndLoadData(period, 'period-toggle');
        });
    }
    
    // Setup event listener for difference chart toggle
    if (differencePeriodToggle) {
        differencePeriodToggle.addEventListener('mode-change', function(event) {
            const period = event.detail.value;
            syncPeriodsAndLoadData(period, 'difference-period-toggle');
        });
    }
}

// Auto-refresh historical chart
function setupHistoricalChartAutoRefresh() {
    // Refresh historical chart every 5 minutes
    setInterval(() => {
        if (dashboardData && dashboardData.hasParticipations && historicalChart) {
            loadHistoricalChart(currentPeriod);
        }
    }, 300000); // 5 minutes
}

// Difference Chart Functions
function showDifferenceChartLoading() {
    document.getElementById('differenceChartLoading').style.display = 'flex';
    document.getElementById('differenceChartError').style.display = 'none';
    document.getElementById('differenceChart').style.display = 'none';
}

function showDifferenceChartError(message) {
    document.getElementById('differenceChartLoading').style.display = 'none';
    document.getElementById('differenceChartError').style.display = 'flex';
    document.getElementById('differenceChart').style.display = 'none';
    
    const errorElement = document.querySelector('#differenceChartError p');
    if (errorElement) {
        errorElement.textContent = message || 'Error carregant les dades d\'aprofitament';
    }
}

function showDifferenceChart() {
    document.getElementById('differenceChartLoading').style.display = 'none';
    document.getElementById('differenceChartError').style.display = 'none';
    document.getElementById('differenceChart').style.display = 'block';
}

function renderDifferenceChart(data) {
    const canvas = document.getElementById('differenceChart');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    
    // Destroy existing chart if it exists
    if (differenceChart) {
        differenceChart.destroy();
    }

    // Calculate grid energy and solar energy for each timestamp
    const consumptionDatasets = data.datasets.filter(dataset => {
        if (dataset.type === 'difference') return false;
        return dataset.type === 'consumption' || 
               (dataset.label && dataset.label.toLowerCase().includes('consum'));
    });
    
    const generationDatasets = data.datasets.filter(dataset => {
        if (dataset.type === 'difference') return false;
        return dataset.type === 'generation' || 
               (dataset.label && !dataset.label.toLowerCase().includes('consum') && 
                dataset.label.includes('%'));
    });

    const gridEnergyData = [];
    const solarEnergyData = [];

    // Calculate for each timestamp
    for (let i = 0; i < data.labels.length; i++) {
        let consumptionAtTime = 0;
        let generationAtTime = 0;

        // Sum consumption at this timestamp
        consumptionDatasets.forEach(dataset => {
            const value = dataset.data[i];
            if (value !== null && value !== undefined && !isNaN(value) && value > 0) {
                consumptionAtTime += value;
            }
        });

        // Sum generation at this timestamp
        generationDatasets.forEach(dataset => {
            const value = dataset.data[i];
            if (value !== null && value !== undefined && !isNaN(value) && value > 0) {
                generationAtTime += value;
            }
        });

        // Calculate solar energy used (min between consumption and generation) - positive values
        const solarEnergyUsed = Math.min(consumptionAtTime, generationAtTime);
        
        // Calculate grid energy needed (consumption - solar energy used) - negative values for downward display
        const gridEnergyNeeded = Math.max(0, consumptionAtTime - solarEnergyUsed);

        solarEnergyData.push(consumptionAtTime > 0 || generationAtTime > 0 ? solarEnergyUsed : null);
        gridEnergyData.push(consumptionAtTime > 0 || generationAtTime > 0 ? -gridEnergyNeeded : null); // Negative for downward display
    }

    differenceChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: data.labels,
            datasets: [
                {
                    label: 'Energia solar',
                    data: solarEnergyData,
                    backgroundColor: '#fcbd25',
                    borderColor: '#fcbd25',
                    borderWidth: 0,
                    borderRadius: 2,
                    borderSkipped: false,
                    maxBarThickness: 20,
                },
                {
                    label: 'Energia de la xarxa',
                    data: gridEnergyData,
                    backgroundColor: '#6b7280',
                    borderColor: '#6b7280',
                    borderWidth: 0,
                    borderRadius: 2,
                    borderSkipped: false,
                    maxBarThickness: 20,
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            devicePixelRatio: window.devicePixelRatio || 1,
            interaction: {
                mode: 'index',
                intersect: false,
            },
            elements: {
                bar: {
                    borderWidth: 0,
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
                        text: 'Energia (W)',
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
                            const absValue = Math.abs(value);
                            if (absValue >= 1000) {
                                return (absValue / 1000).toFixed(1) + 'kW';
                            }
                            return absValue.toFixed(0) + 'W';
                        }
                    }
                }
            },
            plugins: {
                legend: {
                    display: false // We use custom legend
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
                            if (value === null || value === 0) return null;
                            
                            const absValue = Math.abs(value);
                            const unit = absValue >= 1000 ? 'kW' : 'W';
                            const displayValue = absValue >= 1000 ? (absValue / 1000).toFixed(1) : absValue.toFixed(0);
                            
                            return `${context.dataset.label}: ${displayValue} ${unit}`;
                        },
                        footer: function(context) {
                            // Calculate total consumption for this timestamp
                            const solarValue = context.find(c => c.dataset.label === 'Energia solar')?.parsed.y || 0;
                            const gridValue = Math.abs(context.find(c => c.dataset.label === 'Energia de la xarxa')?.parsed.y || 0);
                            const total = solarValue + gridValue;
                            
                            if (total > 0) {
                                const unit = total >= 1000 ? 'kW' : 'W';
                                const displayValue = total >= 1000 ? (total / 1000).toFixed(1) : total.toFixed(0);
                                return `Total consum: ${displayValue} ${unit}`;
                            }
                            return '';
                        }
                    }
                }
            },
            animation: {
                duration: 1000,
                easing: 'easeInOutQuart'
            }
        }
    });

    showDifferenceChart();
    
    console.log('Energy source chart rendered successfully', {
        period: data.period,
        solarDataPoints: solarEnergyData.filter(v => v !== null && v > 0).length,
        gridDataPoints: gridEnergyData.filter(v => v !== null && v > 0).length
    });
}

// Calculate energy utilization from historical data
function calculateEnergyUtilization(data) {
    console.log('🔍 Calculating energy utilization with data:', data);
    
    if (!data || !data.datasets || data.datasets.length === 0) {
        console.log('❌ No data or datasets found');
        energyUtilizationData.totalKwUtilized = 0;
        energyUtilizationData.utilizationPercentage = 0;
        updateUtilizationStats();
        return;
    }

    console.log('📊 Available datasets:', data.datasets.map(d => ({ label: d.label, type: d.type, dataLength: d.data?.length })));

    // More flexible detection of consumption and generation datasets
    const consumptionDatasets = data.datasets.filter(dataset => {
        if (dataset.type === 'difference') return false; // Skip difference dataset
        
        // Check for consumption indicators
        const isConsumption = dataset.type === 'consumption' || 
                             (dataset.label && dataset.label.toLowerCase().includes('consum')) ||
                             (dataset.label && dataset.label.toLowerCase().includes('device'));
        
        console.log(`Dataset "${dataset.label}" - Type: ${dataset.type} - Is Consumption: ${isConsumption}`);
        return isConsumption;
    });
    
    const generationDatasets = data.datasets.filter(dataset => {
        if (dataset.type === 'difference') return false; // Skip difference dataset
        
        // Check for generation indicators
        const isGeneration = dataset.type === 'generation' || 
                            (dataset.label && !dataset.label.toLowerCase().includes('consum') && 
                             !dataset.label.toLowerCase().includes('device') &&
                             (dataset.label.toLowerCase().includes('generador') ||
                              dataset.label.toLowerCase().includes('solar') ||
                              dataset.label.toLowerCase().includes('fotovoltaic') ||
                              dataset.label.includes('%'))); // Generators usually have % in label
        
        console.log(`Dataset "${dataset.label}" - Type: ${dataset.type} - Is Generation: ${isGeneration}`);
        return isGeneration;
    });

    console.log(`🔋 Found ${consumptionDatasets.length} consumption datasets and ${generationDatasets.length} generation datasets`);

    if (consumptionDatasets.length === 0 && generationDatasets.length === 0) {
        console.log('⚠️ No consumption or generation datasets found');
        energyUtilizationData.totalKwUtilized = 0;
        energyUtilizationData.utilizationPercentage = 0;
        updateUtilizationStats();
        return;
    }

    let totalConsumption = 0;
    let totalGeneration = 0;
    let totalUtilized = 0;
    let validDataPoints = 0;

    // Calculate totals for each timestamp
    for (let i = 0; i < data.labels.length; i++) {
        let consumptionAtTime = 0;
        let generationAtTime = 0;

        // Sum consumption at this timestamp
        consumptionDatasets.forEach(dataset => {
            const value = dataset.data[i];
            if (value !== null && value !== undefined && !isNaN(value) && value > 0) {
                consumptionAtTime += value;
            }
        });

        // Sum generation at this timestamp
        generationDatasets.forEach(dataset => {
            const value = dataset.data[i];
            if (value !== null && value !== undefined && !isNaN(value) && value > 0) {
                generationAtTime += value;
            }
        });

        // Only count if we have valid data
        if (consumptionAtTime > 0 || generationAtTime > 0) {
            totalConsumption += consumptionAtTime;
            totalGeneration += generationAtTime;
            
            // Energy utilized = minimum between consumption and generation at each point
            const utilizedAtTime = Math.min(consumptionAtTime, generationAtTime);
            totalUtilized += utilizedAtTime;
            
            validDataPoints++;
        }
    }

    console.log(`📈 Calculation results:`, {
        totalConsumption,
        totalGeneration,
        totalUtilized,
        validDataPoints
    });

    // Convert to kW and calculate totals and averages
    const avgConsumptionKw = validDataPoints > 0 ? (totalConsumption / validDataPoints) / 1000 : 0;
    const totalUtilizedKw = totalUtilized / 1000; // Total kW utilized in the period
    const totalGenerationKw = totalGeneration / 1000; // Total kW generated in the period
    
    // Calculate total wasted energy (total generation - total utilized)
    const totalWastedKw = Math.max(0, totalGenerationKw - totalUtilizedKw);
    
    // Calculate utilization percentage based on averages
    const utilizationPercentage = avgConsumptionKw > 0 ? ((totalUtilized / validDataPoints) / 1000 / avgConsumptionKw) * 100 : 0;

    // Update global data with totals
    energyUtilizationData.totalKwUtilized = totalUtilizedKw;
    energyUtilizationData.totalKwWasted = totalWastedKw;
    energyUtilizationData.utilizationPercentage = utilizationPercentage;

    // Update the UI
    updateUtilizationStats();

    console.log('✅ Energy utilization calculated:', {
        avgConsumptionKw: avgConsumptionKw.toFixed(2),
        totalUtilizedKw: totalUtilizedKw.toFixed(2),
        totalWastedKw: totalWastedKw.toFixed(2),
        utilizationPercentage: utilizationPercentage.toFixed(1),
        validDataPoints,
        consumptionDatasets: consumptionDatasets.length,
        generationDatasets: generationDatasets.length
    });
}

// Update utilization stats in the UI
function updateUtilizationStats() {
    const totalKwUtilizedEl = document.getElementById('totalKwUtilized');
    const totalKwWastedEl = document.getElementById('totalKwWasted');
    const utilizationPercentageEl = document.getElementById('utilizationPercentage');

    console.log('🔄 Updating utilization stats:', {
        totalKwUtilized: energyUtilizationData.totalKwUtilized,
        totalKwWasted: energyUtilizationData.totalKwWasted,
        utilizationPercentage: energyUtilizationData.utilizationPercentage,
        totalKwUtilizedEl: !!totalKwUtilizedEl,
        totalKwWastedEl: !!totalKwWastedEl,
        utilizationPercentageEl: !!utilizationPercentageEl
    });

    if (totalKwUtilizedEl) {
        const displayValue = energyUtilizationData.totalKwUtilized > 0 
            ? `${energyUtilizationData.totalKwUtilized.toFixed(1)}`
            : '-';
        totalKwUtilizedEl.textContent = displayValue;
        console.log(`✅ Updated totalKwUtilized to: ${displayValue}`);
    } else {
        console.log('❌ totalKwUtilized element not found');
    }

    if (totalKwWastedEl) {
        const displayValue = energyUtilizationData.totalKwWasted > 0 
            ? `${energyUtilizationData.totalKwWasted.toFixed(1)}`
            : '-';
        totalKwWastedEl.textContent = displayValue;
        console.log(`✅ Updated totalKwWasted to: ${displayValue}`);
    } else {
        console.log('❌ totalKwWasted element not found');
    }

    if (utilizationPercentageEl) {
        const displayValue = energyUtilizationData.utilizationPercentage > 0 
            ? `${energyUtilizationData.utilizationPercentage.toFixed(1)}%`
            : '-';
        utilizationPercentageEl.textContent = displayValue;
        console.log(`✅ Updated utilizationPercentage to: ${displayValue}`);
    } else {
        console.log('❌ utilizationPercentage element not found');
    }
}

// Function to test utilization display with mock data
function testUtilizationDisplay() {
    console.log('🧪 Testing utilization display with mock data...');
    
    // Set mock data
    energyUtilizationData.totalKwUtilized = 2.5;
    energyUtilizationData.totalKwWasted = 1.2;
    energyUtilizationData.utilizationPercentage = 75.3;
    
    // Update display
    updateUtilizationStats();
    
    console.log('✅ Mock data applied. Check the dashboard for values.');
}

// Make test function available globally for debugging
window.testUtilizationDisplay = testUtilizationDisplay;

// Make functions available globally
window.loadDashboardData = loadDashboardData;
window.loadHistoricalChart = loadHistoricalChart;

// Export functions for global access
window.dashboardUtils = {
    initializeDashboard,
    loadDashboardData,
    loadHistoricalChart,
    formatRelativeTime,
    calculateEnergyUtilization
};
