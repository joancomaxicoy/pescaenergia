/* Datadis (àrea usuari) — consulta de dades oficials per període. */
(function () {
    'use strict';

    function getEl(id) { return document.getElementById(id); }

    var consumptionChart = null;
    var solarMixChart = null;
    var generationUseChart = null;
    var balanceChart = null;

    function formatDate(iso) {
        if (!iso) return '';
        var p = iso.split('-');
        return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : iso;
    }

    function formatDateTime(iso) {
        if (!iso) return '';
        var parts = iso.indexOf('T') >= 0 ? iso.split('T') : [iso, ''];
        var dp = parts[0].split('-');
        var date = dp.length === 3 ? dp[2] + '/' + dp[1] + '/' + dp[0] : parts[0];
        if (!parts[1]) return date;
        return date + ' ' + parts[1].slice(0, 5);
    }

    function formatKwh(value) {
        if (value === null || value === undefined) return '--';
        var n = Math.round(value * 1000) / 1000;
        return n.toLocaleString('ca-ES', { maximumFractionDigits: 3 }) + ' kWh';
    }

    function daysBetween(from, to) {
        var ms = new Date(to + 'T00:00:00') - new Date(from + 'T00:00:00');
        return Math.round(ms / 86400000) + 1;
    }

    function obtainLabel(method) {
        if (!method) return 'Estimació';
        if (method === 'Real') return 'Real';
        if (method === 'Estimate' || method === 'Estimat') return 'Estimació';
        return method;
    }

    function dayLabel(dateStr) {
        var parts = (dateStr || '').split('-');
        return parts.length === 3 ? parts[2] + '/' + parts[1] : (dateStr || '');
    }

    function round2(value) { return Math.round((value || 0) * 100) / 100; }

    function setDefaultPeriod() {
        var to = new Date();
        var from = new Date(Date.now() - 29 * 86400000);
        var fmt = function (d) {
            var m = String(d.getMonth() + 1).padStart(2, '0');
            var day = String(d.getDate()).padStart(2, '0');
            return d.getFullYear() + '-' + m + '-' + day;
        };
        getEl('datadisDateFrom').value = fmt(from);
        getEl('datadisDateTo').value = fmt(to);
    }

    function show(el) { if (el) el.style.display = ''; }
    function hide(el) { if (el) el.style.display = 'none'; }

    function renderConsumptionChart(data) {
        var canvas = getEl('datadisConsumptionChart');
        if (!canvas) return;
        if (!window.Chart) return;

        if (consumptionChart) { consumptionChart.destroy(); consumptionChart = null; }

        var hourly = data.granularity === 'hourly';
        var chart = (data && data.chart) || [];
        if (chart.length === 0) return;

        // La grafica sempre mostra un bar per dia: si les dades son horaries,
        // s'agreguen sumant el consum de cada dia.
        var byDay = {};
        chart.forEach(function (p) {
            var dateStr = hourly ? (p.datetime || '').split('T')[0] : (p.date || '');
            if (!dateStr) return;
            byDay[dateStr] = (byDay[dateStr] || 0) + (p.consumption || 0);
        });
        var days = Object.keys(byDay).sort();
        if (days.length === 0) return;

        var labels = days.map(dayLabel);
        var series = days.map(function (d) { return round2(byDay[d]); });
        var datasets = [
            { label: 'Consum', data: series, backgroundColor: '#4a90d9', borderWidth: 1 }
        ];

        consumptionChart = new window.Chart(canvas.getContext('2d'), {
            type: 'bar',
            data: { labels: labels, datasets: datasets },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                plugins: { legend: { display: false } },
                scales: {
                    x: { ticks: { autoSkip: true, maxRotation: 0, maxTicksLimit: 20 } },
                    y: { beginAtZero: true, title: { display: true, text: 'kWh' } }
                }
            }
        });
    }

    function renderDatadisDonut(canvasId, holder, values, colors) {
        var canvas = getEl(canvasId);
        if (!canvas || !window.Chart) return null;
        if (holder) { holder.destroy(); holder = null; }
        var total = values.reduce(function (a, b) { return a + (b || 0); }, 0);
        if (total <= 0) return null;
        return new window.Chart(canvas.getContext('2d'), {
            type: 'doughnut',
            data: { datasets: [{ data: values, backgroundColor: colors, borderWidth: 0 }] },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                cutout: '62%',
                plugins: { legend: { display: false } }
            }
        });
    }

    function renderDatadisLegend(elId, values, labels, colors) {
        var el = getEl(elId);
        if (!el) return;
        var total = values.reduce(function (a, b) { return a + (b || 0); }, 0);
        if (total <= 0) {
            el.innerHTML = '<div class="stats-donut-legend-item">' +
                '<span class="stats-donut-legend-label">Sense dades al periode</span></div>';
            return;
        }
        var html = '';
        values.forEach(function (v, i) {
            var pct = Math.round(((v || 0) / total) * 100);
            html += '<div class="stats-donut-legend-item">' +
                '<span class="stats-donut-dot" style="background: ' + colors[i] + ';"></span>' +
                '<span class="stats-donut-legend-label">' + labels[i] + '</span>' +
                '<span class="stats-donut-legend-value">' + pct + '% (' + formatKwh(v) + ')</span>' +
                '</div>';
        });
        el.innerHTML = html;
    }

    function renderResumDonuts(data) {
        var totals = data.totals || {};
        // Semantica de Datadis: consumptionKwh = energia importada de xarxa;
        // selfConsumptionEnergyKWh = energia solar aprofitada directament
        // (autoconsum). Consum real = xarxa + aprofitada.
        var xarxa = Math.max(0, totals.consumptionKwh || 0);
        var aprofitada = Math.max(0, totals.selfConsumptionKwh || 0);
        var generation = Math.max(0, totals.generationKwh || 0);
        var exportat = Math.max(0, totals.surplusKwh || 0);

        // Donut 1: origen del consum (percentatge d'autoconsum)
        var mixValues = [Math.round(aprofitada * 100) / 100, Math.round(xarxa * 100) / 100];
        solarMixChart = renderDatadisDonut('datadisSolarMixChart', solarMixChart, mixValues, ['#ffd93d', '#ff6b6b']);
        renderDatadisLegend('datadisSolarMixLegend', [aprofitada, xarxa], ['Solar aprofitada', 'Energia de xarxa'], ['#ffd93d', '#ff6b6b']);
        var consumTotal = aprofitada + xarxa;
        var mixCenter = getEl('datadisSolarMixCenterValue');
        if (mixCenter) {
            mixCenter.textContent = consumTotal > 0
                ? Math.round((aprofitada / consumTotal) * 100) + '%'
                : '--';
        }

        // Donut 2: us de la generacio (percentatge d'aprofitament solar)
        var useValues = [Math.round(aprofitada * 100) / 100, Math.round(exportat * 100) / 100];
        generationUseChart = renderDatadisDonut('datadisGenerationUseChart', generationUseChart, useValues, ['#8bc34a', '#4a90d9']);
        renderDatadisLegend('datadisGenerationUseLegend', [aprofitada, exportat], ['Solar aprofitada', 'Excedent'], ['#8bc34a', '#4a90d9']);
        var useCenter = getEl('datadisGenerationUseCenterValue');
        if (useCenter) {
            useCenter.textContent = generation > 0
                ? Math.round((aprofitada / generation) * 100) + '%'
                : '--';
        }
    }

    function renderBalanceChart(data) {
        var canvas = getEl('datadisBalanceChart');
        if (!canvas || !window.Chart) return;
        if (balanceChart) { balanceChart.destroy(); balanceChart = null; }

        var hourly = data.granularity === 'hourly';
        var rows = (data && data.rows) || [];
        if (rows.length === 0) return;

        // El balanç energètic conserva la granularitat de les dades: mostra
        // les hores quan es consulten dades horàries i els dies quan són diàries.
        var labels = rows.map(function (r) {
            if (hourly) {
                var arr = (r.datetime || '').split('T');
                var dp = (arr[0] || '').split('-');
                var d = dp.length === 3 ? dp[2] + '/' + dp[1] : (arr[0] || '');
                return d + ' ' + (arr[1] || '').slice(0, 5);
            }
            return dayLabel(r.date);
        });

        var datasets = [{
            // Autoconsum: part del consum que queda PER SOTA de la generació
            // (min(gen, cons)) — energia solar consumida directament.
            label: 'Autoconsum',
            data: rows.map(function (r) {
                var gen = r.generationKwh || 0;
                var cons = (r.consumptionKwh || 0) + (r.selfConsumptionKwh || 0);
                return round2(Math.min(gen, cons));
            }),
            borderWidth: 0,
            pointRadius: 0,
            tension: 0.4,
            backgroundColor: 'rgba(139,195,74,0.25)',
            fill: { target: 'origin' }
        }, {
            // Importació de xarxa: franja entre la generació i el consum només
            // quan la línia de consum queda PER SOBRE de la línia de generació.
            // La línia límit és max(gen, cons): en el dèficit toca la corba de
            // consum (i el farciment amb la generació és la zona vermella); en
            // l'excedent coincideix amb la generació i no hi ha farciment.
            label: 'Import de xarxa',
            data: rows.map(function (r) {
                var gen = r.generationKwh || 0;
                var cons = (r.consumptionKwh || 0) + (r.selfConsumptionKwh || 0);
                return round2(Math.max(gen, cons));
            }),
            borderWidth: 0,
            pointRadius: 0,
            tension: 0.4,
            backgroundColor: 'rgba(239,83,80,0.25)',
            fill: { target: 3 }
        }, {
            // Exportació (excedent): franja entre la generació i el consum quan
            // la línia de generació queda PER SOBRE de la línia de consum.
            // Usa la mateixa línia límit max(gen, cons) però farcida cap a la
            // corba de consum: només apareix quan genera més del que es consumeix.
            label: 'Exportació',
            data: rows.map(function (r) {
                var gen = r.generationKwh || 0;
                var cons = (r.consumptionKwh || 0) + (r.selfConsumptionKwh || 0);
                return round2(Math.max(gen, cons));
            }),
            borderWidth: 0,
            pointRadius: 0,
            tension: 0.4,
            backgroundColor: 'rgba(255,217,61,0.30)',
            fill: { target: 4 }
        }, {
            label: 'Generació Solar',
            data: rows.map(function (r) { return round2(r.generationKwh); }),
            borderColor: '#ffd93d',
            backgroundColor: 'rgba(0,0,0,0)',
            borderWidth: 1.5,
            tension: 0.4,
            pointRadius: 0
        }, {
            label: 'Consum',
            // Consum real = energia de xarxa (importada) + solar aprofitada (autoconsum).
            data: rows.map(function (r) {
                return round2((r.consumptionKwh || 0) + (r.selfConsumptionKwh || 0));
            }),
            borderColor: '#1a1a2e',
            backgroundColor: 'rgba(0,0,0,0)',
            borderWidth: 1.5,
            borderDash: [5, 5],
            tension: 0.4,
            pointRadius: 0
        }];

        balanceChart = new window.Chart(canvas.getContext('2d'), {
            type: 'line',
            data: { labels: labels, datasets: datasets },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                plugins: { legend: { display: true, position: 'top' } },
                scales: {
                    x: { ticks: { autoSkip: true, maxRotation: 0, maxTicksLimit: 12 } },
                    y: { beginAtZero: true, title: { display: true, text: 'kWh' } }
                }
            }
        });
    }

    function renderSummary(data) {
        var totals = (data && data.totals) || {};
        var rows = (data && data.rows) || [];
        var xarxa = totals.consumptionKwh || 0;
        var aprofitada = totals.selfConsumptionKwh || 0;
        var generacio = totals.generationKwh || 0;
        var excedent = totals.surplusKwh || 0;
        var consumTotal = xarxa + aprofitada;

        var daysSet = {};
        rows.forEach(function (r) {
            var d = r.date || (r.datetime || '').split('T')[0];
            if (d) daysSet[d] = true;
        });
        var days = Object.keys(daysSet).length;
        var perDay = function (v) { return days > 0 ? Math.round((v / days) * 1000) / 1000 : 0; };

        var selfPct = consumTotal > 0 ? Math.round((aprofitada / consumTotal) * 100) : null;
        var usePct = generacio > 0 ? Math.round((aprofitada / generacio) * 100) : null;
        var co2 = Math.round(generacio * 0.253 * 100) / 100;

        var set = function (id, text) {
            var el = getEl(id);
            if (el) el.textContent = text;
        };

        set('datadisSumConsumption', formatKwh(consumTotal));
        set('datadisSumGrid', formatKwh(xarxa));
        set('datadisSumSolarUsed', formatKwh(aprofitada));
        set('datadisSumSelfConsumption', selfPct === null ? '--' : selfPct + '%');
        set('datadisSumDays', days + ' dies');
        set('datadisSumSolar', formatKwh(generacio));
        set('datadisSumSolarAprofitada', formatKwh(aprofitada));
        set('datadisSumExport', formatKwh(excedent));
        set('datadisSumSolarUsedPct', usePct === null ? '--' : usePct + '%');
        set('datadisSumCo2', '~' + Math.round(co2 * 10) / 10 + ' kg');

        set('datadisAvgConsumption', formatKwh(perDay(consumTotal)));
        set('datadisAvgGrid', formatKwh(perDay(xarxa)));
        set('datadisAvgSolarUsed', formatKwh(perDay(aprofitada)));
        set('datadisAvgSelfConsumption', selfPct === null ? '--' : selfPct + '%');
        set('datadisAvgSolar', formatKwh(perDay(generacio)));
        set('datadisAvgSolarAprofitada', formatKwh(perDay(aprofitada)));
        set('datadisAvgExport', formatKwh(perDay(excedent)));
        set('datadisAvgSolarUsedPct', usePct === null ? '--' : usePct + '%');
        set('datadisAvgCo2', '~' + Math.round(co2 / Math.max(days, 1) * 10) / 10 + ' kg/dia');
    }

    function renderResults(result) {
        var data = result.data;
        var rows = (data && data.rows) || [];
        var hourly = data.granularity === 'hourly';

        getEl('datadisInfo').innerHTML =
            'CUPS <strong>' + (data.cups || '') + '</strong>' +
            (data.distributor ? ' &middot; ' + data.distributor : '') +
            ' &middot; del <strong>' + formatDate(data.from) + '</strong> al <strong>' + formatDate(data.to) + '</strong>' +
            ' &mdash; ' + rows.length + (hourly ? ' registres horaris' : ' dies amb dades');

        var totals = data.totals || {};
        getEl('datadisCardConsumption').textContent = formatKwh((totals.consumptionKwh || 0) + (totals.selfConsumptionKwh || 0));
        getEl('datadisCardSurplus').textContent = formatKwh(totals.surplusKwh);
        getEl('datadisCardGeneration').textContent = formatKwh(totals.generationKwh);
        getEl('datadisCardSelfConsumption').textContent = formatKwh(totals.selfConsumptionKwh);

        renderConsumptionChart(data);
        try { renderResumDonuts(data); } catch (err) { console.error('Error renderitzant donuts:', err); }
        try { renderBalanceChart(data); } catch (err) { console.error('Error renderitzant balanç energètic:', err); }
        try { renderSummary(data); } catch (err) { console.error('Error renderitzant resum:', err); }

        var tbody = getEl('datadisTable').querySelector('tbody');
        tbody.innerHTML = '';
        if (rows.length === 0) {
            var tr = document.createElement('tr');
            var td = document.createElement('td');
            td.colSpan = 6;
            td.textContent = 'No hi ha dades oficials per a aquest període.';
            td.style.textAlign = 'center';
            td.style.padding = '20px';
            td.style.color = '#888';
            tr.appendChild(td);
            tbody.appendChild(tr);
            return;
        }

        rows.forEach(function (row) {
            var tr = document.createElement('tr');
            var cells = [
                hourly ? formatDateTime(row.datetime) : formatDate(row.date),
                formatKwh(row.consumptionKwh),
                formatKwh(row.surplusKwh),
                formatKwh(row.generationKwh),
                formatKwh(row.selfConsumptionKwh),
                obtainLabel(row.obtainMethod)
            ];
            cells.forEach(function (text, i) {
                var td = document.createElement('td');
                td.textContent = text;
                if (i >= 1 && i <= 4) td.className = 'datadis-num';
                tr.appendChild(td);
            });
            tbody.appendChild(tr);
        });
    }

    function showError(message) {
        var box = getEl('datadisError');
        box.textContent = message || 'Error en consultar les dades.';
        show(box);
    }

    async function loadDatadisData() {
        var type = 'hourly';

        var from = getEl('datadisDateFrom').value;
        var to = getEl('datadisDateTo').value;

        if (!from || !to) {
            showError('Selecciona les dates d\'inici i de final del període.');
            return;
        }
        if (from > to) {
            showError('La data inicial no pot ser posterior a la final.');
            return;
        }
        if (daysBetween(from, to) > 366) {
            showError('El període màxim és de 366 dies.');
            return;
        }

        hide(getEl('datadisError'));
        hide(getEl('datadisResults'));
        hide(getEl('datadisEmptyState'));
        show(getEl('datadisLoading'));

        try {
            var { data } = await window.apiClient.get('/api/datadis/data?from=' + from + '&to=' + to + '&type=' + type);
            if (!data || data.success === false) {
                throw new Error((data && data.error) || 'Error en consultar les dades.');
            }
            hide(getEl('datadisLoading'));
            renderResults(data);
            show(getEl('datadisResults'));
        } catch (err) {
            hide(getEl('datadisLoading'));
            show(getEl('datadisEmptyState'));
            showError(err && err.message ? err.message : 'Error en consultar les dades.');
            console.error('Error consultant Datadis:', err);
        }
    }

    function showToast(message, type) {
        var toast = getEl('toast');
        if (!toast) return;
        toast.textContent = message;
        toast.className = 'stats-toast stats-' + (type || 'info') + ' show';
        clearTimeout(showToast._t);
        showToast._t = setTimeout(function () {
            toast.className = 'stats-toast stats-' + (type || 'info');
        }, 3000);
    }

    function generateDatadisPDF() {
        var from = getEl('datadisDateFrom').value;
        var to = getEl('datadisDateTo').value;
        if (!from || !to) {
            showToast('Selecciona un període per generar el PDF', 'error');
            return;
        }
        showToast('Generant PDF...', 'info');
        var panel = document.querySelector('.datadis-filters-panel');
        var userName = panel ? String(panel.dataset.userName || '') : '';
        var token = window.apiClient ? window.apiClient.getAuthToken() : null;
        fetch('/api/datadis/report', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': token ? 'Bearer ' + token : '' },
            body: JSON.stringify({ from: from, to: to, name: userName })
        })
            .then(function (res) {
                if (!res.ok) {
                    return res.json().then(function (d) {
                        throw new Error((d && d.error) || 'HTTP ' + res.status);
                    });
                }
                return res.blob();
            })
            .then(function (blob) {
                var url = URL.createObjectURL(blob);
                var a = document.createElement('a');
                a.href = url;
                a.download = 'informe-datadis-' + from.replace(/-/g, '') + '-' + to.replace(/-/g, '') + '.pdf';
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                showToast('PDF generat correctament!', 'success');
            })
            .catch(function (err) {
                console.error('Error generant PDF:', err);
                showToast(err && err.message ? err.message : 'Error generant el PDF', 'error');
            });
    }

    function generateDatadisExcel() {
        var from = getEl('datadisDateFrom').value;
        var to = getEl('datadisDateTo').value;
        if (!from || !to) {
            showToast('Selecciona un període per generar l\'Excel', 'error');
            return;
        }
        showToast('Generant Excel...', 'info');
        var token = window.apiClient ? window.apiClient.getAuthToken() : null;
        fetch('/api/datadis/excel', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': token ? 'Bearer ' + token : '' },
            body: JSON.stringify({ from: from, to: to })
        })
            .then(function (res) {
                if (!res.ok) {
                    return res.json().then(function (d) {
                        throw new Error((d && d.error) || 'HTTP ' + res.status);
                    });
                }
                return res.blob();
            })
            .then(function (blob) {
                var url = URL.createObjectURL(blob);
                var a = document.createElement('a');
                a.href = url;
                a.download = 'informe-datadis-' + from.replace(/-/g, '') + '-' + to.replace(/-/g, '') + '.xlsx';
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                showToast('Excel generat correctament!', 'success');
            })
            .catch(function (err) {
                console.error('Error generant Excel:', err);
                showToast(err && err.message ? err.message : 'Error generant l\'Excel', 'error');
            });
    }

    function showEmailModal() {
        var panel = document.querySelector('.datadis-filters-panel');
        var userEmail = panel ? String(panel.dataset.userEmail || '') : '';
        var emailInput = getEl('emailInput');
        var messageInput = getEl('emailMessage');

        if (emailInput && !emailInput.value) {
            emailInput.value = userEmail;
        }
        if (messageInput && !messageInput.value) {
            messageInput.value = 'PescaEnergia t\'envia l\'informe de Datadis sol·licitat.';
        }

        var modal = getEl('emailModal');
        if (modal) modal.classList.add('show');
    }

    function closeEmailModal() {
        var modal = getEl('emailModal');
        if (modal) modal.classList.remove('show');
    }

    function sendEmail() {
        var email = getEl('emailInput').value;
        if (!email) {
            showToast('Si us plau, introdueix un email', 'error');
            return;
        }
        var message = getEl('emailMessage').value;
        var from = getEl('datadisDateFrom').value;
        var to = getEl('datadisDateTo').value;
        var panel = document.querySelector('.datadis-filters-panel');
        var userName = panel ? String(panel.dataset.userName || '') : '';
        var token = window.apiClient ? window.apiClient.getAuthToken() : null;

        closeEmailModal();
        showToast('Enviant informe per email...', 'info');
        fetch('/api/datadis/report', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': token ? 'Bearer ' + token : '' },
            body: JSON.stringify({ from: from, to: to, email: email, message: message, name: userName })
        })
            .then(function (res) {
                return res.json().then(function (d) {
                    if (!res.ok) {
                        throw new Error((d && d.error) || 'HTTP ' + res.status);
                    }
                    return d;
                });
            })
            .then(function (result) {
                if (result.ok && result.sent) {
                    showToast('Informe enviat a ' + email, 'success');
                    var ei = getEl('emailInput');
                    var mi = getEl('emailMessage');
                    if (ei) ei.value = '';
                    if (mi) mi.value = '';
                } else {
                    showToast('Error enviant l\'informe', 'error');
                }
            })
            .catch(function (err) {
                console.error('Error enviant informe:', err);
                showToast(err && err.message ? err.message : 'Error enviant l\'informe', 'error');
            });
    }

    document.addEventListener('DOMContentLoaded', function () {
        if (!getEl('datadisDateFrom')) return;

        var panel = document.querySelector('.datadis-filters-panel');
        var configured = !panel || String(panel.dataset.datadisConfigured) === 'true';
        if (!configured) {
            getEl('datadisDateFrom').disabled = true;
            getEl('datadisDateTo').disabled = true;
            getEl('datadisConsultBtn').disabled = true;
            document.querySelectorAll('.datadis-quick-btn').forEach(function (b) { b.disabled = true; });
            return;
        }

        setDefaultPeriod();

        document.querySelectorAll('.datadis-quick-btn').forEach(function (btn) {
            btn.addEventListener('click', function () {
                document.querySelectorAll('.datadis-quick-btn').forEach(function (b) { b.classList.remove('active'); });
                this.classList.add('active');
                var days = parseInt(this.dataset.days, 10);
                var to = new Date();
                var from = new Date(Date.now() - (days - 1) * 86400000);
                var fmt = function (d) {
                    var m = String(d.getMonth() + 1).padStart(2, '0');
                    var day = String(d.getDate()).padStart(2, '0');
                    return d.getFullYear() + '-' + m + '-' + day;
                };
                getEl('datadisDateFrom').value = fmt(from);
                getEl('datadisDateTo').value = fmt(to);
            });
        });

        var collapseToggle = getEl('datadisCollapseToggle');
        var tableWrap = getEl('datadisTableWrap');
        if (collapseToggle && tableWrap) {
            collapseToggle.addEventListener('click', function () {
                var open = collapseToggle.getAttribute('aria-expanded') === 'true';
                collapseToggle.setAttribute('aria-expanded', String(!open));
                tableWrap.style.display = open ? 'none' : '';
            });
        }
    });

    window.loadDatadisData = loadDatadisData;
    window.generateDatadisPDF = generateDatadisPDF;
    window.generateDatadisExcel = generateDatadisExcel;
    window.showEmailModal = showEmailModal;
    window.closeEmailModal = closeEmailModal;
    window.sendEmail = sendEmail;
})();