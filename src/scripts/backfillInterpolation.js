require('dotenv').config();
const database = require('../utils/database');
const logger = require('../utils/logger');
const {
  interpolateConsumptionRows,
  interpolateBalanceRows,
  computeDaylightWindow,
} = require('../utils/interpolationUtils');

const GENERATOR_SCALES = {
  'giravolt': 100,
  'sala-polivalent': 1000,
  'residencia': 1000,
};

/**
 * Corregeix consums (energia_total_wh) dels comptadors Shelly EM:
 * detecta trams congelats seguits de salt, interpola l'acumulat,
 * recalcula energia_wh i potencia_w, i marca interpolated_at.
 */
async function processConsumptions(dryRun = false) {
  const result = await database.query(`
    SELECT c.id, c.device_id, c.timestamp, c.energia_wh, c.potencia_w,
           c.energia_total_wh, c.interpolated_at
    FROM consums c
    WHERE c.dispositiu LIKE 'Shelly EM%'
    ORDER BY c.device_id, c.timestamp
  `);

  const byDevice = new Map();
  for (const row of result.rows) {
    if (!byDevice.has(row.device_id)) byDevice.set(row.device_id, []);
    byDevice.get(row.device_id).push(row);
  }

  let updatedRows = 0;
  let interpolatedRows = 0;
  const corrections = [];

  for (const [deviceId, rows] of byDevice) {
    const { corrections: deviceCorrections } = interpolateConsumptionRows(rows);
    corrections.push(...deviceCorrections.map(c => ({ deviceId, ...c })));

    for (const row of rows) {
      if (!row.changed || row.interpolated_at) continue;

      if (dryRun) {
        updatedRows++;
        if (row.interpolated) interpolatedRows++;
        continue;
      }

      await database.query(
        `UPDATE consums
         SET energia_total_wh = $1, energia_wh = $2, potencia_w = $3,
             interpolated_at = CASE WHEN $4 THEN NOW() ELSE interpolated_at END
         WHERE id = $5`,
        [row.energia_total_wh, row.energia_wh, row.potencia_w, row.interpolated, row.id]
      );
      updatedRows++;
      if (row.interpolated) interpolatedRows++;
    }
  }

  return { updatedRows, interpolatedRows, corrections };
}

/**
 * Corregeix balanc_energetic (generator_total_cumulative_wh):
 * interpola l'acumulat del generador, recalcula generator_total_wh,
 * allocated_wh, consumption_wh i balance_wh, i marca interpolated_at.
 */
async function processBalances(dryRun = false) {
  // Mapa consum (real, ja corregit) per cups + timestamp per recalcular consumption_wh.
  // Dedupe per device+timestamp: els duplicats no han d'inflar el consum.
  const consumMap = new Map();
  const consumResult = await database.query(`
    SELECT cups, timestamp, SUM(energia_wh) AS total
    FROM (
      SELECT DISTINCT ON (device_id, timestamp) device_id, cups, timestamp, energia_wh
      FROM consums
      WHERE dispositiu LIKE 'Shelly EM%'
      ORDER BY device_id, timestamp, id
    ) s
    GROUP BY cups, timestamp
  `);
  for (const row of consumResult.rows) {
    const key = `${row.cups}|${row.timestamp.toISOString().slice(0, 16)}`;
    consumMap.set(key, parseFloat(row.total));
  }

  const result = await database.query(`
    SELECT id, user_id, cups, generator_code, participation_pct, timestamp,
           generator_total_cumulative_wh, generator_total_wh,
           allocated_wh, consumption_wh, balance_wh, interpolated_at
    FROM balanc_energetic
    ORDER BY user_id, generator_code, timestamp
  `);

  const byGroup = new Map();
  for (const row of result.rows) {
    const key = `${row.user_id}|${row.generator_code}`;
    if (!byGroup.has(key)) byGroup.set(key, []);
    byGroup.get(key).push(row);
  }

  let updatedRows = 0;
  let interpolatedRows = 0;
  const corrections = [];

  for (const [key, rows] of byGroup) {
    const [userId, generatorCode] = key.split('|');
    const scale = GENERATOR_SCALES[generatorCode] || 1;

    // Override consumption_wh amb el consum real corregit per timestamp
    for (const row of rows) {
      const consumKey = `${row.cups}|${row.timestamp.toISOString().slice(0, 16)}`;
      row.consumption_wh = consumMap.get(consumKey) || 0;
    }

    // Finestra de sol empírica del generador a partir dels dies nets
    // (intervals amb generació positiva i sense correccions prèvies).
    // Opció 3: la producció solar només passa entre el primer i l'últim
    // interval amb generació; la nit es queda plana a 0.
    const daylightWindow = computeDaylightWindow(
      rows.filter(r => !r.interpolated_at)
    );
    if (daylightWindow) {
      const hhmm = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
      logger.info(`Finestra de sol empírica ${generatorCode}`, {
        start: hhmm(daylightWindow.start),
        end: hhmm(daylightWindow.end),
        cleanIntervals: rows.filter(r => !r.interpolated_at).length,
      });
    }

    const { corrections: groupCorrections } = interpolateBalanceRows(rows, scale, daylightWindow);
    corrections.push(...groupCorrections.map(c => ({ userId, generatorCode, ...c })));

    for (const row of rows) {
      if (!row.changed || row.interpolated_at) continue;

      if (dryRun) {
        updatedRows++;
        if (row.interpolated) interpolatedRows++;
        continue;
      }

      await database.query(
        `UPDATE balanc_energetic
         SET generator_total_cumulative_wh = $1, generator_total_wh = $2,
             allocated_wh = $3, consumption_wh = $4, balance_wh = $5,
             interpolated_at = CASE WHEN $6 THEN NOW() ELSE interpolated_at END
         WHERE id = $7`,
        [
          row.generator_total_cumulative_wh,
          row.generator_total_wh,
          row.allocated_wh,
          row.consumption_wh,
          row.balance_wh,
          row.interpolated,
          row.id,
        ]
      );
      updatedRows++;
      if (row.interpolated) interpolatedRows++;
    }
  }

  return { updatedRows, interpolatedRows, corrections };
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  await database.connect();

  try {
    logger.info(`=== Backfill d'interpolació iniciat (${dryRun ? 'DRY RUN' : 'REAL'}) ===`);

    const consumption = await processConsumptions(dryRun);
    logger.info('Consums corregits', {
      updatedRows: consumption.updatedRows,
      interpolatedRows: consumption.interpolatedRows,
      gaps: consumption.corrections.length,
    });

    const balances = await processBalances(dryRun);
    logger.info('Balanc energètic corregit', {
      updatedRows: balances.updatedRows,
      interpolatedRows: balances.interpolatedRows,
      gaps: balances.corrections.length,
    });

    logger.info(`=== Backfill completat (${dryRun ? 'DRY RUN — cap canvi aplicat' : 'REAL'}) ===`, {
      consums: consumption.updatedRows,
      balanc: balances.updatedRows,
      corrections: {
        consums: consumption.corrections.map(c => ({
          device: c.deviceId,
          from: c.startTs,
          to: c.endTs,
          records: c.records,
          jumpWh: c.jump,
        })),
        balanc: balances.corrections.map(c => ({
          user: c.userId,
          generator: c.generatorCode,
          from: c.startTs,
          to: c.endTs,
          records: c.records,
          jumpWh: c.jump,
        })),
      },
    });

    return { consumption, balances };
  } finally {
    await database.close();
  }
}

if (require.main === module) {
  main().catch(err => {
    logger.error('Backfill d\'interpolació fallat', { error: err.message, stack: err.stack });
    process.exit(1);
  });
}

module.exports = { main, processConsumptions, processBalances };
