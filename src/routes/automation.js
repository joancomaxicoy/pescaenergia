const express = require('express');
const router = express.Router();
const AutomationManager = require('../services/automation/AutomationManager');
const database = require('../utils/database');

const logger = require('../utils/logger');

router.get('/cache', async (req, res) => {
  try {
    const automationManager = AutomationManager.getInstance();

    if (!automationManager || !automationManager.memoryCache || !automationManager.memoryCache.isInitialized) {
      return res.status(503).json({
        error: 'AutomationManager o MemoryCache no disponible',
        timestamp: new Date().toISOString()
      });
    }

    const cache = automationManager.memoryCache;

    const data = {
      stats: cache.getStats(),
      configs: cache.getAllAutomationConfigs(),
      deviceStates: cache.getAllDeviceStates(),
      powerMetrics: cache.getAllPowerMetrics(),
      generators: cache.getAllGeneratorConfigs(),
      timestamp: new Date().toISOString()
    };

    res.json(data);
  } catch (error) {
    logger.error('Error obtenint cache d\'automatització:', error);
    res.status(500).json({
      error: 'Error obtenint cache d\'automatització',
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

router.get('/configs', async (req, res) => {
  try {
    const result = await database.query(`
      SELECT ac.id, ac.device_id, d.shelly_device_id, d.device_name, d.device_type,
             ac.config_name, ac.config_data, ac.is_active, ac.created_at, ac.updated_at
      FROM automation_configs ac
      LEFT JOIN devices d ON d.id = ac.device_id
      ORDER BY ac.updated_at DESC
    `);

    res.json({
      success: true,
      count: result.rows.length,
      configs: result.rows
    });
  } catch (error) {
    logger.error('Error obtenint configs d\'automatització:', error);
    res.status(500).json({
      error: 'Error obtenint configs',
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;
