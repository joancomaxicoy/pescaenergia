const database = require('../utils/database');
const logger = require('../utils/logger');
const { groupByTimestamp, interpolateSeries, computeDaylightWindow } = require('../utils/interpolationUtils');

const generatorScales = {
  'giravolt': 100,
  'sala-polivalent': 1000,
  'residencia': 1000,
};

/**
 * Interpola lazy una sèrie acumulada (per device o generador) deduplicant per
 * timestamp. Retorna una llista { ts, value } ordenada amb els valors corregits.
 * Les files ja corregides a la BD (interpolated_at) no presenten plateaus i
 * no es modifiquen. Per a sèries solars es passa la finestra de sol empírica
 * perquè el salt es reparteixi només en hores de producció.
 */
function interpolateCumulative(rows, valueField, daylightWindow = null) {
  const byTs = groupByTimestamp(rows);
  const keys = [...byTs.keys()];
  const series = keys.map(k => ({
    timestamp: new Date(k),
    value: parseFloat(byTs.get(k)[0][valueField]),
  }));
  const { records } = interpolateSeries(series, { daylightWindow });
  return keys.map((k, i) => ({ ts: k, value: records[i].value }));
}

async function getStatisticsData({ from, to, cups }) {
  const toDate = to || new Date().toISOString().slice(0, 10);
  const fromTs = `${from} 00:00:00+00`;
  const toTs = `${toDate} 23:59:59+00`;

  const deviceTagMap = await getDeviceTagMap(cups);

  // Baselines: últim energia_total_wh per device just abans del període
  const consumBaseResult = await database.query(
    `SELECT DISTINCT ON (c.device_id) c.device_id, c.energia_total_wh
     FROM consums c
     WHERE c.cups = $1 AND c.timestamp < $2
     ORDER BY c.device_id, c.timestamp DESC`,
    [cups, fromTs]
  );

  // Primera lectura per device dins del període (baseline del primer dia quan no n'hi ha de pre-període)
  const consumFirstResult = await database.query(
    `SELECT DISTINCT ON (c.device_id) c.device_id, c.energia_total_wh
     FROM consums c
     WHERE c.cups = $1 AND c.timestamp >= $2 AND c.timestamp <= $3
     ORDER BY c.device_id, c.timestamp ASC`,
    [cups, fromTs, toTs]
  );

  // Sèrie acumulada completa per device dins del període, interpolada lazy
  const consumSeriesResult = await database.query(
    `SELECT c.timestamp, c.device_id, c.dispositiu, c.energia_total_wh
     FROM consums c
     WHERE c.cups = $1 AND c.timestamp >= $2 AND c.timestamp <= $3
     ORDER BY c.device_id, c.timestamp`,
    [cups, fromTs, toTs]
  );

  // Obtenir valor de referència just ABANS del període (baseline per al primer dia)
  const baselineResult = await database.query(
    `SELECT DISTINCT ON (b.generator_code) b.generator_code, b.generator_total_cumulative_wh
     FROM balanc_energetic b
     WHERE b.cups = $1 AND b.timestamp < $2
     ORDER BY b.generator_code, b.timestamp DESC`,
    [cups, fromTs]
  );

  // Sèrie acumulada del generador dins del període, interpolada lazy
  const solarSeriesResult = await database.query(
    `SELECT b.timestamp, b.generator_code, b.generator_total_cumulative_wh,
            b.generator_total_wh, b.participation_pct, b.interpolated_at
     FROM balanc_energetic b
     WHERE b.cups = $1 AND b.timestamp >= $2 AND b.timestamp <= $3
     ORDER BY b.generator_code, b.timestamp`,
    [cups, fromTs, toTs]
  );

  const consumByDevice = new Map();
  for (const row of consumSeriesResult.rows) {
    if (!consumByDevice.has(row.device_id)) consumByDevice.set(row.device_id, []);
    consumByDevice.get(row.device_id).push(row);
  }

  const deviceTotals = {};
  const deviceBaselines = {};

  for (const b of consumBaseResult.rows) {
    deviceBaselines[b.device_id] = parseFloat(b.energia_total_wh);
  }

  // Els dispositius sense baseline pre-període (primer dia de dades) comencen a la seva primera lectura
  for (const r of consumFirstResult.rows) {
    if (deviceBaselines[r.device_id] === undefined) {
      deviceBaselines[r.device_id] = parseFloat(r.energia_total_wh);
    }
  }

  // Consum per interval (delta real del comptador principal Shelly EM, sense sub-meters)
  const consumByTs = {};
  const daysSet = new Set();

  for (const [deviceId, rows] of consumByDevice) {
    const tag = deviceTagMap[deviceId] || 'unknown';
    const interpolated = interpolateCumulative(rows, 'energia_total_wh');
    const isMainMeter = rows[0].dispositiu && String(rows[0].dispositiu).includes('Shelly EM');

    const dayMax = {};
    const dayMin = {};
    let prevVal = null;

    for (const { ts, value } of interpolated) {
      const iso = new Date(ts).toISOString();
      const key = iso.slice(0, 16);
      const day = iso.slice(0, 10);
      daysSet.add(day);

      if (dayMax[day] === undefined) {
        dayMax[day] = value;
        dayMin[day] = value;
      } else {
        if (value > dayMax[day]) dayMax[day] = value;
        if (value < dayMin[day]) dayMin[day] = value;
      }

      if (prevVal !== null) {
        const delta = Math.max(0, Math.round((value - prevVal) * 100) / 100);
        if (isMainMeter) {
          consumByTs[key] = (consumByTs[key] || 0) + delta;
        }
      }
      prevVal = value;
    }

    // Consum per device per dia = MAX del dia - baseline (mateixa lògica que abans,
    // però sobre la sèrie acumulada ja interpolada)
    for (const day of Object.keys(dayMax)) {
      let wh = 0;
      const baseline = deviceBaselines[deviceId];
      if (baseline !== undefined) {
        if (dayMax[day] < baseline) {
          // El comptador s'ha reiniciat (tot el dia queda per sota del baseline)
          deviceBaselines[deviceId] = dayMin[day];
          wh = Math.max(0, dayMax[day] - dayMin[day]);
        } else {
          wh = Math.max(0, dayMax[day] - baseline);
          deviceBaselines[deviceId] = Math.max(baseline, dayMax[day]);
        }
      }

      if (!deviceTotals[tag]) deviceTotals[tag] = {};
      deviceTotals[tag][day] = (deviceTotals[tag][day] || 0) + wh;
    }
  }

  // Solar assignada per interval i per dia a partir de la sèrie interpolada del generador
  const genPrev = {};
  for (const b of baselineResult.rows) {
    genPrev[b.generator_code] = parseFloat(b.generator_total_cumulative_wh);
  }

  const solarByGenerator = new Map();
  for (const row of solarSeriesResult.rows) {
    if (!solarByGenerator.has(row.generator_code)) solarByGenerator.set(row.generator_code, []);
    solarByGenerator.get(row.generator_code).push(row);
  }

  const solarByTs = {};
  const solarByDay = {};

  for (const [genCode, rows] of solarByGenerator) {
    // Finestra de sol empírica del generador a partir de les files netes del període
    const daylightWindow = computeDaylightWindow(
      rows.filter(r => !r.interpolated_at)
    );
    const interpolated = interpolateCumulative(rows, 'generator_total_cumulative_wh', daylightWindow);
    const pct = parseFloat(rows[0].participation_pct);
    const scale = generatorScales[genCode] || 1;
    let prev = genPrev[genCode] !== undefined ? genPrev[genCode] : null;

    for (const { ts, value } of interpolated) {
      const iso = new Date(ts).toISOString();
      const key = iso.slice(0, 16);
      const day = iso.slice(0, 10);

      if (!solarByDay[day]) {
        solarByDay[day] = { solar: 0, consumption: 0, balance: 0 };
      }

      if (prev !== null) {
        const delta = Math.max(0, Math.round((value - prev) * 100) / 100);
        const allocated = Math.round(delta * (pct / 100) * 100) / 100;
        solarByTs[key] = (solarByTs[key] || 0) + allocated * scale;
        solarByDay[day].solar += delta * scale * (pct / 100);
      }

      prev = Math.max(prev === null ? value : prev, value);
    }
  }

  // Import/export per dia = suma per interval de max(0, consum - solar) / max(0, solar - consum)
  const gridByDay = {};
  const intervalKeys = new Set([...Object.keys(consumByTs), ...Object.keys(solarByTs)]);
  for (const key of intervalKeys) {
    const day = key.slice(0, 10);
    const intervalConsum = consumByTs[key] || 0;
    const intervalSolar = solarByTs[key] || 0;
    if (!gridByDay[day]) gridByDay[day] = { import: 0, export: 0 };
    if (intervalConsum > intervalSolar) gridByDay[day].import += intervalConsum - intervalSolar;
    else gridByDay[day].export += intervalSolar - intervalConsum;
  }

  // Construir intervals diaris
  const sortedDays = Array.from(daysSet).sort();
  const intervals = [];
  const aggregatedDeviceTotals = {};

  for (const day of sortedDays) {
    const devices = {};

    for (const [tag, dayData] of Object.entries(deviceTotals)) {
      const wh = dayData[day] || 0;
      devices[tag] = Math.round(wh * 100) / 100;
      aggregatedDeviceTotals[tag] = (aggregatedDeviceTotals[tag] || 0) + wh;
    }

    const consumption = deviceTotals.total && deviceTotals.total[day]
      ? deviceTotals.total[day]
      : Object.entries(deviceTotals)
          .filter(([t]) => t !== 'total' && t !== 'solar')
          .reduce((s, [, dayData]) => s + (dayData[day] || 0), 0);

    const solar = solarByDay[day];
    const solarWh = solar ? solar.solar : 0;
    const grid = gridByDay[day] || { import: 0, export: 0 };

    intervals.push({
      date: day,
      consumption: Math.round(consumption * 100) / 100,
      solar: Math.round(solarWh * 100) / 100,
      grid: Math.round(grid.import * 100) / 100,
      export: Math.round(grid.export * 100) / 100,
      devices
    });
  }

  // Summaries globals
  const totalConsumption = intervals.reduce((s, d) => s + d.consumption, 0);
  const totalSolar = intervals.reduce((s, d) => s + d.solar, 0);
  const totalGrid = intervals.reduce((s, d) => s + d.grid, 0);
  const totalExport = intervals.reduce((s, d) => s + d.export, 0);

  const daysAnalyzed = sortedDays.length;
  const selfConsumptionPct = totalConsumption > 0
    ? Math.round(((totalSolar - totalExport) / totalConsumption) * 1000) / 10
    : 0;

  // Breakdown per dispositiu (excloent 'total' per no duplicar)
  const summaryDevices = {};
  for (const [tag, wh] of Object.entries(aggregatedDeviceTotals)) {
    if (tag !== 'total') {
      summaryDevices[tag] = Math.round(wh * 100) / 100;
    }
  }

  return {
    period: { from, to: toDate },
    cups,
    intervals,
    summary: {
      totalConsumption: Math.round(totalConsumption * 100) / 100,
      totalSolar: Math.round(totalSolar * 100) / 100,
      totalGrid: Math.round(totalGrid * 100) / 100,
      totalExport: Math.round(totalExport * 100) / 100,
      selfConsumptionPct,
      co2Saved: Math.round(totalSolar * 0.253 * 100) / 100,
      economicSaving: Math.round(totalSolar * 0.126 * 100) / 100,
      daysAnalyzed,
      avgDaily: daysAnalyzed > 0 ? Math.round((totalConsumption / daysAnalyzed) * 100) / 100 : 0,
      devices: summaryDevices
    }
  };
}

async function getDeviceTagMap(cups) {
  return database.query(
    `SELECT d.id, d.shelly_device_id
     FROM devices d
     JOIN users u ON d.user_id = u.id::text
     WHERE u.cups = $1`,
    [cups]
  ).then((result) => {
    const deviceTagMap = {};
    for (const d of result.rows) {
      const sid = d.shelly_device_id || '';
      const parts = sid.split('/');
      let tag;
      if (parts.length === 1) tag = 'total';
      else if (parts[0] === 'BombaDepuradora') tag = 'depuradora';
      else if (parts[0] === 'BombaNet') tag = 'bombaNet';
      else if (parts[0] === 'CloradorSali') tag = 'clorador';
      else tag = parts[0].toLowerCase();
      deviceTagMap[d.id] = tag;
    }
    return deviceTagMap;
  });
}

async function getBalanceData({ from, to, cups }) {
  const toDate = to || new Date().toISOString().slice(0, 10);
  const fromTs = `${from} 00:00:00+00`;
  const toTs = `${toDate} 23:59:59+00`;

  const deviceTagMap = await getDeviceTagMap(cups);

  // Solar i consum total per interval (15 min) des de balanc_energetic
  const balancResult = await database.query(
    `SELECT timestamp, generator_code, allocated_wh, consumption_wh
     FROM balanc_energetic
     WHERE cups = $1 AND timestamp >= $2 AND timestamp <= $3`,
    [cups, fromTs, toTs]
  );

  // Consum per aparell per interval (15 min) des de consums
  const consumTsResult = await database.query(
    `SELECT timestamp, device_id, energia_wh
     FROM consums
     WHERE cups = $1 AND timestamp >= $2 AND timestamp <= $3`,
    [cups, fromTs, toTs]
  );

  const byTs = {};
  for (const row of balancResult.rows) {
    const key = row.timestamp.toISOString();
    if (!byTs[key]) byTs[key] = { solar: 0, consumption: null, devices: {} };
    const scale = generatorScales[row.generator_code] || 1;
    byTs[key].solar += parseFloat(row.allocated_wh) * scale;
    byTs[key].consumption = parseFloat(row.consumption_wh);
  }

  for (const row of consumTsResult.rows) {
    const key = row.timestamp.toISOString();
    if (!byTs[key]) byTs[key] = { solar: 0, consumption: null, devices: {} };
    const tag = deviceTagMap[row.device_id] || 'unknown';
    byTs[key].devices[tag] = (byTs[key].devices[tag] || 0) + parseFloat(row.energia_wh);
  }

  const intervals = Object.keys(byTs).sort().map((key) => {
    const d = byTs[key];
    let consumption = d.consumption;
    if (consumption === null) {
      consumption = d.devices.total || Object.values(d.devices).reduce((s, v) => s + v, 0);
    }
    const solar = d.solar;
    return {
      date: key,
      consumption: Math.round(consumption * 100) / 100,
      solar: Math.round(solar * 100) / 100,
      grid: Math.round(Math.max(0, consumption - solar) * 100) / 100,
      export: Math.round(Math.max(0, solar - consumption) * 100) / 100,
      devices: Object.fromEntries(
        Object.entries(d.devices).map(([t, v]) => [t, Math.round(v * 100) / 100])
      )
    };
  });

  return { period: { from, to: toDate }, cups, intervals };
}

module.exports = { getStatisticsData, getBalanceData };
