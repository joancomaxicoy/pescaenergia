// IMPORTANTE: Forzar carga de .env al PRINCIPIO
require('dotenv').config();

const nodemailer = require('nodemailer');
const handlebars = require('handlebars');
const fs = require('fs').promises;
const path = require('path');
const logger = require('../utils/logger');
const { requireEnvironmentVariable } = require('../config/security');

class EmailService {
  constructor() {
    this.transporter = null;
    this.templates = new Map();
    this.initialized = false;
    // NO llamamos a this.init() aquí - lo haremos bajo demanda
  }

  async ensureInitialized() {
    if (this.initialized && this.transporter) return;

    try {
      // Usar las variables CORRECTAS de tu .env
      const host = process.env.SERVIDOR_SMTP || 'smtp.gmail.com';
      const port = parseInt(process.env.PUERTO_SMTP) || 587;
      const user = requireEnvironmentVariable('SMTP_USER');
      const pass = requireEnvironmentVariable('SMTP_PASSWORD');

      // Configurar el transportador SMTP con las variables correctas
      this.transporter = nodemailer.createTransport({
        host: host,
        port: port,
        secure: port === 465, // true para 465, false para otros puertos
        auth: {
          user: user,
          pass: pass,
        },
      });

      // Verificar la conexión
      await this.transporter.verify();
      logger.info('✅ Servicio de email configurado correctamente');

      // Precargar plantillas
      await this.loadTemplates();
      this.initialized = true;
    } catch (error) {
      logger.error('❌ Error configurando servicio de email:', error);
      throw error;
    }
  }

  async loadTemplates() {
    try {
      const templatesDir = path.join(__dirname, '../templates');
      const partialsDir = path.join(templatesDir, 'partials');

      // Registrar partials de Handlebars
      try {
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
      } catch (error) {
        logger.warn('No se pudieron cargar partials:', error.message);
      }

      // Cargar plantillas
      const templates = ['email-verification', 'password-reset', 'welcome', 'test-email'];
      for (const templateName of templates) {
        try {
          const templatePath = path.join(templatesDir, `${templateName}.hbs`);
          const templateContent = await fs.readFile(templatePath, 'utf8');
          this.templates.set(templateName, handlebars.compile(templateContent));
        } catch (error) {
          logger.warn(`Plantilla ${templateName} no encontrada:`, error.message);
        }
      }

      logger.info('Plantillas de email cargadas correctamente');
    } catch (error) {
      logger.error('Error cargando plantillas de email:', error);
    }
  }

  async sendEmailVerification(user, verificationToken) {
    await this.ensureInitialized();

    try {
      const template = this.templates.get('email-verification');
      if (!template) {
        throw new Error('Plantilla de verificación de email no encontrada');
      }

      const verificationUrl = `${process.env.URL_DE_FRONTEND || 'http://localhost:3000'}/area-usuari/verificar/${verificationToken}`;

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
    await this.ensureInitialized();

    try {
      const template = this.templates.get('password-reset');
      if (!template) {
        throw new Error('Plantilla de reset de password no encontrada');
      }

      const resetUrl = `${process.env.URL_DE_FRONTEND || 'http://localhost:3000'}/area-usuari/reset-password/${resetToken}`;

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
    await this.ensureInitialized();

    try {
      const template = this.templates.get('welcome');
      if (!template) {
        throw new Error('Plantilla de bienvenida no encontrada');
      }

      const html = template({
        userName: user.name,
        loginUrl: `${process.env.URL_DE_FRONTEND || 'http://localhost:3000'}/area-usuari/login`,
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
    await this.ensureInitialized();

    try {
      const template = this.templates.get('test-email');
      if (!template) {
        // Si no hay plantilla, usar texto simple
        return await this.transporter.sendMail({
          from: `"PescaEnergia" <${process.env.SMTP_USER}>`,
          to: to,
          subject: 'Test de configuración SMTP - PescaEnergia',
          text: 'La configuración SMTP funciona correctamente.',
          html: '<h1>Email de prueba</h1><p>La configuración SMTP funciona correctamente.</p>'
        });
      }

      const html = template({
        logoUrl: 'cid:logo',
        currentYear: new Date().getFullYear(),
        smtpServer: process.env.SERVIDOR_SMTP,
        smtpPort: process.env.PUERTO_SMTP,
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

// Exportar una única instancia (sin inicializar automáticamente)
const emailService = new EmailService();
module.exports = emailService;
