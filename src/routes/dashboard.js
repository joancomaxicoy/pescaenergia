const express = require('express');
const { param, query, validationResult } = require('express-validator');
const DashboardService = require('../services/dashboardService');
const { authenticateToken, requireEmailValidation } = require('../middleware/auth');
const logger = require('../utils/logger');

const router = express.Router();
const dashboardService = new DashboardService();

// Middleware para manejar errores de validación
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      error: 'Errores de validación',
      details: errors.array(),
      timestamp: new Date().toISOString()
    });
  }
  next();
};

// Middleware para manejar errores async
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

/**
 * @swagger
 * tags:
 *   name: Dashboard
 *   description: Endpoints para el dashboard del usuario con datos de generadores y participaciones
 */

/**
 * @swagger
 * /api/dashboard/user-generators:
 *   get:
 *     summary: Obtiene los datos del dashboard del usuario
 *     description: Retorna los generadores en los que el usuario tiene participación junto con sus métricas más recientes
 *     tags: [Dashboard]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Datos del dashboard obtenidos exitosamente
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 hasParticipations:
 *                   type: boolean
 *                   description: Indica si el usuario tiene participaciones
 *                 generators:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       generatorCode:
 *                         type: string
 *                         example: "giravolt"
 *                       generatorName:
 *                         type: string
 *                         example: "Giravolt"
 *                       participationPercentage:
 *                         type: number
 *                         example: 25.5
 *                       isActive:
 *                         type: boolean
 *                         example: true
 *                       metrics:
 *                         type: object
 *                         properties:
 *                           power:
 *                             type: number
 *                             description: Potencia en kW
 *                           voltage:
 *                             type: number
 *                             description: Tensión en V
 *                           frequency:
 *                             type: number
 *                             description: Frecuencia en Hz
 *                       lastUpdate:
 *                         type: string
 *                         format: date-time
 *                       hasData:
 *                         type: boolean
 *                 totalParticipations:
 *                   type: integer
 *                 activeGenerators:
 *                   type: integer
 *       401:
 *         description: No autorizado
 *       500:
 *         description: Error interno del servidor
 */
router.get('/user-generators',
  authenticateToken,
  requireEmailValidation,
  asyncHandler(async (req, res) => {
    try {
      const userId = req.user.userId;

      const dashboardData = await dashboardService.getUserDashboardData(userId);

      logger.info('Datos del dashboard solicitados', {
        userId,
        hasParticipations: dashboardData.hasParticipations,
        generatorsCount: dashboardData.generators?.length || 0
      });

      res.json({
        message: 'Datos del dashboard obtenidos exitosamente',
        ...dashboardData,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error('Error obteniendo datos del dashboard:', {
        userId: req.user?.userId,
        error: error.message,
        stack: error.stack
      });

      res.status(500).json({
        error: 'Error interno del servidor',
        details: process.env.NODE_ENV !== 'production' ? error.message : undefined,
        timestamp: new Date().toISOString()
      });
    }
  })
);

/**
 * @swagger
 * /api/dashboard/generator/{generatorCode}/evolution:
 *   get:
 *     summary: Obtiene la evolución temporal de un generador
 *     description: Retorna los datos históricos de métricas para un generador específico
 *     tags: [Dashboard]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: generatorCode
 *         required: true
 *         schema:
 *           type: string
 *         description: Código del generador
 *         example: "giravolt"
 *       - in: query
 *         name: period
 *         schema:
 *           type: string
 *           enum: ['1h', '24h', '7d', '30d']
 *           default: '24h'
 *         description: Período de tiempo para la evolución
 *     responses:
 *       200:
 *         description: Evolución del generador obtenida exitosamente
 *       400:
 *         description: Error de validación o usuario sin participación
 *       404:
 *         description: Generador no encontrado
 */
router.get('/generator/:generatorCode/evolution',
  authenticateToken,
  requireEmailValidation,
  [
    param('generatorCode')
      .isString()
      .trim()
      .isLength({ min: 1 })
      .withMessage('generatorCode es requerido'),
    query('period')
      .optional()
      .isIn(['1h', '24h', '7d', '30d'])
      .withMessage('period debe ser uno de: 1h, 24h, 7d, 30d')
  ],
  handleValidationErrors,
  asyncHandler(async (req, res) => {
    try {
      const userId = req.user.userId;
      const { generatorCode } = req.params;
      const { period = '24h' } = req.query;

      const evolutionData = await dashboardService.getGeneratorEvolution(userId, generatorCode, period);

      res.json({
        message: 'Evolución del generador obtenida exitosamente',
        ...evolutionData,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      if (error.message.includes('No tienes participación')) {
        return res.status(400).json({
          error: error.message,
          code: 'NO_PARTICIPATION',
          timestamp: new Date().toISOString()
        });
      }

      if (error.message.includes('no encontrado')) {
        return res.status(404).json({
          error: error.message,
          code: 'GENERATOR_NOT_FOUND',
          timestamp: new Date().toISOString()
        });
      }

      logger.error('Error obteniendo evolución del generador:', {
        userId: req.user?.userId,
        generatorCode: req.params?.generatorCode,
        error: error.message
      });

      res.status(500).json({
        error: 'Error interno del servidor',
        details: process.env.NODE_ENV !== 'production' ? error.message : undefined,
        timestamp: new Date().toISOString()
      });
    }
  })
);

/**
 * @swagger
 * /api/dashboard/stats:
 *   get:
 *     summary: Obtiene estadísticas resumidas del dashboard
 *     description: Retorna estadísticas generales sobre las participaciones del usuario
 *     tags: [Dashboard]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Estadísticas obtenidas exitosamente
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 totalParticipations:
 *                   type: integer
 *                   description: Número total de participaciones
 *                 totalPercentage:
 *                   type: number
 *                   description: Suma total de porcentajes de participación
 *                 activeGenerators:
 *                   type: integer
 *                   description: Número de generadores activos
 *                 averageParticipation:
 *                   type: number
 *                   description: Porcentaje promedio de participación
 */
router.get('/stats',
  authenticateToken,
  requireEmailValidation,
  asyncHandler(async (req, res) => {
    try {
      const userId = req.user.userId;

      const stats = await dashboardService.getDashboardStats(userId);

      res.json({
        message: 'Estadísticas del dashboard obtenidas exitosamente',
        stats,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error('Error obteniendo estadísticas del dashboard:', {
        userId: req.user?.userId,
        error: error.message
      });

      res.status(500).json({
        error: 'Error interno del servidor',
        details: process.env.NODE_ENV !== 'production' ? error.message : undefined,
        timestamp: new Date().toISOString()
      });
    }
  })
);

/**
 * @swagger
 * /api/dashboard/historical-chart:
 *   get:
 *     summary: Obtiene datos históricos para el gráfico combinado
 *     description: Retorna datos históricos de consumo CUPS y generación de todos los generadores con participación
 *     tags: [Dashboard]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: period
 *         schema:
 *           type: string
 *           enum: ['24h', '7d', '30d']
 *           default: '24h'
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
 *                 labels:
 *                   type: array
 *                   items:
 *                     type: string
 *                   description: Timestamps para el eje X
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
 *                       borderColor:
 *                         type: string
 *                       backgroundColor:
 *                         type: string
 *                       type:
 *                         type: string
 *                         enum: ['consumption', 'generation']
 *       401:
 *         description: No autorizado
 *       500:
 *         description: Error interno del servidor
 */
router.get('/historical-chart',
  authenticateToken,
  requireEmailValidation,
  [
    query('period')
      .optional()
      .isIn(['24h', '7d', '30d'])
      .withMessage('period debe ser uno de: 24h, 7d, 30d')
  ],
  handleValidationErrors,
  asyncHandler(async (req, res) => {
    try {
      const userId = req.user.userId;
      const { period = '24h' } = req.query;

      const historicalData = await dashboardService.getHistoricalChartData(userId, period);

      logger.info('Datos históricos del gráfico solicitados', {
        userId,
        period,
        datasetsCount: historicalData.datasets?.length || 0
      });

      res.json({
        message: 'Datos históricos obtenidos exitosamente',
        ...historicalData,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error('Error obteniendo datos históricos del gráfico:', {
        userId: req.user?.userId,
        period: req.query?.period,
        error: error.message,
        stack: error.stack
      });

      res.status(500).json({
        error: 'Error interno del servidor',
        details: process.env.NODE_ENV !== 'production' ? error.message : undefined,
        timestamp: new Date().toISOString()
      });
    }
  })
);

/**
 * @swagger
 * /api/dashboard/health:
 *   get:
 *     summary: Verifica la salud del servicio de dashboard
 *     description: Realiza un health check del servicio de dashboard y sus dependencias
 *     tags: [Dashboard]
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
 *                 services:
 *                   type: object
 *                   properties:
 *                     userParticipation:
 *                       type: boolean
 *                     deviceHistory:
 *                       type: boolean
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *       500:
 *         description: Servicio no saludable
 */
router.get('/health',
  asyncHandler(async (req, res) => {
    try {
      const healthStatus = await dashboardService.healthCheck();

      const statusCode = healthStatus.status === 'healthy' ? 200 : 500;

      res.status(statusCode).json({
        message: `Servicio de dashboard ${healthStatus.status}`,
        ...healthStatus
      });

    } catch (error) {
      logger.error('Health check del dashboard falló:', error);

      res.status(500).json({
        status: 'unhealthy',
        error: 'Health check falló',
        details: process.env.NODE_ENV !== 'production' ? error.message : undefined,
        timestamp: new Date().toISOString()
      });
    }
  })
);

module.exports = router;
