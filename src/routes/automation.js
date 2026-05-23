const express = require('express');
const router = express.Router();
const AutomationManager = require('../services/automation/AutomationManager');

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

module.exports = router;
