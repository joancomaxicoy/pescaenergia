const {
  detectPlateaus,
  interpolateSeries,
  interpolateConsumptionRows,
  interpolateBalanceRows,
  computeDaylightWindow,
  groupByTimestamp,
} = require('../interpolationUtils');

// Timestamp UTC en agost: a Europa/Madrid (CEST, UTC+2) 08:00Z..14:00Z
// cauen a les 10:00..16:00 local → dins la finestra diürna [07:00, 21:00).
const ts = (h, m = 0) => new Date(Date.UTC(2026, 7, 10, h, m));

// Exemple de l'usuari: 08:00=10000 (lectura real) → 14:00=15000 (recuperació),
// 23 registres congelats entremig (08:15..13:45).
function buildUserExample() {
  const records = [];
  for (let i = 0; i < 24; i++) {
    records.push({ timestamp: ts(8, i * 15), value: 10000 });
  }
  records.push({ timestamp: ts(14, 0), value: 15000 });
  return records;
}

describe('detectPlateaus', () => {
  test('detects a daytime frozen plateau followed by a jump', () => {
    const plateaus = detectPlateaus(buildUserExample());
    expect(plateaus).toHaveLength(1);
    expect(plateaus[0].startVal).toBe(10000);
    expect(plateaus[0].endVal).toBe(15000);
    expect(plateaus[0].jump).toBe(5000);
    expect(plateaus[0].startIdx).toBe(0);
    expect(plateaus[0].endIdx).toBe(23);
    expect(plateaus[0].jumpIdx).toBe(24);
    expect(plateaus[0].plateauLen).toBe(24);
  });

  test('ignores plateaus shorter than MIN_PLATEAU_RECORDS', () => {
    const records = [
      { timestamp: ts(8), value: 10000 },
      { timestamp: ts(8, 15), value: 10000 },
      { timestamp: ts(8, 30), value: 10000 },
      { timestamp: ts(8, 45), value: 20000 },
    ];
    expect(detectPlateaus(records)).toHaveLength(0);
  });

  test('ignores jumps below MIN_JUMP_WH', () => {
    const records = [
      { timestamp: ts(8, 0), value: 10000 },
      { timestamp: ts(8, 15), value: 10000 },
      { timestamp: ts(8, 30), value: 10000 },
      { timestamp: ts(8, 45), value: 10000 },
      { timestamp: ts(9, 0), value: 10002 },
    ];
    expect(detectPlateaus(records)).toHaveLength(0);
  });

  test('ignores nocturnal plateaus', () => {
    const records = [];
    for (let i = 0; i < 12; i++) {
      records.push({ timestamp: ts(23, i * 15), value: 10000 });
    }
    records.push({ timestamp: ts(2, 0), value: 20000 });
    expect(detectPlateaus(records)).toHaveLength(0);
  });
});

describe('interpolateSeries', () => {
  test('preserves the anchor and interpolates with constant step', () => {
    const { records, corrections } = interpolateSeries(buildUserExample());
    expect(corrections).toHaveLength(1);

    // Ancoratge: lectura real conservada, sense pic artificial
    expect(records[0].value).toBe(10000);
    expect(records[0].interpolated).toBeUndefined();

    // Interpolació lineal: 23 registres (08:15..13:45) amb pas constant
    const step = 5000 / 24;
    for (let i = 1; i <= 23; i++) {
      expect(records[i].value).toBeCloseTo(10000 + step * i, 2);
      expect(records[i].interpolated).toBe(true);
    }

    // Recuperació: valor real, absorbeix l'últim pas (sense pic)
    expect(records[24].value).toBe(15000);
    expect(records[24].interpolated).toBeUndefined();

    // Conservació: el darrer valor interpolat + el pas de recuperació quadren
    const lastInterp = 10000 + step * 23;
    expect(records[24].value - lastInterp).toBeCloseTo(step, 2);
  });
});

describe('interpolateConsumptionRows', () => {
  test('recomputes deltas and power only for affected rows', () => {
    const rows = [];
    rows.push({ timestamp: ts(7, 45), energia_total_wh: 9900, energia_wh: 100, potencia_w: 400 });
    for (let i = 0; i < 24; i++) {
      rows.push({ timestamp: ts(8, i * 15), energia_total_wh: 10000, energia_wh: 0, potencia_w: 0 });
    }
    rows.push({ timestamp: ts(14, 0), energia_total_wh: 15000, energia_wh: 0, potencia_w: 0 });
    rows.push({ timestamp: ts(14, 15), energia_total_wh: 15050, energia_wh: 50, potencia_w: 200 });

    const { rows: out, corrections } = interpolateConsumptionRows(rows);
    expect(corrections).toHaveLength(1);

    // Ancoratge (08:00): no es toca ni valor ni delta
    expect(out[1].energia_total_wh).toBe(10000);
    expect(out[1].energia_wh).toBe(0);

    // Primer registre interpolat (08:15): delta = pas
    const step = 5000 / 24;
    expect(out[2].energia_total_wh).toBeCloseTo(10000 + step, 2);
    expect(out[2].energia_wh).toBeCloseTo(step, 2);
    expect(out[2].potencia_w).toBeGreaterThan(0);

    // Recuperació (14:00): valor real conservat, delta = últim pas
    const rec = out[25];
    expect(rec.energia_total_wh).toBe(15000);
    expect(rec.energia_wh).toBeCloseTo(step, 1);
    expect(rec.energia_wh).toBeGreaterThan(0);

    // Darrer registre real (14:15): intacte
    expect(out[26].energia_wh).toBe(50);
  });

  test('deduplicates rows with the same timestamp', () => {
    const rows = [];
    for (let i = 0; i < 24; i++) {
      rows.push({ timestamp: ts(8, i * 15), energia_total_wh: 10000, energia_wh: 0, potencia_w: 0 });
    }
    rows.push({ timestamp: ts(14, 0), energia_total_wh: 15000, energia_wh: 0, potencia_w: 0 });
    // duplicats del mateix timestamp
    rows.push({ timestamp: ts(9, 0), energia_total_wh: 99999, energia_wh: 9999, potencia_w: 9999 });

    const { rows: out, corrections } = interpolateConsumptionRows(rows);
    expect(corrections).toHaveLength(1);
    // El duplicat no crea un fals salt: es conserva la primera fila del timestamp
    const nineRows = out.filter(r => r.timestamp.getTime() === ts(9, 0).getTime());
    expect(nineRows.length).toBe(2);
    expect(nineRows[0].energia_total_wh).toBeLessThan(99999);
  });
});

describe('groupByTimestamp', () => {
  test('groups rows by timestamp preserving the first', () => {
    const rows = [
      { timestamp: ts(8), value: 1 },
      { timestamp: ts(8), value: 99 },
      { timestamp: ts(9), value: 2 },
    ];
    const byTs = groupByTimestamp(rows);
    expect(byTs.size).toBe(2);
    expect(byTs.get(ts(8).getTime())[0].value).toBe(1);
  });
});

describe('computeDaylightWindow', () => {
  const cleanRow = (h, m, wh) => ({ timestamp: ts(h, m), generator_total_wh: wh });

  test('computes the production window from clean rows (local time)', () => {
    const rows = [
      cleanRow(6, 15, 1),   // 08:15 local (CEST)
      cleanRow(18, 30, 1),  // 20:30 local
      cleanRow(0, 0, 0),    // nit: ignorada
      cleanRow(12, 0, 5),   // migdia
    ];
    expect(computeDaylightWindow(rows)).toEqual({ start: 8 * 60 + 15, end: 20 * 60 + 30 });
  });

  test('returns null when there is no production', () => {
    expect(computeDaylightWindow([cleanRow(12, 0, 0)])).toBeNull();
    expect(computeDaylightWindow([])).toBeNull();
  });
});

describe('interpolateSeries amb finestra de sol', () => {
  // Escenari giravolt: comptador congelat a 52305 del 08-08 17:30Z (19:30 local)
  // al 08-09 14:45Z (16:45 local), recuperació 15:00Z (17:00 local) = 52518.
  // Finestra de sol empírica [08:15, 20:30] local → 40 intervals diürns.
  function buildDaylightSeries() {
    const records = [];
    const start = Date.UTC(2026, 7, 8, 17, 30);
    for (let i = 0; i < 86; i++) {
      records.push({ timestamp: new Date(start + i * 15 * 60 * 1000), value: 52305 });
    }
    records.push({ timestamp: new Date(Date.UTC(2026, 7, 9, 15, 0)), value: 52518 });
    return records;
  }
  const DAYLIGHT = { start: 8 * 60 + 15, end: 20 * 60 + 30 };

  test('deixa la nit plana i reparteix el salt només en hores de sol', () => {
    const { records, corrections } = interpolateSeries(buildDaylightSeries(), { daylightWindow: DAYLIGHT });
    expect(corrections).toHaveLength(1);

    const step = 213 / 40; // 5.325

    // Primer interval diürn (19:45 local = 17:45Z)
    expect(records[1].value).toBeCloseTo(Math.round((52305 + step) * 100) / 100, 1);
    expect(records[1].interpolated).toBe(true);

    // Nit plana al nivell assolit (després dels 4 intervals de la tarda)
    const nightIdx = 6; // 21:00 local = 19:00Z
    expect(records[nightIdx].value).toBeCloseTo(Math.round((52305 + 4 * step) * 100) / 100, 1);
    expect(records[nightIdx + 1].value).toBe(records[nightIdx].value);

    // Darrer interval marcat (16:45 local = 14:45Z, 39è diürn)
    const lastMarked = records[85];
    expect(lastMarked.value).toBeCloseTo(Math.round((52305 + 39 * step) * 100) / 100, 1);

    // Recuperació conserva el valor real i absorbeix el residual
    expect(records[86].value).toBe(52518);
    expect(records[86].interpolated).toBeUndefined();

    // Conservació: suma de deltes = salt total
    let sum = 0;
    for (let i = 1; i < records.length; i++) sum += records[i].value - records[i - 1].value;
    expect(sum).toBeCloseTo(213, 1);

    // Monotonia: cap delta negatiu
    for (let i = 1; i < records.length; i++) {
      expect(records[i].value - records[i - 1].value).toBeGreaterThanOrEqual(-1e-9);
    }
  });

  test('sense finestra es manté la interpolació uniforme', () => {
    const { records } = interpolateSeries(buildDaylightSeries());
    const step = 213 / 86;
    expect(records[85].value).toBeCloseTo(52305 + step * 85, 2);
  });
});

describe('interpolateBalanceRows amb finestra de sol', () => {
  test('recalcula deltes i derivades: nit 0, dia amb pas, recuperació residual', () => {
    const start = Date.UTC(2026, 7, 8, 17, 30);
    const rows = [];
    for (let i = 0; i < 86; i++) {
      rows.push({
        timestamp: new Date(start + i * 15 * 60 * 1000),
        generator_total_cumulative_wh: 52305,
        generator_total_wh: 0,
        allocated_wh: 0,
        balance_wh: 0,
        participation_pct: 100,
        consumption_wh: 200,
      });
    }
    rows.push({
      timestamp: new Date(Date.UTC(2026, 7, 9, 15, 0)),
      generator_total_cumulative_wh: 52518,
      generator_total_wh: 0,
      allocated_wh: 0,
      balance_wh: 0,
      participation_pct: 100,
      consumption_wh: 200,
    });

    const DAYLIGHT = { start: 8 * 60 + 15, end: 20 * 60 + 30 };
    const { rows: out, corrections } = interpolateBalanceRows(rows, 100, DAYLIGHT);
    expect(corrections).toHaveLength(1);

    // Ancoratge (08-08 19:30 local): no es toca
    expect(out[0].generator_total_cumulative_wh).toBe(52305);
    expect(out[0].changed).toBeFalsy();

    // Interval nocturn (21:00 local): delta i derivades queden a 0
    const nightIdx = 6;
    expect(out[nightIdx].generator_total_wh).toBe(0);
    expect(out[nightIdx].allocated_wh).toBe(0);
    expect(out[nightIdx].balance_wh).toBe(0);

    // Interval diürn: pas ~5.33
    expect(out[1].generator_total_wh).toBeCloseTo(213 / 40, 1);
    expect(out[1].allocated_wh).toBeCloseTo(213 / 40, 1);
    expect(out[1].balance_wh).toBe(333); // 5.33 * 100 - 200

    // Recuperació: valor real, delta residual > 0
    const rec = out[86];
    expect(rec.generator_total_cumulative_wh).toBe(52518);
    expect(rec.generator_total_wh).toBeGreaterThan(0);
  });
});
