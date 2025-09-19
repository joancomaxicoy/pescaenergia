const express = require('express');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { sanitizeInput } = require('../middleware/validation');
const database = require('../utils/database');
const logger = require('../utils/logger');
const User = require('../models/User');
const CupsService = require('../services/cupsService');
const emailService = require('../services/emailService');
const crypto = require('crypto');

const router = express.Router();

/**
 * @swagger
 * components:
 *   schemas:
 *     Device:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *         user_cups:
 *           type: string
 *         device_shelly_id:
 *           type: string
 *         device_name:
 *           type: string
 *         device_type:
 *           type: string
 *         created_at:
 *           type: string
 *           format: date-time
 *         updated_at:
 *           type: string
 *           format: date-time
 */

/**
 * @swagger
 * /api/admin/devices:
 *   get:
 *     summary: Obtener todos los dispositivos (solo admin)
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Lista de todos los dispositivos
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Device'
 *       401:
 *         description: No autenticado
 *       403:
 *         description: No autorizado (no es admin)
 */
router.get('/devices',
  authenticateToken,
  requireAdmin,
  async (req, res) => {
    try {
      // Asegurar que la conexión esté establecida
      if (!database.pool) {
        await database.connect();
      }
      
      const query = `
        SELECT 
          id,
          user_id,
          shelly_device_id,
          device_name,
          device_type,
          created_at,
          updated_at
        FROM devices 
        ORDER BY created_at DESC
      `;
      
      const result = await database.query(query);
      
      res.json({
        success: true,
        data: result.rows
      });
    } catch (error) {
      logger.error('Error obteniendo dispositivos para admin:', error);
      res.status(500).json({
        success: false,
        error: 'Error interno del servidor'
      });
    }
  }
);

/**
 * @swagger
 * /api/admin/devices/user/{userId}:
 *   get:
 *     summary: Obtener dispositivos por user_id (solo admin)
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID del usuario
 *     responses:
 *       200:
 *         description: Lista de dispositivos del usuario especificado
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Device'
 *       401:
 *         description: No autenticado
 *       403:
 *         description: No autorizado (no es admin)
 */
router.get('/devices/user/:userId',
  authenticateToken,
  requireAdmin,
  sanitizeInput,
  async (req, res) => {
    try {
      const { userId } = req.params;
      
      const query = `
        SELECT 
          id,
          user_id,
          shelly_device_id,
          device_name,
          device_type,
          created_at,
          updated_at
        FROM devices 
        WHERE user_id = $1
        ORDER BY created_at DESC
      `;
      
      const result = await database.query(query, [userId]);
      
      res.json({
        success: true,
        data: result.rows
      });
    } catch (error) {
      logger.error('Error obteniendo dispositivos por user_id para admin:', error);
      res.status(500).json({
        success: false,
        error: 'Error interno del servidor'
      });
    }
  }
);

/**
 * @swagger
 * /api/admin/users:
 *   get:
 *     summary: Obtener todos los usuarios (solo admin)
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Lista de todos los usuarios
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/User'
 *       401:
 *         description: No autenticado
 *       403:
 *         description: No autorizado (no es admin)
 */
router.get('/users',
  authenticateToken,
  requireAdmin,
  async (req, res) => {
    try {
      // Asegurar que la conexión esté establecida
      if (!database.pool) {
        await database.connect();
      }
      
      const query = `
        SELECT 
          id,
          name,
          email,
          cups,
          role,
          email_validated,
          created_at,
          updated_at
        FROM users 
        ORDER BY created_at DESC
      `;
      
      const result = await database.query(query);
      
      res.json({
        success: true,
        data: result.rows
      });
    } catch (error) {
      logger.error('Error obteniendo usuarios para admin:', error);
      res.status(500).json({
        success: false,
        error: 'Error interno del servidor'
      });
    }
  }
);

/**
 * @swagger
 * /api/admin/participations:
 *   get:
 *     summary: Obtener todas las participaciones (solo admin)
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Lista de todas las participaciones
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                       user_id:
 *                         type: string
 *                       user_name:
 *                         type: string
 *                       user_email:
 *                         type: string
 *                       generator_code:
 *                         type: string
 *                       participation_percentage:
 *                         type: string
 *                       assigned_by:
 *                         type: string
 *                       created_at:
 *                         type: string
 *                       updated_at:
 *                         type: string
 *       401:
 *         description: No autenticado
 *       403:
 *         description: No autorizado (no es admin)
 */
router.get('/participations',
  authenticateToken,
  requireAdmin,
  async (req, res) => {
    try {
      // Asegurar que la conexión esté establecida
      if (!database.pool) {
        await database.connect();
      }
      
      const query = `
        SELECT 
          up.id,
          up.user_id,
          u.name as user_name,
          u.email as user_email,
          up.generator_code,
          up.participation_percentage,
          up.assigned_by,
          up.created_at,
          up.updated_at
        FROM user_participation up
        LEFT JOIN users u ON up.user_id = u.id
        ORDER BY up.created_at DESC
      `;
      
      const result = await database.query(query);
      
      res.json({
        success: true,
        data: result.rows
      });
    } catch (error) {
      logger.error('Error obteniendo participaciones para admin:', error);
      res.status(500).json({
        success: false,
        error: 'Error interno del servidor'
      });
    }
  }
);

/**
 * @swagger
 * /api/admin/participations:
 *   post:
 *     summary: Crear nueva participación (solo admin)
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - user_id
 *               - generator_code
 *               - participation_percentage
 *             properties:
 *               user_id:
 *                 type: string
 *               generator_code:
 *                 type: string
 *               participation_percentage:
 *                 type: number
 *     responses:
 *       201:
 *         description: Participación creada exitosamente
 *       400:
 *         description: Datos inválidos
 *       401:
 *         description: No autenticado
 *       403:
 *         description: No autorizado (no es admin)
 */
router.post('/participations',
  authenticateToken,
  requireAdmin,
  sanitizeInput,
  async (req, res) => {
    try {
      // Asegurar que la conexión esté establecida
      if (!database.pool) {
        await database.connect();
      }
      
      const { user_id, generator_code, participation_percentage } = req.body;
      
      // Validar datos requeridos
      if (!user_id || !generator_code || !participation_percentage) {
        return res.status(400).json({
          success: false,
          error: 'Faltan campos requeridos: user_id, generator_code, participation_percentage'
        });
      }
      
      // Verificar que el usuario existe
      const userCheck = await database.query('SELECT id FROM users WHERE id = $1', [user_id]);
      if (userCheck.rows.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'Usuario no encontrado'
        });
      }
      
      // Crear la participación
      const query = `
        INSERT INTO user_participation (user_id, generator_code, participation_percentage, assigned_by)
        VALUES ($1, $2, $3, $4)
        RETURNING *
      `;
      
      const result = await database.query(query, [
        user_id, 
        generator_code, 
        participation_percentage, 
        req.user.userId
      ]);
      
      res.status(201).json({
        success: true,
        data: result.rows[0],
        message: 'Participación creada exitosamente'
      });
    } catch (error) {
      logger.error('Error creando participación:', error);
      res.status(500).json({
        success: false,
        error: 'Error interno del servidor'
      });
    }
  }
);

/**
 * @swagger
 * /api/admin/participations/{id}:
 *   put:
 *     summary: Actualizar participación (solo admin)
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID de la participación
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               generator_code:
 *                 type: string
 *               participation_percentage:
 *                 type: number
 *     responses:
 *       200:
 *         description: Participación actualizada exitosamente
 *       400:
 *         description: Datos inválidos
 *       404:
 *         description: Participación no encontrada
 *       401:
 *         description: No autenticado
 *       403:
 *         description: No autorizado (no es admin)
 */
router.put('/participations/:id',
  authenticateToken,
  requireAdmin,
  sanitizeInput,
  async (req, res) => {
    try {
      // Asegurar que la conexión esté establecida
      if (!database.pool) {
        await database.connect();
      }
      
      const { id } = req.params;
      const { generator_code, participation_percentage } = req.body;
      
      // Verificar que la participación existe
      const existingParticipation = await database.query(
        'SELECT id FROM user_participation WHERE id = $1', 
        [id]
      );
      
      if (existingParticipation.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'Participación no encontrada'
        });
      }
      
      // Actualizar la participación
      const query = `
        UPDATE user_participation 
        SET 
          generator_code = COALESCE($1, generator_code),
          participation_percentage = COALESCE($2, participation_percentage),
          updated_at = NOW()
        WHERE id = $3
        RETURNING *
      `;
      
      const result = await database.query(query, [
        generator_code, 
        participation_percentage, 
        id
      ]);
      
      res.json({
        success: true,
        data: result.rows[0],
        message: 'Participación actualizada exitosamente'
      });
    } catch (error) {
      logger.error('Error actualizando participación:', error);
      res.status(500).json({
        success: false,
        error: 'Error interno del servidor'
      });
    }
  }
);

/**
 * @swagger
 * /api/admin/participations/{id}:
 *   delete:
 *     summary: Eliminar participación (solo admin)
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID de la participación
 *     responses:
 *       200:
 *         description: Participación eliminada exitosamente
 *       404:
 *         description: Participación no encontrada
 *       401:
 *         description: No autenticado
 *       403:
 *         description: No autorizado (no es admin)
 */
router.delete('/participations/:id',
  authenticateToken,
  requireAdmin,
  sanitizeInput,
  async (req, res) => {
    try {
      // Asegurar que la conexión esté establecida
      if (!database.pool) {
        await database.connect();
      }
      
      const { id } = req.params;
      
      // Verificar que la participación existe
      const existingParticipation = await database.query(
        'SELECT id FROM user_participation WHERE id = $1', 
        [id]
      );
      
      if (existingParticipation.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'Participación no encontrada'
        });
      }
      
      // Eliminar la participación
      await database.query('DELETE FROM user_participation WHERE id = $1', [id]);
      
      res.json({
        success: true,
        message: 'Participación eliminada exitosamente'
      });
    } catch (error) {
      logger.error('Error eliminando participación:', error);
      res.status(500).json({
        success: false,
        error: 'Error interno del servidor'
      });
    }
  }
);

/**
 * @swagger
 * /api/admin/stats:
 *   get:
 *     summary: Obtener estadísticas generales (solo admin)
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Estadísticas del sistema
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     totalUsers:
 *                       type: integer
 *                     totalDevices:
 *                       type: integer
 *                     verifiedUsers:
 *                       type: integer
 *                     devicesByType:
 *                       type: object
 *       401:
 *         description: No autenticado
 *       403:
 *         description: No autorizado (no es admin)
 */
router.get('/stats',
  authenticateToken,
  requireAdmin,
  async (req, res) => {
    try {
      // Obtener estadísticas básicas
      const statsQueries = await Promise.all([
        database.query('SELECT COUNT(*) as total FROM users'),
        database.query('SELECT COUNT(*) as total FROM devices'),
        database.query('SELECT COUNT(*) as total FROM users WHERE email_validated = true'),
        database.query(`
          SELECT device_type, COUNT(*) as count 
          FROM devices 
          GROUP BY device_type 
          ORDER BY count DESC
        `)
      ]);

      const totalUsers = parseInt(statsQueries[0].rows[0].total);
      const totalDevices = parseInt(statsQueries[1].rows[0].total);
      const verifiedUsers = parseInt(statsQueries[2].rows[0].total);
      const devicesByType = statsQueries[3].rows.reduce((acc, row) => {
        acc[row.device_type] = parseInt(row.count);
        return acc;
      }, {});

      res.json({
        success: true,
        data: {
          totalUsers,
          totalDevices,
          verifiedUsers,
          devicesByType
        }
      });
    } catch (error) {
      logger.error('Error obteniendo estadísticas para admin:', error);
      res.status(500).json({
        success: false,
        error: 'Error interno del servidor'
      });
    }
  }
);

/**
 * @swagger
 * /api/admin/register:
 *   post:
 *     summary: Registrar nuevo usuario (solo admin)
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - email
 *               - cups
 *             properties:
 *               name:
 *                 type: string
 *                 description: Nombre del usuario
 *               email:
 *                 type: string
 *                 format: email
 *                 description: Email del usuario
 *               cups:
 *                 type: string
 *                 description: CUPS a asignar al usuario
 *     responses:
 *       201:
 *         description: Usuario creado exitosamente
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 user:
 *                   $ref: '#/components/schemas/User'
 *                 device:
 *                   type: object
 *                 message:
 *                   type: string
 *       400:
 *         description: Datos inválidos o usuario/CUPS ya existe
 *       401:
 *         description: No autenticado
 *       403:
 *         description: No autorizado (no es admin)
 */
router.post('/register',
  authenticateToken,
  requireAdmin,
  sanitizeInput,
  async (req, res) => {
    try {
      const { name, email, cups } = req.body;

      // Validar campos requeridos
      if (!name || !email || !cups) {
        return res.status(400).json({
          success: false,
          error: 'Faltan campos requeridos: name, email, cups'
        });
      }

      // Validar formato de email básico
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({
          success: false,
          error: 'Formato de email inválido'
        });
      }

      // Verificar si el usuario ya existe
      const existingUser = await User.findByEmail(email);
      if (existingUser) {
        return res.status(400).json({
          success: false,
          error: 'Ya existe un usuario con este email'
        });
      }

      // Verificar si el CUPS ya está asignado
      const existingCups = await CupsService.getCupsInfo(cups);
      if (existingCups && existingCups.is_assigned) {
        return res.status(400).json({
          success: false,
          error: 'Este CUPS ya está asignado a otro usuario'
        });
      }

      // Crear el usuario con password temporal
      const user = await User.createWithTempPassword({
        email: email.toLowerCase().trim(),
        name: name.trim(),
        role: 'user',
        email_validated: false,
        cups: cups.trim()
      });

      // Asignar el CUPS y crear el device
      const deviceResult = await CupsService.assignCups(
        cups.trim(),
        req.user.userId, // Admin que hace la asignación
        'admin',
        user.id // Usuario objetivo
      );

      // Generar token de verificación de email
      const verificationToken = await user.generateEmailVerificationToken();

      // Enviar email de activación
      await emailService.sendEmailVerification(user, verificationToken);

      logger.info('Usuario creado por admin exitosamente', {
        adminId: req.user.userId,
        newUserId: user.id,
        email: user.email,
        cups: cups.trim()
      });

      res.status(201).json({
        success: true,
        user: user.toJSON(),
        device: deviceResult.device,
        message: 'Usuario creado exitosamente. Se ha enviado un email de activación.'
      });

    } catch (error) {
      logger.error('Error en registro por admin:', error);
      
      if (error.message.includes('Ya existe un usuario')) {
        return res.status(400).json({
          success: false,
          error: error.message
        });
      }

      if (error.message.includes('CUPS')) {
        return res.status(400).json({
          success: false,
          error: error.message
        });
      }

      res.status(500).json({
        success: false,
        error: 'Error interno del servidor'
      });
    }
  }
);

module.exports = router;
