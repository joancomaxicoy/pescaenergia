const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const database = require('../utils/database');

const TIMEZONE = process.env.USERS_TIMEZONE || 'Europe/Madrid';

function toLocalISO(date) {
  if (!date) return null;
  return new Date(date).toLocaleString('sv-SE', { timeZone: TIMEZONE }).replace(' ', 'T');
}

router.get('/',
  async (req, res) => {
    try {
      if (!database.pool) {
        await database.connect();
      }

      const devicesResult = await database.query(`
        SELECT d.id, d.device_name, d.device_type, d.shelly_device_id, u.cups
        FROM devices d
        INNER JOIN users u ON d.user_id = u.id::text
        WHERE u.name ILIKE '%joan%'
        ORDER BY d.device_name
      `);

      const devices = [];

      for (const row of devicesResult.rows) {
        const recordsResult = await database.query(`
          SELECT timestamp, energia_wh, potencia_w, energia_total_wh
          FROM consums
          WHERE device_id = $1
          ORDER BY timestamp DESC
          LIMIT 5
        `, [row.id]);

        const records = recordsResult.rows.map(r => ({
          timestamp: toLocalISO(r.timestamp),
          energia_wh: parseFloat(r.energia_wh),
          potencia_w: parseFloat(r.potencia_w),
          energia_total_wh: parseFloat(r.energia_total_wh),
        }));

        devices.push({
          device_name: row.device_name,
          device_type: row.device_type,
          shelly_device_id: row.shelly_device_id,
          cups: row.cups,
          records
        });
      }

      res.json({
        success: true,
        count: devices.length,
        devices
      });
    } catch (error) {
      logger.error('Error obtenint consums:', error);
      res.status(500).json({
        success: false,
        error: 'Error obtenint consums',
        detail: error.message
      });
    }
  }
);

module.exports = router;
