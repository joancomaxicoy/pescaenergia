const express = require('express');
const { body, param, query, validationResult } = require('express-validator');
const DeviceHistoryService = require('../services/deviceHistoryService');
const logger = require('../utils/logger');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { optionalAuthWithDeviceAccess, logDeviceAccess } = require('../middleware/deviceAuth');

const router = express.Router();
const deviceHistoryService = new DeviceHistoryService();

// Middleware para manejar errores de validación
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      error: 'Errors de validació',
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
 *   name: Device History
 *   description: Endpoints para consultar el historial de métricas de dispositivos energéticos
 */

/**
 * @swagger
 * /api/devices/{deviceId}/metrics/latest:
 *   get:
 *     summary: Obtiene las métricas más recientes de un dispositivo
 *     description: Retorna las últimas métricas registradas para un dispositivo específico. Opcionalmente se pueden filtrar métricas específicas. Para generadores públicos (giravolt, residencia) no requiere autenticación. Para dispositivos privados requiere autenticación y ownership.
 *     tags: [Device History]
 *     security:
 *       - bearerAuth: []
 *       - {}
 *     parameters:
 *       - in: path
 *         name: deviceId
 *         required: true
 *         schema:
 *           type: string
 *           minLength: 1
 *           maxLength: 100
 *         description: ID del dispositivo (UUID o shelly_device_id)
 *         example: "123e4567-e89b-12d3-a456-426614174000"
 *       - in: query
 *         name: metrics
 *         required: false
 *         schema:
 *           type: array
 *           items:
 *             type: string
 *         style: form
 *         explode: false
 *         description: Lista de métricas específicas a obtener (separadas por comas)
 *         example: "power_consumption_avg,voltage_avg"
 *     responses:
 *       200:
 *         description: Métricas más recientes obtenidas exitosamente
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DeviceMetrics'
 *             example:
 *               deviceId: "123e4567-e89b-12d3-a456-426614174000"
 *               timestamp: "2025-01-09T18:30:00Z"
 *               metrics:
 *                 power_consumption_avg: 1250.5
 *                 voltage_avg: 230.2
 *                 power_generation_avg: 850.0
 *               totalMetrics: 3
 *       400:
 *         description: Error de validación
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       404:
 *         description: Dispositivo no encontrado
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
router.get('/:deviceId/metrics/latest',
  [
    param('deviceId')
      .isString()
      .isLength({ min: 1, max: 100 })
      .withMessage('deviceId debe ser un string válido'),
    query('metrics')
      .optional()
      .isString()
      .withMessage('metrics debe ser una cadena de texto')
  ],
  handleValidationErrors,
  ...optionalAuthWithDeviceAccess,
  logDeviceAccess,
  asyncHandler(async (req, res) => {
    const { deviceId } = req.params;
    const { metrics } = req.query;

    // Procesar métricas específicas si se proporcionan
    let metricNames = null;
    if (metrics) {
      metricNames = metrics.split(',').map(m => m.trim()).filter(m => m.length > 0);
    }

    const result = await deviceHistoryService.getLatestMetrics(deviceId, metricNames);
    res.json(result);
  })
);

/**
 * @swagger
 * /api/devices/{deviceId}/metrics/{metricName}/evolution:
 *   get:
 *     summary: Obtiene la evolución temporal de una métrica específica
 *     description: Retorna la evolución de una métrica en un rango de fechas con agregación temporal configurable. Para generadores públicos (giravolt, residencia) no requiere autenticación. Para dispositivos privados requiere autenticación y ownership.
 *     tags: [Device History]
 *     security:
 *       - bearerAuth: []
 *       - {}
 *     parameters:
 *       - in: path
 *         name: deviceId
 *         required: true
 *         schema:
 *           type: string
 *           minLength: 1
 *           maxLength: 100
 *         description: ID del dispositivo (UUID o shelly_device_id)
 *       - in: path
 *         name: metricName
 *         required: true
 *         schema:
 *           type: string
 *         description: Nombre de la métrica a consultar
 *         example: "power_consumption_avg"
 *       - in: query
 *         name: startDate
 *         required: true
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Fecha de inicio del rango
 *         example: "2025-01-08T00:00:00Z"
 *       - in: query
 *         name: endDate
 *         required: true
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Fecha de fin del rango
 *         example: "2025-01-09T00:00:00Z"
 *       - in: query
 *         name: aggregation
 *         required: false
 *         schema:
 *           type: string
 *           enum: ['1m', '5m', '15m', '30m', '1h', '2h', '6h', '12h', '1d', '1w', '1M']
 *           default: '1h'
 *         description: Nivel de agregación temporal
 *       - in: query
 *         name: limit
 *         required: false
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 10000
 *         description: Límite máximo de puntos de datos
 *     responses:
 *       200:
 *         description: Evolución de métrica obtenida exitosamente
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/MetricEvolution'
 *       400:
 *         description: Error de validación
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       404:
 *         description: Dispositivo no encontrado
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
router.get('/:deviceId/metrics/:metricName/evolution',
  [
    param('deviceId')
      .isString()
      .isLength({ min: 1, max: 100 })
      .withMessage('deviceId debe ser un string válido'),
    param('metricName')
      .isString()
      .isLength({ min: 1, max: 100 })
      .withMessage('metricName debe ser una cadena válida'),
    query('startDate')
      .isISO8601()
      .withMessage('startDate debe ser una fecha válida en formato ISO8601'),
    query('endDate')
      .isISO8601()
      .withMessage('endDate debe ser una fecha válida en formato ISO8601'),
    query('aggregation')
      .optional()
      .isIn(['1m', '5m', '15m', '30m', '1h', '2h', '6h', '12h', '1d', '1w', '1M'])
      .withMessage('aggregation debe ser un valor válido'),
    query('limit')
      .optional()
      .isInt({ min: 1, max: 10000 })
      .withMessage('limit debe ser un entero entre 1 y 10000')
  ],
  handleValidationErrors,
  ...optionalAuthWithDeviceAccess,
  logDeviceAccess,
  asyncHandler(async (req, res) => {
    const { deviceId, metricName } = req.params;
    const { startDate, endDate, aggregation = '1h', limit } = req.query;

    const result = await deviceHistoryService.getMetricEvolution(
      deviceId,
      metricName,
      startDate,
      endDate,
      aggregation,
      limit ? parseInt(limit) : null
    );

    res.json(result);
  })
);

/**
 * @swagger
 * /api/devices/{deviceId}/metrics:
 *   get:
 *     summary: Obtiene múltiples métricas de un dispositivo en un rango de tiempo
 *     description: Retorna múltiples métricas para un dispositivo en un período específico con agregación temporal. Para generadores públicos (giravolt, residencia) no requiere autenticación. Para dispositivos privados requiere autenticación y ownership.
 *     tags: [Device History]
 *     security:
 *       - bearerAuth: []
 *       - {}
 *     parameters:
 *       - in: path
 *         name: deviceId
 *         required: true
 *         schema:
 *           type: string
 *           minLength: 1
 *           maxLength: 100
 *         description: ID del dispositivo (UUID o shelly_device_id)
 *       - in: query
 *         name: startDate
 *         required: true
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Fecha de inicio del rango
 *       - in: query
 *         name: endDate
 *         required: true
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Fecha de fin del rango
 *       - in: query
 *         name: metrics
 *         required: false
 *         schema:
 *           type: array
 *           items:
 *             type: string
 *         style: form
 *         explode: false
 *         description: Lista de métricas específicas (separadas por comas)
 *       - in: query
 *         name: aggregation
 *         required: false
 *         schema:
 *           type: string
 *           enum: ['1m', '5m', '15m', '30m', '1h', '2h', '6h', '12h', '1d', '1w', '1M']
 *           default: '1h'
 *         description: Nivel de agregación temporal
 *       - in: query
 *         name: limit
 *         required: false
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 10000
 *           default: 1000
 *         description: Límite máximo de resultados
 *     responses:
 *       200:
 *         description: Métricas múltiples obtenidas exitosamente
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 deviceId:
 *                   type: string
 *                 aggregation:
 *                   type: string
 *                 period:
 *                   type: object
 *                   properties:
 *                     start:
 *                       type: string
 *                       format: date-time
 *                     end:
 *                       type: string
 *                       format: date-time
 *                 metrics:
 *                   type: object
 *                   additionalProperties:
 *                     type: array
 *                     items:
 *                       type: object
 *                       properties:
 *                         timestamp:
 *                           type: string
 *                           format: date-time
 *                         value:
 *                           type: number
 *                         min:
 *                           type: number
 *                         max:
 *                           type: number
 *                         dataPoints:
 *                           type: integer
 *                 totalMetrics:
 *                   type: integer
 *                 totalDataPoints:
 *                   type: integer
 *                 queryTime:
 *                   type: integer
 *       400:
 *         description: Error de validación
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       404:
 *         description: Dispositivo no encontrado
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
router.get('/:deviceId/metrics',
  [
    param('deviceId')
      .isString()
      .isLength({ min: 1, max: 100 })
      .withMessage('deviceId debe ser un string válido'),
    query('startDate')
      .isISO8601()
      .withMessage('startDate debe ser una fecha válida en formato ISO8601'),
    query('endDate')
      .isISO8601()
      .withMessage('endDate debe ser una fecha válida en formato ISO8601'),
    query('metrics')
      .optional()
      .isString()
      .withMessage('metrics debe ser una cadena de texto'),
    query('aggregation')
      .optional()
      .isIn(['1m', '5m', '15m', '30m', '1h', '2h', '6h', '12h', '1d', '1w', '1M'])
      .withMessage('aggregation debe ser un valor válido'),
    query('limit')
      .optional()
      .isInt({ min: 1, max: 10000 })
      .withMessage('limit debe ser un entero entre 1 y 10000')
  ],
  handleValidationErrors,
  ...optionalAuthWithDeviceAccess,
  logDeviceAccess,
  asyncHandler(async (req, res) => {
    const { deviceId } = req.params;
    const { startDate, endDate, metrics, aggregation = '1h', limit = 1000 } = req.query;

    // Procesar métricas específicas si se proporcionan
    let metricNames = null;
    if (metrics) {
      metricNames = metrics.split(',').map(m => m.trim()).filter(m => m.length > 0);
    }

    const result = await deviceHistoryService.getDeviceMetrics(
      deviceId,
      startDate,
      endDate,
      metricNames,
      aggregation,
      parseInt(limit)
    );

    res.json(result);
  })
);

/**
 * @swagger
 * /api/devices/{deviceId}/info:
 *   get:
 *     summary: Obtiene información básica de un dispositivo
 *     description: Retorna los metadatos y información básica de un dispositivo específico. Para generadores públicos (giravolt, residencia) no requiere autenticación. Para dispositivos privados requiere autenticación y ownership.
 *     tags: [Device History]
 *     security:
 *       - bearerAuth: []
 *       - {}
 *     parameters:
 *       - in: path
 *         name: deviceId
 *         required: true
 *         schema:
 *           type: string
 *           minLength: 1
 *           maxLength: 100
 *         description: ID del dispositivo (UUID o shelly_device_id)
 *     responses:
 *       200:
 *         description: Información del dispositivo obtenida exitosamente
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DeviceInfo'
 *       400:
 *         description: Error de validación
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       404:
 *         description: Dispositivo no encontrado
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
router.get('/:deviceId/info',
  [
    param('deviceId')
      .isString()
      .isLength({ min: 1, max: 100 })
      .withMessage('deviceId debe ser un string válido')
  ],
  handleValidationErrors,
  ...optionalAuthWithDeviceAccess,
  logDeviceAccess,
  asyncHandler(async (req, res) => {
    const { deviceId } = req.params;

    const result = await deviceHistoryService.getDeviceInfo(deviceId);
    
    if (!result) {
      return res.status(404).json({
        error: 'Dispositiu no trobat',
        deviceId,
        timestamp: new Date().toISOString()
      });
    }

    res.json(result);
  })
);

/**
 * @swagger
 * /api/devices/{deviceId}/metrics/available:
 *   get:
 *     summary: Obtiene las métricas disponibles para un dispositivo
 *     description: Retorna una lista de todas las métricas que están disponibles para un dispositivo específico. Para generadores públicos (giravolt, residencia) no requiere autenticación. Para dispositivos privados requiere autenticación y ownership.
 *     tags: [Device History]
 *     security:
 *       - bearerAuth: []
 *       - {}
 *     parameters:
 *       - in: path
 *         name: deviceId
 *         required: true
 *         schema:
 *           type: string
 *           minLength: 1
 *           maxLength: 100
 *         description: ID del dispositivo (UUID o shelly_device_id)
 *     responses:
 *       200:
 *         description: Lista de métricas disponibles obtenida exitosamente
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 deviceId:
 *                   type: string
 *                 availableMetrics:
 *                   type: array
 *                   items:
 *                     type: string
 *                   description: Lista de nombres de métricas disponibles
 *                 totalMetrics:
 *                   type: integer
 *                   description: Número total de métricas disponibles
 *             example:
 *               deviceId: "123e4567-e89b-12d3-a456-426614174000"
 *               availableMetrics:
 *                 - "power_consumption_avg"
 *                 - "power_consumption_max"
 *                 - "voltage_avg"
 *                 - "energy_total_sum"
 *               totalMetrics: 4
 *       400:
 *         description: Error de validación
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       404:
 *         description: Dispositivo no encontrado
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
router.get('/:deviceId/metrics/available',
  [
    param('deviceId')
      .isString()
      .isLength({ min: 1, max: 100 })
      .withMessage('deviceId debe ser un string válido')
  ],
  handleValidationErrors,
  ...optionalAuthWithDeviceAccess,
  logDeviceAccess,
  asyncHandler(async (req, res) => {
    const { deviceId } = req.params;

    // Verificar que el dispositivo existe
    const deviceExists = await deviceHistoryService.validateDevice(deviceId);
    if (!deviceExists) {
      return res.status(404).json({
        error: 'Dispositiu no trobat',
        deviceId,
        timestamp: new Date().toISOString()
      });
    }

    const availableMetrics = await deviceHistoryService.getAvailableMetrics(deviceId);

    res.json({
      deviceId,
      availableMetrics,
      totalMetrics: availableMetrics.length
    });
  })
);

/**
 * @swagger
 * /api/devices/history/stats:
 *   get:
 *     summary: Obtiene estadísticas del servicio de historial
 *     description: Retorna estadísticas detalladas sobre el rendimiento y uso del servicio de historial de dispositivos.
 *     tags: [Device History]
 *     responses:
 *       200:
 *         description: Estadísticas obtenidas exitosamente
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 totalQueries:
 *                   type: integer
 *                   description: Número total de consultas realizadas
 *                 totalLatestMetricsQueries:
 *                   type: integer
 *                   description: Consultas de métricas más recientes
 *                 totalEvolutionQueries:
 *                   type: integer
 *                   description: Consultas de evolución temporal
 *                 totalErrors:
 *                   type: integer
 *                   description: Número total de errores
 *                 averageQueryTime:
 *                   type: integer
 *                   description: Tiempo promedio de consulta en milisegundos
 *                 totalQueryTime:
 *                   type: integer
 *                   description: Tiempo total de consultas en milisegundos
 *                 cacheHits:
 *                   type: integer
 *                   description: Número de aciertos en cache
 *                 cacheMisses:
 *                   type: integer
 *                   description: Número de fallos en cache
 *                 cacheSize:
 *                   type: integer
 *                   description: Tamaño actual del cache
 *                 cacheHitRate:
 *                   type: string
 *                   description: Porcentaje de aciertos en cache
 *                 limits:
 *                   type: object
 *                   properties:
 *                     maxDataPoints:
 *                       type: integer
 *                     maxDaysRange:
 *                       type: integer
 *                     defaultPageSize:
 *                       type: integer
 *       500:
 *         description: Error interno del servidor
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/history/stats',
  asyncHandler(async (req, res) => {
    const stats = deviceHistoryService.getStats();
    res.json(stats);
  })
);

/**
 * @swagger
 * /api/devices/history/health:
 *   get:
 *     summary: Verifica la salud del servicio de historial
 *     description: Realiza un health check del servicio de historial de dispositivos y su conectividad con la base de datos.
 *     tags: [Device History]
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
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *                 service:
 *                   type: string
 *                   example: "DeviceHistoryService"
 *       500:
 *         description: Servicio no saludable
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: "unhealthy"
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *                 service:
 *                   type: string
 *                   example: "DeviceHistoryService"
 *                 error:
 *                   type: string
 */
router.get('/history/health',
  asyncHandler(async (req, res) => {
    const isHealthy = await deviceHistoryService.healthCheck();
    
    const response = {
      status: isHealthy ? 'healthy' : 'unhealthy',
      timestamp: new Date().toISOString(),
      service: 'DeviceHistoryService'
    };

    if (!isHealthy) {
      response.error = 'Health check falló - revisar logs para más detalles';
      return res.status(500).json(response);
    }

    res.json(response);
  })
);

/**
 * @swagger
 * /api/devices/history/cache/clear:
 *   post:
 *     summary: Limpia el cache del servicio de historial
 *     description: Limpia el cache de metadatos de dispositivos del servicio de historial. Requiere autenticación y permisos de administrador.
 *     tags: [Device History]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Cache limpiado exitosamente
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "Cache limpiado exitosamente"
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *                 previousCacheSize:
 *                   type: integer
 *                   description: Tamaño del cache antes de limpiar
 *       500:
 *         description: Error interno del servidor
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/history/cache/clear',
  authenticateToken,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const previousStats = deviceHistoryService.getStats();
    const previousCacheSize = previousStats.cacheSize;
    
    deviceHistoryService.clearCache();
    
    res.json({
      message: 'Cache netejada correctament',
      timestamp: new Date().toISOString(),
      previousCacheSize
    });
  })
);

/**
 * @swagger
 * /api/devices/history/stats/reset:
 *   post:
 *     summary: Resetea las estadísticas del servicio de historial
 *     description: Resetea todas las estadísticas de rendimiento del servicio de historial de dispositivos. Requiere autenticación y permisos de administrador.
 *     tags: [Device History]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Estadísticas reseteadas exitosamente
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "Estadísticas reseteadas exitosamente"
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *       500:
 *         description: Error interno del servidor
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/history/stats/reset',
  authenticateToken,
  requireAdmin,
  asyncHandler(async (req, res) => {
    deviceHistoryService.resetStats();
    
    res.json({
      message: 'Estadístiques restablertes correctament',
      timestamp: new Date().toISOString()
    });
  })
);

module.exports = router;
