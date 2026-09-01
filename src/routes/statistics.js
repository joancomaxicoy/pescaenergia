const express = require('express');
const database = require('../utils/database');
const logger = require('../utils/logger');
const { getStatisticsData, getBalanceData } = require('../services/statisticsService');
const { generateReportPdf } = require('../services/reportService');
const { generateStatisticsExcel, XLSX_CONTENT_TYPE } = require('../services/statisticsExcelService');
const emailService = require('../services/emailService');

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

    const result = await getBalanceData({ from, to, cups });

    res.json({
      ...result,
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

    const result = await getStatisticsData({ from, to, cups });

    res.json({
      period: result.period,
      cups,
      intervals: result.intervals,
      summary: result.summary,
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

// Genera l'informe en PDF (descarrega) o l'envia per email segons el paràmetre sendTo
router.post('/report', asyncHandler(async (req, res) => {
  try {
    const { from, to, cups, email, message, name } = req.body || {};

    if (!from || !cups) {
      return res.status(400).json({
        error: 'Calen els paràmetres from i cups',
        timestamp: new Date().toISOString()
      });
    }

    const result = await getStatisticsData({ from, to, cups });
    const pdfBuffer = await generateReportPdf({
      period: result.period,
      summary: result.summary,
      userName: name
    });

    const safeFrom = from.replace(/-/g, '');
    const safeTo = (to || new Date().toISOString().slice(0, 10)).replace(/-/g, '');
    const filename = `informe-energetic-${safeFrom}-${safeTo}.pdf`;
    const excelFilename = `informe-energetic-${safeFrom}-${safeTo}.xlsx`;

    // Si ens passen un email, enviar per correu amb el resum (PDF) i l'Excel adjunts
    if (email) {
      const balance = await getBalanceData({ from, to, cups });
      const excelBuffer = await generateStatisticsExcel({
        period: result.period,
        balance
      });

      await emailService.sendReportEmail(email, {
        subject: `Informe energètic ${result.period.from} — ${result.period.to}`,
        text: message || 'Tens adjunt l\'informe energètic sol·licitat (resum en PDF i desglossament en Excel).',
        html: `<p>${(message || 'Tens adjunt l\'informe energètic sol·licitat (resum en PDF i desglossament en Excel).').replace(/\n/g, '<br>')}</p>`,
        attachments: [
          {
            filename,
            content: pdfBuffer
          },
          {
            filename: excelFilename,
            content: excelBuffer
          }
        ]
      });

      return res.json({
        ok: true,
        sent: true,
        email,
        filename,
        excelFilename,
        timestamp: new Date().toISOString()
      });
    }

    // Si no, retornar el PDF per descarregar
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(pdfBuffer);
  } catch (error) {
    logger.error('Error generant informe:', { error: error.message });
    res.status(500).json({
      error: 'Error generant l\'informe',
      details: process.env.NODE_ENV !== 'production' ? error.message : undefined,
      timestamp: new Date().toISOString()
    });
  }
}));

// Genera el desglossament i el balanç energètic en Excel
router.post('/excel', asyncHandler(async (req, res) => {
  try {
    const { from, to, cups } = req.body || {};

    if (!from || !cups) {
      return res.status(400).json({
        error: 'Calen els paràmetres from i cups',
        timestamp: new Date().toISOString()
      });
    }

    const result = await getStatisticsData({ from, to, cups });
    const balance = await getBalanceData({ from, to, cups });

    const excelBuffer = await generateStatisticsExcel({
      period: result.period,
      balance
    });

    const safeFrom = from.replace(/-/g, '');
    const safeTo = (to || new Date().toISOString().slice(0, 10)).replace(/-/g, '');
    const filename = `informe-energetic-${safeFrom}-${safeTo}.xlsx`;

    res.setHeader('Content-Type', XLSX_CONTENT_TYPE);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(excelBuffer);
  } catch (error) {
    logger.error('Error generant l\'informe Excel:', { error: error.message });
    res.status(500).json({
      error: 'Error generant l\'informe Excel',
      details: process.env.NODE_ENV !== 'production' ? error.message : undefined,
      timestamp: new Date().toISOString()
    });
  }
}));

module.exports = router;
