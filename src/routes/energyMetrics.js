const express = require('express');
const database = require('../utils/database');
const logger = require('../utils/logger');

const router = express.Router();

const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

router.get('/recent', asyncHandler(async (req, res) => {
  try {
    const result = await database.query(
      `SELECT timestamp, device_id, metric_name, value
       FROM energy_metrics
       WHERE device_id LIKE 'gen-%'
         AND metric_name = 'e_total_fotovoltaica_max'
         AND timestamp >= NOW() - INTERVAL '24 hours'
       ORDER BY device_id, timestamp DESC`,
    );

    const grouped = {};
    for (const row of result.rows) {
      if (!grouped[row.device_id]) {
        grouped[row.device_id] = [];
      }
      if (grouped[row.device_id].length < 10) {
        grouped[row.device_id].push({ timestamp: row.timestamp, value: row.value });
      }
    }

    const generators = Object.entries(grouped).map(([deviceId, metrics]) => ({
      device_id: deviceId,
      count: metrics.length,
      metrics
    }));

    res.json({
      generators,
      totalGenerators: generators.length,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Error obtenint últims valors de generació:', { error: error.message });
    res.status(500).json({
      error: 'Error consultant energy_metrics',
      details: process.env.NODE_ENV !== 'production' ? error.message : undefined,
      timestamp: new Date().toISOString()
    });
  }
}));

module.exports = router;
