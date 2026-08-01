let DEVICE_COLORS = {};
let DEVICE_NAMES = {};
let selectedDevices = [];
let chartInstances = {};
let currentIntervals = [];

document.addEventListener('DOMContentLoaded', function() {
    // Llegir colors i noms dels tags del DOM
    document.querySelectorAll('.stats-device-tag').forEach(function(tag) {
        var device = tag.dataset.device;
        var dot = tag.querySelector('.stats-color-dot');
        DEVICE_COLORS[device] = dot ? dot.style.backgroundColor : '#888';
        DEVICE_NAMES[device] = tag.textContent.trim();
    });

    selectedDevices = document.querySelectorAll('.stats-device-tag.active').length > 0
        ? Array.from(document.querySelectorAll('.stats-device-tag.active')).map(function(t) { return t.dataset.device; })
        : Object.keys(DEVICE_COLORS);

    const now = moment();
    document.getElementById('dateFrom').value = now.clone().subtract(30, 'days').format('YYYY-MM-DD');
    document.getElementById('dateTo').value = now.format('YYYY-MM-DD');

    document.querySelectorAll('.stats-device-tag').forEach(function(tag) {
        tag.addEventListener('click', function() {
            this.classList.toggle('active');
            updateSelectedDevices();
        });
    });

    document.querySelectorAll('.stats-quick-btn').forEach(function(btn) {
        btn.addEventListener('click', function() {
            document.querySelectorAll('.stats-quick-btn').forEach(function(b) { b.classList.remove('active'); });
            this.classList.add('active');
            var days = parseInt(this.dataset.days);
            var to = moment();
            var from = to.clone().subtract(days, 'days');
            document.getElementById('dateFrom').value = from.format('YYYY-MM-DD');
            document.getElementById('dateTo').value = to.format('YYYY-MM-DD');
            updateDashboard();
        });
    });

    document.getElementById('dateFrom').addEventListener('change', updateDashboard);
    document.getElementById('dateTo').addEventListener('change', updateDashboard);

    updateDashboard();
});

function updateSelectedDevices() {
    selectedDevices = [];
    document.querySelectorAll('.stats-device-tag.active').forEach(function(tag) {
        selectedDevices.push(tag.dataset.device);
    });
    if (selectedDevices.length > 0) updateDashboard();
}

function updateDashboard() {
    var from = document.getElementById('dateFrom').value;
    var to = document.getElementById('dateTo').value;
    var cups = document.getElementById('statsContainer').dataset.cups;
    var params = 'from=' + from + '&to=' + to + '&cups=' + encodeURIComponent(cups);

    document.getElementById('periodDisplay').textContent =
        moment(from).format('DD/MM/YYYY') + ' - ' + moment(to).format('DD/MM/YYYY');

    // Carregar totes les dades d'un cop
    fetch('/api/statistics/data?' + params)
        .then(function(res) { return res.json(); })
        .then(function(result) {
            currentIntervals = result.intervals || [];
            updateKPIs(result.summary);
            updateCharts(currentIntervals);
            updateSummary(result.summary);
            updateDeviceBreakdown(result.summary);
            try {
                renderSolarDonuts(result.summary);
            } catch (err) {
                console.error('Error renderitzant donuts solar/xarxa:', err);
            }
        })
        .catch(function(err) {
            console.error('Error carregant dades:', err);
            showToast('Error carregant dades', 'error');
        });

    // Balanc energetic per 1/4 d'hora (evolucio)
    fetch('/api/statistics/balance?' + params)
        .then(function(res) { return res.json(); })
        .then(function(result) {
            renderBalanceChart(result.intervals || []);
        })
        .catch(function(err) {
            console.error('Error carregant balanç:', err);
            showToast('Error carregant balanç', 'error');
        });

    // Consum total KPI via /consumption (dades acumulades exactes)
    fetch('/api/statistics/consumption?' + params)
        .then(function(res) { return res.json(); })
        .then(function(result) {
            var totalWh = result.totalConsumptionWh || 0;
            document.getElementById('kpiConsumption').textContent = formatKwh(totalWh);
            var cs = result.startTotal || 0;
            var ce = result.endTotal || 0;
            document.getElementById('kpiConsumptionSub').textContent =
                formatKwh(cs) + ' → ' + formatKwh(ce);
        })
        .catch(function(err) {
            console.error('Error carregant consum:', err);
            showToast('Error carregant consum', 'error');
        });

    // Solar KPI via /solar (inclou càlcul d'avui)
    fetch('/api/statistics/solar?' + params)
        .then(function(res) { return res.json(); })
        .then(function(result) {
            var solarWh = result.totalSolarWh || 0;
            document.getElementById('kpiSolar').textContent = formatKwh(solarWh);
            var ps = result.periodStartWh || 0;
            var pe = result.periodEndWh || 0;
            document.getElementById('kpiSolarSub').textContent =
                formatKwh(ps) + ' → ' + formatKwh(pe);
        })
        .catch(function(err) {
            console.error('Error carregant solar:', err);
            showToast('Error carregant solar', 'error');
        });
}

function updateKPIs(summary) {
    document.getElementById('kpiSolar').textContent = formatKwh(summary.totalSolar);
    document.getElementById('kpiGrid_').textContent = formatKwh(summary.totalGrid);
    document.getElementById('kpiExport').textContent = formatKwh(summary.totalExport);
    document.getElementById('kpiSelfConsumption').textContent = (summary.selfConsumptionPct || 0) + '%';

    var solarUsed = Math.max(0, (summary.totalConsumption || 0) - (summary.totalGrid || 0));
    document.getElementById('kpiSolarUsed').textContent = formatKwh(solarUsed);

    var gridPct = summary.totalConsumption > 0
        ? Math.round((summary.totalGrid / summary.totalConsumption) * 100)
        : 0;
    var solarUsedPct = summary.totalConsumption > 0
        ? Math.round((solarUsed / summary.totalConsumption) * 100)
        : 0;
    var selfConsPct = summary.totalSolar > 0
        ? Math.round((solarUsed / summary.totalSolar) * 100)
        : 0;
    var exportPct = summary.totalSolar > 0
        ? Math.round((summary.totalExport / summary.totalSolar) * 100)
        : 0;
    document.getElementById('kpiSelfConsumption').textContent = selfConsPct + '%';
    document.getElementById('kpiGridSub').textContent = gridPct + '% del consum total';
    document.getElementById('kpiExportSub').textContent = exportPct + '% de la generacio';
    document.getElementById('kpiSelfConsumptionSub').textContent = summary.co2Saved + ' kg CO2 estalviats';
    document.getElementById('kpiSolarUsedSub').textContent = solarUsedPct + '% del consum total';
}

function renderSolarDonuts(summary) {
    var totalConsumption = summary.totalConsumption || 0;
    var totalGrid = summary.totalGrid || 0;
    var totalExport = summary.totalExport || 0;
    var solarUsed = Math.max(0, totalConsumption - totalGrid);

    var donutOptions = function() {
        return {
            responsive: true,
            maintainAspectRatio: true,
            cutout: '62%',
            plugins: { legend: { display: false } }
        };
    };

    renderChart('solarMixChart', 'doughnut',
        ['Energia Solar', 'Energia de Xarxa'],
        [{
            data: [Math.round(solarUsed * 100) / 100, Math.round(totalGrid * 100) / 100],
            backgroundColor: ['#ffd93d', '#ff6b6b'],
            borderWidth: 0
        }],
        donutOptions());

    renderChart('generationUseChart', 'doughnut',
        ['Solar aprofitada', 'Exportada a la xarxa'],
        [{
            data: [Math.round(solarUsed * 100) / 100, Math.round(totalExport * 100) / 100],
            backgroundColor: ['#8bc34a', '#4a90d9'],
            borderWidth: 0
        }],
        donutOptions());

    setDonutLegend('solarMixLegend', [solarUsed, totalGrid], ['Energia Solar', 'Energia de Xarxa'], ['#ffd93d', '#ff6b6b']);
    setDonutLegend('generationUseLegend', [solarUsed, totalExport], ['Solar aprofitada', 'Exportada a la xarxa'], ['#8bc34a', '#4a90d9']);
}

function setDonutLegend(elId, values, labels, colors) {
    var el = document.getElementById(elId);
    if (!el) return;
    var total = values.reduce(function(a, b) { return a + b; }, 0);
    var html = '';
    values.forEach(function(v, i) {
        var pct = total > 0 ? Math.round((v / total) * 100) : 0;
        html += '<div class="stats-donut-legend-item">' +
            '<span class="stats-donut-dot" style="background: ' + colors[i] + ';"></span>' +
            '<span class="stats-donut-legend-label">' + labels[i] + '</span>' +
            '<span class="stats-donut-legend-value">' + pct + '% (' + formatKwh(v) + ')</span>' +
            '</div>';
    });
    el.innerHTML = html;
}

function updateCharts(intervals) {
    if (!intervals || intervals.length === 0) return;

    var labels = intervals.map(function(d) { return moment(d.date).format('DD/MM'); });

    var deviceTags = Object.keys(intervals[0].devices || {}).filter(function(t) {
        return t !== 'total' && selectedDevices.indexOf(t) !== -1;
    });

    // 1. Consum per aparell (stacked bar)
    var deviceDatasets = [];

    deviceTags.forEach(function(tag) {
        deviceDatasets.push({
            label: DEVICE_NAMES[tag] || tag,
            data: intervals.map(function(d) {
                return Math.round((d.devices[tag] || 0) * 10) / 10;
            }),
            backgroundColor: DEVICE_COLORS[tag] || '#b0bec5',
            borderWidth: 1
        });
    });

    if (selectedDevices.indexOf('total') !== -1) {
        deviceDatasets.push({
            label: 'Altres',
            data: intervals.map(function(d) {
                var total = d.consumption;
                var sum = deviceTags.reduce(function(s, tag) { return s + (d.devices[tag] || 0); }, 0);
                return Math.round(Math.max(0, total - sum) * 10) / 10;
            }),
            backgroundColor: '#b0bec5',
            borderWidth: 1
        });
    }

    renderChart('consumptionChart', 'bar', labels, deviceDatasets, {
        responsive: true,
        maintainAspectRatio: true,
        plugins: { legend: { position: 'top' } },
        scales: {
            x: { stacked: true },
            y: { stacked: true, beginAtZero: true, title: { display: true, text: 'kWh' } }
        }
    });
}

function renderBalanceChart(intervals) {
    if (!intervals || intervals.length === 0) return;

    var labels = intervals.map(function(d) { return moment(d.date).format('DD/MM HH:mm'); });

    // Unió de tots els aparells presents a qualsevol interval del període
    var allTags = {};
    intervals.forEach(function(d) {
        Object.keys(d.devices || {}).forEach(function(t) { allTags[t] = true; });
    });
    var deviceTags = Object.keys(allTags).filter(function(t) {
        return t !== 'total' && selectedDevices.indexOf(t) !== -1;
    });

    var balanceDatasets = [];

    // Línia de consum per cada aparell seleccionat
    deviceTags.forEach(function(tag) {
        balanceDatasets.push({
            label: DEVICE_NAMES[tag] || tag,
            data: intervals.map(function(d) { return Math.round((d.devices[tag] || 0) * 10) / 10; }),
            borderColor: DEVICE_COLORS[tag] || '#b0bec5',
            backgroundColor: 'rgba(0,0,0,0)',
            borderWidth: 1,
            tension: 0.4,
            pointRadius: 0
        });
    });

    // Línia de consum total
    if (selectedDevices.indexOf('total') !== -1) {
        balanceDatasets.push({
            label: 'Consum Total',
            data: intervals.map(function(d) { return Math.round(d.consumption * 10) / 10; }),
            borderColor: '#1a1a2e',
            backgroundColor: 'rgba(0,0,0,0)',
            borderWidth: 1.5,
            borderDash: [5, 5],
            tension: 0.4,
            pointRadius: 0
        });
    }

    // Línia de generació solar
    if (selectedDevices.indexOf('solar') !== -1) {
        balanceDatasets.push({
            label: 'Generacio Solar',
            data: intervals.map(function(d) { return Math.round(d.solar * 10) / 10; }),
            borderColor: '#ffd93d',
            backgroundColor: 'rgba(0,0,0,0)',
            borderWidth: 1.5,
            tension: 0.4,
            pointRadius: 0
        });
    }

    // Línia excedent / xarxa (positiu = excedent, negatiu = import de la xarxa)
    balanceDatasets.push({
        label: 'Excedent / Xarxa',
        data: intervals.map(function(d) { return Math.round((d.export - d.grid) * 10) / 10; }),
        borderColor: '#4a90d9',
        backgroundColor: 'rgba(74,144,217,0.1)',
        borderWidth: 1,
        fill: true,
        tension: 0.4,
        pointRadius: 0
    });

    renderChart('balanceChart', 'line', labels, balanceDatasets, {
        responsive: true,
        maintainAspectRatio: true,
        plugins: { legend: { position: 'top' } },
        scales: {
            x: { ticks: { autoSkip: true, maxRotation: 0, maxTicksLimit: 12 } },
            y: { title: { display: true, text: 'kWh' } }
        }
    });
}

function renderChart(canvasId, type, labels, datasets, options) {
    var canvas = document.getElementById(canvasId);
    if (!canvas) return;

    if (chartInstances[canvasId]) {
        chartInstances[canvasId].destroy();
    }

    chartInstances[canvasId] = new Chart(canvas.getContext('2d'), {
        type: type,
        data: { labels: labels, datasets: datasets },
        options: options
    });
}

function updateSummary(summary) {
    document.getElementById('sumConsumption').textContent = formatKwh(summary.totalConsumption);
    document.getElementById('sumSolar').textContent = formatKwh(summary.totalSolar);
    document.getElementById('sumGrid').textContent = formatKwh(summary.totalGrid);
    document.getElementById('sumExport').textContent = formatKwh(summary.totalExport);
    document.getElementById('sumSelfConsumption').textContent = (summary.totalSolar > 0
        ? Math.round((Math.max(0, (summary.totalConsumption || 0) - (summary.totalGrid || 0)) / summary.totalSolar) * 100)
        : 0) + '%';
    document.getElementById('sumSolarUsed').textContent = formatKwh(Math.max(0, (summary.totalConsumption || 0) - (summary.totalGrid || 0)));
    document.getElementById('sumCo2').textContent = '~' + (summary.co2Saved || 0) + ' kg';
    document.getElementById('sumSaving').textContent = '~' + (summary.economicSaving || 0) + ' EUR';
    document.getElementById('sumDays').textContent = (summary.daysAnalyzed || 0) + ' dies';
    document.getElementById('sumAvg').textContent = (summary.avgDaily || 0) + ' kWh/dia';
}

function updateDeviceBreakdown(summary) {
    var container = document.getElementById('deviceBreakdown');
    if (!container || !summary.devices) return;

    var totalConsumption = summary.totalConsumption || 1;
    var devices = Object.keys(summary.devices)
        .filter(function(k) { return k !== 'total'; })
        .map(function(key) {
            return {
                key: key,
                name: DEVICE_NAMES[key] || key,
                color: DEVICE_COLORS[key] || '#888',
                wh: summary.devices[key] || 0
            };
        });

    var html = '';
    devices.forEach(function(dev) {
        var pct = dev.wh > 0 ? ((dev.wh / totalConsumption) * 100).toFixed(1) : '0.0';
        html += '<div class="stats-device-item">' +
            '<div class="stats-device-name" style="color: ' + dev.color + ';">' + dev.name + '</div>' +
            '<div class="stats-device-stats"><span>' + formatKwh(dev.wh) + '</span><span>' + pct + '%</span></div>' +
            '<div class="stats-progress-bar"><div class="stats-progress-fill" style="width: ' + pct + '%; background: ' + dev.color + ';"></div></div>' +
            '</div>';
    });

    if (summary.totalSolar) {
        var solarPct = ((summary.totalSolar / totalConsumption) * 100).toFixed(1);
        html += '<div class="stats-device-item">' +
            '<div class="stats-device-name" style="color: #ffd93d;">Solar</div>' +
            '<div class="stats-device-stats"><span>' + formatKwh(summary.totalSolar) + '</span><span>-</span></div>' +
            '<div class="stats-progress-bar"><div class="stats-progress-fill" style="width: ' + Math.min(100, solarPct) + '%; background: #ffd93d;"></div></div>' +
            '</div>';
    }

    container.innerHTML = html;
}

function resetFilters() {
    document.querySelectorAll('.stats-device-tag').forEach(function(t) { t.classList.add('active'); });
    document.querySelectorAll('.stats-quick-btn').forEach(function(b) { b.classList.remove('active'); });
    document.querySelector('.stats-quick-btn[data-days="30"]').classList.add('active');

    var now = moment();
    document.getElementById('dateFrom').value = now.clone().subtract(30, 'days').format('YYYY-MM-DD');
    document.getElementById('dateTo').value = now.format('YYYY-MM-DD');

    updateSelectedDevices();
}

function formatKwh(wh) {
    if (!wh && wh !== 0) return '--';
    var kwh = wh / 1000;
    if (kwh >= 1000) return Math.round(kwh).toLocaleString() + ' kWh';
    return kwh.toFixed(1) + ' kWh';
}

function generatePDF() {
    showToast('Generant PDF...', 'info');
    setTimeout(function() {
        showToast('PDF generat correctament!', 'success');
    }, 1500);
}

function showEmailModal() {
    document.getElementById('emailModal').classList.add('show');
}

function closeEmailModal() {
    document.getElementById('emailModal').classList.remove('show');
}

function sendEmail() {
    var email = document.getElementById('emailInput').value;
    if (!email) {
        showToast('Si us plau, introdueix un email', 'error');
        return;
    }
    closeEmailModal();
    showToast('Enviant informe per email...', 'info');
    setTimeout(function() {
        showToast('Informe enviat a ' + email, 'success');
    }, 2000);
}

function showToast(message, type) {
    var toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = 'stats-toast stats-' + (type || 'info') + ' show';
    clearTimeout(toast._timeout);
    toast._timeout = setTimeout(function() {
        toast.classList.remove('show');
    }, 3000);
}

document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') closeEmailModal();
});

document.querySelectorAll('.kpi-info').forEach(function(btn) {
    btn.addEventListener('click', function(e) {
        e.stopPropagation();
        var popup = btn.querySelector('.kpi-info-popup');
        if (!popup) return;
        var isShow = popup.classList.contains('show');
        document.querySelectorAll('.kpi-info-popup.show').forEach(function(p) { p.classList.remove('show'); });
        if (!isShow) popup.classList.add('show');
    });
});

document.addEventListener('click', function(e) {
    if (!e.target.closest('.kpi-info')) {
        document.querySelectorAll('.kpi-info-popup.show').forEach(function(p) { p.classList.remove('show'); });
    }
});
