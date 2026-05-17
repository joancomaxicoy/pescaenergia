const express = require('express');
const rateLimit = require('express-rate-limit');
const authService = require('../services/authService');
const emailService = require('../services/emailService');
const {
  authenticateToken,
  requireEmailValidation,
  logAuthAction,
  validateUserExists
} = require('../middleware/auth');
const {
  validateRegister,
  validateLogin,
  validateGoogleLogin,
  validateEmailVerification,
  validateResendVerification,
  validateForgotPassword,
  validateResetPassword,
  validateChangePassword,
  validateUpdateProfile,
  validateRefreshToken,
  sanitizeInput
} = require('../middleware/validation');
const logger = require('../utils/logger');

const router = express.Router();

// Rate limiting más estricto para endpoints de autenticación
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 15, // máximo 5 intentos por IP
  message: {
    error: 'Demasiados intentos de autenticación. Intenta de nuevo en 15 minutos.',
    code: 'TOO_MANY_AUTH_ATTEMPTS'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Rate limiting para registro
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hora
  max: 3, // máximo 3 registros por IP por hora
  message: {
    error: 'Demasiados registros desde esta IP. Intenta de nuevo en 1 hora.',
    code: 'TOO_MANY_REGISTRATIONS'
  }
});

// Rate limiting para reset de password
const passwordResetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hora
  max: 3, // máximo 3 intentos por IP por hora
  message: {
    error: 'Demasiadas solicitudes de reset de contraseña. Intenta de nuevo en 1 hora.',
    code: 'TOO_MANY_PASSWORD_RESETS'
  }
});

/**
 * @swagger
 * components:
 *   schemas:
 *     User:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           format: uuid
 *         email:
 *           type: string
 *           format: email
 *         name:
 *           type: string
 *         role:
 *           type: string
 *           enum: [admin, user]
 *         email_validated:
 *           type: boolean
 *         cups:
 *           type: string
 *         created_at:
 *           type: string
 *           format: date-time
 *         updated_at:
 *           type: string
 *           format: date-time
 *     AuthResponse:
 *       type: object
 *       properties:
 *         user:
 *           $ref: '#/components/schemas/User'
 *         accessToken:
 *           type: string
 *         refreshToken:
 *           type: string
 *         expiresIn:
 *           type: string
 *     Error:
 *       type: object
 *       properties:
 *         error:
 *           type: string
 *         code:
 *           type: string
 *         details:
 *           type: array
 *           items:
 *             type: object
 */

/**
 * @swagger
 * /api/auth/register:
 *   post:
 *     summary: Registrar nuevo usuario
 *     tags: [Autenticación]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - name
 *               - password
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *               name:
 *                 type: string
 *               password:
 *                 type: string
 *                 minLength: 8
 *     responses:
 *       201:
 *         description: Usuario registrado exitosamente
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 user:
 *                   $ref: '#/components/schemas/User'
 *                 message:
 *                   type: string
 *       400:
 *         description: Datos inválidos
 *       409:
 *         description: Usuario ya existe
 */
router.post('/register',
  registerLimiter,
  sanitizeInput,
  validateRegister,
  logAuthAction('register'),
  async (req, res) => {
    try {
      const result = await authService.register(req.body);
      res.status(201).json(result);
    } catch (error) {
      logger.error('Error en registro:', error);

      if (error.message.includes('Ya existe un usuario')) {
        return res.status(409).json({
          error: error.message,
          code: 'USER_ALREADY_EXISTS'
        });
      }

      res.status(400).json({
        error: error.message,
        code: 'REGISTRATION_ERROR'
      });
    }
  }
);

/**
 * @swagger
 * /api/auth/login:
 *   post:
 *     summary: Iniciar sesión con email y contraseña
 *     tags: [Autenticación]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *               password:
 *                 type: string
 *     responses:
 *       200:
 *         description: Login exitoso
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AuthResponse'
 *       401:
 *         description: Credenciales inválidas
 *       403:
 *         description: Email no verificado
 */
router.post('/login',
  authLimiter,
  sanitizeInput,
  validateLogin,
  logAuthAction('login'),
  async (req, res) => {
    try {
      const result = await authService.login(req.body.email, req.body.password);
      res.json(result);
    } catch (error) {
      logger.error('Error en login:', error);

      if (error.code === 'EMAIL_NOT_VERIFIED') {
        return res.status(403).json({
          error: error.message,
          code: 'EMAIL_NOT_VERIFIED'
        });
      }

      if (error.code === 'PASSWORD_NOT_SET') {
        return res.status(403).json({
          error: error.message,
          code: 'PASSWORD_NOT_SET',
          requiresPasswordSetup: true
        });
      }

      if (error.code === 'CUPS_NOT_ASSIGNED') {
        return res.status(403).json({
          error: error.message,
          code: 'CUPS_NOT_ASSIGNED',
          requiresCupsAssignment: true
        });
      }

      res.status(401).json({
        error: 'Credenciales inválidas',
        code: 'INVALID_CREDENTIALS'
      });
    }
  }
);

/**
 * @swagger
 * /api/auth/google:
 *   post:
 *     summary: Iniciar sesión con Google
 *     tags: [Autenticación]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - idToken
 *             properties:
 *               idToken:
 *                 type: string
 *     responses:
 *       200:
 *         description: Login con Google exitoso
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AuthResponse'
 *       401:
 *         description: Token de Google inválido
 */
router.post('/google',
  authLimiter,
  sanitizeInput,
  validateGoogleLogin,
  logAuthAction('google-login'),
  async (req, res) => {
    try {
      const result = await authService.loginWithGoogle(req.body.idToken);
      res.json(result);
    } catch (error) {
      logger.error('Error en login con Google:', error);
      res.status(401).json({
        error: error.message,
        code: 'GOOGLE_AUTH_ERROR'
      });
    }
  }
);

/**
 * @swagger
 * /api/auth/verify-email:
 *   post:
 *     summary: Verificar email con token
 *     tags: [Autenticación]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - token
 *             properties:
 *               token:
 *                 type: string
 *     responses:
 *       200:
 *         description: Email verificado exitosamente
 *       400:
 *         description: Token inválido o expirado
 */
router.post('/verify-email',
  sanitizeInput,
  validateEmailVerification,
  logAuthAction('verify-email'),
  async (req, res) => {
    try {
      const result = await authService.verifyEmail(req.body.token);
      res.json(result);
    } catch (error) {
      logger.error('Error verificando email:', error);
      res.status(400).json({
        error: error.message,
        code: 'EMAIL_VERIFICATION_ERROR'
      });
    }
  }
);

/**
 * @swagger
 * /api/auth/resend-verification:
 *   post:
 *     summary: Reenviar email de verificación
 *     tags: [Autenticación]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *     responses:
 *       200:
 *         description: Email de verificación enviado
 *       400:
 *         description: Error en el envío
 */
router.post('/resend-verification',
  passwordResetLimiter,
  sanitizeInput,
  validateResendVerification,
  logAuthAction('resend-verification'),
  async (req, res) => {
    try {
      const result = await authService.resendEmailVerification(req.body.email);
      res.json(result);
    } catch (error) {
      logger.error('Error reenviando verificación:', error);
      res.status(400).json({
        error: error.message,
        code: 'RESEND_VERIFICATION_ERROR'
      });
    }
  }
);

/**
 * @swagger
 * /api/auth/forgot-password:
 *   post:
 *     summary: Solicitar reset de contraseña
 *     tags: [Autenticación]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *     responses:
 *       200:
 *         description: Email de reset enviado (si el email existe)
 */
router.post('/forgot-password',
  passwordResetLimiter,
  sanitizeInput,
  validateForgotPassword,
  logAuthAction('forgot-password'),
  async (req, res) => {
    try {
      const result = await authService.forgotPassword(req.body.email);
      res.json(result);
    } catch (error) {
      logger.error('Error en forgot password:', error);
      res.status(500).json({
        error: 'Error interno del servidor',
        code: 'INTERNAL_ERROR'
      });
    }
  }
);

/**
 * @swagger
 * /api/auth/reset-password:
 *   post:
 *     summary: Restablecer contraseña con token
 *     tags: [Autenticación]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - token
 *               - password
 *             properties:
 *               token:
 *                 type: string
 *               password:
 *                 type: string
 *                 minLength: 8
 *     responses:
 *       200:
 *         description: Contraseña restablecida exitosamente
 *       400:
 *         description: Token inválido o expirado
 */
router.post('/reset-password',
  sanitizeInput,
  validateResetPassword,
  logAuthAction('reset-password'),
  async (req, res) => {
    try {
      const result = await authService.resetPassword(req.body.token, req.body.password);
      res.json(result);
    } catch (error) {
      logger.error('Error restableciendo password:', error);
      res.status(400).json({
        error: error.message,
        code: 'PASSWORD_RESET_ERROR'
      });
    }
  }
);

/**
 * @swagger
 * /api/auth/refresh-token:
 *   post:
 *     summary: Renovar token de acceso
 *     tags: [Autenticación]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - refreshToken
 *             properties:
 *               refreshToken:
 *                 type: string
 *     responses:
 *       200:
 *         description: Token renovado exitosamente
 *       401:
 *         description: Refresh token inválido
 */
router.post('/refresh-token',
  sanitizeInput,
  validateRefreshToken,
  logAuthAction('refresh-token'),
  async (req, res) => {
    try {
      const result = await authService.refreshToken(req.body.refreshToken);
      res.json(result);
    } catch (error) {
      logger.error('Error renovando token:', error);
      res.status(401).json({
        error: error.message,
        code: 'REFRESH_TOKEN_ERROR'
      });
    }
  }
);

/**
 * @swagger
 * /api/auth/profile:
 *   get:
 *     summary: Obtener perfil del usuario autenticado
 *     tags: [Autenticación]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Perfil del usuario
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/User'
 *       401:
 *         description: No autenticado
 */
router.get('/profile',
  authenticateToken,
  requireEmailValidation,
  validateUserExists,
  async (req, res) => {
    try {
      const profile = await authService.getProfile(req.user.userId);
      res.json(profile);
    } catch (error) {
      logger.error('Error obteniendo perfil:', error);
      res.status(500).json({
        error: 'Error interno del servidor',
        code: 'INTERNAL_ERROR'
      });
    }
  }
);

/**
 * @swagger
 * /api/auth/profile:
 *   put:
 *     summary: Actualizar perfil del usuario
 *     tags: [Autenticación]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               cups:
 *                 type: string
 *     responses:
 *       200:
 *         description: Perfil actualizado
 *       400:
 *         description: Datos inválidos
 *       401:
 *         description: No autenticado
 */
router.put('/profile',
  authenticateToken,
  requireEmailValidation,
  validateUserExists,
  sanitizeInput,
  validateUpdateProfile,
  logAuthAction('update-profile'),
  async (req, res) => {
    try {
      const updatedProfile = await authService.updateProfile(req.user.userId, req.body);
      res.json(updatedProfile);
    } catch (error) {
      logger.error('Error actualizando perfil:', error);
      res.status(400).json({
        error: error.message,
        code: 'PROFILE_UPDATE_ERROR'
      });
    }
  }
);

/**
 * @swagger
 * /api/auth/change-password:
 *   post:
 *     summary: Cambiar contraseña del usuario autenticado
 *     tags: [Autenticación]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - currentPassword
 *               - newPassword
 *             properties:
 *               currentPassword:
 *                 type: string
 *               newPassword:
 *                 type: string
 *                 minLength: 8
 *     responses:
 *       200:
 *         description: Contraseña cambiada exitosamente
 *       400:
 *         description: Contraseña actual incorrecta
 *       401:
 *         description: No autenticado
 */
router.post('/change-password',
  authenticateToken,
  requireEmailValidation,
  validateUserExists,
  sanitizeInput,
  validateChangePassword,
  logAuthAction('change-password'),
  async (req, res) => {
    try {
      const result = await authService.changePassword(
        req.user.userId,
        req.body.currentPassword,
        req.body.newPassword
      );
      res.json(result);
    } catch (error) {
      logger.error('Error cambiando password:', error);
      res.status(400).json({
        error: error.message,
        code: 'PASSWORD_CHANGE_ERROR'
      });
    }
  }
);

/**
 * @swagger
 * /api/auth/set-initial-password:
 *   post:
 *     summary: Establecer contraseña inicial (usuarios creados por admin)
 *     tags: [Autenticación]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - token
 *               - password
 *             properties:
 *               token:
 *                 type: string
 *                 description: Token de verificación de email
 *               password:
 *                 type: string
 *                 minLength: 8
 *                 description: Nueva contraseña del usuario
 *     responses:
 *       200:
 *         description: Contraseña establecida exitosamente
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AuthResponse'
 *       400:
 *         description: Token inválido o usuario ya tiene contraseña
 *       500:
 *         description: Error interno del servidor
 */
router.post('/set-initial-password',
  sanitizeInput,
  async (req, res) => {
    try {
      const { token, password } = req.body;

      // Validar campos requeridos
      if (!token || !password) {
        return res.status(400).json({
          error: 'Token y contraseña son requeridos',
          code: 'MISSING_FIELDS'
        });
      }

      // Validar longitud mínima de password
      if (password.length < 8) {
        return res.status(400).json({
          error: 'La contraseña debe tener al menos 8 caracteres',
          code: 'PASSWORD_TOO_SHORT'
        });
      }

      const result = await authService.setInitialPassword(token, password);
      res.json(result);
    } catch (error) {
      logger.error('Error estableciendo password inicial:', error);

      if (error.message.includes('Token de verificació invàlid') ||
        error.message.includes('caducat')) {
        return res.status(400).json({
          error: 'Token inválido o expirado',
          code: 'INVALID_TOKEN'
        });
      }

      if (error.message.includes('Email no verificat')) {
        return res.status(400).json({
          error: 'Email no verificado',
          code: 'EMAIL_NOT_VERIFIED'
        });
      }

      if (error.message.includes('ja té una contrasenya')) {
        return res.status(400).json({
          error: 'Este usuario ya tiene una contraseña establecida',
          code: 'PASSWORD_ALREADY_SET'
        });
      }

      res.status(500).json({
        error: 'Error interno del servidor',
        code: 'INTERNAL_ERROR'
      });
    }
  }
);

/**
 * @swagger
 * /api/auth/test-email:
 *   post:
 *     summary: Enviar email de prueba (solo para desarrollo)
 *     tags: [Autenticación]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *     responses:
 *       200:
 *         description: Email de prueba enviado
 *       500:
 *         description: Error enviando email
 */
router.post('/test-email',
  async (req, res) => {
    // Solo disponible en desarrollo
    if (process.env.NODE_ENV === 'production') {
      return res.status(404).json({
        error: 'Endpoint no disponible en producción',
        code: 'NOT_AVAILABLE'
      });
    }

    try {
      const { email } = req.body;
      if (!email) {
        return res.status(400).json({
          error: 'Email requerido',
          code: 'EMAIL_REQUIRED'
        });
      }

      await emailService.sendTestEmail(email);
      res.json({
        message: 'Email de prueba enviado exitosamente',
        email: email
      });
    } catch (error) {
      logger.error('Error enviando email de prueba:', error);
      res.status(500).json({
        error: 'Error enviando email de prueba',
        code: 'EMAIL_TEST_ERROR'
      });
    }
  }
);

module.exports = router;
