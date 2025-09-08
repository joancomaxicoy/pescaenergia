const authService = require('../services/authService');
const logger = require('../utils/logger');

// Middleware para verificar JWT
const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
      return res.status(401).json({
        error: 'Token de acceso requerido',
        code: 'MISSING_TOKEN'
      });
    }

    const decoded = authService.verifyJWT(token);
    
    // Añadir información del usuario a la request
    req.user = {
      userId: decoded.userId,
      email: decoded.email,
      role: decoded.role,
      emailValidated: decoded.emailValidated
    };

    next();
  } catch (error) {
    logger.error('Error en autenticación:', error);
    return res.status(401).json({
      error: 'Token inválido o expirado',
      code: 'INVALID_TOKEN'
    });
  }
};

// Middleware para verificar que el email esté validado
const requireEmailValidation = (req, res, next) => {
  if (!req.user.emailValidated) {
    return res.status(403).json({
      error: 'Debes verificar tu email para acceder a este recurso',
      code: 'EMAIL_NOT_VALIDATED'
    });
  }
  next();
};

// Middleware para verificar roles
const requireRole = (roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        error: 'Autenticación requerida',
        code: 'AUTHENTICATION_REQUIRED'
      });
    }

    const userRole = req.user.role;
    const allowedRoles = Array.isArray(roles) ? roles : [roles];

    if (!allowedRoles.includes(userRole)) {
      return res.status(403).json({
        error: 'No tienes permisos para acceder a este recurso',
        code: 'INSUFFICIENT_PERMISSIONS',
        requiredRoles: allowedRoles,
        userRole: userRole
      });
    }

    next();
  };
};

// Middleware para verificar que el usuario es admin
const requireAdmin = requireRole('admin');

// Middleware para verificar que el usuario puede acceder a sus propios datos
const requireOwnershipOrAdmin = (req, res, next) => {
  const requestedUserId = req.params.userId || req.params.id;
  const currentUserId = req.user.userId;
  const isAdmin = req.user.role === 'admin';

  if (!isAdmin && requestedUserId !== currentUserId) {
    return res.status(403).json({
      error: 'Solo puedes acceder a tus propios datos',
      code: 'OWNERSHIP_REQUIRED'
    });
  }

  next();
};

// Middleware opcional de autenticación (no falla si no hay token)
const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (token) {
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
    // En autenticación opcional, continuamos sin usuario
    next();
  }
};

// Middleware para rate limiting específico de auth
const authRateLimit = (req, res, next) => {
  // Este middleware se puede usar junto con express-rate-limit
  // para aplicar límites más estrictos en endpoints de autenticación
  next();
};

// Middleware para logging de acciones de autenticación
const logAuthAction = (action) => {
  return (req, res, next) => {
    const originalSend = res.send;
    
    res.send = function(data) {
      const statusCode = res.statusCode;
      const success = statusCode >= 200 && statusCode < 300;
      
      logger.info('Acción de autenticación', {
        action,
        success,
        statusCode,
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        email: req.body?.email,
        userId: req.user?.userId
      });

      originalSend.call(this, data);
    };

    next();
  };
};

// Middleware para validar que el usuario existe en la base de datos
const validateUserExists = async (req, res, next) => {
  try {
    const User = require('../models/User');
    const user = await User.findById(req.user.userId);
    
    if (!user) {
      return res.status(401).json({
        error: 'Usuario no encontrado',
        code: 'USER_NOT_FOUND'
      });
    }

    // Actualizar información del usuario en la request
    req.user.dbUser = user;
    next();
  } catch (error) {
    logger.error('Error validando existencia del usuario:', error);
    return res.status(500).json({
      error: 'Error interno del servidor',
      code: 'INTERNAL_ERROR'
    });
  }
};

// Middleware para verificar que la cuenta no esté bloqueada/suspendida
const checkAccountStatus = (req, res, next) => {
  // Aquí se pueden añadir verificaciones adicionales como:
  // - Cuenta suspendida
  // - Cuenta bloqueada
  // - Términos y condiciones aceptados
  // - etc.
  
  // Por ahora, simplemente continuamos
  next();
};

module.exports = {
  authenticateToken,
  requireEmailValidation,
  requireRole,
  requireAdmin,
  requireOwnershipOrAdmin,
  optionalAuth,
  authRateLimit,
  logAuthAction,
  validateUserExists,
  checkAccountStatus
};
