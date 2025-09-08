const express = require('express');
const { body, param, query, validationResult } = require('express-validator');
const configLoader = require('../utils/configLoader');
const DeviceHistoryService = require('../services/deviceHistoryService');
const logger = require('../utils/logger');

const router = express.Router();
const deviceHistoryService = new DeviceHistoryService();

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

// Middleware para validar que el generador existe
const validateGenerator = asyncHandler(async (req, res, next) => {
  const { generatorCode } = req.params;
  
  try {
    const generatorsConfig = configLoader.loadEnergyGenerators();
    
    if (!generatorsConfig[generatorCode] || !generatorsConfig[generatorCode].active) {
      return res.status(404).json({
        error: 'Generador no encontrado',
        generatorCode,
        availableGenerators: Object.keys(generatorsConfig).filter(code => generatorsConfig[code].active),
        timestamp: new Date().toISOString()
      });
    }
    
    // Agregar información del generador al request para uso posterior
    req.generatorInfo = {
      code: generatorCode,
      name: generatorsConfig[generatorCode].name,
      mqtt_topic: generatorsConfig[generatorCode].mqtt_topic
    };
    
    next();
  } catch (error) {
    logger.error('Error validando generador:', {
      generatorCode,
      error: error.message
    });
    
    res.status(500).json({
      error: 'Error validando generador',
      details: process.env.NODE_ENV !== 'production' ? error.message : undefined,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @swagger
 * tags:
 *   name: Generators
 *   description: Endpoints para obtener información sobre los generadores de energía disponibles
 */

/**
 * @swagger
 * /api/generators:
 *   get:
 *     summary: Obtiene la lista de generadores de energía disponibles
 *     description: Retorna todos los generadores de energía activos configurados en el sistema con su código y nombre. Este endpoint es público y no requiere autenticación.
 *     tags: [Generators]
 *     responses:
 *       200:
 *         description: Lista de generadores obtenida exitosamente
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 generators:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       code:
 *                         type: string
 *                         description: Código único del generador
 *                         example: "giravolt"
 *                       name:
 *                         type: string
 *                         description: Nombre descriptivo del generador
 *                         example: "Giravolt"
 *                 totalGenerators:
 *                   type: integer
 *                   description: Número total de generadores activos
 *                   example: 2
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *                   description: Timestamp de la respuesta
 *                   example: "2025-01-09T12:48:54.000Z"
 *             example:
 *               generators:
 *                 - code: "giravolt"
 *                   name: "Giravolt"
 *                 - code: "residencia"
 *                   name: "Residència"
 *               totalGenerators: 2
 *               timestamp: "2025-01-09T12:48:54.000Z"
 *       500:
 *         description: Error interno del servidor
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   description: Mensaje de error
 *                   example: "Error cargando configuración de generadores"
 *                 details:
 *                   type: string
 *                   description: Detalles adicionales del error
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *                   description: Timestamp del error
 */
router.get('/',
  handleValidationErrors,
  asyncHandler(async (req, res) => {
    try {
      // Cargar la configuración de generadores desde el archivo YAML
      const generatorsConfig = configLoader.loadEnergyGenerators();
      
      // Filtrar solo los generadores activos y transformar la estructura
      const activeGenerators = Object.entries(generatorsConfig)
        .filter(([code, config]) => config.active === true)
        .map(([code, config]) => ({
          code: code,
          name: config.name
        }));

      logger.info('Generadores obtenidos exitosamente', {
        totalGenerators: activeGenerators.length,
        generators: activeGenerators.map(g => g.code)
      });

      res.json({
        generators: activeGenerators,
        totalGenerators: activeGenerators.length,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error('Error obteniendo generadores:', {
        error: error.message,
        stack: error.stack
      });

      res.status(500).json({
        error: 'Error cargando configuración de generadores',
        details: process.env.NODE_ENV !== 'production' ? error.message : undefined,
        timestamp: new Date().toISOString()
      });
    }
  })
);

/**
 * @swagger
 * /api/generators/{generatorCode}/metrics/latest:
 *   get:
 *     summary: Obtiene las métricas más recientes de un generador
 *     description: Retorna las últimas métricas registradas para un generador específico. Opcionalmente se pueden filtrar métricas específicas. Este endpoint es público y no requiere autenticación.
 *     tags: [Generators]
 *     parameters:
 *       - in: path
 *         name: generatorCode
 *         required: true
 *         schema:
 *           type: string
 *           minLength: 1
 *           maxLength: 50
 *         description: Código del generador (ej. giravolt, residencia)
 *         example: "giravolt"
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
 *         example: "power_generation_avg,voltage_avg"
 *     responses:
 *       200:
 *         description: Métricas más recientes obtenidas exitosamente
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DeviceMetrics'
 *             example:
 *               deviceId: "giravolt"
 *               timestamp: "2025-01-09T18:30:00Z"
 *               metrics:
 *                 power_generation_avg: 850.0
 *                 voltage_avg: 230.2
 *                 energy_total_sum: 1250.5
 *               totalMetrics: 3
 *       400:
 *         description: Error de validación
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       404:
 *         description: Generador no encontrado
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
router.get('/:generatorCode/metrics/latest',
  [
    param('generatorCode')
      .isString()
      .isLength({ min: 1, max: 50 })
      .withMessage('generatorCode debe ser un string válido'),
    query('metrics')
      .optional()
      .isString()
      .withMessage('metrics debe ser una cadena de texto')
  ],
  handleValidationErrors,
  validateGenerator,
  asyncHandler(async (req, res) => {
    const { generatorCode } = req.params;
    const { metrics } = req.query;

    // Procesar métricas específicas si se proporcionan
    let metricNames = null;
    if (metrics) {
      metricNames = metrics.split(',').map(m => m.trim()).filter(m => m.length > 0);
    }

    const result = await deviceHistoryService.getLatestMetrics(generatorCode, metricNames);
    
    logger.info('Métricas más recientes de generador obtenidas', {
      generatorCode,
      generatorName: req.generatorInfo.name,
      metricsCount: result.totalMetrics,
      requestedMetrics: metricNames
    });

    res.json(result);
  })
);

/**
 * @swagger
 * /api/generators/{generatorCode}/metrics/{metricName}/evolution:
 *   get:
 *     summary: Obtiene la evolución temporal de una métrica específica de un generador
 *     description: Retorna la evolución de una métrica en un rango de fechas con agregación temporal configurable. Este endpoint es público y no requiere autenticación.
 *     tags: [Generators]
 *     parameters:
 *       - in: path
 *         name: generatorCode
 *         required: true
 *         schema:
 *           type: string
 *           minLength: 1
 *           maxLength: 50
 *         description: Código del generador (ej. giravolt, residencia)
 *         example: "giravolt"
 *       - in: path
 *         name: metricName
 *         required: true
 *         schema:
 *           type: string
 *         description: Nombre de la métrica a consultar
 *         example: "power_generation_avg"
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
 *         description: Generador no encontrado
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
router.get('/:generatorCode/metrics/:metricName/evolution',
  [
    param('generatorCode')
      .isString()
      .isLength({ min: 1, max: 50 })
      .withMessage('generatorCode debe ser un string válido'),
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
  validateGenerator,
  asyncHandler(async (req, res) => {
    const { generatorCode, metricName } = req.params;
    const { startDate, endDate, aggregation = '1h', limit } = req.query;

    const result = await deviceHistoryService.getMetricEvolution(
      generatorCode,
      metricName,
      startDate,
      endDate,
      aggregation,
      limit ? parseInt(limit) : null
    );

    logger.info('Evolución de métrica de generador obtenida', {
      generatorCode,
      generatorName: req.generatorInfo.name,
      metricName,
      aggregation,
      dataPoints: result.totalPoints,
      dateRange: `${startDate} - ${endDate}`
    });

    res.json(result);
  })
);

/**
 * @swagger
 * /api/generators/{generatorCode}/metrics:
 *   get:
 *     summary: Obtiene múltiples métricas de un generador en un rango de tiempo
 *     description: Retorna múltiples métricas para un generador en un período específico con agregación temporal. Este endpoint es público y no requiere autenticación.
 *     tags: [Generators]
 *     parameters:
 *       - in: path
 *         name: generatorCode
 *         required: true
 *         schema:
 *           type: string
 *           minLength: 1
 *           maxLength: 50
 *         description: Código del generador (ej. giravolt, residencia)
 *         example: "giravolt"
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
 *         name: metrics
 *         required: false
 *         schema:
 *           type: array
 *           items:
 *             type: string
 *         style: form
 *         explode: false
 *         description: Lista de métricas específicas (separadas por comas)
 *         example: "power_generation_avg,energy_total_sum"
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
 *         description: Generador no encontrado
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
router.get('/:generatorCode/metrics',
  [
    param('generatorCode')
      .isString()
      .isLength({ min: 1, max: 50 })
      .withMessage('generatorCode debe ser un string válido'),
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
  validateGenerator,
  asyncHandler(async (req, res) => {
    const { generatorCode } = req.params;
    const { startDate, endDate, metrics, aggregation = '1h', limit = 1000 } = req.query;

    // Procesar métricas específicas si se proporcionan
    let metricNames = null;
    if (metrics) {
      metricNames = metrics.split(',').map(m => m.trim()).filter(m => m.length > 0);
    }

    const result = await deviceHistoryService.getDeviceMetrics(
      generatorCode,
      startDate,
      endDate,
      metricNames,
      aggregation,
      parseInt(limit)
    );

    logger.info('Métricas múltiples de generador obtenidas', {
      generatorCode,
      generatorName: req.generatorInfo.name,
      metricsCount: result.totalMetrics,
      totalDataPoints: result.totalDataPoints,
      requestedMetrics: metricNames,
      dateRange: `${startDate} - ${endDate}`
    });

    res.json(result);
  })
);

/**
 * @swagger
 * /api/generators/{generatorCode}/info:
 *   get:
 *     summary: Obtiene información básica de un generador
 *     description: Retorna los metadatos y información básica de un generador específico. Este endpoint es público y no requiere autenticación.
 *     tags: [Generators]
 *     parameters:
 *       - in: path
 *         name: generatorCode
 *         required: true
 *         schema:
 *           type: string
 *           minLength: 1
 *           maxLength: 50
 *         description: Código del generador (ej. giravolt, residencia)
 *         example: "giravolt"
 *     responses:
 *       200:
 *         description: Información del generador obtenida exitosamente
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DeviceInfo'
 *             example:
 *               id: "giravolt"
 *               device_name: "Giravolt"
 *               device_type: "GENERATOR"
 *               shelly_device_id: "giravolt"
 *               created_at: "2025-01-09T18:30:00Z"
 *               user_cups: null
 *               user_name: null
 *               mqtt_topic: "Dades-Fotovoltaiques-consum-giravolt32"
 *       400:
 *         description: Error de validación
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       404:
 *         description: Generador no encontrado
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
router.get('/:generatorCode/info',
  [
    param('generatorCode')
      .isString()
      .isLength({ min: 1, max: 50 })
      .withMessage('generatorCode debe ser un string válido')
  ],
  handleValidationErrors,
  validateGenerator,
  asyncHandler(async (req, res) => {
    const { generatorCode } = req.params;

    const result = await deviceHistoryService.getDeviceInfo(generatorCode);
    
    if (!result) {
      return res.status(404).json({
        error: 'Generador no encontrado',
        generatorCode,
        timestamp: new Date().toISOString()
      });
    }

    logger.info('Información de generador obtenida', {
      generatorCode,
      generatorName: req.generatorInfo.name,
      deviceType: result.device_type
    });

    res.json(result);
  })
);

/**
 * @swagger
 * /api/generators/{generatorCode}/metrics/available:
 *   get:
 *     summary: Obtiene las métricas disponibles para un generador
 *     description: Retorna una lista de todas las métricas que están disponibles para un generador específico. Este endpoint es público y no requiere autenticación.
 *     tags: [Generators]
 *     parameters:
 *       - in: path
 *         name: generatorCode
 *         required: true
 *         schema:
 *           type: string
 *           minLength: 1
 *           maxLength: 50
 *         description: Código del generador (ej. giravolt, residencia)
 *         example: "giravolt"
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
 *               deviceId: "giravolt"
 *               availableMetrics:
 *                 - "power_generation_avg"
 *                 - "power_generation_max"
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
 *         description: Generador no encontrado
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
router.get('/:generatorCode/metrics/available',
  [
    param('generatorCode')
      .isString()
      .isLength({ min: 1, max: 50 })
      .withMessage('generatorCode debe ser un string válido')
  ],
  handleValidationErrors,
  validateGenerator,
  asyncHandler(async (req, res) => {
    const { generatorCode } = req.params;

    // Verificar que el generador existe
    const deviceExists = await deviceHistoryService.validateDevice(generatorCode);
    if (!deviceExists) {
      return res.status(404).json({
        error: 'Generador no encontrado',
        generatorCode,
        timestamp: new Date().toISOString()
      });
    }

    const availableMetrics = await deviceHistoryService.getAvailableMetrics(generatorCode);

    logger.info('Métricas disponibles de generador obtenidas', {
      generatorCode,
      generatorName: req.generatorInfo.name,
      totalMetrics: availableMetrics.length,
      metrics: availableMetrics
    });

    res.json({
      deviceId: generatorCode,
      availableMetrics,
      totalMetrics: availableMetrics.length
    });
  })
);

/**
 * @swagger
 * /api/generators/health:
 *   get:
 *     summary: Verifica la salud del servicio de generadores
 *     description: Realiza un health check del servicio de generadores verificando que el archivo de configuración sea accesible.
 *     tags: [Generators]
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
 *                   example: "healthy"
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *                   example: "2025-01-09T12:48:54.000Z"
 *                 service:
 *                   type: string
 *                   example: "GeneratorsService"
 *                 configFile:
 *                   type: string
 *                   description: Ruta del archivo de configuración
 *                 totalGenerators:
 *                   type: integer
 *                   description: Número de generadores cargados
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
 *                   example: "GeneratorsService"
 *                 error:
 *                   type: string
 *                   description: Descripción del error
 */
router.get('/health',
  asyncHandler(async (req, res) => {
    try {
      // Intentar cargar la configuración para verificar que todo funciona
      const generatorsConfig = configLoader.loadEnergyGenerators();
      const totalGenerators = Object.keys(generatorsConfig).length;

      res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        service: 'GeneratorsService',
        configFile: 'energy-generators.yml',
        totalGenerators
      });

    } catch (error) {
      logger.error('Health check falló para generadores:', error);

      res.status(500).json({
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        service: 'GeneratorsService',
        error: 'No se pudo cargar la configuración de generadores'
      });
    }
  })
);

module.exports = router;
