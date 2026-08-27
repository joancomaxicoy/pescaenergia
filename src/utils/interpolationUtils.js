const logger = require('./logger');

const TIMEZONE = process.env.USERS_TIMEZONE || 'Europe/Madrid';

// Finestra horària (hora local) on es considera "hora de sol".
// Els trams nocturns congelats són normals (no hi ha generació), per això
// només interpolem trams que toquen aquesta finestra.
const DAY_START_HOUR = 7;
const DAY_END_HOUR = 21;

// Llindar mínim de salt del comptador per considerar que hi ha hagut pèrdua
// de dades. Els salts nocturns típics (< 5 Wh) no es toquen.
const MIN_JUMP_WH = 5;

// Nombre mínim de registres congelats consecutius per considerar-ho un tram perdut.
// Un valor massa baix detecta falsos positius (duplicats o arrodoniments).
const MIN_PLATEAU_RECORDS = 4;

/**
 * Agrupa les files per timestamp conservant l'ordre cronològic.
 * Les files duplicades (mateix timestamp) no han de crear falsos plateaus.
 */
function groupByTimestamp(rows) {
  const byTs = new Map();
  for (const r of rows) {
    const key = new Date(r.timestamp).getTime();
    if (!byTs.has(key)) byTs.set(key, []);
    byTs.get(key).push(r);
  }
  return byTs;
}

/**
 * Retorna l'hora local (0-23) d'una data a la timezone configurada.
 */
function getLocalHour(date) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TIMEZONE, hour: '2-digit', hour12: false,
  }).formatToParts(date);
  const hour = parseInt(parts.find(p => p.type === 'hour').value, 10) % 24;
  return hour;
}

/**
 * Retorna els minuts locals des de mitjanit (0-1439) d'una data.
 */
function getLocalMinutes(date) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TIMEZONE, hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(date);
  const hour = parseInt(parts.find(p => p.type === 'hour').value, 10) % 24;
  const minute = parseInt(parts.find(p => p.type === 'minute').value, 10);
  return hour * 60 + minute;
}

/**
 * Calcula la finestra de producció (hora local en minuts) a partir dels
 * intervals amb generació positiva (generator_total_wh > 0) de dies nets.
 * Opció 3: la producció solar real només passa entre el primer i l'últim
 * interval amb generació; la nit queda plana a 0.
 *
 * @param {Array} rows - files de BD amb { timestamp, generator_total_wh }
 * @returns {{start: number, end: number}|null} finestra [inici, fi] en minuts locals
 */
function computeDaylightWindow(rows) {
  let start = null;
  let end = null;
  for (const r of rows) {
    const v = parseFloat(r.generator_total_wh);
    if (!Number.isFinite(v) || v <= 0) continue;
    const t = getLocalMinutes(new Date(r.timestamp));
    if (start === null || t < start) start = t;
    if (end === null || t > end) end = t;
  }
  return start !== null && end !== null ? { start, end } : null;
}

/**
 * Indica si un timestamp cau dins la finestra de sol empírica (hora local).
 * Sense finestra, tots els intervals es consideren vàlids (uniforme).
 */
function isWithinDaylight(date, daylightWindow) {
  if (!daylightWindow) return true;
  const t = getLocalMinutes(new Date(date));
  return t >= daylightWindow.start && t <= daylightWindow.end;
}

/**
 * Detecta si un tram de registres congelats és majoritàriament en hores de sol.
 * Els trams nocturns (sense generació / consum ~0) són normals: un tram perdut
 * de veritat només passa mentre el sol és actiu, per tant exigeixo que la
 * majoria dels registres congelats caiguin dins la finestra diürna.
 */
function isDaytimePlateau(records) {
  if (!records.length) return false;
  let dayCount = 0;
  for (const r of records) {
    const hour = getLocalHour(new Date(r.timestamp));
    if (hour >= DAY_START_HOUR && hour < DAY_END_HOUR) dayCount++;
  }
  return dayCount / records.length >= 0.5;
}

/**
 * Detecta trams de registres congelats (mateix valor acumulat consecutiu)
 * seguits d'un salt del comptador, que indiquen pèrdua de dades.
 *
 * @param {Array<{timestamp: Date|string, value: number}>} records - ordenats asc per timestamp
 * @returns {Array<{startIdx, endIdx, jumpIdx, startVal, endVal}>} trams detectats
 */
function detectPlateaus(records) {
  const plateaus = [];
  let i = 0;

  while (i < records.length) {
    let j = i;
    while (j < records.length && records[j].value === records[i].value) {
      j++;
    }
    const plateauLen = j - i;
    // Cal que hi hagi un registre posterior (el salt) i prou longitud
    if (plateauLen >= MIN_PLATEAU_RECORDS && j < records.length) {
      const startVal = records[i].value;
      const endVal = records[j].value;
      const jump = endVal - startVal;
      const plateauRecords = records.slice(i, j);

      // Només interpolar salts positius en trams diürns: un tram nocturn
      // congelat seguit d'un salt petit és el comportament normal del comptador.
      if (jump >= MIN_JUMP_WH && isDaytimePlateau(plateauRecords)) {
        plateaus.push({
          startIdx: i,
          endIdx: j - 1,
          jumpIdx: j,
          startVal,
          endVal,
          jump,
          plateauLen,
        });
      }
    }
    i = j;
  }

  return plateaus;
}

/**
 * Interpola els valors acumulats d'un tram detectat.
 * Reparteix el salt (endVal - startVal) entre els intervals perduts,
 * fent que el darrer valor interpolat quadri amb el valor recuperat.
 *
 * Si es passa una finestra de sol empírica (daylightWindow), el salt només
 * es reparteix entre els intervals diürns: la nit es queda plana al nivell
 * assolit (curva monòtona, sense deltes negatius). Sense finestra, es
 * reparteix entre tots els intervals (comportament uniforme, per a consum).
 *
 * @param {Array<{timestamp: Date|string, value: number}>} records
 * @param {Object} plateau - tram detectat per detectPlateaus
 * @param {{start: number, end: number}|null} daylightWindow - minuts locals
 * @returns {Array<number>} nous valors interpolats (un per registre del tram)
 */
function interpolatePlateau(records, plateau, daylightWindow) {
  const { startIdx, endIdx, jumpIdx, startVal, endVal } = plateau;
  // Nombre d'intervals de 15 min entre l'inici del tram i el valor recuperat.
  // El salt es reparteix entre aquests intervals.
  const startTime = new Date(records[startIdx].timestamp).getTime();
  const jumpTime = new Date(records[jumpIdx].timestamp).getTime();
  const intervalMs = 15 * 60 * 1000;
  const intervals = Math.max(1, Math.round((jumpTime - startTime) / intervalMs));

  // Amb finestra de sol només compten els intervals diürns (inclòs el de recuperació)
  let dayCount = intervals;
  if (daylightWindow) {
    dayCount = 0;
    for (let idx = startIdx + 1; idx <= jumpIdx; idx++) {
      if (isWithinDaylight(records[idx].timestamp, daylightWindow)) dayCount++;
    }
    if (dayCount <= 0) dayCount = 1;
  }

  const step = (endVal - startVal) / dayCount;
  const interpolated = [];

  // El primer registre del tram (startIdx) és una lectura real i es conserva:
  // només s'interpola a partir del segon. El registre de recuperació (jumpIdx)
  // manté el valor real i absorbeix l'últim step (cap pic artificial).
  let k = 0;
  for (let idx = startIdx + 1; idx <= endIdx; idx++) {
    if (isWithinDaylight(records[idx].timestamp, daylightWindow)) k++;
    const value = startVal + step * k;
    interpolated.push(Math.round(value * 100) / 100);
  }

  return interpolated;
}

/**
 * Aplica la interpolació a una sèrie de registres, retornant els registres
 * amb els valors corregits (còpia). No modifica la BD.
 *
 * @param {Array<{timestamp: Date|string, value: number}>} records - ordenats asc
 * @param {{daylightWindow?: {start: number, end: number}}} opts - finestra de sol empírica
 * @returns {{records: Array, corrections: Array}} registres corregits + detall
 */
function interpolateSeries(records, opts = {}) {
  if (!records || records.length < MIN_PLATEAU_RECORDS + 2) {
    return { records: records || [], corrections: [] };
  }

  const sorted = [...records].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  const plateaus = detectPlateaus(sorted);
  const corrections = [];

  for (const plateau of plateaus) {
    const values = interpolatePlateau(sorted, plateau, opts.daylightWindow || null);
    // interpolatePlateau retorna valors per a startIdx+1..endIdx (el primer
    // registre del tram és una lectura real i es conserva), per tant s'assignen
    // des de startIdx+1.
    for (let i = 0; i < values.length; i++) {
      const idx = plateau.startIdx + 1 + i;
      sorted[idx] = {
        ...sorted[idx],
        value: values[i],
        interpolated: true,
      };
    }
    corrections.push({
      startTs: new Date(sorted[plateau.startIdx].timestamp).toISOString(),
      endTs: new Date(sorted[plateau.endIdx].timestamp).toISOString(),
      startIdx: plateau.startIdx,
      endIdx: plateau.endIdx,
      jumpIdx: plateau.jumpIdx,
      records: plateau.plateauLen,
      jump: plateau.jump,
      startVal: plateau.startVal,
      endVal: plateau.endVal,
    });
  }

  return { records: sorted, corrections };
}

/**
 * Corregeix una sèrie de registres de consum (energia_total_wh), recalculant
 * els deltes (energia_wh) i la potència (potencia_w = energia_wh / hores).
 * La potència NO s'interpola: es deriva dels deltes interpolats.
 *
 * @param {Array} rows - files de BD amb { timestamp, energia_total_wh }
 * @returns {{rows: Array, corrections: Array}} files corregides + detall
 */
function interpolateConsumptionRows(rows) {
  if (!rows || rows.length < MIN_PLATEAU_RECORDS + 2) {
    return { rows: rows || [], corrections: [] };
  }

  const sorted = [...rows].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  // Dedupe per timestamp: les files duplicades creen falsos plateaus.
  const byTs = groupByTimestamp(sorted);
  const uniqueKeys = [...byTs.keys()];
  const uniqueRows = uniqueKeys.map(k => byTs.get(k)[0]);
  const uniqueIdxByKey = new Map();
  uniqueKeys.forEach((k, i) => uniqueIdxByKey.set(k, i));

  const series = uniqueRows.map(r => ({
    timestamp: r.timestamp,
    value: parseFloat(r.energia_total_wh),
  }));
  const { records, corrections } = interpolateSeries(series);

  // Valors acumulats corregits per timestamp únic (els no interpolats mantenen el valor real)
  const correctedValues = records.map((rec, i) =>
    rec.interpolated ? rec.value : parseFloat(uniqueRows[i].energia_total_wh)
  );

  // Només es recalcula el delta de les files interpolades i la de recuperació
  // (post-tram); la resta del registre es deixa intacte.
  const affectedIdx = new Set();
  for (const c of corrections) {
    for (let idx = c.startIdx + 1; idx <= c.jumpIdx; idx++) affectedIdx.add(idx);
  }

  const originalDelta = new Map(sorted.map(r => [r, parseFloat(r.energia_wh || 0)]));

  for (let i = 0; i < sorted.length; i++) {
    const row = sorted[i];
    const key = new Date(row.timestamp).getTime();
    const uniqueIdx = uniqueIdxByKey.get(key);
    const rec = records[uniqueIdx];
    const value = correctedValues[uniqueIdx];

    row.changed = rec.interpolated || false;
    row.interpolated = rec.interpolated || false;

    // El registre de recuperació (post-tram) no s'interpola el comptador,
    // però el seu delta s'ha de recalcular per absorbir el residual.
    if (rec.interpolated) {
      row.energia_total_wh = value;
    }

    if (uniqueIdx > 0 && affectedIdx.has(uniqueIdx)) {
      const prev = correctedValues[uniqueIdx - 1];
      const newDelta = Math.round((value - prev) * 100) / 100;

      if (Math.abs(newDelta - originalDelta.get(row)) > 1e-9) {
        row.energia_wh = newDelta;
        row.changed = true;
      }

      // Recalcular la potència a partir del delta i les hores reals transcorregudes.
      // Mai s'interpola la potència: només es deriva del delta corregit.
      if (row.changed) {
        const hoursElapsed = Math.abs(key - uniqueKeys[uniqueIdx - 1]) / (1000 * 60 * 60);
        row.potencia_w = hoursElapsed > 0
          ? Math.round((row.energia_wh / hoursElapsed) * 100) / 100
          : 0;
      }
    }
  }

  return { rows: sorted, corrections };
}

/**
 * Corregeix una sèrie de registres de balanç energètic (generator_total_cumulative_wh),
 * recalculant els deltes (generator_total_wh) i les derivades (allocated_wh, balance_wh).
 *
 * @param {Array} rows - files de BD amb { timestamp, generator_total_cumulative_wh, participation_pct }
 * @param {number} scale - escala del generador (giravolt=100, etc.)
 * @param {{start: number, end: number}|null} daylightWindow - finestra de sol empírica (minuts locals)
 * @returns {{rows: Array, corrections: Array}} files corregides + detall
 */
function interpolateBalanceRows(rows, scale = 1, daylightWindow = null) {
  if (!rows || rows.length < MIN_PLATEAU_RECORDS + 2) {
    return { rows: rows || [], corrections: [] };
  }

  const sorted = [...rows].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  // Dedupe per timestamp: les files duplicades creen falsos plateaus.
  const byTs = groupByTimestamp(sorted);
  const uniqueKeys = [...byTs.keys()];
  const uniqueRows = uniqueKeys.map(k => byTs.get(k)[0]);
  const uniqueIdxByKey = new Map();
  uniqueKeys.forEach((k, i) => uniqueIdxByKey.set(k, i));

  const series = uniqueRows.map(r => ({
    timestamp: r.timestamp,
    value: parseFloat(r.generator_total_cumulative_wh),
  }));
  const { records, corrections } = interpolateSeries(series, { daylightWindow });

  const correctedValues = records.map((rec, i) =>
    rec.interpolated ? rec.value : parseFloat(uniqueRows[i].generator_total_cumulative_wh)
  );

  const affectedIdx = new Set();
  for (const c of corrections) {
    for (let idx = c.startIdx + 1; idx <= c.jumpIdx; idx++) affectedIdx.add(idx);
  }

  const originalDelta = new Map(sorted.map(r => [r, parseFloat(r.generator_total_wh || 0)]));

  for (let i = 0; i < sorted.length; i++) {
    const row = sorted[i];
    const key = new Date(row.timestamp).getTime();
    const uniqueIdx = uniqueIdxByKey.get(key);
    const rec = records[uniqueIdx];
    const value = correctedValues[uniqueIdx];

    row.changed = rec.interpolated || false;
    row.interpolated = rec.interpolated || false;

    if (rec.interpolated) {
      row.generator_total_cumulative_wh = value;
    }

    if (uniqueIdx > 0 && affectedIdx.has(uniqueIdx)) {
      const prev = correctedValues[uniqueIdx - 1];
      const delta = Math.max(0, Math.round((value - prev) * 100) / 100);

      if (Math.abs(delta - originalDelta.get(row)) > 1e-9) {
        row.generator_total_wh = delta;
        row.allocated_wh = Math.round(delta * (parseFloat(row.participation_pct) / 100) * 100) / 100;
        row.balance_wh = Math.round((row.allocated_wh * scale - parseFloat(row.consumption_wh || 0)) * 100) / 100;
        row.changed = true;
      }
    }
  }

  return { rows: sorted, corrections };
}

module.exports = {
  detectPlateaus,
  interpolatePlateau,
  interpolateSeries,
  interpolateConsumptionRows,
  interpolateBalanceRows,
  computeDaylightWindow,
  isWithinDaylight,
  getLocalHour,
  getLocalMinutes,
  isDaytimePlateau,
  groupByTimestamp,
  DAY_START_HOUR,
  DAY_END_HOUR,
  MIN_JUMP_WH,
  MIN_PLATEAU_RECORDS,
};
