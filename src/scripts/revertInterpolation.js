require('dotenv').config();
const database = require('../utils/database');
const logger = require('../utils/logger');

const GENERATOR_SCALES = {
  'giravolt': 100,
  'sala-polivalent': 1000,
  'residencia': 1000,
};

const round = (v) => Math.round(v * 100) / 100;

/**
 * Desfà la interpolació aplicada i deixa la BD en l'estat pre-backfill:
 * el tram congelat torna al valor real (el de l'última lectura real anterior),
 * el registre de recuperació recupera el salt complet, i es netegen els
 * registres danyats (deltes negatius / consums negatius de la fila final).
 *
 * Estratègia robusta:
 * - El darrer registre NO marcat anterior al tram ja és el valor congelat real
 *   (l'ancoratge): frozenVal = el seu valor acumulat, sense afegir cap delta.
 *   (El delta real de l'ancoratge s'ha conservat en aquesta fila prèvia; el delta
 *   del primer registre marcat és l'interpolat i no s'ha de sumar.)
 * - La fila final del tram (unmarked, valor == frozenVal) pot tenir el delta o
 *   consum corromput (negatiu) → es restaura a 0.
 */
async function revertConsumptions(client) {
  const interp = await client.query(`
    SELECT c.id, c.device_id, c.timestamp, c.energia_wh, c.potencia_w, c.energia_total_wh
    FROM consums c
    WHERE c.dispositiu LIKE 'Shelly EM%' AND c.interpolated_at IS NOT NULL
    ORDER BY c.device_id, c.timestamp
  `);

  const byDevice = new Map();
  for (const r of interp.rows) {
    if (!byDevice.has(r.device_id)) byDevice.set(r.device_id, []);
    byDevice.get(r.device_id).push(r);
  }

  let restored = 0;
  for (const [deviceId, rows] of byDevice) {
    const sorted = rows.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    const anchor = sorted[0];

    // Valor congelat = valor acumulat de l'última lectura real anterior al tram.
    // (L'ancoratge real és la fila NO marcada immediatament anterior al primer
    // registre marcat; el seu acumulat ja és el valor congelat real.)
    const prev = await client.query(
      `SELECT energia_total_wh FROM consums
       WHERE device_id = $1 AND timestamp < $2 AND interpolated_at IS NULL
       ORDER BY timestamp DESC LIMIT 1`,
      [deviceId, anchor.timestamp]
    );
    let frozenVal;
    if (prev.rows.length) {
      frozenVal = round(parseFloat(prev.rows[0].energia_total_wh));
    } else {
      const step = sorted.length >= 2
        ? sorted[1].energia_total_wh - sorted[0].energia_total_wh
        : 0;
      frozenVal = round(parseFloat(anchor.energia_total_wh) - step);
    }

    // El registre de recuperació és el primer amb salt real (> frozenVal);
    // la fila final del tram (valor == frozenVal) n'és part i queda per netejar.
    const rec = await client.query(
      `SELECT id, energia_total_wh, timestamp FROM consums
       WHERE device_id = $1 AND timestamp > $2 AND energia_total_wh > $3
       ORDER BY timestamp ASC LIMIT 1`,
      [deviceId, sorted[sorted.length - 1].timestamp, frozenVal]
    );

    // Restaura les files interpolades (excepte l'ancoratge) al valor congelat, delta 0
    for (const r of sorted.slice(1)) {
      // Els duplicats del mateix timestamp que l'ancoratge són la mateixa lectura
      // real: conserven el delta i la potència de l'ancoratge.
      const sameTsAsAnchor = new Date(r.timestamp).getTime() === new Date(anchor.timestamp).getTime();
      await client.query(
        `UPDATE consums SET energia_total_wh = $1, energia_wh = $2, potencia_w = $3, interpolated_at = NULL
         WHERE id = $4`,
        sameTsAsAnchor
          ? [frozenVal, anchor.energia_wh, anchor.potencia_w, r.id]
          : [frozenVal, 0, 0, r.id]
      );
      restored++;
    }
    // L'ancoratge: valor congelat, conserva el delta real i es desmarca
    await client.query(
      `UPDATE consums SET energia_total_wh = $1, interpolated_at = NULL WHERE id = $2`,
      [frozenVal, anchor.id]
    );
    restored++;

    // Fila final del tram (unmarked): neteja deltes negatius (el comptador era congelat)
    if (rec.rows.length) {
      const mid = await client.query(
        `SELECT id FROM consums
         WHERE device_id = $1 AND timestamp > $2 AND timestamp < $3 AND energia_total_wh = $4`,
        [deviceId, sorted[sorted.length - 1].timestamp, rec.rows[0].timestamp, frozenVal]
      );
      for (const m of mid.rows) {
        await client.query(
          `UPDATE consums SET energia_wh = 0, potencia_w = 0 WHERE id = $1`,
          [m.id]
        );
      }
      // El registre de recuperació recupera el salt complet
      const recovery = rec.rows[0];
      const recDelta = round(parseFloat(recovery.energia_total_wh) - frozenVal);
      const recHours = Math.abs(new Date(recovery.timestamp) - new Date(sorted[sorted.length - 1].timestamp)) / (1000 * 60 * 60);
      await client.query(
        `UPDATE consums SET energia_wh = $1, potencia_w = $2 WHERE id = $3`,
        [recDelta, recHours > 0 ? round(recDelta / recHours) : 0, recovery.id]
      );
    }

    logger.debug('Consums revertits', { deviceId, anchorTs: anchor.timestamp, frozenVal, restored: sorted.length });
  }

  return restored;
}

async function revertBalances(client) {
  const interp = await client.query(`
    SELECT b.id, b.user_id, b.generator_code, b.cups, b.timestamp, b.participation_pct,
           b.generator_total_cumulative_wh, b.generator_total_wh, b.allocated_wh, b.consumption_wh
    FROM balanc_energetic b
    WHERE b.interpolated_at IS NOT NULL
    ORDER BY b.user_id, b.generator_code, b.timestamp
  `);

  const consumMap = new Map();
  const consumResult = await client.query(`
    SELECT cups, timestamp, SUM(energia_wh) AS total
    FROM (
      SELECT DISTINCT ON (device_id, timestamp) device_id, cups, timestamp, energia_wh
      FROM consums WHERE dispositiu LIKE 'Shelly EM%'
      ORDER BY device_id, timestamp, id
    ) s GROUP BY cups, timestamp
  `);
  for (const row of consumResult.rows) {
    const key = `${row.cups}|${row.timestamp.toISOString().slice(0, 16)}`;
    consumMap.set(key, parseFloat(row.total));
  }

  const byGroup = new Map();
  for (const r of interp.rows) {
    const key = `${r.user_id}|${r.generator_code}`;
    if (!byGroup.has(key)) byGroup.set(key, []);
    byGroup.get(key).push(r);
  }

  let restored = 0;
  for (const [key, rows] of byGroup) {
    const [userId, generatorCode] = key.split('|');
    const scale = GENERATOR_SCALES[generatorCode] || 1;
    const sorted = rows.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    const anchor = sorted[0];
    const pct = parseFloat(anchor.participation_pct);

    // Valor congelat = valor acumulat de l'última lectura real anterior al tram.
    const prev = await client.query(
      `SELECT generator_total_cumulative_wh FROM balanc_energetic
       WHERE user_id = $1 AND generator_code = $2 AND timestamp < $3 AND interpolated_at IS NULL
       ORDER BY timestamp DESC LIMIT 1`,
      [userId, generatorCode, anchor.timestamp]
    );
    let frozenVal;
    if (prev.rows.length) {
      frozenVal = round(parseFloat(prev.rows[0].generator_total_cumulative_wh));
    } else {
      const step = sorted.length >= 2
        ? sorted[1].generator_total_cumulative_wh - sorted[0].generator_total_cumulative_wh
        : 0;
      frozenVal = round(parseFloat(anchor.generator_total_cumulative_wh) - step);
    }

    const rec = await client.query(
      `SELECT id, generator_total_cumulative_wh, timestamp FROM balanc_energetic
       WHERE user_id = $1 AND generator_code = $2 AND timestamp > $3
         AND generator_total_cumulative_wh > $4
       ORDER BY timestamp ASC LIMIT 1`,
      [userId, generatorCode, sorted[sorted.length - 1].timestamp, frozenVal]
    );

    const writeFrozen = (r, consumption) => client.query(
      `UPDATE balanc_energetic
       SET generator_total_cumulative_wh = $1, generator_total_wh = 0, allocated_wh = 0,
           consumption_wh = $2, balance_wh = $3, interpolated_at = NULL
       WHERE id = $4`,
      [frozenVal, consumption, round(-consumption), r.id]
    );

    // Restaura les files interpolades (excepte l'ancoratge)
    for (const r of sorted.slice(1)) {
      const consumption = consumMap.get(`${r.cups}|${r.timestamp.toISOString().slice(0, 16)}`) || 0;
      await writeFrozen(r, consumption);
      restored++;
    }
    // L'ancoratge: valor congelat, conserva el delta real
    const anchorCons = consumMap.get(`${anchor.cups}|${anchor.timestamp.toISOString().slice(0, 16)}`) || 0;
    await client.query(
      `UPDATE balanc_energetic
       SET generator_total_cumulative_wh = $1, interpolated_at = NULL
       WHERE id = $2`,
      [frozenVal, anchor.id]
    );
    restored++;

    // Fila final del tram (unmarked): neteja deltes/consums corruptes
    if (rec.rows.length) {
      const mid = await client.query(
        `SELECT id, cups, timestamp FROM balanc_energetic
         WHERE user_id = $1 AND generator_code = $2 AND timestamp > $3 AND timestamp < $4
           AND generator_total_cumulative_wh = $5`,
        [userId, generatorCode, sorted[sorted.length - 1].timestamp, rec.rows[0].timestamp, frozenVal]
      );
      for (const m of mid.rows) {
        const consumption = consumMap.get(`${m.cups}|${m.timestamp.toISOString().slice(0, 16)}`) || 0;
        await client.query(
          `UPDATE balanc_energetic
           SET generator_total_wh = 0, allocated_wh = 0,
               consumption_wh = $1, balance_wh = $2
           WHERE id = $3`,
          [consumption, round(-consumption), m.id]
        );
      }
      // El registre de recuperació recupera el salt complet
      const recovery = rec.rows[0];
      const recGen = round(Math.max(0, parseFloat(recovery.generator_total_cumulative_wh) - frozenVal));
      const recAlloc = round(recGen * (pct / 100));
      const recCons = consumMap.get(`${anchor.cups}|${recovery.timestamp.toISOString().slice(0, 16)}`) || 0;
      await client.query(
        `UPDATE balanc_energetic
         SET generator_total_wh = $1, allocated_wh = $2,
             consumption_wh = $3, balance_wh = $4
         WHERE id = $5`,
        [recGen, recAlloc, recCons, round(recAlloc * scale - recCons), recovery.id]
      );
    }

    logger.debug('Balanc revertit', { userId, generatorCode, anchorTs: anchor.timestamp, frozenVal, restored: sorted.length });
  }

  return restored;
}

async function main() {
  const client = await database.getClient();
  try {
    await client.query('BEGIN');
    logger.info('=== Revert d\'interpolació iniciat ===');

    const consums = await revertConsumptions(client);
    logger.info('Consums revertits', { restored: consums });

    const balances = await revertBalances(client);
    logger.info('Balanc revertit', { restored: balances });

    await client.query('COMMIT');
    logger.info('=== Revert completat. Re-executa el backfill per aplicar el model corregit. ===');
    return { consums, balances };
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('Revert fallat, transacció revertida', { error: err.message, stack: err.stack });
    throw err;
  } finally {
    client.release();
  }
}

if (require.main === module) {
  database.connect().then(() => {
    main().then(() => database.close()).catch(err => {
      logger.error('Revert fallat', { error: err.message, stack: err.stack });
      database.close();
      process.exit(1);
    });
  });
}

module.exports = { main, revertConsumptions, revertBalances };
