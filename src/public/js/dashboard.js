// Dashboard functionality
console.log('Dashboard loaded');

// Global variables
let dashboardData = null;
let gaugeCharts = {};
let historicalChart = null;
let currentPeriod = '24h';

// Profile modal functions
function showProfile() {
    const modal = document.getElementById('profileModal');
    if (modal) {
        modal.classList.remove('modal-hidden');
    }
}

function closeProfile() {
    const modal = document.getElementById('profileModal');
    if (modal) {
        modal.classList.add('modal-hidden');
    }
}

function getAuthToken() {
    // Get token from cookie or localStorage
    const cookies = document.cookie.split(';');
    for (let cookie of cookies) {
        const [name, value] = cookie.trim().split('=');
        if (name === 'authToken') {
            return value;
        }
    }
    return localStorage.getItem('authToken');
}

// Dashboard data loading
async function loadDashboardData() {
    try {
        showLoading();
        
        // First get user participations
        const participationsResponse = await fetch('/api/dashboard/user-generators', {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${getAuthToken()}`,
                'Content-Type': 'application/json'
            }
        });

        const participationsData = await participationsResponse.json();

        if (!participationsResponse.ok) {
            throw new Error(participationsData.error || 'Error carregant les dades');
        }

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
    
    // Find most recent update
    const lastUpdate = data.generators
        .filter(gen => gen.lastUpdate)
        .map(gen => new Date(gen.lastUpdate))
        .sort((a, b) => b - a)[0];

    document.getElementById('totalGenerators').textContent = data.activeGenerators;
    document.getElementById('totalParticipation').textContent = `${totalParticipation.toFixed(1)}%`;
    document.getElementById('lastUpdate').textContent = lastUpdate 
        ? formatRelativeTime(lastUpdate)
        : 'Sense dades';
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

function formatRelativeTime(date) {
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
    
    // Close profile modal button
    const closeProfileBtn = document.getElementById('closeProfileBtn');
    if (closeProfileBtn) {
        closeProfileBtn.addEventListener('click', closeProfile);
    }

    // Close modal when clicking outside
    const profileModal = document.getElementById('profileModal');
    if (profileModal) {
        profileModal.addEventListener('click', function(e) {
            if (e.target === this) {
                closeProfile();
            }
        });
    }

    // Profile form submission
    const profileForm = document.getElementById('profileForm');
    if (profileForm) {
        profileForm.addEventListener('submit', async function(e) {
            e.preventDefault();
            
            const name = document.getElementById('profileName').value.trim();
            const submitBtn = e.target.querySelector('button[type="submit"]');
            const btnText = submitBtn.querySelector('.btn-text');
            const loading = document.getElementById('profileLoading');
            
            if (!name) {
                alert('El nom és obligatori');
                return;
            }
            
            // Show loading
            submitBtn.disabled = true;
            btnText.style.display = 'none';
            loading.classList.remove('loading-hidden');
            
            try {
                const response = await fetch('/api/auth/profile', {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${getAuthToken()}`
                    },
                    body: JSON.stringify({ name })
                });
                
                const data = await response.json();
                
                if (response.ok) {
                    // Update the name in the dashboard
                    const dashboardTitle = document.querySelector('.dashboard-title');
                    if (dashboardTitle) {
                        dashboardTitle.textContent = `Benvingut, ${data.name}!`;
                    }
                    // Update navbar
                    const userDropdown = document.querySelector('#userDropdown');
                    if (userDropdown && userDropdown.childNodes[0]) {
                        userDropdown.childNodes[0].textContent = data.name;
                    }
                    closeProfile();
                    alert('Perfil actualitzat correctament');
                } else {
                    alert(data.error || 'Error actualitzant el perfil');
                }
            } catch (error) {
                console.error('Error:', error);
                alert('Error de connexió');
            } finally {
                // Hide loading
                submitBtn.disabled = false;
                btnText.style.display = 'inline';
                loading.classList.add('loading-hidden');
            }
        });
    }
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
        
        const response = await fetch(`/api/dashboard/historical-chart?period=${period}`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${getAuthToken()}`,
                'Content-Type': 'application/json'
            }
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Error carregant dades històriques');
        }

        renderHistoricalChart(data);
        currentPeriod = period;

    } catch (error) {
        console.error('Error loading historical chart:', error);
        showChartError(error.message);
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

    // Prepare datasets with different colors for each type
    const processedDatasets = data.datasets.map((dataset, index) => {
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

    showChart();
    
    console.log('Historical chart rendered successfully', {
        period: data.period,
        datasets: data.datasets.length,
        dataPoints: data.totalDataPoints
    });
}

function setupPeriodControls() {
    const periodButtons = document.querySelectorAll('.period-btn');
    
    periodButtons.forEach(button => {
        button.addEventListener('click', function() {
            const period = this.getAttribute('data-period');
            
            // Update active state
            periodButtons.forEach(btn => btn.classList.remove('active'));
            this.classList.add('active');
            
            // Load new data
            loadHistoricalChart(period);
        });
    });
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

// Make functions available globally
window.showProfile = showProfile;
window.loadDashboardData = loadDashboardData;
window.loadHistoricalChart = loadHistoricalChart;

// Export functions for global access
window.dashboardUtils = {
    initializeDashboard,
    loadDashboardData,
    loadHistoricalChart,
    showProfile,
    closeProfile,
    formatRelativeTime
};
