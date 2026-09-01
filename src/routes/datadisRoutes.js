const express = require('express');
const { authenticateToken, requireEmailValidation, validateUserExists } = require('../middleware/auth');
const datadisService = require('../services/datadisService');
const { generateDatadisReportPdf } = require('../services/datadisReportService');
const { generateDatadisExcel, XLSX_CONTENT_TYPE } = require('../services/datadisExcelService');
const cryptoService = require('../services/cryptoService');
const emailService = require('../services/emailService');
const database = require('../utils/database');
const logger = require('../utils/logger');

const router = express.Router();

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RANGE_DAYS = 366;

/**
 * GET /api/datadis/data?from=YYYY-MM-DD&to=YYYY-MM-DD&type=daily|hourly
 * Dades de Datadis del propi usuari durant el període indicat.
 */
router.get(
  '/data',
  authenticateToken,
  requireEmailValidation,
  validateUserExists,
  async (req, res) => {
    try {
      if (!database.pool) {
        await database.connect();
      }

      const { from, to, type = 'daily' } = req.query;

      if (!from || !to || !DATE_REGEX.test(from) || !DATE_REGEX.test(to)) {
        return res.status(400).json({
          success: false,
          code: 'invalid_dates',
          error: 'Cal indicar les dates \'from\' i \'to\' en format YYYY-MM-DD'
        });
      }

      if (from > to) {
        return res.status(400).json({
          success: false,
          code: 'invalid_dates',
          error: 'La data inicial no pot ser posterior a la final'
        });
      }

      const granularity = type === 'hourly' ? 'hourly' : 'daily';

      const rangeDays = Math.round((new Date(`${to}T00:00:00`) - new Date(`${from}T00:00:00`)) / 86400000) + 1;
      if (rangeDays > MAX_RANGE_DAYS) {
        return res.status(400).json({
          success: false,
          code: 'invalid_dates',
          error: `El període màxim és de ${MAX_RANGE_DAYS} dies`
        });
      }

      const user = req.user.dbUser;
      if (!user.cups) {
        return res.status(400).json({
          success: false,
          code: 'no_cups',
          error: 'No tens cap CUPS assignat'
        });
      }
      if (!user.dni) {
        return res.status(400).json({
          success: false,
          code: 'no_credentials',
          error: 'No tens el DNI/NIE enregistrat'
        });
      }
      if (!user.clau_datadis) {
        return res.status(400).json({
          success: false,
          code: 'no_credentials',
          error: 'No tens la clau d\'accés a Datadis enregistrada'
        });
      }

      const clauDatadis = cryptoService.decrypt(user.clau_datadis);

      const data = await datadisService.getSociConsumption({
        userId: req.user.userId,
        dni: user.dni,
        password: clauDatadis,
        cups: user.cups,
        from,
        to,
        granularity,
        pool: database.pool,
      });

      res.json({ success: true, data });
    } catch (error) {
      if (error instanceof datadisService.DatadisError) {
        return res.status(400).json({
          success: false,
          code: error.code,
          error: error.message
        });
      }
      logger.error('Error consultant Datadis per l\'usuari:', error);
      res.status(500).json({
        success: false,
        code: 'server',
        error: 'Error intern del servidor'
      });
    }
  }
);

/**
 * POST /api/datadis/report
 * Genera l'informe en PDF (descarrega) o l'envia per email segons el paràmetre sendTo.
 */
router.post(
  '/report',
  authenticateToken,
  requireEmailValidation,
  validateUserExists,
  async (req, res) => {
    try {
      if (!database.pool) {
        await database.connect();
      }

      const { from, to, email, message, name } = req.body || {};

      if (!from || !to || !DATE_REGEX.test(from) || !DATE_REGEX.test(to)) {
        return res.status(400).json({
          success: false,
          code: 'invalid_dates',
          error: 'Cal indicar les dates \'from\' i \'to\' en format YYYY-MM-DD'
        });
      }

      if (from > to) {
        return res.status(400).json({
          success: false,
          code: 'invalid_dates',
          error: 'La data inicial no pot ser posterior a la final'
        });
      }

      const rangeDays = Math.round((new Date(`${to}T00:00:00`) - new Date(`${from}T00:00:00`)) / 86400000) + 1;
      if (rangeDays > MAX_RANGE_DAYS) {
        return res.status(400).json({
          success: false,
          code: 'invalid_dates',
          error: `El període màxim és de ${MAX_RANGE_DAYS} dies`
        });
      }

      const user = req.user.dbUser;
      if (!user.cups) {
        return res.status(400).json({
          success: false,
          code: 'no_cups',
          error: 'No tens cap CUPS assignat'
        });
      }
      if (!user.dni || !user.clau_datadis) {
        return res.status(400).json({
          success: false,
          code: 'no_credentials',
          error: 'No tens les credencials de Datadis enregistrades'
        });
      }

      const clauDatadis = cryptoService.decrypt(user.clau_datadis);

      const data = await datadisService.getSociConsumption({
        userId: req.user.userId,
        dni: user.dni,
        password: clauDatadis,
        cups: user.cups,
        from,
        to,
        granularity: 'hourly',
        pool: database.pool,
      });

      const pdfBuffer = await generateDatadisReportPdf({
        period: { from, to },
        data,
        userName: name,
      });

      const safeFrom = from.replace(/-/g, '');
      const safeTo = to.replace(/-/g, '');
      const filename = `informe-datadis-${safeFrom}-${safeTo}.pdf`;
      const excelFilename = `informe-datadis-${safeFrom}-${safeTo}.xlsx`;

      // Si ens passen un email, enviar per correu amb el resum (PDF) i l'Excel adjunts
      if (email) {
        const excelBuffer = await generateDatadisExcel({
          data,
          userName: name,
        });

        await emailService.sendReportEmail(email, {
          subject: `Informe de Datadis ${from} — ${to}`,
          text: message || 'Tens adjunt l\'informe de Datadis sol·licitat (resum en PDF i desglossament horari en Excel).',
          html: `<p>${(message || 'Tens adjunt l\'informe de Datadis sol·licitat (resum en PDF i desglossament horari en Excel).').replace(/\n/g, '<br>')}</p>`,
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
      if (error instanceof datadisService.DatadisError) {
        return res.status(400).json({
          success: false,
          code: error.code,
          error: error.message
        });
      }
      logger.error('Error generant l\'informe de Datadis:', error);
      res.status(500).json({
        success: false,
        code: 'server',
        error: 'Error intern del servidor'
      });
    }
  }
);

/**
 * POST /api/datadis/excel
 * Genera un fitxer Excel amb el desglossament horari, fórmules i un gràfic natiu.
 */
router.post(
  '/excel',
  authenticateToken,
  requireEmailValidation,
  validateUserExists,
  async (req, res) => {
    try {
      if (!database.pool) {
        await database.connect();
      }

      const { from, to } = req.body || {};

      if (!from || !to || !DATE_REGEX.test(from) || !DATE_REGEX.test(to)) {
        return res.status(400).json({
          success: false,
          code: 'invalid_dates',
          error: 'Cal indicar les dates \'from\' i \'to\' en format YYYY-MM-DD'
        });
      }

      if (from > to) {
        return res.status(400).json({
          success: false,
          code: 'invalid_dates',
          error: 'La data inicial no pot ser posterior a la final'
        });
      }

      const rangeDays = Math.round((new Date(`${to}T00:00:00`) - new Date(`${from}T00:00:00`)) / 86400000) + 1;
      if (rangeDays > MAX_RANGE_DAYS) {
        return res.status(400).json({
          success: false,
          code: 'invalid_dates',
          error: `El període màxim és de ${MAX_RANGE_DAYS} dies`
        });
      }

      const user = req.user.dbUser;
      if (!user.cups) {
        return res.status(400).json({
          success: false,
          code: 'no_cups',
          error: 'No tens cap CUPS assignat'
        });
      }
      if (!user.dni || !user.clau_datadis) {
        return res.status(400).json({
          success: false,
          code: 'no_credentials',
          error: 'No tens les credencials de Datadis enregistrades'
        });
      }

      const clauDatadis = cryptoService.decrypt(user.clau_datadis);

      const data = await datadisService.getSociConsumption({
        userId: req.user.userId,
        dni: user.dni,
        password: clauDatadis,
        cups: user.cups,
        from,
        to,
        granularity: 'hourly',
        pool: database.pool,
      });

      const excelBuffer = await generateDatadisExcel({
        data,
        userName: (req.body || {}).name,
      });

      const safeFrom = from.replace(/-/g, '');
      const safeTo = to.replace(/-/g, '');
      const filename = `informe-datadis-${safeFrom}-${safeTo}.xlsx`;

      res.setHeader('Content-Type', XLSX_CONTENT_TYPE);
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(excelBuffer);
    } catch (error) {
      if (error instanceof datadisService.DatadisError) {
        return res.status(400).json({
          success: false,
          code: error.code,
          error: error.message
        });
      }
      logger.error('Error generant l\'informe Excel de Datadis:', error);
      res.status(500).json({
        success: false,
        code: 'server',
        error: 'Error intern del servidor'
      });
    }
  }
);

module.exports = router;