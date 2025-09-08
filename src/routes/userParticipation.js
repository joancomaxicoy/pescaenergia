const express = require('express');
const { body, param, query, validationResult } = require('express-validator');
const UserParticipationService = require('../services/userParticipationService');
const { authenticateToken, requireAdmin, requireEmailValidation } = require('../middleware/auth');
const logger = require('../utils/logger');

const router = express.Router();
const userParticipationService = new UserParticipationService();

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
 *   name: User Participation
 *   description: Endpoints para gestionar la participación de usuarios en generadores de energía
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     UserParticipation:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           format: uuid
 *           description: ID único de la participación
 *         user_id:
 *           type: string
 *           format: uuid
 *           description: ID del usuario
 *         generator_code:
 *           type: string
 *           description: Código del generador
 *         participation_percentage:
 *           type: number
 *           format: decimal
 *           minimum: 0
 *           maximum: 100
 *           description: Porcentaje de participación
 *         assigned_by:
 *           type: string
 *           format: uuid
 *           description: ID del administrador que asignó la participación
 *         created_at:
 *           type: string
 *           format: date-time
 *         updated_at:
 *           type: string
 *           format: date-time
 */

// ============================================================================
// ENDPOINTS PARA ADMINISTRADORES
// ============================================================================

/**
 * @swagger
 * /api/user-participation/assign:
 *   post:
 *     summary: Asignar participación a un usuario en un generador (Solo Admins)
 *     description: Permite a los administradores asignar un porcentaje de participación a un usuario en un generador específico
 *     tags: [User Participation]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - userId
 *               - generatorCode
 *               - participationPercentage
 *             properties:
 *               userId:
 *                 type: string
 *                 format: uuid
 *                 description: ID del usuario
 *               generatorCode:
 *                 type: string
 *                 description: Código del generador
 *                 example: "giravolt"
 *               participationPercentage:
 *                 type: number
 *                 minimum: 0
 *                 maximum: 100
 *                 description: Porcentaje de participación
 *                 example: 25.5
 *     responses:
 *       201:
 *         description: Participación asignada exitosamente
 *       400:
 *         description: Error de validación
 *       401:
 *         description: No autorizado
 *       403:
 *         description: Permisos insuficientes
 *       409:
 *         description: El usuario ya tiene participación en este generador
 */
router.post('/assign',
  authenticateToken,
  requireEmailValidation,
  requireAdmin,
  [
    body('userId')
      .isUUID()
      .withMessage('userId debe ser un UUID válido'),
    body('generatorCode')
      .isString()
      .trim()
      .isLength({ min: 1 })
      .withMessage('generatorCode es requerido'),
    body('participationPercentage')
      .isFloat({ min: 0, max: 100 })
      .withMessage('participationPercentage debe ser un número entre 0 y 100')
  ],
  handleValidationErrors,
  asyncHandler(async (req, res) => {
    try {
      const { userId, generatorCode, participationPercentage } = req.body;
      const assignedBy = req.user.userId;

      const participation = await userParticipationService.assignParticipation({
        userId,
        generatorCode,
        participationPercentage,
        assignedBy
      });

      logger.info('Participación asignada por admin', {
        participationId: participation.id,
        adminId: assignedBy,
        userId,
        generatorCode,
        percentage: participationPercentage
      });

      res.status(201).json({
        message: 'Participación asignada exitosamente',
        participation,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      if (error.message.includes('ya tiene una participación')) {
        return res.status(409).json({
          error: error.message,
          code: 'PARTICIPATION_ALREADY_EXISTS',
          timestamp: new Date().toISOString()
        });
      }

      logger.error('Error asignando participación:', error);
      res.status(400).json({
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  })
);

/**
 * @swagger
 * /api/user-participation/{id}:
 *   put:
 *     summary: Actualizar participación existente (Solo Admins)
 *     description: Permite a los administradores modificar el porcentaje de participación de un usuario
 *     tags: [User Participation]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: ID de la participación
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - participationPercentage
 *             properties:
 *               participationPercentage:
 *                 type: number
 *                 minimum: 0
 *                 maximum: 100
 *                 description: Nuevo porcentaje de participación
 *     responses:
 *       200:
 *         description: Participación actualizada exitosamente
 *       400:
 *         description: Error de validación
 *       404:
 *         description: Participación no encontrada
 */
router.put('/:id',
  authenticateToken,
  requireEmailValidation,
  requireAdmin,
  [
    param('id')
      .isUUID()
      .withMessage('ID debe ser un UUID válido'),
    body('participationPercentage')
      .isFloat({ min: 0, max: 100 })
      .withMessage('participationPercentage debe ser un número entre 0 y 100')
  ],
  handleValidationErrors,
  asyncHandler(async (req, res) => {
    try {
      const { id } = req.params;
      const { participationPercentage } = req.body;
      const assignedBy = req.user.userId;

      const updatedParticipation = await userParticipationService.updateParticipation(id, {
        participationPercentage,
        assignedBy
      });

      res.json({
        message: 'Participación actualizada exitosamente',
        participation: updatedParticipation,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      if (error.message.includes('no encontrada')) {
        return res.status(404).json({
          error: error.message,
          code: 'PARTICIPATION_NOT_FOUND',
          timestamp: new Date().toISOString()
        });
      }

      logger.error('Error actualizando participación:', error);
      res.status(400).json({
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  })
);

/**
 * @swagger
 * /api/user-participation/{id}:
 *   delete:
 *     summary: Eliminar participación (Solo Admins)
 *     description: Permite a los administradores eliminar una participación de usuario
 *     tags: [User Participation]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: ID de la participación
 *     responses:
 *       200:
 *         description: Participación eliminada exitosamente
 *       404:
 *         description: Participación no encontrada
 */
router.delete('/:id',
  authenticateToken,
  requireEmailValidation,
  requireAdmin,
  [
    param('id')
      .isUUID()
      .withMessage('ID debe ser un UUID válido')
  ],
  handleValidationErrors,
  asyncHandler(async (req, res) => {
    try {
      const { id } = req.params;

      const deletedParticipation = await userParticipationService.deleteParticipation(id);

      res.json({
        message: 'Participación eliminada exitosamente',
        participation: deletedParticipation,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      if (error.message.includes('no encontrada')) {
        return res.status(404).json({
          error: error.message,
          code: 'PARTICIPATION_NOT_FOUND',
          timestamp: new Date().toISOString()
        });
      }

      logger.error('Error eliminando participación:', error);
      res.status(400).json({
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  })
);

/**
 * @swagger
 * /api/user-participation/admin/all:
 *   get:
 *     summary: Obtener todas las participaciones (Solo Admins)
 *     description: Permite a los administradores ver todas las participaciones del sistema con filtros y paginación
 *     tags: [User Participation]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           minimum: 1
 *           default: 1
 *         description: Número de página
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 50
 *         description: Elementos por página
 *       - in: query
 *         name: generatorCode
 *         schema:
 *           type: string
 *         description: Filtrar por código de generador
 *       - in: query
 *         name: userId
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Filtrar por ID de usuario
 *     responses:
 *       200:
 *         description: Lista de participaciones obtenida exitosamente
 */
router.get('/admin/all',
  authenticateToken,
  requireEmailValidation,
  requireAdmin,
  [
    query('page')
      .optional()
      .isInt({ min: 1 })
      .withMessage('page debe ser un entero mayor a 0'),
    query('limit')
      .optional()
      .isInt({ min: 1, max: 100 })
      .withMessage('limit debe ser un entero entre 1 y 100'),
    query('generatorCode')
      .optional()
      .isString()
      .trim(),
    query('userId')
      .optional()
      .isUUID()
      .withMessage('userId debe ser un UUID válido')
  ],
  handleValidationErrors,
  asyncHandler(async (req, res) => {
    try {
      const { page = 1, limit = 50, generatorCode, userId } = req.query;

      const result = await userParticipationService.getAllParticipations({
        page: parseInt(page),
        limit: parseInt(limit),
        generatorCode,
        userId
      });

      res.json({
        message: 'Participaciones obtenidas exitosamente',
        ...result,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error('Error obteniendo todas las participaciones:', error);
      res.status(400).json({
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  })
);

// ============================================================================
// ENDPOINTS PARA USUARIOS
// ============================================================================

/**
 * @swagger
 * /api/user-participation/my-participations:
 *   get:
 *     summary: Obtener mis participaciones
 *     description: Permite a un usuario ver sus propias participaciones en generadores
 *     tags: [User Participation]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Participaciones del usuario obtenidas exitosamente
 */
router.get('/my-participations',
  authenticateToken,
  requireEmailValidation,
  asyncHandler(async (req, res) => {
    try {
      const userId = req.user.userId;

      const participations = await userParticipationService.getUserParticipations(userId);

      res.json({
        message: 'Participaciones obtenidas exitosamente',
        participations,
        totalParticipations: participations.length,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error('Error obteniendo participaciones del usuario:', error);
      res.status(400).json({
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  })
);

/**
 * @swagger
 * /api/user-participation/generator/{generatorCode}:
 *   get:
 *     summary: Obtener participación en un generador específico
 *     description: Permite a un usuario ver su participación en un generador específico, o a un admin ver todas las participaciones de ese generador
 *     tags: [User Participation]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: generatorCode
 *         required: true
 *         schema:
 *           type: string
 *         description: Código del generador
 *     responses:
 *       200:
 *         description: Participación obtenida exitosamente
 *       404:
 *         description: No se encontró participación para este usuario y generador
 */
router.get('/generator/:generatorCode',
  authenticateToken,
  requireEmailValidation,
  [
    param('generatorCode')
      .isString()
      .trim()
      .isLength({ min: 1 })
      .withMessage('generatorCode es requerido')
  ],
  handleValidationErrors,
  asyncHandler(async (req, res) => {
    try {
      const { generatorCode } = req.params;
      const userId = req.user.userId;
      const isAdmin = req.user.role === 'admin';

      if (isAdmin) {
        // Los admins pueden ver todas las participaciones del generador
        const result = await userParticipationService.getGeneratorParticipations(generatorCode);
        
        res.json({
          message: 'Participaciones del generador obtenidas exitosamente',
          ...result,
          timestamp: new Date().toISOString()
        });
      } else {
        // Los usuarios solo pueden ver su propia participación
        const participation = await userParticipationService.getUserGeneratorParticipation(userId, generatorCode);
        
        if (!participation) {
          return res.status(404).json({
            error: 'No tienes participación en este generador',
            code: 'PARTICIPATION_NOT_FOUND',
            timestamp: new Date().toISOString()
          });
        }

        res.json({
          message: 'Participación obtenida exitosamente',
          participation,
          timestamp: new Date().toISOString()
        });
      }

    } catch (error) {
      logger.error('Error obteniendo participación del generador:', error);
      res.status(400).json({
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  })
);

// ============================================================================
// ENDPOINTS PÚBLICOS/INFORMATIVOS
// ============================================================================

/**
 * @swagger
 * /api/user-participation/generators:
 *   get:
 *     summary: Obtener lista de generadores disponibles
 *     description: Obtiene la lista de generadores activos disponibles para asignar participaciones
 *     tags: [User Participation]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Lista de generadores obtenida exitosamente
 */
router.get('/generators',
  authenticateToken,
  requireEmailValidation,
  asyncHandler(async (req, res) => {
    try {
      const generators = userParticipationService.getAvailableGenerators();

      res.json({
        message: 'Generadores disponibles obtenidos exitosamente',
        generators,
        totalGenerators: generators.length,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error('Error obteniendo generadores disponibles:', error);
      res.status(500).json({
        error: 'Error interno del servidor',
        timestamp: new Date().toISOString()
      });
    }
  })
);

/**
 * @swagger
 * /api/user-participation/generator/{generatorCode}/summary:
 *   get:
 *     summary: Obtener resumen de un generador (Solo Admins)
 *     description: Obtiene estadísticas resumidas de las participaciones en un generador específico
 *     tags: [User Participation]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: generatorCode
 *         required: true
 *         schema:
 *           type: string
 *         description: Código del generador
 *     responses:
 *       200:
 *         description: Resumen del generador obtenido exitosamente
 */
router.get('/generator/:generatorCode/summary',
  authenticateToken,
  requireEmailValidation,
  requireAdmin,
  [
    param('generatorCode')
      .isString()
      .trim()
      .isLength({ min: 1 })
      .withMessage('generatorCode es requerido')
  ],
  handleValidationErrors,
  asyncHandler(async (req, res) => {
    try {
      const { generatorCode } = req.params;

      const summary = await userParticipationService.getGeneratorSummary(generatorCode);

      res.json({
        message: 'Resumen del generador obtenido exitosamente',
        ...summary,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error('Error obteniendo resumen del generador:', error);
      res.status(400).json({
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  })
);

module.exports = router;
