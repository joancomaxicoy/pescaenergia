const express = require('express');
const router = express.Router();
const PoolService = require('../services/poolService');
const { authenticateToken } = require('../middleware/auth');
const logger = require('../utils/logger');

const poolService = new PoolService();

router.get('/device', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const device = await poolService.findUserPoolDevice(userId);

    if (!device) {
      return res.json({ success: true, data: null });
    }

    res.json({
      success: true,
      data: {
        deviceId: device.shelly_device_id,
        deviceName: device.device_name,
        id: device.id
      }
    });
  } catch (error) {
    logger.error('Error getting pool device', { error: error.message });
    res.status(500).json({ error: 'Error obtenint el dispositiu de piscina' });
  }
});

router.get('/status', authenticateToken, async (req, res) => {
  try {
    const { deviceId } = req.query;
    if (!deviceId) {
      return res.status(400).json({ error: 'deviceId és requerit' });
    }

    const status = await poolService.getPoolStatus(deviceId);
    res.json({ success: true, data: status });
  } catch (error) {
    logger.error('Error getting pool status', { error: error.message });
    res.status(500).json({ error: 'Error obtenint l\'estat de la piscina' });
  }
});

router.get('/automation', authenticateToken, async (req, res) => {
  try {
    const { deviceId } = req.query;
    if (!deviceId) {
      return res.status(400).json({ error: 'deviceId és requerit' });
    }

    const config = await poolService.getPoolAutomation(deviceId);
    res.json({ success: true, data: config });
  } catch (error) {
    logger.error('Error getting pool automation', { error: error.message });
    res.status(500).json({ error: 'Error obtenint la configuració d\'automatització' });
  }
});

router.post('/automation', authenticateToken, async (req, res) => {
  try {
    const { deviceId } = req.query;
    const config = req.body;

    if (!deviceId) {
      return res.status(400).json({ error: 'deviceId és requerit' });
    }

    const result = await poolService.savePoolAutomation(deviceId, config);
    res.json(result);
  } catch (error) {
    logger.error('Error saving pool automation', { error: error.message });
    res.status(500).json({ error: 'Error guardant la configuració d\'automatització' });
  }
});

router.get('/hours', authenticateToken, async (req, res) => {
  try {
    const { deviceId } = req.query;
    if (!deviceId) return res.status(400).json({ error: 'deviceId és requerit' });

    const hours = await poolService.getPoolHours(deviceId);
    res.json({ success: true, data: hours });
  } catch (error) {
    logger.error('Error getting pool hours', { error: error.message });
    res.status(500).json({ error: 'Error obtenint les hores de funcionament' });
  }
});

router.post('/hours', authenticateToken, async (req, res) => {
  try {
    const { deviceId } = req.query;
    const hoursData = req.body;
    if (!deviceId) return res.status(400).json({ error: 'deviceId és requerit' });

    const result = await poolService.savePoolHours(deviceId, hoursData);
    res.json(result);
  } catch (error) {
    logger.error('Error saving pool hours', { error: error.message });
    res.status(500).json({ error: 'Error guardant les hores de funcionament' });
  }
});

router.post('/control', authenticateToken, async (req, res) => {
  try {
    const { deviceId, element, action } = req.body;
    if (!deviceId || !element || !action) {
      return res.status(400).json({ error: 'deviceId, element i action són requerits' });
    }

    const result = await poolService.controlElement(deviceId, element, action);
    res.json(result);
  } catch (error) {
    logger.error('Error controlling pool element', { error: error.message });
    res.status(500).json({ error: 'Error controlant l\'element de la piscina' });
  }
});

router.post('/status_update', authenticateToken, async (req, res) => {
  try {
    const { deviceId } = req.body;
    if (!deviceId) {
      return res.status(400).json({ error: 'deviceId és requerit' });
    }

    const result = await poolService.requestStatusUpdate(deviceId);
    res.json(result);
  } catch (error) {
    logger.error('Error requesting pool status update', { error: error.message });
    res.status(500).json({ error: 'Error sol·licitant l\'actualització d\'estat' });
  }
});

router.post('/test-automation', authenticateToken, async (req, res) => {
  try {
    const { deviceId, simulatedExcedentKW } = req.body;
    if (!deviceId || simulatedExcedentKW === undefined) {
      return res.status(400).json({ error: 'deviceId i simulatedExcedentKW són requerits' });
    }

    const deviceQuery = `
      SELECT id, shelly_device_id, device_name, user_id
      FROM devices
      WHERE shelly_device_id = $1 AND user_id = $2
      LIMIT 1
    `;
    const db = require('../utils/database');
    const deviceResult = await db.query(deviceQuery, [deviceId, req.user.userId]);
    if (deviceResult.rows.length === 0) {
      return res.status(404).json({ error: 'Dispositiu no trobat' });
    }

    const PoolAutomationService = require('../services/poolAutomationService');
    const automationService = new PoolAutomationService();
    await automationService.processDevice(deviceResult.rows[0], { simulatedExcedentKW });

    res.json({ success: true, message: `Test d'automatització executat amb excedent ${simulatedExcedentKW} kW` });
  } catch (error) {
    logger.error('Error en test d\'automatització', { error: error.message });
    res.status(500).json({ error: 'Error executant test d\'automatització' });
  }
});

module.exports = router;
