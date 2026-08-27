const express = require('express');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { sanitizeInput, validateUpdateUser } = require('../middleware/validation');
const database = require('../utils/database');
const logger = require('../utils/logger');
const User = require('../models/User');
const CupsService = require('../services/cupsService');
const emailService = require('../services/emailService');
const configLoader = require('../utils/configLoader');
const cryptoService = require('../services/cryptoService');
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
          dni,
          cups,
          role,
          (clau_datadis IS NOT NULL AND clau_datadis <> '') AS datadis_configured,
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
 * /api/admin/users/{id}:
 *   put:
 *     summary: Actualizar un usuario (solo admin)
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID del usuario
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               email:
 *                 type: string
 *                 format: email
 *               cups:
 *                 type: string
 *     responses:
 *       200:
 *         description: Usuario actualizado
 *       404:
 *         description: Usuario no encontrado
 *       409:
 *         description: El email ya está en uso
 */
router.put('/users/:id',
  authenticateToken,
  requireAdmin,
  sanitizeInput,
  validateUpdateUser,
  async (req, res) => {
    try {
      // Asegurar que la conexión esté establecida
      if (!database.pool) {
        await database.connect();
      }

      const { id } = req.params;
      const { name, email, cups, dni, clau_datadis } = req.body;

      const existingUser = await User.findById(id);
      if (!existingUser) {
        return res.status(404).json({
          success: false,
          error: 'Usuari no trobat'
        });
      }

      // Si es canvia l'email, validar que no estigui en ús
      let emailChanged = false;
      const cleanEmail = email ? email.toLowerCase().trim() : null;
      if (cleanEmail && cleanEmail !== existingUser.email.toLowerCase()) {
        const conflict = await User.findByEmail(cleanEmail);
        if (conflict && conflict.id !== id) {
          return res.status(409).json({
            success: false,
            error: 'Ja existeix un usuari amb aquest email'
          });
        }
        emailChanged = true;
      }

      // Gestionar el canvi de CUPS (canvi de domicili)
      const newCups = cups ? cups.trim() : null;
      const oldCups = existingUser.cups ? existingUser.cups.trim() : null;
      if (newCups !== oldCups) {
        // Alliberar el CUPS antic
        if (oldCups) {
          try {
            await CupsService.unassignCups(oldCups);
          } catch (err) {
            logger.warn('No s\'ha pogut alliberar el CUPS anterior', { cups: oldCups, error: err.message });
          }
        }

        // Assignar el CUPS nou (crea el device si no existeix)
        if (newCups) {
          await CupsService.assignCups(newCups, req.user.userId, 'admin', id);
        }
      }

      // Actualitzar els camps bàsics
      const fields = [];
      const values = [];
      let paramCount = 1;

      if (name !== undefined) {
        fields.push(`name = $${paramCount++}`);
        values.push(name.trim());
      }

      if (cleanEmail !== null) {
        fields.push(`email = $${paramCount++}`);
        values.push(cleanEmail);
        if (emailChanged) {
          fields.push('email_validated = false');
          fields.push('email_verification_token = NULL');
          fields.push('email_verification_expires = NULL');
        }
      }

      // DNI/NIE del soci
      if (dni !== undefined) {
        fields.push(`dni = $${paramCount++}`);
        values.push(dni ? dni.trim().toUpperCase() : null);
      }

      // Clau d'accés a Datadis: s'encripta abans de desar.
      // Si ve buida o null es deixa/cap el valor actual.
      if (clau_datadis !== undefined) {
        fields.push(`clau_datadis = $${paramCount++}`);
        values.push(clau_datadis !== '' ? cryptoService.encrypt(clau_datadis) : existingUser.clau_datadis);
      }

      if (fields.length === 0) {
        return res.json({
          success: true,
          data: existingUser.toJSON(),
          message: 'No hi ha cap camp per actualitzar'
        });
      }

      fields.push('updated_at = NOW()');
      values.push(id);

      const updateResult = await database.query(
        `UPDATE users SET ${fields.join(', ')} WHERE id = $${paramCount} RETURNING *`,
        values
      );

      const updatedUser = new User(updateResult.rows[0]);

      // Reenviar email de confirmació si ha canviat l'email
      let responseMessage = 'Usuari actualitzat correctament';
      if (emailChanged) {
        try {
          const verificationToken = await updatedUser.generateEmailVerificationToken();
          await emailService.sendEmailVerification(updatedUser, verificationToken);
          responseMessage = 'Usuari actualitzat correctament. S\'ha enviat un email de confirmació al nou correu.';
        } catch (err) {
          logger.error('Error enviant l\'email de confirmació', { error: err.message });
          responseMessage = 'Usuari actualitzat correctament, però no s\'ha pogut enviar l\'email de confirmació.';
        }
      }

      res.json({
        success: true,
        data: updatedUser.toJSON(),
        message: responseMessage
      });
    } catch (error) {
      logger.error('Error actualizando usuario:', error);
      res.status(500).json({
        success: false,
        error: 'Error intern del servidor'
      });
    }
  }
);

/**
 * @swagger
 * /api/admin/users/{id}:
 *   delete:
 *     summary: Eliminar un usuario (solo admin)
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID del usuario
 *     responses:
 *       200:
 *         description: Usuario eliminado
 *       400:
 *         description: No se puede eliminar el propio usuario
 *       404:
 *         description: Usuario no encontrado
 */
router.delete('/users/:id',
  authenticateToken,
  requireAdmin,
  sanitizeInput,
  async (req, res) => {
    const client = await database.getClient();

    try {
      const { id } = req.params;

      if (id === req.user.userId) {
        return res.status(400).json({
          success: false,
          error: 'No pots eliminar el teu propi usuari'
        });
      }

      const existingUser = await User.findById(id);
      if (!existingUser) {
        return res.status(404).json({
          success: false,
          error: 'Usuari no trobat'
        });
      }

      await client.query('BEGIN');

      // Participacions que aquest usuari va assignar: deixar-les sense responsable
      await client.query(
        'UPDATE user_participation SET assigned_by = NULL, updated_at = NOW() WHERE assigned_by = $1',
        [id]
      );

      // Dispositius del seu CUPS: desassignar perquè quedi lliure per al proper resident
      await client.query(
        "UPDATE devices SET user_id = 'not_assigned', updated_at = NOW() WHERE user_id = $1",
        [id]
      );

      // Eliminar l'usuari (participacions i balanc_energetic s'esborren en cascada per FK)
      await client.query('DELETE FROM users WHERE id = $1', [id]);

      await client.query('COMMIT');

      res.json({
        success: true,
        message: 'Usuari eliminat correctament'
      });
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Error eliminando usuario:', error);
      res.status(500).json({
        success: false,
        error: 'Error intern del servidor'
      });
    } finally {
      client.release();
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
          error: 'Falten camps obligatoris: user_id, generator_code, participation_percentage'
        });
      }
      
      // Verificar que el usuario existe
      const userCheck = await database.query('SELECT id FROM users WHERE id = $1', [user_id]);
      if (userCheck.rows.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'Usuari no trobat'
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
        message: 'Participació creada correctament'
      });
    } catch (error) {
      logger.error('Error creando participación:', error);
      if (error.code === '23505') {
        return res.status(409).json({
          success: false,
          error: 'Aquest usuari ja té una participació en aquest generador'
        });
      }
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
          error: 'Participació no trobada'
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
        message: 'Participació actualitzada correctament'
      });
    } catch (error) {
      logger.error('Error actualizando participación:', error);
      if (error.code === '23505') {
        return res.status(409).json({
          success: false,
          error: 'Aquest usuari ja té una participació en aquest generador'
        });
      }
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
          error: 'Participació no trobada'
        });
      }
      
      // Eliminar la participación
      await database.query('DELETE FROM user_participation WHERE id = $1', [id]);
      
      res.json({
        success: true,
        message: 'Participació eliminada correctament'
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
const GENERATOR_SCALES = {
  'giravolt': 100,
  'sala-polivalent': 1000,
  'residencia': 1000,
};

/**
 * @swagger
 * /api/admin/consumptions:
 *   get:
 *     summary: Obtener consumos y generación por socio (solo admin)
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *           format: date
 *         description: Fecha inicio (YYYY-MM-DD). Por defecto hace 30 días
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *           format: date
 *         description: Fecha fin (YYYY-MM-DD). Por defecto hoy
 *     responses:
 *       200:
 *         description: Consumos por socio
 *       401:
 *         description: No autenticado
 *       403:
 *         description: No autorizado (no es admin)
 */
router.get('/consumptions',
  authenticateToken,
  requireAdmin,
  async (req, res) => {
    try {
      if (!database.pool) {
        await database.connect();
      }

      const toDate = req.query.to || new Date().toISOString().slice(0, 10);
      const fromDate = req.query.from ||
        new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
      const fromTs = `${fromDate} 00:00:00+00`;
      const toTs = `${toDate} 23:59:59+00`;

      const targetUsedPct = parseFloat(req.query.targetUsedPct);
      const targetUsed = Number.isFinite(targetUsedPct)
        ? Math.min(100, Math.max(1, targetUsedPct))
        : 30;

      // Socis = usuaris amb CUPS assignat
      const usersResult = await database.query(
        `SELECT id, name, email, cups
         FROM users
         WHERE cups IS NOT NULL AND cups <> ''
         ORDER BY name`
      );

      if (usersResult.rows.length === 0) {
        return res.json({
          success: true,
          data: {
            period: { from: fromDate, to: toDate },
            members: [],
            summary: {
              totalConsumptionKwh: 0,
              totalGenerationKwh: 0,
              totalExportKwh: 0,
              totalImportKwh: 0,
            },
          },
        });
      }

      const cupsList = usersResult.rows.map((u) => u.cups);
      const userIds = usersResult.rows.map((u) => u.id);

      // Participacions (planta + percentatge) per soci
      const participationResult = await database.query(
        `SELECT user_id, generator_code, participation_percentage
         FROM user_participation
         WHERE user_id = ANY($1::uuid[])`,
        [userIds]
      );
      const participationsByUser = {};
      for (const row of participationResult.rows) {
        if (!participationsByUser[row.user_id]) participationsByUser[row.user_id] = [];
        participationsByUser[row.user_id].push(row);
      }
      const generatorsConfig = configLoader.loadEnergyGenerators();

      // Consum total per CUPS des del comptador principal (Shelly EM)
      const consumptionResult = await database.query(
        `SELECT cups, SUM(energia_wh) as total_wh
         FROM consums
         WHERE cups = ANY($1::text[]) AND dispositiu LIKE 'Shelly EM%'
           AND timestamp >= $2 AND timestamp <= $3
         GROUP BY cups`,
        [cupsList, fromTs, toTs]
      );
      const consumptionByCups = {};
      for (const row of consumptionResult.rows) {
        consumptionByCups[row.cups] = parseFloat(row.total_wh) || 0;
      }

      // Generació assignada i consum per interval (15 min) des de balanc_energetic.
      // gen100 = generació del soci a participació 100% de les seves plantes.
      const balancResult = await database.query(
        `SELECT user_id, generator_code, participation_pct, allocated_wh, consumption_wh, timestamp
         FROM balanc_energetic
         WHERE timestamp >= $1 AND timestamp <= $2
         ORDER BY timestamp`,
        [fromTs, toTs]
      );

      const userIntervals = {};
      for (const row of balancResult.rows) {
        const uid = row.user_id;
        const key = row.timestamp.toISOString();
        if (!userIntervals[uid]) userIntervals[uid] = {};
        if (!userIntervals[uid][key]) {
          userIntervals[uid][key] = {
            gen: 0,
            gen100: 0,
            cons: parseFloat(row.consumption_wh) || 0,
          };
        }
        const pct = parseFloat(row.participation_pct) || 0;
        const scale = GENERATOR_SCALES[row.generator_code] || 1;
        const allocated = parseFloat(row.allocated_wh) || 0;
        userIntervals[uid][key].gen += allocated * scale;
        userIntervals[uid][key].gen100 += pct > 0 ? allocated * scale * (100 / pct) : 0;
      }

      // % de generació aprofitada a una fracció p (0..1) de participació
      const usedPctAt = (intervals, p) => {
        let used = 0;
        let totalGen = 0;
        for (const iv of intervals) {
          const g = iv.gen100 * p;
          totalGen += g;
          used += Math.min(iv.cons, g);
        }
        return totalGen > 0 ? (used / totalGen) * 100 : 0;
      };

      // Participació màxima (%) per mantenir-se per sobre del llindar objectiu.
      // Retorna 100 si ja ho compleix a plena participació, o null si no hi arriba mai.
      const participationForTarget = (intervals) => {
        if (intervals.length === 0) return null;
        if (usedPctAt(intervals, 1) >= targetUsed) return 100;
        if (usedPctAt(intervals, 0.0001) < targetUsed) return null;
        let lo = 0.0001;
        let hi = 1;
        for (let i = 0; i < 60; i++) {
          const mid = (lo + hi) / 2;
          if (usedPctAt(intervals, mid) >= targetUsed) lo = mid;
          else hi = mid;
        }
        return Math.round(lo * 10000) / 100;
      };

      const perUser = {};
      for (const [uid, intervals] of Object.entries(userIntervals)) {
        const ivList = Object.values(intervals);
        let gen = 0, cons = 0, exp = 0, imp = 0;
        for (const iv of ivList) {
          gen += iv.gen;
          cons += iv.cons;
          exp += Math.max(0, iv.gen - iv.cons);
          imp += Math.max(0, iv.cons - iv.gen);
        }
        perUser[uid] = {
          generationKwh: gen / 1000,
          consumptionKwh: cons / 1000,
          exportKwh: exp / 1000,
          importKwh: imp / 1000,
          intervals: ivList,
        };
      }

      const round2 = (v) => Math.round(v * 100) / 100;
      const members = usersResult.rows.map((u) => {
        const b = perUser[u.id];
        const generationKwh = round2(b ? b.generationKwh : 0);
        const exportKwh = round2(b ? b.exportKwh : 0);
        const importKwh = round2(b ? b.importKwh : 0);
        // Consum: preferim el comptador principal (consums); si no hi ha dades, el del balanç
        const consumptionKwh = round2(
          consumptionByCups[u.cups] !== undefined
            ? consumptionByCups[u.cups] / 1000
            : (b ? b.consumptionKwh : 0)
        );

        const pct = generationKwh > 0
          ? {
              generationUsedPct: Math.round(((generationKwh - exportKwh) / generationKwh) * 1000) / 10,
              generationExportedPct: Math.round((exportKwh / generationKwh) * 1000) / 10,
            }
          : { generationUsedPct: null, generationExportedPct: null };

        // Participació (%) objectiu per estar per sobre del llindar d'aprofitament
        const participationForTargetPct = b
          ? participationForTarget(b.intervals)
          : null;

        const generators = (participationsByUser[u.id] || []).map((p) => ({
          generatorCode: p.generator_code,
          generatorName:
            (generatorsConfig[p.generator_code] && generatorsConfig[p.generator_code].name) ||
            p.generator_code,
          participationPercentage: parseFloat(p.participation_percentage),
        }));

        return {
          userId: u.id,
          name: u.name,
          email: u.email,
          cups: u.cups,
          hasGeneration: generationKwh > 0,
          totalConsumptionKwh: consumptionKwh,
          totalGenerationKwh: generationKwh,
          totalExportKwh: exportKwh,
          totalImportKwh: importKwh,
          generators,
          targetUsedPct: targetUsed,
          participationForTargetPct,
          ...pct,
        };
      });

      const totalConsumptionKwh = round2(members.reduce((s, m) => s + m.totalConsumptionKwh, 0));
      const totalGenerationKwh = round2(members.reduce((s, m) => s + m.totalGenerationKwh, 0));
      const totalExportKwh = round2(members.reduce((s, m) => s + m.totalExportKwh, 0));
      const totalImportKwh = round2(members.reduce((s, m) => s + m.totalImportKwh, 0));

      res.json({
        success: true,
        data: {
          period: { from: fromDate, to: toDate },
          members,
          summary: {
            totalConsumptionKwh,
            totalGenerationKwh,
            totalExportKwh,
            totalImportKwh,
          },
        },
      });
    } catch (error) {
      logger.error('Error obtenint consums per soci:', error);
      res.status(500).json({
        success: false,
        error: 'Error intern del servidor',
      });
    }
  }
);

router.post('/register',
  authenticateToken,
  requireAdmin,
  sanitizeInput,
  async (req, res) => {
    try {
      const { name, email, cups, dni, clau_datadis } = req.body;

      // Validar campos requeridos
      if (!name || !email || !cups) {
        return res.status(400).json({
          success: false,
          error: 'Falten camps obligatoris: name, email, cups'
        });
      }

      // Validar formato de email básico
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({
          success: false,
          error: 'Format d\'email invàlid'
        });
      }

      // Validar DNI/NIE (opcional)
      const dniRegex = /^[0-9XYZ][0-9]{7}[A-Za-z]$/;
      const cleanDni = dni ? dni.trim().toUpperCase() : null;
      if (cleanDni && !dniRegex.test(cleanDni)) {
        return res.status(400).json({
          success: false,
          error: 'DNI/NIE invàlid'
        });
      }

      // Verificar si el usuario ya existe
      const existingUser = await User.findByEmail(email);
      if (existingUser) {
        return res.status(400).json({
          success: false,
          error: 'Ja existeix un usuari amb aquest email'
        });
      }

      // Verificar si el CUPS ya está asignado
      const existingCups = await CupsService.getCupsInfo(cups);
      if (existingCups && existingCups.is_assigned) {
        return res.status(400).json({
          success: false,
          error: 'Aquest CUPS ja està assignat a un altre usuari'
        });
      }

      // Crear el usuario con password temporal
      const user = await User.createWithTempPassword({
        email: email.toLowerCase().trim(),
        name: name.trim(),
        role: 'user',
        email_validated: false,
        cups: cups.trim(),
        dni: cleanDni,
        clau_datadis: clau_datadis ? cryptoService.encrypt(clau_datadis) : null
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
        message: 'Usuari creat correctament. S\'ha enviat un email d\'activació.'
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
