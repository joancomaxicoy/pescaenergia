const express = require('express');
const BalancEnergeticService = require('../services/balancEnergeticService');
const logger = require('../utils/logger');

const router = express.Router();
const balancService = new BalancEnergeticService();

const TIMEZONE = process.env.USERS_TIMEZONE || 'Europe/Madrid';

const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

function toLocalISO(date) {
  if (!date) return null;
  return new Date(date).toLocaleString('sv-SE', { timeZone: TIMEZONE }).replace(' ', 'T');
}

const GENERATOR_SCALES = {
  'giravolt': 100,
  'sala-polivalent': 1000,
  'residencia': 1000,
};

function toSlot(date) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TIMEZONE, hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(date);
  let hour = parseInt(parts.find(p => p.type === 'hour').value, 10) % 24;
  const minute = parseInt(parts.find(p => p.type === 'minute').value, 10);
  return hour * 4 + Math.floor(minute / 15);
}

function mode(values) {
  if (!values || values.length === 0) return 0;
  const counts = new Map();
  for (const v of values) counts.set(v, (counts.get(v) || 0) + 1);
  let bestValue = values[0];
  let bestCount = 0;
  for (const [v, c] of counts) {
    if (c > bestCount) {
      bestCount = c;
      bestValue = v;
    }
  }
  return Math.round(bestValue * 100) / 100;
}

function mean(values) {
  if (!values || values.length === 0) return 0;
  const total = values.reduce((s, v) => s + v, 0);
  return Math.round((total / values.length) * 100) / 100;
}

const INTERVAL_HOURS = 0.25;

function simulateBattery(profile, params) {
  const capacityWh = params.capacityKwh * 1000;
  const maxFlowWh = params.maxPowerKw * 1000 * INTERVAL_HOURS;
  const minWh = capacityWh * params.minSoc;
  const maxWh = capacityWh * params.maxSoc;

  let soc = capacityWh * params.startSoc;
  let running = 0;
  let requiredCapacityWh = 0;
  let totalSurplus = 0;
  let totalDeficit = 0;

  const slots = profile.map((p) => {
    const surplus = Math.max(0, p.generation_mode - p.consumption_mode);
    const deficit = Math.max(0, p.consumption_mode - p.generation_mode);
    totalSurplus += surplus;
    totalDeficit += deficit;

    const chargeWh = Math.min(surplus, maxFlowWh, Math.max(0, maxWh - soc));
    soc += chargeWh;
    const exportWh = Math.max(0, surplus - chargeWh);

    const dischargeStored = Math.min(
      deficit / params.efficiency,
      Math.max(0, soc - minWh),
      maxFlowWh
    );
    const dischargeWh = dischargeStored * params.efficiency;
    soc -= dischargeStored;
    const importWh = Math.max(0, deficit - dischargeWh);

    running = Math.max(0, running + surplus - deficit);
    requiredCapacityWh = Math.max(requiredCapacityWh, running);

    return {
      slot: p.slot,
      label: p.label,
      chargeWh: Math.round(chargeWh * 100) / 100,
      dischargeWh: Math.round(dischargeWh * 100) / 100,
      importWh: Math.round(importWh * 100) / 100,
      exportWh: Math.round(exportWh * 100) / 100,
      socPct: Math.round((soc / capacityWh) * 1000) / 10,
    };
  });

  const round = (v) => Math.round(v * 100) / 100;
  const totalCharge = round(slots.reduce((s, x) => s + x.chargeWh, 0));
  const totalDischarge = round(slots.reduce((s, x) => s + x.dischargeWh, 0));
  const totalImport = round(slots.reduce((s, x) => s + x.importWh, 0));
  const totalExport = round(slots.reduce((s, x) => s + x.exportWh, 0));
  const socPcts = slots.map((x) => x.socPct);

  const usableWh = capacityWh * (params.maxSoc - params.minSoc);

  const totalConsumptionDay = profile.reduce((s, p) => s + Math.max(0, p.consumption_mode), 0);
  const totalGenerationDay = profile.reduce((s, p) => s + Math.max(0, p.generation_mode), 0);
  // Autoconsum: percentatge del consum cobert amb producció pròpia (directa + bateria)
  const autoconsumConsPct = totalConsumptionDay > 0
    ? round(((totalConsumptionDay - totalImport) / totalConsumptionDay) * 100)
    : 0;
  // Sense bateria (l'import sense bateria és tot el dèficit)
  const autoconsumConsPctNoBattery = totalConsumptionDay > 0
    ? round(((totalConsumptionDay - totalDeficit) / totalConsumptionDay) * 100)
    : 0;
  // Percentatge de la generació aprofitada en lloc d'abocar-la a la xarxa
  const autoconsumGenPct = totalGenerationDay > 0
    ? round(((totalGenerationDay - totalExport) / totalGenerationDay) * 100)
    : 0;

  return {
    params,
    slots,
    summary: {
      totalSurplusWh: round(totalSurplus),
      totalDeficitWh: round(totalDeficit),
      totalChargeKwh: round(totalCharge / 1000),
      totalDischargeKwh: round(totalDischarge / 1000),
      totalImportKwh: round(totalImport / 1000),
      totalExportKwh: round(totalExport / 1000),
      capturedPct: totalSurplus > 0 ? round((totalCharge / totalSurplus) * 100) : 0,
      coveragePct: totalDeficit > 0 ? round((totalDischarge / totalDeficit) * 100) : 0,
      autoconsumConsPct,
      autoconsumConsPctNoBattery,
      autoconsumGenPct,
      requiredCapacityKwh: round(requiredCapacityWh / 1000),
      maxSocPct: socPcts.length > 0 ? Math.max(...socPcts) : 0,
      minSocPct: socPcts.length > 0 ? Math.min(...socPcts) : 0,
      endSocPct: socPcts.length > 0 ? socPcts[socPcts.length - 1] : 0,
      fillDays: totalSurplus > 0 ? round(usableWh / totalSurplus) : null,
    },
  };
}

router.get('/dia-tipic', asyncHandler(async (req, res) => {
  try {
    const { cups, days } = req.query;
    if (!cups) {
      return res.status(400).json({
        error: 'Cal el paràmetre cups',
        timestamp: new Date().toISOString(),
      });
    }

    const requestedDays = Math.min(Math.max(parseInt(days) || 30, 1), 365);
    const toDate = new Date().toISOString().slice(0, 10);
    const fromTs = new Date(Date.parse(`${toDate}T00:00:00Z`) - requestedDays * 86400000).toISOString();
    const toTs = `${toDate} 23:59:59+00`;

    const parsedSimPct = parseFloat(req.query.simulationPct);
    const simulationPct = Number.isFinite(parsedSimPct) ? Math.min(100, Math.max(0, parsedSimPct)) : null;

    const result = await require('../utils/database').query(
      `SELECT generator_code, allocated_wh, consumption_wh, participation_pct, timestamp
       FROM balanc_energetic
       WHERE cups = $1 AND timestamp >= $2 AND timestamp <= $3
       ORDER BY timestamp`,
      [cups, fromTs, toTs]
    );

    const participationsByGen = new Map();
    const byTimestamp = {};
    for (const row of result.rows) {
      const scale = GENERATOR_SCALES[row.generator_code] || 1;
      const rowPct = parseFloat(row.participation_pct) || 0;
      if (!participationsByGen.has(row.generator_code)) {
        participationsByGen.set(row.generator_code, rowPct);
      }
      let pctFactor = 1;
      if (simulationPct !== null && rowPct > 0) {
        pctFactor = simulationPct / rowPct;
      }
      const assigned = parseFloat(row.allocated_wh) * scale * pctFactor;
      const consumption = parseFloat(row.consumption_wh) || 0;
      const key = row.timestamp.toISOString();
      if (!byTimestamp[key]) {
        byTimestamp[key] = { assigned: 0, consumption: 0, ts: row.timestamp };
      }
      byTimestamp[key].assigned += assigned;
      byTimestamp[key].consumption = Math.max(byTimestamp[key].consumption, consumption);
    }

    const entries = Object.values(byTimestamp).sort((a, b) => a.ts - b.ts);

    const slots = Array.from({ length: 96 }, () => ({ assigned: [], consumption: [] }));
    const daysSet = new Set();
    for (const entry of entries) {
      slots[toSlot(entry.ts)].assigned.push(entry.assigned);
      slots[toSlot(entry.ts)].consumption.push(entry.consumption);
      const dayParts = new Intl.DateTimeFormat('en-CA', {
        timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
      }).format(entry.ts);
      daysSet.add(dayParts);
    }

    const profile = slots.map((slotData, index) => {
      const hour = String(Math.floor(index / 4)).padStart(2, '0');
      const minute = String((index % 4) * 15).padStart(2, '0');
      return {
        slot: index,
        label: `${hour}:${minute}`,
        samples: slotData.assigned.length,
        generation_mode: mode(slotData.assigned),
        generation_mean: mean(slotData.assigned),
        consumption_mode: mode(slotData.consumption),
        consumption_mean: mean(slotData.consumption),
      };
    });

    let totalConsumption = 0;
    let totalGeneration = 0;
    let totalImport = 0;
    let totalExport = 0;
    for (const entry of entries) {
      totalConsumption += entry.consumption;
      totalGeneration += entry.assigned;
      totalImport += Math.max(0, entry.consumption - entry.assigned);
      totalExport += Math.max(0, entry.assigned - entry.consumption);
    }

    const daysCount = Math.max(daysSet.size, 1);

    let typicalGeneration = 0;
    let typicalConsumption = 0;
    let typicalImport = 0;
    let typicalExport = 0;
    for (const p of profile) {
      typicalGeneration += p.generation_mode;
      typicalConsumption += p.consumption_mode;
      typicalImport += Math.max(0, p.consumption_mode - p.generation_mode);
      typicalExport += Math.max(0, p.generation_mode - p.consumption_mode);
    }

    // --- Simulació de bateria sobre el dia típic (moda) ---
    const batteryParams = {
      capacityKwh: Math.min(50, Math.max(0.5, parseFloat(req.query.batteryKwh) || 5)),
      maxPowerKw: Math.min(50, Math.max(0.1, parseFloat(req.query.batteryKw) || 2.5)),
      efficiency: Math.min(1, Math.max(0.5, parseFloat(req.query.batteryEfficiency) || 0.9)),
      minSoc: 0.2,
      maxSoc: 1,
      startSoc: 0.5,
    };

    const battery = simulateBattery(profile, batteryParams);

    const participationGenerators = Array.from(participationsByGen.entries())
      .map(([generator_code, participation_pct]) => ({ generator_code, participation_pct }));
    const pctCounts = new Map();
    for (const p of participationGenerators) {
      pctCounts.set(p.participation_pct, (pctCounts.get(p.participation_pct) || 0) + 1);
    }
    let currentPct = 0;
    let currentPctCount = -1;
    for (const [pct, count] of pctCounts) {
      if (count > currentPctCount) {
        currentPctCount = count;
        currentPct = pct;
      }
    }

    res.json({
      cups,
      timezone: TIMEZONE,
      period: { from: fromTs.slice(0, 10), to: toDate, days: daysCount },
      participation: {
        actual: participationGenerators,
        currentPct,
        appliedPct: simulationPct,
      },
      profile,
      totals: {
        consumptionWh: Math.round(totalConsumption * 100) / 100,
        generationWh: Math.round(totalGeneration * 100) / 100,
        importWh: Math.round(totalImport * 100) / 100,
        exportWh: Math.round(totalExport * 100) / 100,
        days: daysCount,
      },
      typicalDay: {
        consumptionWh: Math.round(typicalConsumption * 100) / 100,
        generationWh: Math.round(typicalGeneration * 100) / 100,
        importWh: Math.round(typicalImport * 100) / 100,
        exportWh: Math.round(typicalExport * 100) / 100,
        autoconsumConsPct: typicalConsumption > 0
          ? Math.round(((typicalConsumption - typicalImport) / typicalConsumption) * 1000) / 10
          : 0,
        autoconsumGenPct: typicalGeneration > 0
          ? Math.round(((typicalGeneration - typicalExport) / typicalGeneration) * 1000) / 10
          : 0,
        exportPct: typicalGeneration > 0
          ? Math.round((typicalExport / typicalGeneration) * 1000) / 10
          : 0,
      },
      battery,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Error consultant dia típic:', { error: error.message });
    res.status(500).json({
      error: 'Error consultant dia típic',
      details: process.env.NODE_ENV !== 'production' ? error.message : undefined,
      timestamp: new Date().toISOString(),
    });
  }
}));

router.get('/recent', asyncHandler(async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);

    const result = await require('../utils/database').query(
      `SELECT user_id, cups, generator_code, participation_pct,
              generator_total_cumulative_wh, generator_total_wh,
              allocated_wh, consumption_wh, balance_wh, timestamp
       FROM balanc_energetic
       ORDER BY timestamp DESC, user_id
       LIMIT $1`,
      [limit]
    );

    const grouped = {};
    for (const row of result.rows) {
      const key = `${row.user_id}_${row.timestamp}`;
      if (!grouped[key]) {
        grouped[key] = {
          user_id: row.user_id,
          cups: row.cups,
          timestamp: toLocalISO(row.timestamp),
          generators: [],
        };
      }
      grouped[key].generators.push({
        generator_code: row.generator_code,
        participation_pct: parseFloat(row.participation_pct),
        generator_total_cumulative_wh: parseFloat(row.generator_total_cumulative_wh),
        generator_total_wh: parseFloat(row.generator_total_wh),
        allocated_wh: parseFloat(row.allocated_wh),
        consumption_wh: parseFloat(row.consumption_wh),
        balance_wh: parseFloat(row.balance_wh),
      });
    }

    res.json({
      timezone: TIMEZONE,
      balancs: Object.values(grouped),
      count: Object.values(grouped).length,
      timestamp: toLocalISO(new Date()),
    });
  } catch (error) {
    logger.error('Error obtenint balanc energètic:', { error: error.message });
    res.status(500).json({
      error: 'Error consultant balanc_energetic',
      details: process.env.NODE_ENV !== 'production' ? error.message : undefined,
      timestamp: toLocalISO(new Date()),
    });
  }
}));

module.exports = router;
