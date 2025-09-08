const { body, param, query, validationResult } = require('express-validator');
const logger = require('../utils/logger');

// Middleware para manejar errores de validación
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  
  if (!errors.isEmpty()) {
    const formattedErrors = errors.array().map(error => ({
      field: error.path || error.param,
      message: error.msg,
      value: error.value
    }));

    logger.warn('Errores de validación', {
      url: req.url,
      method: req.method,
      errors: formattedErrors,
      ip: req.ip
    });

    return res.status(400).json({
      error: 'Datos de entrada inválidos',
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
    .withMessage('Debe ser un email válido')
    .normalizeEmail()
    .isLength({ max: 255 })
    .withMessage('El email no puede exceder 255 caracteres'),
  
  body('name')
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('El nombre debe tener entre 2 y 100 caracteres')
    .matches(/^[a-zA-ZáéíóúÁÉÍÓÚñÑüÜ\s]+$/)
    .withMessage('El nombre solo puede contener letras y espacios'),
  
  body('password')
    .isLength({ min: 8 })
    .withMessage('La contraseña debe tener al menos 8 caracteres')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage('La contraseña debe contener al menos una minúscula, una mayúscula y un número'),

  handleValidationErrors
];

// Validaciones para login
const validateLogin = [
  body('email')
    .isEmail()
    .withMessage('Debe ser un email válido')
    .normalizeEmail(),
  
  body('password')
    .notEmpty()
    .withMessage('La contraseña es requerida'),

  handleValidationErrors
];

// Validaciones para login con Google
const validateGoogleLogin = [
  body('idToken')
    .notEmpty()
    .withMessage('Token de Google requerido')
    .isLength({ min: 10 })
    .withMessage('Token de Google inválido'),

  handleValidationErrors
];

// Validaciones para verificación de email
const validateEmailVerification = [
  body('token')
    .notEmpty()
    .withMessage('Token de verificación requerido')
    .isLength({ min: 32, max: 64 })
    .withMessage('Token de verificación inválido'),

  handleValidationErrors
];

// Validaciones para reenvío de verificación
const validateResendVerification = [
  body('email')
    .isEmail()
    .withMessage('Debe ser un email válido')
    .normalizeEmail(),

  handleValidationErrors
];

// Validaciones para forgot password
const validateForgotPassword = [
  body('email')
    .isEmail()
    .withMessage('Debe ser un email válido')
    .normalizeEmail(),

  handleValidationErrors
];

// Validaciones para reset password
const validateResetPassword = [
  body('token')
    .notEmpty()
    .withMessage('Token de reset requerido')
    .isLength({ min: 32, max: 64 })
    .withMessage('Token de reset inválido'),
  
  body('password')
    .isLength({ min: 8 })
    .withMessage('La contraseña debe tener al menos 8 caracteres')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage('La contraseña debe contener al menos una minúscula, una mayúscula y un número'),

  handleValidationErrors
];

// Validaciones para cambio de contraseña
const validateChangePassword = [
  body('currentPassword')
    .notEmpty()
    .withMessage('La contraseña actual es requerida'),
  
  body('newPassword')
    .isLength({ min: 8 })
    .withMessage('La nueva contraseña debe tener al menos 8 caracteres')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage('La nueva contraseña debe contener al menos una minúscula, una mayúscula y un número'),

  handleValidationErrors
];

// Validaciones para actualización de perfil
const validateUpdateProfile = [
  body('name')
    .optional()
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('El nombre debe tener entre 2 y 100 caracteres')
    .matches(/^[a-zA-ZáéíóúÁÉÍÓÚñÑüÜ\s]+$/)
    .withMessage('El nombre solo puede contener letras y espacios'),
  
  body('cups')
    .optional()
    .trim()
    .matches(/^ES\d{18}[A-Z]{2}\d{2}[A-Z]$/)
    .withMessage('El CUPS debe tener el formato válido español (ES + 18 dígitos + 2 letras + 2 dígitos + 1 letra)'),

  handleValidationErrors
];

// Validaciones para refresh token
const validateRefreshToken = [
  body('refreshToken')
    .notEmpty()
    .withMessage('Refresh token requerido'),

  handleValidationErrors
];

// Validaciones para parámetros de usuario
const validateUserId = [
  param('userId')
    .isUUID()
    .withMessage('ID de usuario debe ser un UUID válido'),

  handleValidationErrors
];

// Validaciones para query parameters
const validatePagination = [
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('La página debe ser un número entero mayor a 0'),
  
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('El límite debe ser un número entre 1 y 100'),

  handleValidationErrors
];

// Validación personalizada para CUPS
const validateCUPS = (value) => {
  const cupsRegex = /^ES\d{18}[A-Z]{2}\d{2}[A-Z]$/;
  if (!cupsRegex.test(value)) {
    throw new Error('CUPS inválido');
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
    throw new Error(`La contraseña debe tener al menos ${minLength} caracteres`);
  }

  if (!hasUpperCase) {
    throw new Error('La contraseña debe contener al menos una letra mayúscula');
  }

  if (!hasLowerCase) {
    throw new Error('La contraseña debe contener al menos una letra minúscula');
  }

  if (!hasNumbers) {
    throw new Error('La contraseña debe contener al menos un número');
  }

  // Opcional: requerir caracteres especiales
  // if (!hasSpecialChar) {
  //   throw new Error('La contraseña debe contener al menos un carácter especial');
  // }

  return true;
};

// Validación personalizada para email español
const validateSpanishEmail = (value) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(value)) {
    throw new Error('Email inválido');
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
