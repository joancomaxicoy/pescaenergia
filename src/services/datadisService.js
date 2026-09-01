// API privada de Datadis (endpoints confirmats):
// - Login:     POST https://datadis.es/nikola-auth/tokens/login  (x-www-form-urlencoded)
//              -> resposta: token en text pla (Bearer, validesa ~24h; en fem cache per seguretat)
// - Suministros: GET https://datadis.es/api-private/api/get-supplies
// - Dades:     GET https://datadis.es/api-private/api/get-consumption-data
//              params: cups, distributorCode, startDate=YYYY/MM, endDate=YYYY/MM,
//                      measurementType (0=horari,1=15min), pointType (opcional)
//              resposta: llista diària/horària (camps consumoKWh, surplusEnergyKWh,
//              generationEnergyKWh, selfConsumptionEnergyKWh, obtainMethod) o {timeCurve: [...]}
// - Restricció: les dates SOLO s'accepten en format mensual YYYY/MM (es filtra per dia a la resposta).
//
// Limitació coneguda: no es poden re-consultar les mateixes dades abans de 24 h.
// Per això les dades diàries es desen a la taula `datadis_cache` (per usuari, CUPS i dia):
// només es torna a consultar Datadis pels mesos que falten i mai abans de 24 h.
const DATADIS_BASE_URL = process.env.DATADIS_API_BASE_URL || 'https://datadis.es';

const TOKEN_TTL_MS = 5 * 60 * 60 * 1000;
const NO_DATA_MARKER = '__no_data__';
const COOLDOWN_HOURS = 24;
const tokenCache = new Map();

class DatadisError extends Error {
  constructor(code, message, httpStatus) {
    super(message);
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

function monthOf(dateStr) {
  return `${dateStr.slice(0, 4)}/${dateStr.slice(5, 7)}`;
}

function daysInMonthRange(month, from, to) {
  const [y, m] = month.split('/').map(Number);
  const first = `${y}-${String(m).padStart(2, '0')}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const last = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  const lo = from > first ? from : first;
  const hi = to < last ? to : last;
  const d0 = new Date(`${lo}T00:00:00`);
  const d1 = new Date(`${hi}T00:00:00`);
  return Math.max(0, Math.round((d1 - d0) / 86400000) + 1);
}

function monthsBetween(from, to) {
  const [fy, fm] = [Number(from.slice(0, 4)), Number(from.slice(5, 7))];
  const [ty, tm] = [Number(to.slice(0, 4)), Number(to.slice(5, 7))];
  const months = [];
  let [y, m] = [fy, fm];
  while (y < ty || (y === ty && m <= tm)) {
    months.push(`${y}/${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return months;
}

async function request(path, options = {}, timeoutMs = 120000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(`${DATADIS_BASE_URL}${path}`, {
      ...options,
      signal: controller.signal,
    });
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new DatadisError('servidor', 'Temps màxim superat: l\'API de Datadis triga massa a respondre');
    }
    throw new DatadisError('servidor', `Error de connexió amb Datadis: ${error.message}`);
  } finally {
    clearTimeout(timer);
  }
}

// === TOKEN ===
async function getToken(dni, password) {
  const cached = tokenCache.get(dni);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.token;
  }

  const response = await request('/nikola-auth/tokens/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams({ username: String(dni), password: String(password) }).toString(),
  }, 30000);

  const text = (await response.text()).trim();

  if (!response.ok || !text || text === 'null') {
    if (response.status === 400 || response.status === 401 || response.status === 403) {
      throw new DatadisError('credencials', 'Usuari (DNI/NIE) o clau de Datadis invàlids', response.status);
    }
    throw new DatadisError('servidor', `Error d\'autenticació amb Datadis (HTTP ${response.status})`, response.status);
  }

  let token = text.replace(/^"|"$/g, '');
  if (text.startsWith('{')) {
    try {
      token = JSON.parse(text).token || token;
    } catch (_) {
      // mantenim el text
    }
  }

  tokenCache.set(dni, { token, expiresAt: Date.now() + TOKEN_TTL_MS });
  return token;
}

async function authenticatedGet(dni, password, path, params) {
  const token = await getToken(dni, password);

  const qs = params && Object.keys(params).length > 0
    ? `?${new URLSearchParams(params).toString()}`
    : '';
  const response = await request(`${path}${qs}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  });

  if (response.status === 401) {
    tokenCache.delete(dni);
    throw new DatadisError('credencials', 'La sessió de Datadis ha caducat; torna-ho a provar', 401);
  }

  const text = await response.text();

  if (!response.ok) {
    if (response.status === 429 || /(24\s*h|repetida)/i.test(text)) {
      throw new DatadisError(
        'limit',
        'Datadis no permet tornar a consultar el mateix CUPS i període fins que no passen 24 hores.'
      );
    }
    if (response.status === 404) {
      throw new DatadisError('no_cups', 'El CUPS no s\'ha pogut localitzar a Datadis.', response.status);
    }
    throw new DatadisError('servidor', `Error de Datadis (HTTP ${response.status}): ${text.slice(0, 200)}`, response.status);
  }

  if (!text) return [];
  const json = JSON.parse(text);
  return json;
}

// === SUMINISTROS ===
async function getSupplies(dni, password) {
  const data = await authenticatedGet(dni, password, '/api-private/api/get-supplies', {});
  return Array.isArray(data) ? data : (data && data.supplies) || [];
}

// === DADES ===
function numberValue(row, keys) {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && row[key] !== '') {
      const n = Number(row[key]);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

function normalizeDate(value) {
  if (value === undefined || value === null || value === '') return null;
  return String(value).trim().split(/[\sT]/)[0].replace(/\//g, '-');
}

// Normalitza una data-hora (ex. '01/01/2025 01:00:00' o ISO) a 'YYYY-MM-DDTHH:mm:ss'.
function normalizeDateTime(value) {
  if (value === undefined || value === null || value === '') return null;
  const s = String(value).trim();
  const parts = s.split(/[\sT]+/);
  const datePart = parts[0];
  const timePart = parts[1] || '00:00:00';
  let y;
  let m;
  let d;
  if (datePart.includes('/')) {
    const [dd, mm, yyyy] = datePart.split('/');
    [y, m, d] = [yyyy, mm, dd];
  } else {
    [y, m, d] = datePart.split('-');
  }
  return `${y}-${m}-${d}T${timePart}`;
}

// Combina un camp de data (YYYY-MM-DD o YYYY/MM/DD) amb un d'hora (HH:mm o HH:mm:ss).
function combineDateTime(dateStr, timePart) {
  const tm = String(timePart || '').trim().split(':');
  const hh = (tm[0] || '00').padStart(2, '0');
  const mi = (tm[1] || '00').padStart(2, '0');
  const ss = (tm[2] || '00').padStart(2, '0');
  return `${dateStr}T${hh}:${mi}:${ss}`;
}

function normalizeRow(row) {
  return {
    date: normalizeDate(row.fecha || row.date || row.fechaDato),
    consumptionKwh: numberValue(row, ['consumoKWh', 'consumKwh', 'consumptionKWh', 'energia']),
    surplusKwh: numberValue(row, ['surplusEnergyKWh', 'excedenteKWh', 'excedentKWh', 'surplusKWh']),
    generationKwh: numberValue(row, ['generationEnergyKWh', 'generacionKWh', 'generationKWh']),
    selfConsumptionKwh: numberValue(row, ['selfConsumptionEnergyKWh', 'autoconsumoKWh', 'selfConsumptionKWh']),
    obtainMethod: row.obtainMethod || row.obtainMethodType || null,
  };
}

// Datadis retorna `date` ("YYYY/MM/DD") i `time` ("HH:mm") per separat en
// agrupació horària; en d'altres casos pot venir tot junt a `fecha`.
function normalizeHourlyRow(row) {
  const base = row.fecha || row.date || row.fechaDato;
  let datetime = null;
  if (base !== undefined && base !== null && base !== '') {
    const baseStr = String(base).trim();
    if (/\s/.test(baseStr) || baseStr.includes('T')) {
      datetime = normalizeDateTime(baseStr);
    } else if (/^\d{4}[\/-]\d{2}[\/-]\d{2}$/.test(baseStr)) {
      datetime = combineDateTime(normalizeDate(baseStr), row.time || row.hora);
    } else {
      datetime = normalizeDateTime(baseStr);
    }
  }
  return {
    datetime,
    date: datetime ? datetime.slice(0, 10) : null,
    consumptionKwh: numberValue(row, ['consumoKWh', 'consumKwh', 'consumptionKWh', 'energia']),
    surplusKwh: numberValue(row, ['surplusEnergyKWh', 'excedenteKWh', 'excedentKWh', 'surplusKWh']),
    generationKwh: numberValue(row, ['generationEnergyKWh', 'generacionKWh', 'generationKWh']),
    selfConsumptionKwh: numberValue(row, ['selfConsumptionEnergyKWh', 'autoconsumoKWh', 'selfConsumptionKWh']),
    obtainMethod: row.obtainMethod || row.obtainMethodType || null,
  };
}

// Filtra i ordena les fileres horàries dins de [from, to].
function aggregateHourly(rawRows, from, to) {
  return rawRows
    .map(normalizeHourlyRow)
    .filter((row) => row.datetime && row.date >= from && row.date <= to)
    .sort((a, b) => a.datetime.localeCompare(b.datetime));
}

// Agrega les fileres (diàries o horàries) per dia, dins de [from, to].
function aggregateDaily(rawRows, from, to) {
  const rowsByDate = new Map();

  for (const raw of rawRows) {
    const row = normalizeRow(raw);
    if (!row.date || row.date < from || row.date > to) continue;

    let acc = rowsByDate.get(row.date);
    if (!acc) {
      acc = {
        date: row.date,
        consumptionKwh: 0,
        surplusKwh: null,
        generationKwh: null,
        selfConsumptionKwh: null,
        obtainMethod: null,
        hasSurplus: false,
        hasGeneration: false,
        hasSelf: false,
      };
      rowsByDate.set(row.date, acc);
    }

    acc.consumptionKwh += row.consumptionKwh ?? 0;
    if (row.surplusKwh !== null) { acc.hasSurplus = true; acc.surplusKwh = (acc.surplusKwh ?? 0) + row.surplusKwh; }
    if (row.generationKwh !== null) { acc.hasGeneration = true; acc.generationKwh = (acc.generationKwh ?? 0) + row.generationKwh; }
    if (row.selfConsumptionKwh !== null) { acc.hasSelf = true; acc.selfConsumptionKwh = (acc.selfConsumptionKwh ?? 0) + row.selfConsumptionKwh; }
    if (row.obtainMethod && row.obtainMethod !== 'Estimate') {
      acc.obtainMethod = row.obtainMethod;
    }
  }

  return [...rowsByDate.values()]
    .map(({ hasSurplus, hasGeneration, hasSelf, ...row }) => ({
      ...row,
      surplusKwh: hasSurplus ? row.surplusKwh : null,
      generationKwh: hasGeneration ? row.generationKwh : null,
      selfConsumptionKwh: hasSelf ? row.selfConsumptionKwh : null,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

// === CACHE (taula datadis_cache) ===
async function saveDailyRows(pool, userId, cups, rows, fetchedAt = new Date()) {
  const insert = `
    INSERT INTO datadis_cache
      (user_id, cups, date, consumption_kwh, surplus_kwh, generation_kwh, self_consumption_kwh, obtain_method, fetched_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    ON CONFLICT (user_id, date) DO UPDATE SET
      cups = EXCLUDED.cups,
      consumption_kwh = EXCLUDED.consumption_kwh,
      surplus_kwh = EXCLUDED.surplus_kwh,
      generation_kwh = EXCLUDED.generation_kwh,
      self_consumption_kwh = EXCLUDED.self_consumption_kwh,
      obtain_method = EXCLUDED.obtain_method,
      fetched_at = EXCLUDED.fetched_at
  `;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const row of rows) {
      await client.query(insert, [
        userId,
        cups,
        row.date,
        row.consumptionKwh,
        row.surplusKwh,
        row.generationKwh,
        row.selfConsumptionKwh,
        row.obtainMethod,
        fetchedAt,
      ]);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function loadDailyRows(pool, userId, from, to) {
  const { rows } = await pool.query(
    `SELECT date::text AS date,
            consumption_kwh AS "consumptionKwh",
            surplus_kwh AS "surplusKwh",
            generation_kwh AS "generationKwh",
            self_consumption_kwh AS "selfConsumptionKwh",
            obtain_method AS "obtainMethod"
     FROM datadis_cache
     WHERE user_id = $1 AND date BETWEEN $2::date AND $3::date
     ORDER BY date`,
    [userId, from, to]
  );
  return rows.filter((row) => row.obtainMethod !== NO_DATA_MARKER);
}

// === CACHE HORÀRIA (taula datadis_cache_hourly) ===
async function saveHourlyRows(pool, userId, cups, rows, fetchedAt = new Date()) {
  const insert = `
    INSERT INTO datadis_cache_hourly
      (user_id, cups, timestamp, consumption_kwh, surplus_kwh, generation_kwh, self_consumption_kwh, obtain_method, fetched_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    ON CONFLICT (user_id, timestamp) DO UPDATE SET
      cups = EXCLUDED.cups,
      consumption_kwh = EXCLUDED.consumption_kwh,
      surplus_kwh = EXCLUDED.surplus_kwh,
      generation_kwh = EXCLUDED.generation_kwh,
      self_consumption_kwh = EXCLUDED.self_consumption_kwh,
      obtain_method = EXCLUDED.obtain_method,
      fetched_at = EXCLUDED.fetched_at
  `;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const row of rows) {
      if (!row.datetime) continue;
      await client.query(insert, [
        userId,
        cups,
        row.datetime,
        row.consumptionKwh,
        row.surplusKwh,
        row.generationKwh,
        row.selfConsumptionKwh,
        row.obtainMethod,
        fetchedAt,
      ]);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function loadHourlyRows(pool, userId, from, to) {
  const { rows } = await pool.query(
    `SELECT to_char(timestamp, 'YYYY-MM-DD"T"HH24:MI:SS') AS datetime,
            to_char(timestamp, 'YYYY-MM-DD') AS date,
            consumption_kwh AS "consumptionKwh",
            surplus_kwh AS "surplusKwh",
            generation_kwh AS "generationKwh",
            self_consumption_kwh AS "selfConsumptionKwh",
            obtain_method AS "obtainMethod"
     FROM datadis_cache_hourly
     WHERE user_id = $1 AND timestamp::date BETWEEN $2::date AND $3::date
     ORDER BY timestamp`,
    [userId, from, to]
  );
  return rows.filter((row) => row.obtainMethod !== NO_DATA_MARKER);
}

/**
 * Consulta les dades de consum/generació d'un soci a Datadis per un període,
 * usant la cache sempre que sigui possible per respectar el límit de 24 h.
 *
 * @param {object} opts
 * @param {string} opts.userId
 * @param {string} opts.dni
 * @param {string} opts.password
 * @param {string} opts.cups
 * @param {string} opts.from  'YYYY-MM-DD'
 * @param {string} opts.to    'YYYY-MM-DD'
 * @param {string} [opts.granularity] 'daily' (per defecte) o 'hourly'
 * @param {object} opts.pool
 */
async function getSociConsumption({ userId, dni, password, cups, from, to, granularity = 'daily', pool }) {
  const hourlyMode = granularity === 'hourly' || granularity === 'hourly24';

  const supplies = await getSupplies(dni, password);

  const supply = supplies.find(
    (s) => String(s.cups || '').toUpperCase() === String(cups).toUpperCase()
  );

  if (!supply) {
    throw new DatadisError(
      'no_cups',
      `El CUPS ${cups} no es troba entre els subministraments d'aquest soci a Datadis`
    );
  }

  const distributorCode = supply.distributorCode !== undefined ? supply.distributorCode : '';
  const pointType = supply.pointType !== undefined ? supply.pointType : '';

  // Quins mesos cobreix la finestra demanada i quants dies n'hem de tenir.
  const months = monthsBetween(from, to);
  const expectedPerMonth = new Map(
    months.map((month) => [month, daysInMonthRange(month, from, to)])
  );

  // Què tenim ja en cache (dies amb dades reals per mes, excloent marcadors de buit,
  // i si algú es va consultar fa < 24 h). Els marcadors no compten com a cobertura:
  // un mes amb només marcadors ha de tornar-se a consultar quan passi el cooldown.
  const coverageTable = hourlyMode ? 'datadis_cache_hourly' : 'datadis_cache';
  const coverageColumn = hourlyMode ? 'timestamp' : 'date';
  const { rows: coverage } = await pool.query(
    `SELECT to_char(${coverageColumn}, 'YYYY/MM') AS m,
            count(DISTINCT ${coverageColumn}::date) FILTER (WHERE obtain_method <> $5)::int AS c,
            bool_or(fetched_at > NOW() - make_interval(hours => ${COOLDOWN_HOURS})) AS recent
     FROM ${coverageTable}
     WHERE user_id = $1 AND cups = $2 AND ${coverageColumn}::date BETWEEN $3::date AND $4::date
     GROUP BY 1`,
    [userId, cups, from, to, NO_DATA_MARKER]
  );
  const coverageByMonth = new Map(coverage.map((row) => [row.m, { count: +row.c, recent: row.recent }]));

  const missingMonths = months.filter(
    (month) => (coverageByMonth.get(month)?.count || 0) < expectedPerMonth.get(month)
  );

  // Podem tornar a consultar Datadis? (no si algun mes que falta es va consultar fa < 24 h)
  const canFetch = missingMonths.length > 0 &&
    !missingMonths.some((month) => coverageByMonth.get(month)?.recent === true);

  // Si Datadis rebutja la consulta (429 / 24 h) ho marquem per no tornar-la a picotejar
  // fins que passi el cooldown.
  let refetchBlocked = false;

  if (canFetch) {
    try {
      const raw = await authenticatedGet(dni, password, '/api-private/api/get-consumption-data', {
        cups: String(cups),
        distributorCode: String(distributorCode),
        measurementType: '0',
        pointType: String(pointType),
        startDate: monthOf(from),
        endDate: monthOf(to),
      });

      const rawRows = Array.isArray(raw) ? raw : (raw && raw.timeCurve) || [];
      // Omplim la cache de tot el rang mensual consultat (no només la finestra).
      const firstOfFrom = `${monthOf(from).replace('/', '-')}-01`;
      const [fy, fm] = monthOf(to).split('/').map(Number);
      const lastDayOfTo = new Date(fy, fm, 0).getDate();
      const lastOfTo = `${fy}-${String(fm).padStart(2, '0')}-${String(lastDayOfTo).padStart(2, '0')}`;

      const daily = aggregateDaily(rawRows, firstOfFrom, lastOfTo);
      await saveDailyRows(pool, userId, cups, daily);

      // Guardem també les fileres horàries per poder consultar amb agrupació horària.
      const hourly = aggregateHourly(rawRows, firstOfFrom, lastOfTo);
      await saveHourlyRows(pool, userId, cups, hourly);

      // Per als mesos de la finestra sense cap dada, marquem-ho per no re-consultar-los.
      const { rows: afterSave } = await pool.query(
        `SELECT DISTINCT to_char(date, 'YYYY/MM') AS m
         FROM datadis_cache
         WHERE user_id = $1 AND cups = $2 AND date BETWEEN $3::date AND $4::date`,
        [userId, cups, firstOfFrom, lastOfTo]
      );
      const monthsWithRows = new Set(afterSave.map((row) => row.m));
      const emptyMonths = months.filter(
        (month) => !monthsWithRows.has(month)
      );
      if (emptyMonths.length > 0) {
        const markers = emptyMonths.map((month) => ({
          date: `${month.replace('/', '-')}-01`,
          consumptionKwh: null,
          surplusKwh: null,
          generationKwh: null,
          selfConsumptionKwh: null,
          obtainMethod: NO_DATA_MARKER,
        }));
        await saveDailyRows(pool, userId, cups, markers);

        const hourlyMarkers = emptyMonths.map((month) => ({
          datetime: `${month.replace('/', '-')}-01T00:00:00`,
          consumptionKwh: null,
          surplusKwh: null,
          generationKwh: null,
          selfConsumptionKwh: null,
          obtainMethod: NO_DATA_MARKER,
        }));
        await saveHourlyRows(pool, userId, cups, hourlyMarkers);
      }
    } catch (error) {
      // Si Datadis bloqueja per 24 h tenim cache per servir; si no, marquem els mesos
      // pendents per no re-picotejar l'API i avisem clarament al final.
      if (error && error.code === 'limit') {
        const existing = hourlyMode
          ? await loadHourlyRows(pool, userId, from, to)
          : await loadDailyRows(pool, userId, from, to);
        if (!existing.length) {
          const markers = missingMonths.map((month) => {
            const stamp = `${month.replace('/', '-')}-01`;
            return hourlyMode
              ? { datetime: `${stamp}T00:00:00`, consumptionKwh: null, surplusKwh: null, generationKwh: null, selfConsumptionKwh: null, obtainMethod: NO_DATA_MARKER }
              : { date: stamp, consumptionKwh: null, surplusKwh: null, generationKwh: null, selfConsumptionKwh: null, obtainMethod: NO_DATA_MARKER };
          });
          if (markers.length > 0) {
            if (hourlyMode) await saveHourlyRows(pool, userId, cups, markers);
            else await saveDailyRows(pool, userId, cups, markers);
            refetchBlocked = true;
          }
        }
      } else {
        throw error;
      }
    }
  }

  const rows = hourlyMode
    ? await loadHourlyRows(pool, userId, from, to)
    : await loadDailyRows(pool, userId, from, to);

  // Cooldown de 24 h a Datadis: si no hem pogut consultar i no tenim res per servir,
  // avisem clarament (tant si l'hem rebutjat en aquesta petició com en una anterior).
  const hasRecentBlock = months.some((month) => coverageByMonth.get(month)?.recent === true);
  if (refetchBlocked || (rows.length === 0 && hasRecentBlock)) {
    throw new DatadisError(
      'limit',
      hourlyMode
        ? `Datadis no permet tornar a descarregar la corba horària d'aquest període fins que no passin ${COOLDOWN_HOURS} hores des de l'última consulta. Torna-ho a provar demà; quan es pugui consultar, l'agrupació horària es desarà automàticament.`
        : `Aquest període ja es va consultar fa menys de ${COOLDOWN_HOURS} hores a Datadis; torna a provar-ho més tard.`
    );
  }

  const sum = (key) => rows.reduce((acc, row) => acc + (row[key] ?? 0), 0);
  const anyValue = (key) => rows.some((row) => row[key] !== null);

  // Sèrie per als gràfics: un punt per dia (o per hora) amb el consum desglossat
  // entre energia de xarxa (importada) i solar aprofitada (autoconsum directe).
  const chart = rows.map((row) => {
    const consumption = Math.max(0, row.consumptionKwh ?? 0);
    const self = Math.min(consumption, Math.max(0, row.selfConsumptionKwh ?? 0));
    return {
      date: row.date,
      datetime: hourlyMode ? row.datetime : null,
      consumption: Math.round(consumption * 1000) / 1000,
      self: Math.round(self * 1000) / 1000,
      grid: Math.round((consumption - self) * 1000) / 1000,
    };
  });

  return {
    cups: String(cups).toUpperCase(),
    distributor: supply.distributor || null,
    distributorCode: String(distributorCode),
    pointType: String(pointType),
    from,
    to,
    granularity: hourlyMode ? 'hourly' : 'daily',
    rows,
    chart,
    totals: {
      consumptionKwh: sum('consumptionKwh'),
      surplusKwh: anyValue('surplusKwh') ? sum('surplusKwh') : null,
      generationKwh: anyValue('generationKwh') ? sum('generationKwh') : null,
      selfConsumptionKwh: anyValue('selfConsumptionKwh') ? sum('selfConsumptionKwh') : null,
    },
  };
}

module.exports = {
  DatadisError,
  getSociConsumption,
  getSupplies,
  monthOf,
};