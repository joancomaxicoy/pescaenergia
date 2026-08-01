const express = require('express');
const database = require('../utils/database');
const logger = require('../utils/logger');

const router = express.Router();

const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

router.get('/consumption', asyncHandler(async (req, res) => {
  try {
    const { from, to, cups } = req.query;

    if (!from || !cups) {
      return res.status(400).json({
        error: 'Calen els paràmetres from i cups',
        timestamp: new Date().toISOString()
      });
    }

    const toDate = to || new Date().toISOString().slice(0, 10);

    const startResult = await database.query(
      `SELECT energia_total_wh, timestamp
       FROM consums
       WHERE cups = $1 AND dispositiu LIKE 'Shelly EM%'
         AND timestamp < $2::timestamptz
       ORDER BY timestamp DESC LIMIT 1`,
      [cups, `${from} 00:00:00+00`]
    );

    // Sense lectura prèvia al període (primer dia de dades), el baseline és la primera lectura dins del període
    if (startResult.rows.length === 0) {
      const firstResult = await database.query(
        `SELECT energia_total_wh, timestamp
         FROM consums
         WHERE cups = $1 AND dispositiu LIKE 'Shelly EM%'
           AND timestamp >= $2 AND timestamp <= $3
         ORDER BY timestamp ASC LIMIT 1`,
        [cups, `${from} 00:00:00+00`, `${toDate} 23:59:59+00`]
      );
      if (firstResult.rows.length > 0) {
        startResult.rows = firstResult.rows;
      }
    }

    const endResult = await database.query(
      `SELECT energia_total_wh, timestamp
       FROM consums
       WHERE cups = $1 AND dispositiu LIKE 'Shelly EM%'
         AND timestamp >= $2 AND timestamp <= $3
       ORDER BY energia_total_wh DESC, timestamp DESC
       LIMIT 1`,
      [cups, `${from} 00:00:00+00`, `${toDate} 23:59:59+00`]
    );

    if (startResult.rows.length === 0 || endResult.rows.length === 0 || endResult.rows[0].energia_total_wh === null) {
      return res.json({
        cups,
        period: { from, to: toDate },
        totalConsumptionWh: 0,
        startTotal: 0,
        endTotal: 0,
        startTimestamp: null,
        endTimestamp: null,
        timestamp: new Date().toISOString()
      });
    }

    const startTotal = parseFloat(startResult.rows[0].energia_total_wh);
    const endTotal = parseFloat(endResult.rows[0].energia_total_wh);
    const totalConsumptionWh = Math.max(0, Math.round((endTotal - startTotal) * 100) / 100);

    res.json({
      cups,
      period: { from, to: toDate },
      totalConsumptionWh,
      startTotal,
      endTotal,
      startTimestamp: startResult.rows[0].timestamp,
      endTimestamp: endResult.rows[0].timestamp,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Error obtenint consum total:', { error: error.message });
    res.status(500).json({
      error: 'Error consultant consum',
      details: process.env.NODE_ENV !== 'production' ? error.message : undefined,
      timestamp: new Date().toISOString()
    });
  }
}));

router.get('/solar', asyncHandler(async (req, res) => {
  try {
    const { from, to, cups } = req.query;

    if (!from || !cups) {
      return res.status(400).json({
        error: 'Calen els paràmetres from i cups',
        timestamp: new Date().toISOString()
      });
    }

    const toDate = to || new Date().toISOString().slice(0, 10);
    const fromTs = `${from} 00:00:00+00`;
    const toTs = `${toDate} 23:59:59+00`;
    const today = new Date().toISOString().slice(0, 10);

    const generatorScales = {
      'giravolt': 100,
      'sala-polivalent': 1000,
      'residencia': 1000,
    };

    // Obtenir tots els generadors diferents per aquest CUPS
    const genResult = await database.query(
      `SELECT DISTINCT generator_code, participation_pct
       FROM balanc_energetic
       WHERE cups = $1`,
      [cups]
    );

    if (genResult.rows.length === 0) {
      return res.json({
        cups,
        period: { from, to: toDate },
        totalSolarWh: 0,
        generatorCode: null,
        participationPct: 0,
        startTotal: 0,
        endTotal: 0,
        startTimestamp: null,
        endTimestamp: null,
        todayFirst: 0,
        todayLast: 0,
        timestamp: new Date().toISOString()
      });
    }

    // Per a cada generador, calcular el delta acumulat al període i sumar-lo
    let totalSolarWh = 0;
    let startTotal = 0;
    let endTotal = 0;
    let startTimestamp = null;
    let endTimestamp = null;
    let firstGen = null;
    let periodStartWh = 0;
    let periodEndWh = 0;

    for (const gen of genResult.rows) {
      const genCode = gen.generator_code;
      const pct = parseFloat(gen.participation_pct);
      const scale = generatorScales[genCode] || 1;

      // Primer registre del període per aquest generador
      const startRes = await database.query(
        `SELECT generator_total_cumulative_wh, timestamp
         FROM balanc_energetic
         WHERE cups = $1 AND generator_code = $2
         ORDER BY ABS(EXTRACT(EPOCH FROM (timestamp - $3::timestamptz))) ASC LIMIT 1`,
        [cups, genCode, fromTs]
      );

      // Valor màxim del període per aquest generador (evita drops al final)
      const endRes = await database.query(
        `SELECT generator_total_cumulative_wh, timestamp
         FROM balanc_energetic
         WHERE cups = $1 AND generator_code = $2 AND timestamp >= $3 AND timestamp <= $4
         ORDER BY generator_total_cumulative_wh DESC, timestamp DESC
         LIMIT 1`,
        [cups, genCode, fromTs, toTs]
      );

      if (startRes.rows.length === 0 || endRes.rows.length === 0) continue;

      const startVal = parseFloat(startRes.rows[0].generator_total_cumulative_wh);
      const endVal = parseFloat(endRes.rows[0].generator_total_cumulative_wh);
      const delta = Math.max(0, endVal - startVal);
      totalSolarWh += Math.round(delta * scale * (pct / 100) * 100) / 100;

      periodStartWh += Math.round(startVal * scale * (pct / 100) * 100) / 100;
      periodEndWh += Math.round(endVal * scale * (pct / 100) * 100) / 100;

      if (!firstGen) {
        firstGen = genCode;
        startTotal = startVal;
        endTotal = endVal;
        startTimestamp = startRes.rows[0].timestamp;
        endTimestamp = endRes.rows[0].timestamp;
      }
    }

    // Dades d'avui per la subtitle (del primer generador, per coherència)
    let todayFirst = 0;
    let todayLast = 0;
    if (firstGen) {
      const todayStartRes = await database.query(
        `SELECT generator_total_cumulative_wh
         FROM balanc_energetic
         WHERE cups = $1 AND generator_code = $2
         ORDER BY ABS(EXTRACT(EPOCH FROM (timestamp - $3::timestamptz))) ASC LIMIT 1`,
        [cups, firstGen, `${today} 00:00:00+00`]
      );
      const todayEndRes = await database.query(
        `SELECT generator_total_cumulative_wh
         FROM balanc_energetic
         WHERE cups = $1 AND generator_code = $2 AND timestamp >= $3 AND timestamp <= $4
         ORDER BY generator_total_cumulative_wh DESC, timestamp DESC
         LIMIT 1`,
        [cups, firstGen, `${today} 00:00:00+00`, `${today} 23:59:59+00`]
      );
      todayFirst = todayStartRes.rows.length > 0
        ? parseFloat(todayStartRes.rows[0].generator_total_cumulative_wh) : 0;
      todayLast = todayEndRes.rows.length > 0
        ? parseFloat(todayEndRes.rows[0].generator_total_cumulative_wh) : 0;
    }

    res.json({
      cups,
      period: { from, to: toDate },
      totalSolarWh,
      generatorCode: firstGen,
      participationPct: genResult.rows.length > 0 ? parseFloat(genResult.rows[0].participation_pct) : 0,
      generators: genResult.rows.map(g => g.generator_code),
      startTotal,
      endTotal,
      startTimestamp,
      endTimestamp,
      todayFirst,
      todayLast,
      periodStartWh,
      periodEndWh,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Error obtenint generació solar:', { error: error.message });
    res.status(500).json({
      error: 'Error consultant generació solar',
      details: process.env.NODE_ENV !== 'production' ? error.message : undefined,
      timestamp: new Date().toISOString()
    });
  }
}));

router.get('/balance', asyncHandler(async (req, res) => {
  try {
    const { from, to, cups } = req.query;

    if (!from || !cups) {
      return res.status(400).json({
        error: 'Calen els paràmetres from i cups',
        timestamp: new Date().toISOString()
      });
    }

    const toDate = to || new Date().toISOString().slice(0, 10);
    const fromTs = `${from} 00:00:00+00`;
    const toTs = `${toDate} 23:59:59+00`;

    // Map device_id → tag per aquest CUPS
    const deviceMapResult = await database.query(
      `SELECT d.id, d.shelly_device_id
       FROM devices d
       JOIN users u ON d.user_id = u.id::text
       WHERE u.cups = $1`,
      [cups]
    );

    const deviceTagMap = {};
    for (const d of deviceMapResult.rows) {
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

    const generatorScales = {
      'giravolt': 100,
      'sala-polivalent': 1000,
      'residencia': 1000,
    };

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

    res.json({
      period: { from, to: toDate },
      cups,
      intervals,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Error obtenint balanç per intervals:', { error: error.message });
    res.status(500).json({
      error: 'Error consultant balanç',
      details: process.env.NODE_ENV !== 'production' ? error.message : undefined,
      timestamp: new Date().toISOString()
    });
  }
}));

router.get('/data', asyncHandler(async (req, res) => {
  try {
    const { from, to, cups } = req.query;

    if (!from || !cups) {
      return res.status(400).json({
        error: 'Calen els paràmetres from i cups',
        timestamp: new Date().toISOString()
      });
    }

    const toDate = to || new Date().toISOString().slice(0, 10);
    const fromTs = `${from} 00:00:00+00`;
    const toTs = `${toDate} 23:59:59+00`;

    // Map device_id → tag per aquest CUPS
    const deviceMapResult = await database.query(
      `SELECT d.id, d.shelly_device_id
       FROM devices d
       JOIN users u ON d.user_id = u.id::text
       WHERE u.cups = $1`,
      [cups]
    );

    const deviceTagMap = {};
    for (const d of deviceMapResult.rows) {
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

    const generatorScales = {
      'giravolt': 100,
      'sala-polivalent': 1000,
      'residencia': 1000,
    };

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

    res.json({
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
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Error obtenint dades estadístiques:', { error: error.message });
    res.status(500).json({
      error: 'Error consultant estadístiques',
      details: process.env.NODE_ENV !== 'production' ? error.message : undefined,
      timestamp: new Date().toISOString()
    });
  }
}));

module.exports = router;
