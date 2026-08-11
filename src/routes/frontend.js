const express = require('express');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const logger = require('../utils/logger');
const { getJwtSecret } = require('../config/security');

const router = express.Router();

// Middleware para verificar autenticación desde cookies
const checkAuthFromCookie = async (req, res, next) => {
    try {
        // Intentar obtener token de cookie o header
        let token = req.cookies?.authToken;
        
        if (!token && req.headers.authorization) {
            token = req.headers.authorization.replace('Bearer ', '');
        }

        if (!token) {
            req.user = null;
            return next();
        }

        // Verificar token
        const jwtSecret = getJwtSecret();
        const decoded = jwt.verify(token, jwtSecret, {
            issuer: 'pescaenergia',
            audience: 'pescaenergia-users'
        });

        // Obtener usuario de la base de datos
        const user = await User.findById(decoded.userId);
        if (!user) {
            req.user = null;
            return next();
        }

        req.user = {
            userId: user.id,
            email: user.email,
            role: user.role,
            emailValidated: user.email_validated,
            userData: user.toJSON()
        };

        next();
    } catch (error) {
        logger.error('Error verificando autenticación:', error);
        req.user = null;
        next();
    }
};

// Middleware para requerir autenticación
const requireAuth = (req, res, next) => {
    if (!req.user) {
        return res.redirect('/area-usuari/login');
    }
    
    if (!req.user.emailValidated) {
        return res.render('pages/email-verification-required', {
            title: 'Verificació requerida',
            layout: 'main',
            showNavbar: false,
            showFooter: true,
            user: req.user.userData,
            googleClientId: process.env.GOOGLE_CLIENT_ID
        });
    }
    
    next();
};

// Middleware para requerir CUPS asignado
const requireCups = (req, res, next) => {
    if (!req.user.userData.cups) {
        return res.redirect('/area-usuari/assignar-cups');
    }
    next();
};

// Helper para formatear fechas
const formatDate = (date) => {
    if (!date) return '';
    return new Date(date).toLocaleDateString('ca-ES', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
};

/**
 * Ruta principal del área de usuario
 * Redirige según el estado del usuario:
 * - No autenticado -> login
 * - Sin CUPS -> asignación de CUPS
 * - Autenticado con CUPS -> dashboard
 */
router.get('/', checkAuthFromCookie, (req, res) => {
    if (!req.user) {
        return res.redirect('/area-usuari/login');
    }
    
    if (!req.user.emailValidated) {
        return res.render('pages/email-verification-required', {
            title: 'Verificació requerida',
            layout: 'main',
            showNavbar: false,
            showFooter: true,
            user: req.user.userData,
            googleClientId: process.env.GOOGLE_CLIENT_ID
        });
    }
    
    if (!req.user.userData.cups) {
        return res.redirect('/area-usuari/assignar-cups');
    }
    
    // Usuario autenticado con CUPS -> dashboard
    res.redirect('/area-usuari/dashboard');
});

/**
 * Página de login/registro
 */
router.get('/login', checkAuthFromCookie, (req, res) => {
    // Si ya está autenticado, redirigir al área de usuario
    if (req.user && req.user.emailValidated) {
        return res.redirect('/area-usuari');
    }
    
    res.render('pages/login', {
        title: 'Iniciar sessió',
        layout: 'main',
        showNavbar: false,
        showFooter: true,
        googleClientId: process.env.GOOGLE_CLIENT_ID
    });
});

/**
 * Página de asignación de CUPS
 */
router.get('/assignar-cups', checkAuthFromCookie, requireAuth, (req, res) => {
    // Si ya tiene CUPS asignado, redirigir al dashboard
    if (req.user.userData.cups) {
        return res.redirect('/area-usuari/dashboard');
    }
    
    res.render('pages/cups-assignment', {
        title: 'Assignar CUPS',
        layout: 'main',
        showNavbar: false,
        showFooter: true,
        user: req.user.userData,
        googleClientId: process.env.GOOGLE_CLIENT_ID
    });
});

/**
 * Dashboard principal
 */
router.get('/dashboard', checkAuthFromCookie, requireAuth, requireCups, (req, res) => {
    res.render('pages/dashboard', {
        title: 'Dashboard',
        layout: 'main',
        showNavbar: true,
        showFooter: true,
        isDashboard: true,
        user: req.user.userData,
        additionalScripts: ['/js/dashboard.js'],
        helpers: {
            formatDate: formatDate
        }
    });
});

/**
 * Página de Endolls
 */
router.get('/endolls', checkAuthFromCookie, requireAuth, requireCups, (req, res) => {
    res.render('pages/endolls', {
        title: 'Endolls',
        layout: 'main',
        showNavbar: true,
        showFooter: true,
        isEndolls: true,
        user: req.user.userData,
        additionalScripts: ['/js/endolls.js'],
        helpers: {
            formatDate: formatDate
        }
    });
});

/**
 * Página de verificación de email requerida
 */
router.get('/verificar-email', checkAuthFromCookie, (req, res) => {
    if (!req.user) {
        return res.redirect('/area-usuari/login');
    }
    
    if (req.user.emailValidated) {
        return res.redirect('/area-usuari');
    }
    
    res.render('pages/email-verification-required', {
        title: 'Verificació requerida',
        layout: 'main',
        showNavbar: false,
        showFooter: true,
        user: req.user.userData,
        googleClientId: process.env.GOOGLE_CLIENT_ID
    });
});

/**
 * Logout
 */
router.post('/logout', (req, res) => {
    res.clearCookie('authToken');
    res.clearCookie('refreshToken');
    res.redirect('/area-usuari/login');
});

/**
 * Rutas de redirección para compatibilidad con enlaces de la home
 */
router.get('/register', (req, res) => {
    res.redirect('/area-usuari/login');
});

router.get('/signin', (req, res) => {
    res.redirect('/area-usuari/login');
});

/**
 * Ruta para manejar la verificación de email desde enlaces
 */
router.get('/verificar/:token', async (req, res) => {
    try {
        const { token } = req.params;

        // Llamar al servicio de autenticación para verificar el email
        const authService = require('../services/authService');
        const result = await authService.verifyEmail(token);

        // Pasar tokens a la página para autologin
        res.render('pages/email-verified', {
            title: 'Email verificat',
            layout: 'main',
            showNavbar: false,
            showFooter: true,
            success: true,
            message: 'El teu email ha estat verificat correctament. Iniciant sessió...',
            accessToken: result.accessToken,
            refreshToken: result.refreshToken,
            user: result.user,
            userJson: JSON.stringify(result.user)
        });

    } catch (error) {
        logger.error('Error verificando email:', error);

        res.render('pages/email-verified', {
            title: 'Error de verificació',
            layout: 'main',
            showNavbar: false,
            showFooter: true,
            success: false,
            message: 'El enllaç de verificació és invàlid o ha expirat.'
        });
    }
});

/**
 * Página de reset de contraseña
 */
router.get('/reset-password/:token', async (req, res) => {
    try {
        const { token } = req.params;

        // Verificar que el token sea válido
        const User = require('../models/User');
        const user = await User.findByPasswordResetToken(token);

        if (!user) {
            return res.render('pages/password-reset-error', {
                title: 'Error',
                layout: 'main',
                showNavbar: false,
                showFooter: true,
                message: 'El enllaç de restabliment és invàlid o ha expirat.'
            });
        }

        res.render('pages/password-reset', {
            title: 'Restablir contrasenya',
            layout: 'main',
            showNavbar: false,
            showFooter: true,
            token: token
        });

    } catch (error) {
        logger.error('Error en reset password:', error);

        res.render('pages/password-reset-error', {
            title: 'Error',
            layout: 'main',
            showNavbar: false,
            showFooter: true,
            message: 'Error procesant la sol·licitud.'
        });
    }
});

/**
 * Página para establecer contraseña inicial
 */
router.get('/set-initial-password', checkAuthFromCookie, requireAuth, (req, res) => {
    // Verificar si el usuario tiene password temporal
    if (!req.user.userData.is_temp_password) {
        // Si no tiene password temporal, redirigir apropiadamente
        if (!req.user.userData.cups) {
            return res.redirect('/area-usuari/assignar-cups');
        } else {
            return res.redirect('/area-usuari/dashboard');
        }
    }

    // Generar token para la API
    const jwt = require('jsonwebtoken');
    const jwtSecret = getJwtSecret();
    const token = jwt.sign(
        {
            userId: req.user.userId,
            type: 'set_initial_password'
        },
        jwtSecret,
        { expiresIn: '1h' }
    );

    res.render('pages/set-initial-password', {
        title: 'Establir Contrasenya',
        layout: 'main',
        showNavbar: false,
        showFooter: true,
        user: req.user.userData,
        token: token
    });
});

module.exports = router;
