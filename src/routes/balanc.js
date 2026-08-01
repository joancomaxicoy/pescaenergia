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
