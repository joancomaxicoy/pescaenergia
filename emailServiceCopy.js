console.log("🔴 EL ARCHIVO emailServices.js SE ESTÁ CARGANDO");

// Lo primero, antes de cualquier otro require (excepto dotenv) afegit per proves.
require('dotenv').config();

require('dotenv').config();
console.error('📧 EMAIL SERVICE LOADED, ENV CHECK:', {
    SERVIDOR_SMTP: process.env.SERVIDOR_SMTP,
    PUERTO_SMTP: process.env.PUERTO_SMTP
});

const nodemailer = require('nodemailer');
const handlebars = require('handlebars');
const fs = require('fs').promises;
const path = require('path');
const logger = require('../utils/logger');

class EmailService {
    constructor() {
        this.transporter = null;
        this.templates = new Map();
        this.init();
    }

    async init() {
        try {
            // Log per veure què està llegint
            console.log('🔍 DEBUG - Variables SMTP:');
            console.log('SERVIDOR_SMTP:', process.env.SERVIDOR_SMTP);
            console.log('PUERTO_SMTP:', process.env.PUERTO_SMTP);
            console.log('SMTP_USER:', process.env.SMTP_USER);
            console.log('SMTP_PASSWORD:', process.env.SMTP_PASSWORD ? '***SET***' : 'MISSING');

            // Configurar el transportador SMTP
            this.transporter = nodemailer.createTransport({
                // ojo que el he cambiat no coincideixen amb el .env
                // host: process.env.SMTP_SERVER,
                // port: parseInt(process.env.SMTP_PORT),
                // secure: false, // true para 465, false para otros puertos
                host: process.env.SERVIDOR_SMTP,           // ← Canviat
                port: parseInt(process.env.PUERTO_SMTP),   // ← Canviat
                secure: process.env.PUERTO_SMTP == 465,    // true si port 465
                auth: {
                    user: process.env.SMTP_USER,
                    pass: process.env.SMTP_PASSWORD,
                },
            });

            // Verificar la conexión
            await this.transporter.verify();
            logger.info('Servicio de email configurado correctamente');

            // Precargar plantillas
            await this.loadTemplates();
        } catch (error) {
            logger.error('Error configurando servicio de email:', error);
            throw error;
        }
    }

    async loadTemplates() {
        try {
            const templatesDir = path.join(__dirname, '../templates');
            const partialsDir = path.join(templatesDir, 'partials');

            // Registrar partials de Handlebars
            const headerPartial = await fs.readFile(
                path.join(partialsDir, 'header.hbs'),
                'utf8'
            );
            handlebars.registerPartial('header', headerPartial);

            const footerPartial = await fs.readFile(
                path.join(partialsDir, 'footer.hbs'),
                'utf8'
            );
            handlebars.registerPartial('footer', footerPartial);

            // Cargar plantilla de verificación de email
            const emailVerificationTemplate = await fs.readFile(
                path.join(templatesDir, 'email-verification.hbs'),
                'utf8'
            );
            this.templates.set('email-verification', handlebars.compile(emailVerificationTemplate));

            // Cargar plantilla de reset de password
            const passwordResetTemplate = await fs.readFile(
                path.join(templatesDir, 'password-reset.hbs'),
                'utf8'
            );
            this.templates.set('password-reset', handlebars.compile(passwordResetTemplate));

            // Cargar plantilla de bienvenida
            const welcomeTemplate = await fs.readFile(
                path.join(templatesDir, 'welcome.hbs'),
                'utf8'
            );
            this.templates.set('welcome', handlebars.compile(welcomeTemplate));

            // Cargar plantilla de test de email
            const testEmailTemplate = await fs.readFile(
                path.join(templatesDir, 'test-email.hbs'),
                'utf8'
            );
            this.templates.set('test-email', handlebars.compile(testEmailTemplate));

            logger.info('Plantillas de email y partials cargados correctamente');
        } catch (error) {
            logger.error('Error cargando plantillas de email:', error);
            throw error;
        }
    }

    async sendEmailVerification(user, verificationToken) {
        try {
            const template = this.templates.get('email-verification');
            if (!template) {
                throw new Error('Plantilla de verificación de email no encontrada');
            }

            const verificationUrl = `${process.env.FRONTEND_URL || 'http://localhost:3001'}/area-usuari/verificar/${verificationToken}`;

            const html = template({
                userName: user.name,
                verificationUrl,
                logoUrl: 'cid:logo',
                currentYear: new Date().getFullYear()
            });

            const mailOptions = {
                from: {
                    name: 'PescaEnergia',
                    address: process.env.SMTP_USER
                },
                to: user.email,
                subject: 'Verifica tu cuenta en PescaEnergia',
                html,
                attachments: [
                    {
                        filename: 'pescaenergia-logo.png',
                        path: path.join(__dirname, '../../resources/pescaenergia-logo.png'),
                        cid: 'logo'
                    }
                ]
            };

            const result = await this.transporter.sendMail(mailOptions);
            logger.info('Email de verificación enviado', {
                userId: user.id,
                email: user.email,
                messageId: result.messageId
            });

            return result;
        } catch (error) {
            logger.error('Error enviando email de verificación:', error);
            throw error;
        }
    }

    async sendPasswordReset(user, resetToken) {
        try {
            const template = this.templates.get('password-reset');
            if (!template) {
                throw new Error('Plantilla de reset de password no encontrada');
            }

            const resetUrl = `${process.env.FRONTEND_URL || 'http://localhost:3001'}/area-usuari/reset-password/${resetToken}`;

            const html = template({
                userName: user.name,
                resetUrl,
                logoUrl: 'cid:logo',
                currentYear: new Date().getFullYear()
            });

            const mailOptions = {
                from: {
                    name: 'PescaEnergia',
                    address: process.env.SMTP_USER
                },
                to: user.email,
                subject: 'Restablece tu contraseña en PescaEnergia',
                html,
                attachments: [
                    {
                        filename: 'pescaenergia-logo.png',
                        path: path.join(__dirname, '../../resources/pescaenergia-logo.png'),
                        cid: 'logo'
                    }
                ]
            };

            const result = await this.transporter.sendMail(mailOptions);
            logger.info('Email de reset de password enviado', {
                userId: user.id,
                email: user.email,
                messageId: result.messageId
            });

            return result;
        } catch (error) {
            logger.error('Error enviando email de reset de password:', error);
            throw error;
        }
    }

    async sendWelcomeEmail(user) {
        try {
            const template = this.templates.get('welcome');
            if (!template) {
                throw new Error('Plantilla de bienvenida no encontrada');
            }

            const html = template({
                userName: user.name,
                loginUrl: `${process.env.FRONTEND_URL || 'http://localhost:3001'}/area-usuari/login`,
                logoUrl: 'cid:logo',
                currentYear: new Date().getFullYear()
            });

            const mailOptions = {
                from: {
                    name: 'PescaEnergia',
                    address: process.env.SMTP_USER
                },
                to: user.email,
                subject: '¡Bienvenido a PescaEnergia!',
                html,
                attachments: [
                    {
                        filename: 'pescaenergia-logo.png',
                        path: path.join(__dirname, '../../resources/pescaenergia-logo.png'),
                        cid: 'logo'
                    }
                ]
            };

            const result = await this.transporter.sendMail(mailOptions);
            logger.info('Email de bienvenida enviado', {
                userId: user.id,
                email: user.email,
                messageId: result.messageId
            });

            return result;
        } catch (error) {
            logger.error('Error enviando email de bienvenida:', error);
            throw error;
        }
    }

    async sendTestEmail(to) {
        try {
            const template = this.templates.get('test-email');
            if (!template) {
                throw new Error('Plantilla de test de email no encontrada');
            }

            const html = template({
                logoUrl: 'cid:logo',
                currentYear: new Date().getFullYear(),
                smtpServer: process.env.SMTP_SERVER,
                smtpPort: process.env.SMTP_PORT,
                testDate: new Date().toLocaleString('es-ES', {
                    timeZone: 'Europe/Madrid',
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                })
            });

            const mailOptions = {
                from: {
                    name: 'PescaEnergia',
                    address: process.env.SMTP_USER
                },
                to,
                subject: 'Test de configuración SMTP - PescaEnergia',
                html,
                attachments: [
                    {
                        filename: 'pescaenergia-logo.png',
                        path: path.join(__dirname, '../../resources/pescaenergia-logo.png'),
                        cid: 'logo'
                    }
                ]
            };

            const result = await this.transporter.sendMail(mailOptions);
            logger.info('Email de test enviado', {
                email: to,
                messageId: result.messageId
            });

            return result;
        } catch (error) {
            logger.error('Error enviando email de test:', error);
            throw error;
        }
    }
}

// Singleton instance
const emailService = new EmailService();

module.exports = emailService;
