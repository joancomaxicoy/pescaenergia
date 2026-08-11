const { body, param, query, validationResult } = require('express-validator');
const logger = require('../utils/logger');

// Middleware para manejar errores de validación
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  
  if (!errors.isEmpty()) {
    const formattedErrors = errors.array().map(error => ({
      field: error.path || error.param,
      message: error.msg
    }));

    logger.warn('Errores de validación', {
      path: req.path,
      method: req.method,
      errors: formattedErrors,
      ip: req.ip
    });

    return res.status(400).json({
      error: 'Dades d\'entrada invàlides',
      code: 'VALIDATION_ERROR',
      details: formattedErrors
    });
  }

  next();
};

// Validaciones para registro
const validateRegister = [
  body('email')
    .isEmail()
    .withMessage('Ha de ser un email vàlid')
    .normalizeEmail({ 
      gmail_remove_dots: false,
      gmail_remove_subaddress: false
    })
    .isLength({ max: 255 })
    .withMessage('L\'email no pot excedir 255 caràcters'),
  
  body('name')
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('El nom ha de tenir entre 2 i 100 caràcters')
    .matches(/^[a-zA-ZáéíóúÁÉÍÓÚñÑüÜ\s]+$/)
    .withMessage('El nom només pot contenir lletres i espais'),
  
  body('password')
    .isLength({ min: 8 })
    .withMessage('La contrasenya ha de tenir almenys 8 caràcters')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage('La contrasenya ha de contenir almenys una minúscula, una majúscula i un número'),

  handleValidationErrors
];

// Validaciones para login
const validateLogin = [
  body('email')
    .isEmail()
    .withMessage('Ha de ser un email vàlid')
    .normalizeEmail({ 
      gmail_remove_dots: false,
      gmail_remove_subaddress: false
    }),
  
  body('password')
    .notEmpty()
    .withMessage('La contrasenya és obligatòria'),

  handleValidationErrors
];

// Validaciones para login con Google
const validateGoogleLogin = [
  body('idToken')
    .notEmpty()
    .withMessage('Token de Google obligatori')
    .isLength({ min: 10 })
    .withMessage('Token de Google invàlid'),

  handleValidationErrors
];

// Validaciones para verificación de email
const validateEmailVerification = [
  body('token')
    .notEmpty()
    .withMessage('Token de verificació obligatori')
    .isLength({ min: 32, max: 64 })
    .withMessage('Token de verificació invàlid'),

  handleValidationErrors
];

// Validaciones para reenvío de verificación
const validateResendVerification = [
  body('email')
    .isEmail()
    .withMessage('Ha de ser un email vàlid')
    .normalizeEmail({ 
      gmail_remove_dots: false,
      gmail_remove_subaddress: false
    }),

  handleValidationErrors
];

// Validaciones para forgot password
const validateForgotPassword = [
  body('email')
    .isEmail()
    .withMessage('Ha de ser un email vàlid')
    .normalizeEmail({ 
      gmail_remove_dots: false,
      gmail_remove_subaddress: false
    }),

  handleValidationErrors
];

// Validaciones para reset password
const validateResetPassword = [
  body('token')
    .notEmpty()
    .withMessage('Token de reset obligatori')
    .isLength({ min: 32, max: 64 })
    .withMessage('Token de reset invàlid'),
  
  body('password')
    .isLength({ min: 8 })
    .withMessage('La contrasenya ha de tenir almenys 8 caràcters')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage('La contrasenya ha de contenir almenys una minúscula, una majúscula i un número'),

  handleValidationErrors
];

// Validaciones para cambio de contraseña
const validateChangePassword = [
  body('currentPassword')
    .notEmpty()
    .withMessage('La contrasenya actual és obligatòria'),
  
  body('newPassword')
    .isLength({ min: 8 })
    .withMessage('La nova contrasenya ha de tenir almenys 8 caràcters')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage('La nova contrasenya ha de contenir almenys una minúscula, una majúscula i un número'),

  handleValidationErrors
];

// Validaciones para actualización de perfil
const validateUpdateProfile = [
  body('name')
    .optional()
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('El nom ha de tenir entre 2 i 100 caràcters')
    .matches(/^[a-zA-ZáéíóúÁÉÍÓÚñÑüÜ\s]+$/)
    .withMessage('El nom només pot contenir lletres i espais'),
  
  body('cups')
    .optional()
    .trim()
    .matches(/^ES\d{18}[A-Z]{2}\d{2}[A-Z]$/)
    .withMessage('El CUPS ha de tenir el format vàlid espanyol (ES + 18 dígits + 2 lletres + 2 dígits + 1 lletra)'),

  handleValidationErrors
];

// Validaciones para refresh token
const validateRefreshToken = [
  body('refreshToken')
    .notEmpty()
    .withMessage('Refresh token obligatori'),

  handleValidationErrors
];

// Validaciones para parámetros de usuario
const validateUserId = [
  param('userId')
    .isUUID()
    .withMessage('ID d\'usuari ha de ser un UUID vàlid'),

  handleValidationErrors
];

// Validaciones para query parameters
const validatePagination = [
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('La pàgina ha de ser un número enter major a 0'),
  
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('El límit ha de ser un número entre 1 i 100'),

  handleValidationErrors
];

// Validación personalizada para CUPS
const validateCUPS = (value) => {
  const cupsRegex = /^ES\d{18}[A-Z]{2}\d{2}[A-Z]$/;
  if (!cupsRegex.test(value)) {
    throw new Error('CUPS invàlid');
  }
  return true;
};

// Validación personalizada para contraseña segura
const validateStrongPassword = (value) => {
  const minLength = 8;
  const hasUpperCase = /[A-Z]/.test(value);
  const hasLowerCase = /[a-z]/.test(value);
  const hasNumbers = /\d/.test(value);
  const hasSpecialChar = /[!@#$%^&*(),.?":{}|<>]/.test(value);

  if (value.length < minLength) {
    throw new Error(`La contrasenya ha de tenir almenys ${minLength} caràcters`);
  }

  if (!hasUpperCase) {
    throw new Error('La contrasenya ha de contenir almenys una lletra majúscula');
  }

  if (!hasLowerCase) {
    throw new Error('La contrasenya ha de contenir almenys una lletra minúscula');
  }

  if (!hasNumbers) {
    throw new Error('La contrasenya ha de contenir almenys un número');
  }

  // Opcional: requerir caracteres especiales
  // if (!hasSpecialChar) {
  //   throw new Error('La contrasenya ha de contenir almenys un caràcter especial');
  // }

  return true;
};

// Validación personalizada para email español
const validateSpanishEmail = (value) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(value)) {
    throw new Error('Email invàlid');
  }

  // Lista de dominios comunes españoles (opcional)
  const spanishDomains = [
    'gmail.com', 'hotmail.com', 'yahoo.es', 'outlook.com',
    'telefonica.net', 'movistar.es', 'orange.es', 'vodafone.es'
  ];

  return true;
};

// Sanitización de datos
const sanitizeInput = (req, res, next) => {
  // Sanitizar strings para prevenir XSS
  const sanitizeString = (str) => {
    if (typeof str !== 'string') return str;
    return str.trim().replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  };

  // Aplicar sanitización recursivamente
  const sanitizeObject = (obj) => {
    for (const key in obj) {
      if (typeof obj[key] === 'string') {
        obj[key] = sanitizeString(obj[key]);
      } else if (typeof obj[key] === 'object' && obj[key] !== null) {
        sanitizeObject(obj[key]);
      }
    }
  };

  if (req.body) {
    sanitizeObject(req.body);
  }

  if (req.query) {
    sanitizeObject(req.query);
  }

  next();
};

module.exports = {
  handleValidationErrors,
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
  validateUserId,
  validatePagination,
  validateCUPS,
  validateStrongPassword,
  validateSpanishEmail,
  sanitizeInput
};
