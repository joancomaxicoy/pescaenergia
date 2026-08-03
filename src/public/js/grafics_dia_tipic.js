/**
 * Gràfics de Dia Típic per moda i mitjanes
 * Consumeix GET /api/balanc/dia-tipic?cups=X&days=N
 */

(function () {
  let chartInstances = {};
  let participationInitialized = false;

  function formatKwh(wh) {
    if (wh === null || wh === undefined) return '--';
    var kwh = wh / 1000;
    if (kwh >= 1000) return Math.round(kwh).toLocaleString() + ' kWh';
    return kwh.toFixed(2) + ' kWh';
  }

  function formatPct(v) {
    if (v === null || v === undefined) return '0';
    return (Math.round(v * 10) / 10).toFixed(1).replace(/\.0$/, '');
  }

  function renderParticipation(participation) {
    var input = document.getElementById('participationPct');
    var note = document.getElementById('simParticipationNote');
    if (!input || !participation) return;
    if (!participationInitialized) {
      participationInitialized = true;
      var init = participation.currentPct !== undefined ? participation.currentPct : 0;
      input.value = formatPct(init);
    }
    if (note) {
      var applied = participation.appliedPct;
      var current = participation.currentPct;
      if (applied !== null && applied !== undefined && current !== undefined && Math.abs(applied - current) > 0.0001) {
        note.hidden = false;
        note.textContent = 'Simulant amb una participació del ' + formatPct(applied) + '% (participació real: ' + formatPct(current) + '%)';
      } else {
        note.hidden = true;
      }
    }
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

  function setKpi(id, value) {
    var el = document.getElementById(id);
    if (el) el.textContent = value;
  }

  function renderTotals(totals, typicalDay) {
    if (!totals) return;
    setKpi('kpiPeriodConsumption', formatKwh(totals.consumptionWh));
    setKpi('kpiPeriodGeneration', formatKwh(totals.generationWh));
    setKpi('kpiPeriodImport', formatKwh(totals.importWh));
    setKpi('kpiPeriodExport', formatKwh(totals.exportWh));
    setKpi('kpiPeriodDays', (totals.days || 0) + ' dies');

    if (typicalDay) {
      setKpi('kpiDayConsumption', formatKwh(typicalDay.consumptionWh));
      setKpi('kpiDayGeneration', formatKwh(typicalDay.generationWh));
      setKpi('kpiDayImport', formatKwh(typicalDay.importWh));
      setKpi('kpiDayExport', formatKwh(typicalDay.exportWh));
    }
  }

  function renderDayAutoconsum(typicalDay) {
    if (!typicalDay) return;
    setKpi('kpiDayAutoconsumCons', (typicalDay.autoconsumConsPct !== undefined ? typicalDay.autoconsumConsPct : 0) + '%');
    setKpi('kpiDayAutoconsumGen', (typicalDay.autoconsumGenPct !== undefined ? typicalDay.autoconsumGenPct : 0) + '%');
    setKpi('kpiDayExportPct', (typicalDay.exportPct !== undefined ? typicalDay.exportPct : 0) + '%');
  }

  function renderBatterySummary(battery) {
    if (!battery || !battery.summary) return;
    var s = battery.summary;
    setKpi('kpiBatteryCharge', s.totalChargeKwh !== undefined ? s.totalChargeKwh.toFixed(2) : '--');
    setKpi('kpiBatteryDischarge', s.totalDischargeKwh !== undefined ? s.totalDischargeKwh.toFixed(2) : '--');
    setKpi('kpiBatteryCaptured', (s.capturedPct !== undefined ? s.capturedPct : 0) + '%');
    setKpi('kpiBatteryAutoconsum', (s.autoconsumConsPct !== undefined ? s.autoconsumConsPct : 0) + '%');
    var autoconsumSub = document.getElementById('kpiBatteryAutoconsumSub');
    if (autoconsumSub && s.autoconsumConsPctNoBattery !== undefined) {
      autoconsumSub.textContent = 'del consum · sense bateria: ' + s.autoconsumConsPctNoBattery + '%';
    }
    setKpi('kpiBatteryImport', s.totalImportKwh !== undefined ? s.totalImportKwh.toFixed(2) : '--');
    setKpi('kpiBatteryExport', s.totalExportKwh !== undefined ? s.totalExportKwh.toFixed(2) : '--');
    setKpi('kpiBatteryRequired', s.requiredCapacityKwh !== undefined ? s.requiredCapacityKwh.toFixed(2) : '--');
    setKpi('kpiBatteryFillDays', s.fillDays !== null && s.fillDays !== undefined ? s.fillDays.toFixed(1) : '--');
  }

  function alignSocZero(chart) {
    var y = chart.scales.y;
    var ySoc = chart.scales.ySoc;
    if (!y || !ySoc) return;
    var span = y.max - y.min;
    if (span === 0) return;
    var f = (0 - y.min) / span;
    var socMax = 100;
    var socMin = (f < 0 || f >= 1) ? 0 : (socMax * f) / (f - 1);
    ySoc.options.min = socMin;
    ySoc.options.max = socMax;
    chart.update();
  }

  function renderBatteryChart(profile, battery) {
    if (!profile || profile.length === 0) return;
    var labels = profile.map(function (p) { return p.label; });
    var slots = (battery && battery.slots) || [];

    renderChart('batteryChart', 'bar', labels, [
      {
        label: 'Generació assignada',
        data: profile.map(function (p) { return p.generation_mode; }),
        type: 'line',
        borderColor: '#ffd93d',
        backgroundColor: 'rgba(255, 217, 61, 0.15)',
        fill: false,
        tension: 0.3,
        pointRadius: 1,
        order: 1
      },
      {
        label: 'Consum',
        data: profile.map(function (p) { return p.consumption_mode; }),
        type: 'line',
        borderColor: '#1a1a2e',
        backgroundColor: 'rgba(26, 26, 46, 0.08)',
        fill: false,
        tension: 0.3,
        pointRadius: 1,
        order: 1
      },
      {
        label: 'Càrrega bateria',
        data: slots.map(function (x) { return x ? x.chargeWh : 0; }),
        backgroundColor: 'rgba(139, 195, 74, 0.7)',
        borderColor: '#8bc34a',
        borderWidth: 1,
        order: 2
      },
      {
        label: 'Descàrrega bateria',
        data: slots.map(function (x) { return x ? -x.dischargeWh : 0; }),
        backgroundColor: 'rgba(74, 144, 217, 0.7)',
        borderColor: '#4a90d9',
        borderWidth: 1,
        order: 2
      },
      {
        label: 'SOC bateria',
        data: slots.map(function (x) { return x ? x.socPct : 0; }),
        type: 'line',
        borderColor: '#ab47bc',
        backgroundColor: 'rgba(171, 71, 188, 0.15)',
        borderDash: [5, 3],
        fill: false,
        tension: 0.3,
        pointRadius: 1,
        yAxisID: 'ySoc',
        order: 3
      }
    ], {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'top' },
        tooltip: {
          callbacks: {
            label: function (ctx) {
              var v = ctx.parsed.y;
              if (ctx.dataset.yAxisID === 'ySoc') return ctx.dataset.label + ': ' + v.toFixed(1) + ' %';
              if (ctx.datasetIndex === 3) return ctx.dataset.label + ': -' + Math.abs(v).toFixed(2) + ' Wh';
              return ctx.dataset.label + ': ' + v.toFixed(2) + ' Wh';
            }
          }
        }
      },
      scales: {
        x: {
          title: { display: true, text: 'Hora' },
          ticks: { autoSkip: true, maxRotation: 0, maxTicksLimit: 24 }
        },
        y: {
          beginAtZero: true,
          title: { display: true, text: 'Wh per 15 min' }
        },
        ySoc: {
          position: 'right',
          min: 0,
          max: 100,
          title: { display: true, text: 'SOC (%)' },
          grid: { drawOnChartArea: false }
        }
      }
    });

    var bc = chartInstances['batteryChart'];
    if (bc) alignSocZero(bc);
  }

  function renderProfileCharts(profile) {
    if (!profile || profile.length === 0) return;

    var labels = profile.map(function (p) { return p.label; });

    var commonOptions = {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'top' },
        tooltip: {
          callbacks: {
            label: function (ctx) {
              return ctx.dataset.label + ': ' + ctx.parsed.y.toFixed(2) + ' Wh';
            }
          }
        }
      },
      scales: {
        x: {
          title: { display: true, text: 'Hora' },
          ticks: { autoSkip: true, maxRotation: 0, maxTicksLimit: 24 }
        },
        y: {
          beginAtZero: true,
          title: { display: true, text: 'Wh per 15 min' }
        }
      }
    };

    renderChart('modeChart', 'line', labels, [
      {
        label: 'Generació (moda)',
        data: profile.map(function (p) { return p.generation_mode; }),
        borderColor: '#ffd93d',
        backgroundColor: 'rgba(255, 217, 61, 0.15)',
        fill: true,
        tension: 0.3,
        pointRadius: 1
      },
      {
        label: 'Consum (moda)',
        data: profile.map(function (p) { return p.consumption_mode; }),
        borderColor: '#1a1a2e',
        backgroundColor: 'rgba(26, 26, 46, 0.08)',
        fill: true,
        tension: 0.3,
        pointRadius: 1
      }
    ], commonOptions);

    renderChart('meanChart', 'line', labels, [
      {
        label: 'Generació (mitjana)',
        data: profile.map(function (p) { return p.generation_mean; }),
        borderColor: '#ffd93d',
        backgroundColor: 'rgba(255, 217, 61, 0.15)',
        fill: true,
        tension: 0.3,
        pointRadius: 1
      },
      {
        label: 'Consum (mitjana)',
        data: profile.map(function (p) { return p.consumption_mean; }),
        borderColor: '#1a1a2e',
        backgroundColor: 'rgba(26, 26, 46, 0.08)',
        fill: true,
        tension: 0.3,
        pointRadius: 1
      }
    ], commonOptions);
  }

  function loadData() {
    var container = document.getElementById('simContainer');
    if (!container) return;
    var cups = container.dataset.cups;
    var days = document.getElementById('periodSelect').value || '30';

    var params = 'cups=' + encodeURIComponent(cups) + '&days=' + encodeURIComponent(days);
    var batteryKwh = document.getElementById('batteryKwh');
    var batteryKw = document.getElementById('batteryKw');
    var batteryEfficiency = document.getElementById('batteryEfficiency');
    if (batteryKwh) params += '&batteryKwh=' + encodeURIComponent(batteryKwh.value);
    if (batteryKw) params += '&batteryKw=' + encodeURIComponent(batteryKw.value);
    if (batteryEfficiency) params += '&batteryEfficiency=' + encodeURIComponent((parseFloat(batteryEfficiency.value) || 90) / 100);
    var participationInput = document.getElementById('participationPct');
    if (participationInput && participationInput.value !== '') {
      var pct = parseFloat(participationInput.value);
      if (Number.isFinite(pct)) params += '&simulationPct=' + encodeURIComponent(Math.min(100, Math.max(0, pct)));
    }

    setKpi('simLoading', 'Carregant dades...');

    fetch('/api/balanc/dia-tipic?' + params)
      .then(function (res) { return res.json(); })
      .then(function (data) {
        setKpi('simLoading', '');
        renderParticipation(data.participation);
        renderTotals(data.totals, data.typicalDay);
        renderDayAutoconsum(data.typicalDay);
        renderProfileCharts(data.profile);
        renderBatterySummary(data.battery);
        renderBatteryChart(data.profile, data.battery);
        setKpi('simPeriod', data.period ? data.period.from + ' → ' + data.period.to : '');
      })
      .catch(function (err) {
        console.error('Error carregant dia típic:', err);
        setKpi('simLoading', 'Error carregant les dades');
      });
  }

  document.addEventListener('DOMContentLoaded', function () {
    var container = document.getElementById('simContainer');
    if (!container) return;
    var periodSelect = document.getElementById('periodSelect');
    if (periodSelect) {
      periodSelect.addEventListener('change', loadData);
    }
    ['batteryKwh', 'batteryKw', 'batteryEfficiency'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.addEventListener('change', loadData);
    });
    var participationInput = document.getElementById('participationPct');
    if (participationInput) participationInput.addEventListener('change', loadData);
    loadData();
  });
})();
