const express = require('express');
const router = express.Router();
const PlugsService = require('../services/plugsService');
const AutomationManager = require('../services/automation/AutomationManager');
const { authenticateToken } = require('../middleware/auth');
const logger = require('../utils/logger');

// Instancia del servicio
const plugsService = new PlugsService();

// Asegurar que el PlugsService use la instancia singleton del AutomationManager
(async () => {
  try {
    // Obtener la instancia singleton del AutomationManager
    const automationManager = AutomationManager.getInstance();
    
    // Actualizar la referencia en el PlugsService si no está ya configurada
    if (!plugsService.automationManager) {
      plugsService.automationManager = automationManager;
      logger.info('✅ AutomationManager singleton asignado a PlugsService de las rutas');
    }
  } catch (error) {
    logger.warn('⚠️ No se pudo asignar AutomationManager singleton a PlugsService de las rutas:', error.message);
  }
})();

/**
 * @swagger
 * components:
 *   schemas:
 *     Plug:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           format: uuid
 *           description: ID único del enchufe
 *         device_name:
 *           type: string
 *           description: Nombre del enchufe
 *         shelly_device_id:
 *           type: string
 *           description: ID del dispositivo Shelly
 *         device_type:
 *           type: string
 *           description: Tipo de dispositivo
 *         created_at:
 *           type: string
 *           format: date-time
 *           description: Fecha de creación
 *         updated_at:
 *           type: string
 *           format: date-time
 *           description: Fecha de última actualización
 *         user_cups:
 *           type: string
 *           description: CUPS del usuario propietario
 *         user_name:
 *           type: string
 *           description: Nombre del usuario propietario
 *     PlugDiscoveryResult:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           description: Indica si el autodescubrimiento fue exitoso
 *         discovered:
 *           type: integer
 *           description: Número de enchufes descubiertos y asignados
 *         message:
 *           type: string
 *           description: Mensaje descriptivo del resultado
 *         user:
 *           type: object
 *           properties:
 *             id:
 *               type: string
 *               format: uuid
 *             name:
 *               type: string
 *             cups:
 *               type: string
 *         plugs:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/Plug'
 *     PlugControlResult:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           description: Indica si el control fue exitoso
 *         plugId:
 *           type: string
 *           format: uuid
 *           description: ID del enchufe controlado
 *         shellyDeviceId:
 *           type: string
 *           description: ID del dispositivo Shelly
 *         deviceName:
 *           type: string
 *           description: Nombre del enchufe
 *         action:
 *           type: string
 *           enum: [on, off, toggle]
 *           description: Acción ejecutada
 *         timestamp:
 *           type: string
 *           format: date-time
 *           description: Timestamp de la acción
 *         message:
 *           type: string
 *           description: Mensaje descriptivo
 *         mqttImplemented:
 *           type: boolean
 *           description: Indica si el control MQTT está implementado
 *     PlugStatus:
 *       type: object
 *       properties:
 *         plugId:
 *           type: string
 *           format: uuid
 *           description: ID del enchufe
 *         shellyDeviceId:
 *           type: string
 *           description: ID del dispositivo Shelly
 *         deviceName:
 *           type: string
 *           description: Nombre del enchufe
 *         deviceType:
 *           type: string
 *           description: Tipo de dispositivo
 *         isOnline:
 *           type: boolean
 *           description: Estado de conexión del enchufe
 *         isOn:
 *           type: boolean
 *           description: Estado del enchufe (encendido/apagado)
 *         power:
 *           type: number
 *           description: Potencia actual en vatios
 *         voltage:
 *           type: number
 *           description: Voltaje actual
 *         temperature:
 *           type: number
 *           description: Temperatura del dispositivo
 *         lastUpdate:
 *           type: string
 *           format: date-time
 *           description: Última actualización de estado
 *         simulated:
 *           type: boolean
 *           description: Indica si los datos son simulados
 *   securitySchemes:
 *     bearerAuth:
 *       type: http
 *       scheme: bearer
 *       bearerFormat: JWT
 */

/**
 * @swagger
 * /api/plugs/discover:
 *   get:
 *     summary: Autodescubrimiento de enchufes
 *     description: Busca y asigna enchufes al usuario basándose en el patrón shelly_device_id que termine con /{cups}
 *     tags: [Plugs]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Autodescubrimiento completado exitosamente
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/PlugDiscoveryResult'
 *       400:
 *         description: Error en la solicitud
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         description: No autorizado
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Error interno del servidor
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/discover', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    
    logger.info('Solicitud de autodescubrimiento de enchufes', {
      userId,
      userEmail: req.user.email,
      ip: req.ip
    });

    const result = await plugsService.discover(userId);

    res.json(result);

  } catch (error) {
    logger.error('Error en endpoint de autodescubrimiento', {
      userId: req.user?.userId,
      error: error.message,
      stack: error.stack
    });

    res.status(500).json({
      error: 'Error en el autodescubrimiento de enchufes',
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @swagger
 * /api/plugs:
 *   get:
 *     summary: Obtener enchufes del usuario
 *     description: Retorna todos los enchufes asignados al usuario autenticado
 *     tags: [Plugs]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Lista de enchufes obtenida exitosamente
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 count:
 *                   type: integer
 *                   description: Número total de enchufes
 *                 plugs:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Plug'
 *       401:
 *         description: No autorizado
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Error interno del servidor
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    
    logger.info('Solicitud de lista de enchufes', {
      userId,
      userEmail: req.user.email
    });

    const plugs = await plugsService.getUserPlugs(userId);

    res.json({
      success: true,
      count: plugs.length,
      plugs: plugs
    });

  } catch (error) {
    logger.error('Error obteniendo lista de enchufes', {
      userId: req.user?.userId,
      error: error.message
    });

    res.status(500).json({
      error: 'Error obteniendo la lista de enchufes',
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @swagger
 * /api/plugs/health:
 *   get:
 *     summary: Health check del servicio de enchufes
 *     description: Verifica el estado de salud del servicio de enchufes
 *     tags: [Plugs]
 *     responses:
 *       200:
 *         description: Servicio saludable
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   enum: [healthy, unhealthy]
 *                 database:
 *                   type: string
 *                   enum: [connected, error]
 *                 totalPlugs:
 *                   type: integer
 *                   description: Número total de enchufes en el sistema
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *       500:
 *         description: Servicio no saludable
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   enum: [unhealthy]
 *                 database:
 *                   type: string
 *                   enum: [error]
 *                 error:
 *                   type: string
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 */
router.get('/health', async (req, res) => {
  try {
    const health = await plugsService.healthCheck();
    
    const statusCode = health.status === 'healthy' ? 200 : 500;
    res.status(statusCode).json(health);

  } catch (error) {
    logger.error('Error en health check de enchufes', {
      error: error.message
    });

    res.status(500).json({
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @swagger
 * /api/plugs/historical-chart:
 *   get:
 *     summary: Obtener datos históricos para gráfica de plugs
 *     description: Retorna datos históricos de consumo de plugs individuales, generación y resto de consumo para crear gráficas
 *     tags: [Plugs]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: period
 *         schema:
 *           type: string
 *           enum: [24h, 7d, 30d]
 *           default: 24h
 *         description: Período de tiempo para los datos históricos
 *     responses:
 *       200:
 *         description: Datos históricos obtenidos exitosamente
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 period:
 *                   type: string
 *                   enum: [24h, 7d, 30d]
 *                 labels:
 *                   type: array
 *                   items:
 *                     type: string
 *                   description: Etiquetas de tiempo para el eje X
 *                 datasets:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       label:
 *                         type: string
 *                       data:
 *                         type: array
 *                         items:
 *                           type: number
 *                       type:
 *                         type: string
 *                         enum: [generation, plug_consumption, other_consumption]
 *                       stack:
 *                         type: string
 *                         description: Grupo de stack para gráficas apiladas
 *                 totalDataPoints:
 *                   type: integer
 *                 dateRange:
 *                   type: object
 *                   properties:
 *                     start:
 *                       type: string
 *                       format: date-time
 *                     end:
 *                       type: string
 *                       format: date-time
 *       401:
 *         description: No autorizado
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Error interno del servidor
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/historical-chart', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const period = req.query.period || '24h';

    // Validar período
    const validPeriods = ['24h', '7d', '30d'];
    if (!validPeriods.includes(period)) {
      return res.status(400).json({
        error: 'Período no válido',
        details: `El período debe ser uno de: ${validPeriods.join(', ')}`,
        timestamp: new Date().toISOString()
      });
    }

    logger.info('Solicitud de datos históricos de plugs', {
      userId,
      period,
      userEmail: req.user.email
    });

    const data = await plugsService.getPlugsHistoricalChartData(userId, period);

    res.json(data);

  } catch (error) {
    logger.error('Error obteniendo datos históricos de plugs', {
      userId: req.user?.userId,
      period: req.query?.period,
      error: error.message
    });

    res.status(500).json({
      error: 'Error obteniendo datos históricos de plugs',
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @swagger
 * /api/plugs/{plugId}:
 *   get:
 *     summary: Obtener información de un enchufe específico
 *     description: Retorna información detallada de un enchufe específico
 *     tags: [Plugs]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: plugId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: ID único del enchufe
 *     responses:
 *       200:
 *         description: Información del enchufe obtenida exitosamente
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Plug'
 *       404:
 *         description: Enchufe no encontrado
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         description: No autorizado
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Error interno del servidor
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/:plugId', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { plugId } = req.params;

    logger.info('Solicitud de información de enchufe específico', {
      userId,
      plugId,
      userEmail: req.user.email
    });

    const plug = await plugsService.getPlugById(plugId, userId);

    res.json(plug);

  } catch (error) {
    logger.error('Error obteniendo información del enchufe', {
      userId: req.user?.userId,
      plugId: req.params.plugId,
      error: error.message
    });

    const statusCode = error.message.includes('no encontrado') || 
                      error.message.includes('no tienes permisos') ? 404 : 500;

    res.status(statusCode).json({
      error: 'Error obteniendo información del enchufe',
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @swagger
 * /api/plugs/{plugId}/control:
 *   post:
 *     summary: Controlar un enchufe
 *     description: Envía comandos de control (on/off/toggle) a un enchufe específico
 *     tags: [Plugs]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: plugId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: ID único del enchufe
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - action
 *             properties:
 *               action:
 *                 type: string
 *                 enum: [on, off, toggle]
 *                 description: Acción a realizar en el enchufe
 *             example:
 *               action: "on"
 *     responses:
 *       200:
 *         description: Control ejecutado exitosamente
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/PlugControlResult'
 *       400:
 *         description: Acción no válida
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       404:
 *         description: Enchufe no encontrado
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         description: No autorizado
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Error interno del servidor
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/:plugId/control', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { plugId } = req.params;
    const { action } = req.body;

    // Validar que se proporcione la acción
    if (!action) {
      return res.status(400).json({
        error: 'Acción requerida',
        details: 'Debe proporcionar una acción (on, off, toggle)',
        timestamp: new Date().toISOString()
      });
    }

    logger.info('Solicitud de control de enchufe', {
      userId,
      plugId,
      action,
      userEmail: req.user.email
    });

    const result = await plugsService.controlPlug(plugId, userId, action);

    res.json(result);

  } catch (error) {
    logger.error('Error controlando enchufe', {
      userId: req.user?.userId,
      plugId: req.params.plugId,
      action: req.body?.action,
      error: error.message
    });

    let statusCode = 500;
    if (error.message.includes('no encontrado') || error.message.includes('no tienes permisos')) {
      statusCode = 404;
    } else if (error.message.includes('no válida')) {
      statusCode = 400;
    }

    res.status(statusCode).json({
      error: 'Error controlando el enchufe',
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @swagger
 * /api/plugs/{plugId}/status:
 *   get:
 *     summary: Obtener estado de un enchufe
 *     description: Retorna el estado actual de un enchufe específico (online/offline, on/off, métricas)
 *     tags: [Plugs]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: plugId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: ID único del enchufe
 *     responses:
 *       200:
 *         description: Estado del enchufe obtenido exitosamente
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/PlugStatus'
 *       404:
 *         description: Enchufe no encontrado
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         description: No autorizado
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Error interno del servidor
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/:plugId/status', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { plugId } = req.params;

    logger.info('Solicitud de estado de enchufe', {
      userId,
      plugId,
      userEmail: req.user.email
    });

    const status = await plugsService.getPlugStatus(plugId, userId);

    res.json(status);

  } catch (error) {
    logger.error('Error obteniendo estado del enchufe', {
      userId: req.user?.userId,
      plugId: req.params.plugId,
      error: error.message
    });

    const statusCode = error.message.includes('no encontrado') || 
                      error.message.includes('no tienes permisos') ? 404 : 500;

    res.status(statusCode).json({
      error: 'Error obteniendo estado del enchufe',
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @swagger
 * /api/plugs/{plugId}/status_update:
 *   post:
 *     summary: Forzar actualización de estado de un enchufe
 *     description: Envía comando MQTT status_update para forzar que el dispositivo publique su estado actual
 *     tags: [Plugs]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: plugId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: ID único del enchufe
 *     responses:
 *       200:
 *         description: Comando status_update enviado exitosamente
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 plugId:
 *                   type: string
 *                   format: uuid
 *                 shellyDeviceId:
 *                   type: string
 *                 deviceName:
 *                   type: string
 *                 command:
 *                   type: string
 *                   enum: [status_update]
 *                 topic:
 *                   type: string
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *                 message:
 *                   type: string
 *       404:
 *         description: Enchufe no encontrado
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         description: No autorizado
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Error interno del servidor
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/:plugId/status_update', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { plugId } = req.params;

    logger.info('Solicitud de actualización de estado de enchufe', {
      userId,
      plugId,
      userEmail: req.user.email
    });

    const result = await plugsService.requestStatusUpdate(plugId, userId);

    res.json(result);

  } catch (error) {
    logger.error('Error solicitando actualización de estado del enchufe', {
      userId: req.user?.userId,
      plugId: req.params.plugId,
      error: error.message
    });

    const statusCode = error.message.includes('no encontrado') || 
                      error.message.includes('no tienes permisos') ? 404 : 500;

    res.status(statusCode).json({
      error: 'Error solicitando actualización de estado del enchufe',
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @swagger
 * /api/plugs/{plugId}/automation:
 *   get:
 *     summary: Obtener configuración de automatización de un enchufe
 *     description: Retorna la configuración de automatización actual de un enchufe específico
 *     tags: [Plugs]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: plugId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: ID único del enchufe
 *     responses:
 *       200:
 *         description: Configuración de automatización obtenida exitosamente
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 plugId:
 *                   type: string
 *                   format: uuid
 *                 plugName:
 *                   type: string
 *                 shellyDeviceId:
 *                   type: string
 *                 automation:
 *                   type: object
 *                   properties:
 *                     type:
 *                       type: string
 *                       enum: [manual, power, schedule]
 *                       description: Tipo de automatización
 *                     power:
 *                       type: number
 *                       minimum: 1
 *                       maximum: 100
 *                       description: Umbral de potencia para automatización por excedente
 *                     schedule:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           id:
 *                             type: number
 *                           days:
 *                             type: array
 *                             items:
 *                               type: number
 *                               minimum: 0
 *                               maximum: 6
 *                             description: Días de la semana (0=Domingo, 1=Lunes, etc.)
 *                           startTime:
 *                             type: string
 *                             pattern: '^([01]?[0-9]|2[0-3]):[0-5][0-9]$'
 *                             description: Hora de inicio (HH:MM)
 *                           endTime:
 *                             type: string
 *                             pattern: '^([01]?[0-9]|2[0-3]):[0-5][0-9]$'
 *                             description: Hora de fin (HH:MM)
 *                           enabled:
 *                             type: boolean
 *                             description: Si el slot está habilitado
 *               example:
 *                 success: true
 *                 plugId: "123e4567-e89b-12d3-a456-426614174000"
 *                 plugName: "Termo ACS"
 *                 shellyDeviceId: "shellyplusplugs-64b7080cc994"
 *                 automation:
 *                   type: "schedule"
 *                   power: 10
 *                   schedule:
 *                     - id: 1
 *                       days: [1, 2, 3, 4, 5]
 *                       startTime: "08:00"
 *                       endTime: "18:00"
 *                       enabled: true
 *       404:
 *         description: Enchufe no encontrado
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         description: No autorizado
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Error interno del servidor
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/:plugId/automation', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { plugId } = req.params;

    logger.info('Solicitud de configuración de automatización', {
      userId,
      plugId,
      userEmail: req.user.email
    });

    const result = await plugsService.getPlugAutomation(plugId, userId);

    res.json({
      success: true,
      ...result
    });

  } catch (error) {
    logger.error('Error obteniendo configuración de automatización', {
      userId: req.user?.userId,
      plugId: req.params.plugId,
      error: error.message
    });

    const statusCode = error.message.includes('no encontrado') || 
                      error.message.includes('no tienes permisos') ? 404 : 500;

    res.status(statusCode).json({
      error: 'Error obteniendo configuración de automatización',
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @swagger
 * /api/plugs/{plugId}/automation:
 *   post:
 *     summary: Guardar configuración de automatización de un enchufe
 *     description: Guarda o actualiza la configuración de automatización de un enchufe específico
 *     tags: [Plugs]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: plugId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: ID único del enchufe
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - type
 *             properties:
 *               type:
 *                 type: string
 *                 enum: [manual, power, schedule]
 *                 description: Tipo de automatización
 *               power:
 *                 type: number
 *                 minimum: 1
 *                 maximum: 100
 *                 description: Umbral de potencia para automatización por excedente (requerido si type=power)
 *               schedule:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required:
 *                     - id
 *                     - days
 *                     - startTime
 *                     - endTime
 *                   properties:
 *                     id:
 *                       type: number
 *                       description: ID único del slot
 *                     days:
 *                       type: array
 *                       items:
 *                         type: number
 *                         minimum: 0
 *                         maximum: 6
 *                       minItems: 1
 *                       description: Días de la semana (0=Domingo, 1=Lunes, etc.)
 *                     startTime:
 *                       type: string
 *                       pattern: '^([01]?[0-9]|2[0-3]):[0-5][0-9]$'
 *                       description: Hora de inicio (HH:MM)
 *                     endTime:
 *                       type: string
 *                       pattern: '^([01]?[0-9]|2[0-3]):[0-5][0-9]$'
 *                       description: Hora de fin (HH:MM)
 *                     enabled:
 *                       type: boolean
 *                       default: true
 *                       description: Si el slot está habilitado
 *                 description: Horarios programados (requerido si type=schedule)
 *           examples:
 *             manual:
 *               summary: Modo manual
 *               value:
 *                 type: "manual"
 *                 power: 10
 *                 schedule: []
 *             power:
 *               summary: Automatización por potencia
 *               value:
 *                 type: "power"
 *                 power: 20
 *                 schedule: []
 *             schedule:
 *               summary: Automatización horaria
 *               value:
 *                 type: "schedule"
 *                 power: 10
 *                 schedule:
 *                   - id: 1
 *                     days: [1, 2, 3, 4, 5]
 *                     startTime: "08:00"
 *                     endTime: "18:00"
 *                     enabled: true
 *                   - id: 2
 *                     days: [6, 0]
 *                     startTime: "10:00"
 *                     endTime: "16:00"
 *                     enabled: true
 *     responses:
 *       200:
 *         description: Configuración guardada exitosamente
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 operation:
 *                   type: string
 *                   enum: [created, updated]
 *                 plugId:
 *                   type: string
 *                   format: uuid
 *                 plugName:
 *                   type: string
 *                 shellyDeviceId:
 *                   type: string
 *                 configId:
 *                   type: string
 *                   format: uuid
 *                 automation:
 *                   type: object
 *                   description: Configuración guardada
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *               example:
 *                 success: true
 *                 operation: "updated"
 *                 plugId: "123e4567-e89b-12d3-a456-426614174000"
 *                 plugName: "Termo ACS"
 *                 shellyDeviceId: "shellyplusplugs-64b7080cc994"
 *                 configId: "456e7890-e89b-12d3-a456-426614174001"
 *                 automation:
 *                   type: "schedule"
 *                   power: 10
 *                   schedule:
 *                     - id: 1
 *                       days: [1, 2, 3, 4, 5]
 *                       startTime: "08:00"
 *                       endTime: "18:00"
 *                       enabled: true
 *                 timestamp: "2025-01-13T06:21:00.000Z"
 *       400:
 *         description: Datos de configuración no válidos
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       404:
 *         description: Enchufe no encontrado
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         description: No autorizado
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Error interno del servidor
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/:plugId/automation', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { plugId } = req.params;
    const automationConfig = req.body;

    // Validar que se proporcione la configuración
    if (!automationConfig || typeof automationConfig !== 'object') {
      return res.status(400).json({
        error: 'Configuración de automatización requerida',
        details: 'Debe proporcionar un objeto de configuración válido',
        timestamp: new Date().toISOString()
      });
    }

    logger.info('Solicitud de guardado de configuración de automatización', {
      userId,
      plugId,
      userEmail: req.user.email,
      automationType: automationConfig.type,
      scheduleSlots: automationConfig.schedule?.length || 0
    });

    const result = await plugsService.savePlugAutomation(plugId, userId, automationConfig);

    res.json(result);

  } catch (error) {
    logger.error('Error guardando configuración de automatización', {
      userId: req.user?.userId,
      plugId: req.params.plugId,
      error: error.message,
      automationConfig: req.body
    });

    let statusCode = 500;
    if (error.message.includes('no encontrado') || error.message.includes('no tienes permisos')) {
      statusCode = 404;
    } else if (error.message.includes('debe ser') || error.message.includes('no válida') || 
               error.message.includes('requerido') || error.message.includes('entre')) {
      statusCode = 400;
    }

    res.status(statusCode).json({
      error: 'Error guardando configuración de automatización',
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;
