const logger = require('../utils/logger');
const { pool } = require('../utils/database');
const configLoader = require('../utils/configLoader');

/**
 * Verifica si un deviceId corresponde a un generador público
 * @param {string} deviceId - ID del dispositivo
 * @returns {boolean} - true si es un generador público
 */
const isPublicGenerator = (deviceId) => {
  try {
    const generators = configLoader.getEnergyGenerators();
    return Object.keys(generators).includes(deviceId);
  } catch (error) {
    logger.error('Error verificando generadores públicos:', error);
    return false;
  }
};

/**
 * Verifica si un usuario tiene acceso a un dispositivo específico
 * @param {string} userId - ID del usuario
 * @param {string} deviceId - ID del dispositivo (puede ser UUID o shelly_device_id)
 * @returns {Promise<boolean>} - true si el usuario tiene acceso
 */
const checkDeviceOwnership = async (userId, deviceId) => {
  try {
    const query = `
      SELECT COUNT(*) as count
      FROM devices 
      WHERE user_id = $1 
      AND (id::text = $2 OR shelly_device_id = $2)
    `;
    
    const result = await pool.query(query, [userId, deviceId]);
    return parseInt(result.rows[0].count) > 0;
  } catch (error) {
    logger.error('Error verificando ownership del dispositivo:', {
      error: error.message,
      userId,
      deviceId
    });
    return false;
  }
};

/**
 * Middleware para verificar acceso a dispositivos
 * Permite acceso libre a generadores públicos, requiere autenticación y ownership para dispositivos privados
 */
const requireDeviceAccess = async (req, res, next) => {
  try {
    const { deviceId } = req.params;

    if (!deviceId) {
      return res.status(400).json({
        error: 'deviceId es requerido',
        code: 'DEVICE_ID_REQUIRED'
      });
    }

    // Verificar si es un generador público
    if (isPublicGenerator(deviceId)) {
      logger.info('Acceso permitido a generador público:', { deviceId });
      return next();
    }

    // Para dispositivos privados, verificar autenticación
    if (!req.user) {
      return res.status(401).json({
        error: 'Autenticación requerida para acceder a este dispositivo',
        code: 'AUTHENTICATION_REQUIRED',
        deviceId
      });
    }

    // Los administradores tienen acceso a todos los dispositivos
    if (req.user.role === 'admin') {
      logger.info('Acceso de admin permitido:', { 
        userId: req.user.userId, 
        deviceId,
        role: req.user.role 
      });
      return next();
    }

    // Verificar ownership del dispositivo para usuarios normales
    const hasAccess = await checkDeviceOwnership(req.user.userId, deviceId);
    
    if (!hasAccess) {
      logger.warn('Acceso denegado a dispositivo:', {
        userId: req.user.userId,
        deviceId,
        reason: 'No es propietario del dispositivo'
      });
      
      return res.status(403).json({
        error: 'No tienes permisos para acceder a este dispositivo',
        code: 'DEVICE_ACCESS_DENIED',
        deviceId
      });
    }

    logger.info('Acceso permitido por ownership:', {
      userId: req.user.userId,
      deviceId
    });

    next();
  } catch (error) {
    logger.error('Error en middleware de acceso a dispositivo:', {
      error: error.message,
      stack: error.stack,
      deviceId: req.params.deviceId,
      userId: req.user?.userId
    });

    return res.status(500).json({
      error: 'Error interno verificando acceso al dispositivo',
      code: 'DEVICE_ACCESS_CHECK_ERROR'
    });
  }
};

/**
 * Middleware que combina autenticación opcional con verificación de acceso a dispositivos
 * Útil para endpoints que pueden ser accedidos sin autenticación (generadores públicos)
 * pero requieren autenticación para dispositivos privados
 */
const optionalAuthWithDeviceAccess = [
  // Primero intentar autenticación opcional
  async (req, res, next) => {
    try {
      const authHeader = req.headers['authorization'];
      const token = authHeader && authHeader.split(' ')[1];

      if (token) {
        const authService = require('../services/authService');
        const decoded = authService.verifyJWT(token);
        req.user = {
          userId: decoded.userId,
          email: decoded.email,
          role: decoded.role,
          emailValidated: decoded.emailValidated
        };
      }

      next();
    } catch (error) {
      // En autenticación opcional, continuamos sin usuario si el token es inválido
      logger.warn('Token inválido en autenticación opcional:', error.message);
      next();
    }
  },
  // Luego verificar acceso al dispositivo
  requireDeviceAccess
];

/**
 * Obtiene información del dispositivo para logging y debugging
 * @param {string} deviceId - ID del dispositivo
 * @returns {Promise<Object|null>} - Información del dispositivo o null si no existe
 */
const getDeviceInfo = async (deviceId) => {
  try {
    const query = `
      SELECT d.*, u.email as user_email
      FROM devices d
      LEFT JOIN users u ON d.user_id != 'not_assigned' AND d.user_id::uuid = u.id
      WHERE d.id::text = $1 OR d.shelly_device_id = $1
    `;
    
    const result = await pool.query(query, [deviceId]);
    return result.rows[0] || null;
  } catch (error) {
    logger.error('Error obteniendo información del dispositivo:', error);
    return null;
  }
};

/**
 * Middleware para logging detallado de acceso a dispositivos
 */
const logDeviceAccess = async (req, res, next) => {
  const { deviceId } = req.params;
  const startTime = Date.now();

  // Interceptar la respuesta para logging
  const originalSend = res.send;
  res.send = function(data) {
    const duration = Date.now() - startTime;
    const statusCode = res.statusCode;
    const success = statusCode >= 200 && statusCode < 300;

    logger.info('Acceso a dispositivo completado:', {
      deviceId,
      userId: req.user?.userId,
      userRole: req.user?.role,
      method: req.method,
      endpoint: req.originalUrl,
      statusCode,
      success,
      duration,
      ip: req.ip,
      userAgent: req.get('User-Agent')
    });

    originalSend.call(this, data);
  };

  next();
};

module.exports = {
  requireDeviceAccess,
  optionalAuthWithDeviceAccess,
  isPublicGenerator,
  checkDeviceOwnership,
  getDeviceInfo,
  logDeviceAccess
};
