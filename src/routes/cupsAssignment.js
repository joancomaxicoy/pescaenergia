const express = require('express');
const { body, param, validationResult } = require('express-validator');
const CupsService = require('../services/cupsService');
const { authenticateToken, requireEmailValidation, requireAdmin } = require('../middleware/auth');
const logger = require('../utils/logger');

const router = express.Router();

/**
 * @swagger
 * components:
 *   schemas:
 *     CupsAssignmentRequest:
 *       type: object
 *       required:
 *         - cups
 *       properties:
 *         cups:
 *           type: string
 *           description: El CUPS a asignar
 *           example: "ES0031446450479001ZC0F"
 *         user_id:
 *           type: string
 *           description: ID del usuario objetivo (solo para administradores)
 *           example: "123e4567-e89b-12d3-a456-426614174000"
 *     
 *     CupsAssignmentResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: true
 *         device:
 *           type: object
 *           properties:
 *             id:
 *               type: string
 *             shelly_device_id:
 *               type: string
 *             device_name:
 *               type: string
 *             device_type:
 *               type: string
 *             user_id:
 *               type: string
 *             user_name:
 *               type: string
 *             user_email:
 *               type: string
 *         operation:
 *           type: string
 *           enum: [created, assigned]
 *         previousUserId:
 *           type: string
 *           nullable: true
 *         message:
 *           type: string
 *     
 *     CupsInfo:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *         shelly_device_id:
 *           type: string
 *         device_name:
 *           type: string
 *         device_type:
 *           type: string
 *         user_id:
 *           type: string
 *         user_name:
 *           type: string
 *           nullable: true
 *         user_email:
 *           type: string
 *           nullable: true
 *         is_assigned:
 *           type: boolean
 *         created_at:
 *           type: string
 *           format: date-time
 *         updated_at:
 *           type: string
 *           format: date-time
 */

/**
 * @swagger
 * /api/cups/assign:
 *   post:
 *     summary: Asignar un CUPS a un usuario
 *     description: |
 *       Asigna un CUPS a un usuario. El comportamiento varía según el rol:
 *       - **Usuarios normales**: Solo pueden asignarse CUPS a sí mismos
 *       - **Administradores**: Pueden asignar CUPS a cualquier usuario y reasignar CUPS ya asignados
 *     tags: [CUPS Management]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CupsAssignmentRequest'
 *           examples:
 *             usuario_normal:
 *               summary: Usuario normal se asigna CUPS
 *               value:
 *                 cups: "ES0031446450479001ZC0F"
 *             admin_asigna:
 *               summary: Admin asigna CUPS a usuario específico
 *               value:
 *                 cups: "ES0031446450479001ZC0F"
 *                 user_id: "123e4567-e89b-12d3-a456-426614174000"
 *     responses:
 *       200:
 *         description: CUPS asignado exitosamente
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/CupsAssignmentResponse'
 *       400:
 *         description: Error de validación
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             examples:
 *               cups_ya_asignado:
 *                 summary: CUPS ya asignado
 *                 value:
 *                   error: "Este CUPS ya está asignado a otro usuario. Solo un administrador puede reasignarlo."
 *                   timestamp: "2025-01-09T18:30:00Z"
 *               cups_invalido:
 *                 summary: CUPS inválido
 *                 value:
 *                   error: "CUPS inválido"
 *                   timestamp: "2025-01-09T18:30:00Z"
 *       401:
 *         description: No autorizado
 *       403:
 *         description: Email no verificado o permisos insuficientes
 *       404:
 *         description: Usuario objetivo no encontrado
 *       500:
 *         description: Error interno del servidor
 */
router.post('/assign',
  authenticateToken,
  requireEmailValidation,
  [
    body('cups')
      .notEmpty()
      .withMessage('CUPS es requerido')
      .isString()
      .withMessage('CUPS debe ser una cadena de texto')
      .trim()
      .isLength({ min: 1, max: 50 })
      .withMessage('CUPS debe tener entre 1 y 50 caracteres'),
    body('user_id')
      .optional()
      .isUUID()
      .withMessage('user_id debe ser un UUID válido')
  ],
  async (req, res) => {
    try {
      // Validar errores de entrada
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          error: 'Datos de entrada inválidos',
          details: errors.array(),
          timestamp: new Date().toISOString()
        });
      }

      const { cups, user_id } = req.body;
      const requestingUserId = req.user.userId;
      const requestingUserRole = req.user.role;

      // Validar que solo admins pueden usar el parámetro user_id
      if (user_id && requestingUserRole !== 'admin') {
        return res.status(403).json({
          error: 'Solo los administradores pueden asignar CUPS a otros usuarios',
          timestamp: new Date().toISOString()
        });
      }

      const result = await CupsService.assignCups(
        cups,
        requestingUserId,
        requestingUserRole,
        user_id
      );

      res.json(result);

    } catch (error) {
      logger.error('Error en endpoint de asignación de CUPS:', {
        error: error.message,
        userId: req.user.userId,
        cups: req.body.cups
      });

      res.status(400).json({
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  }
);

/**
 * @swagger
 * /api/cups/{cups}/info:
 *   get:
 *     summary: Obtener información de un CUPS
 *     description: Obtiene información detallada de un CUPS específico
 *     tags: [CUPS Management]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: cups
 *         required: true
 *         schema:
 *           type: string
 *         description: El CUPS a consultar
 *         example: "ES0031446450479001ZC0F"
 *     responses:
 *       200:
 *         description: Información del CUPS
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/CupsInfo'
 *       404:
 *         description: CUPS no encontrado
 *       401:
 *         description: No autorizado
 *       403:
 *         description: Email no verificado
 */
router.get('/:cups/info',
  authenticateToken,
  requireEmailValidation,
  [
    param('cups')
      .notEmpty()
      .withMessage('CUPS es requerido')
      .isString()
      .withMessage('CUPS debe ser una cadena de texto')
      .trim()
      .isLength({ min: 1, max: 50 })
      .withMessage('CUPS debe tener entre 1 y 50 caracteres')
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          error: 'Parámetros inválidos',
          details: errors.array(),
          timestamp: new Date().toISOString()
        });
      }

      const { cups } = req.params;
      const cupsInfo = await CupsService.getCupsInfo(cups);

      if (!cupsInfo) {
        return res.status(404).json({
          error: 'CUPS no encontrado',
          timestamp: new Date().toISOString()
        });
      }

      // Los usuarios normales solo pueden ver información de sus propios CUPS
      if (req.user.role !== 'admin' && cupsInfo.user_id !== req.user.userId) {
        return res.status(403).json({
          error: 'No tienes permisos para ver información de este CUPS',
          timestamp: new Date().toISOString()
        });
      }

      res.json(cupsInfo);

    } catch (error) {
      logger.error('Error obteniendo información de CUPS:', {
        error: error.message,
        cups: req.params.cups,
        userId: req.user.userId
      });

      res.status(500).json({
        error: 'Error interno del servidor',
        timestamp: new Date().toISOString()
      });
    }
  }
);

/**
 * @swagger
 * /api/cups/list:
 *   get:
 *     summary: Listar todos los CUPS (solo administradores)
 *     description: Obtiene una lista de todos los CUPS del sistema con su estado de asignación
 *     tags: [CUPS Management]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Lista de CUPS
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 cups:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/CupsInfo'
 *                 total:
 *                   type: integer
 *                 assigned:
 *                   type: integer
 *                 unassigned:
 *                   type: integer
 *       401:
 *         description: No autorizado
 *       403:
 *         description: Permisos insuficientes (solo administradores)
 */
router.get('/list',
  authenticateToken,
  requireEmailValidation,
  requireAdmin,
  async (req, res) => {
    try {
      const cupsList = await CupsService.listAllCups();
      
      const stats = {
        total: cupsList.length,
        assigned: cupsList.filter(c => c.is_assigned).length,
        unassigned: cupsList.filter(c => !c.is_assigned).length
      };

      res.json({
        cups: cupsList,
        ...stats
      });

    } catch (error) {
      logger.error('Error listando CUPS:', {
        error: error.message,
        userId: req.user.userId
      });

      res.status(500).json({
        error: 'Error interno del servidor',
        timestamp: new Date().toISOString()
      });
    }
  }
);

/**
 * @swagger
 * /api/cups/{cups}/unassign:
 *   post:
 *     summary: Desasignar un CUPS (solo administradores)
 *     description: Desasigna un CUPS de su usuario actual, dejándolo disponible para reasignación
 *     tags: [CUPS Management]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: cups
 *         required: true
 *         schema:
 *           type: string
 *         description: El CUPS a desasignar
 *         example: "ES0031446450479001ZC0F"
 *     responses:
 *       200:
 *         description: CUPS desasignado exitosamente
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 previousUserId:
 *                   type: string
 *       400:
 *         description: Error de validación
 *       401:
 *         description: No autorizado
 *       403:
 *         description: Permisos insuficientes (solo administradores)
 *       404:
 *         description: CUPS no encontrado
 */
router.post('/:cups/unassign',
  authenticateToken,
  requireEmailValidation,
  requireAdmin,
  [
    param('cups')
      .notEmpty()
      .withMessage('CUPS es requerido')
      .isString()
      .withMessage('CUPS debe ser una cadena de texto')
      .trim()
      .isLength({ min: 1, max: 50 })
      .withMessage('CUPS debe tener entre 1 y 50 caracteres')
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          error: 'Parámetros inválidos',
          details: errors.array(),
          timestamp: new Date().toISOString()
        });
      }

      const { cups } = req.params;
      const result = await CupsService.unassignCups(cups);

      res.json(result);

    } catch (error) {
      logger.error('Error desasignando CUPS:', {
        error: error.message,
        cups: req.params.cups,
        userId: req.user.userId
      });

      if (error.message === 'CUPS no encontrado') {
        return res.status(404).json({
          error: error.message,
          timestamp: new Date().toISOString()
        });
      }

      res.status(400).json({
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  }
);

module.exports = router;
