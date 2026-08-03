const database = require('../utils/database');
const logger = require('../utils/logger');

const generatorScales = {
  'giravolt': 100,
  'sala-polivalent': 1000,
  'residencia': 1000,
};

function getDeviceTagMap(cups) {
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

  // Consum per device per dia = MAX(energia_total_wh) del dia - baseline (evita drops i acumulats)
  const consumResult = await database.query(
    `SELECT DATE(c.timestamp) as day, c.device_id,
            MAX(c.energia_total_wh) as max_total, MIN(c.energia_total_wh) as min_total
     FROM consums c
     WHERE c.cups = $1 AND c.timestamp >= $2 AND c.timestamp <= $3
     GROUP BY DATE(c.timestamp), c.device_id
     ORDER BY day, c.device_id`,
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

  // Solar assignada per interval (share de l'usuari en Wh) des de balanc_energetic
  const solarTsResult = await database.query(
    `SELECT timestamp, generator_code, allocated_wh
     FROM balanc_energetic
     WHERE cups = $1 AND timestamp >= $2 AND timestamp <= $3`,
    [cups, fromTs, toTs]
  );

  // Consum per interval (delta real del comptador principal Shelly EM)
  const consumptionTsResult = await database.query(
    `SELECT timestamp, energia_wh
     FROM consums
     WHERE cups = $1 AND dispositiu LIKE 'Shelly EM%'
       AND timestamp >= $2 AND timestamp <= $3`,
    [cups, fromTs, toTs]
  );

  // Import/export per dia = suma per interval de max(0, consum - solar) / max(0, solar - consum)
  // (l'agregació diària max(0, consum_total - solar_total) emmascara els imports nocturns)
  const solarByTs = {};
  for (const row of solarTsResult.rows) {
    const key = row.timestamp.toISOString().slice(0, 16);
    const scale = generatorScales[row.generator_code] || 1;
    solarByTs[key] = (solarByTs[key] || 0) + parseFloat(row.allocated_wh) * scale;
  }

  const consumByTs = {};
  for (const row of consumptionTsResult.rows) {
    const key = row.timestamp.toISOString().slice(0, 16);
    consumByTs[key] = (consumByTs[key] || 0) + parseFloat(row.energia_wh);
  }

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

  // Indexar solar per dia usant delta acumulat (com /solar), evitant el bootstrap inicial
  const solarRowsResult = await database.query(
    `SELECT b.timestamp, b.generator_code, b.generator_total_cumulative_wh, b.participation_pct
     FROM balanc_energetic b
     WHERE b.cups = $1 AND b.timestamp >= $2 AND b.timestamp <= $3
     ORDER BY b.generator_code, b.timestamp`,
    [cups, fromTs, toTs]
  );

  const genPrev = {};
  // Inicialitzar genPrev amb els valors baseline pre-període
  for (const b of baselineResult.rows) {
    genPrev[b.generator_code] = parseFloat(b.generator_total_cumulative_wh);
  }

  const solarByDay = {};
  for (const row of solarRowsResult.rows) {
    const day = row.timestamp.toISOString().slice(0, 10);
    const genCode = row.generator_code;
    const currVal = parseFloat(row.generator_total_cumulative_wh);
    const pct = parseFloat(row.participation_pct);
    const scale = generatorScales[genCode] || 1;

    if (!solarByDay[day]) {
      solarByDay[day] = { solar: 0, consumption: 0, balance: 0 };
    }

    if (genPrev[genCode] !== undefined) {
      const delta = Math.max(0, currVal - genPrev[genCode]);
      solarByDay[day].solar += delta * scale * (pct / 100);
    }

    genPrev[genCode] = Math.max(genPrev[genCode] || 0, currVal);
  }

  // Agrupar consum per dia amb breakdown per tag
  const daysSet = new Set();
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

  for (const c of consumResult.rows) {
    const day = c.day.toISOString().slice(0, 10);
    daysSet.add(day);
    const deviceId = c.device_id;
    const tag = deviceTagMap[deviceId] || 'unknown';
    const maxTotal = parseFloat(c.max_total);
    const minTotal = parseFloat(c.min_total);

    let wh = 0;
    const baseline = deviceBaselines[deviceId];
    if (baseline !== undefined) {
      if (maxTotal < baseline) {
        // El comptador s'ha reiniciat (tot el dia queda per sota del baseline):
        // re-baseline a la lectura mínima del dia i comptem només el moviment d'avui.
        deviceBaselines[deviceId] = minTotal;
        wh = Math.max(0, maxTotal - minTotal);
      } else {
        wh = Math.max(0, maxTotal - baseline);
        // Actualitzar baseline amb el màxim del dia (un drop transitori no reinicia el comptador)
        deviceBaselines[deviceId] = Math.max(baseline, maxTotal);
      }
    }

    if (!deviceTotals[tag]) deviceTotals[tag] = {};
    deviceTotals[tag][day] = (deviceTotals[tag][day] || 0) + wh;
  }

  // Construir intervals diaris
  const sortedDays = Array.from(daysSet).sort();
  const intervals = [];
  const aggregatedDeviceTotals = {};

  for (const day of sortedDays) {
    const devices = {};

    // Omplir dispositius (sub-meters i total)
    for (const [tag, dayData] of Object.entries(deviceTotals)) {
      const wh = dayData[day] || 0;
      devices[tag] = Math.round(wh * 100) / 100;
      aggregatedDeviceTotals[tag] = (aggregatedDeviceTotals[tag] || 0) + wh;
    }

    // El consum total ve del tag 'total' (Shelly EM = comptador principal)
    // Si no hi ha tag 'total', fem la suma de tots els dispositius
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

module.exports = { getStatisticsData };
