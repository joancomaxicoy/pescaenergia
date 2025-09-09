const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const User = require('../models/User');
const emailService = require('./emailService');
const googleAuthService = require('./googleAuthService');
const logger = require('../utils/logger');

class AuthService {
  constructor() {
    this.jwtSecret = process.env.JWT_SECRET || 'your-super-secret-jwt-key';
    this.jwtExpiresIn = process.env.JWT_EXPIRES_IN || '24h';
    this.refreshTokenExpiresIn = process.env.REFRESH_TOKEN_EXPIRES_IN || '7d';
  }

  // Generar JWT token
  generateJWT(user) {
    const payload = {
      userId: user.id,
      email: user.email,
      role: user.role,
      emailValidated: user.email_validated
    };

    return jwt.sign(payload, this.jwtSecret, {
      expiresIn: this.jwtExpiresIn,
      issuer: 'pescaenergia',
      audience: 'pescaenergia-users'
    });
  }

  // Generar refresh token
  generateRefreshToken(user) {
    const payload = {
      userId: user.id,
      type: 'refresh'
    };

    return jwt.sign(payload, this.jwtSecret, {
      expiresIn: this.refreshTokenExpiresIn,
      issuer: 'pescaenergia',
      audience: 'pescaenergia-users'
    });
  }

  // Verificar JWT token
  verifyJWT(token) {
    try {
      return jwt.verify(token, this.jwtSecret, {
        issuer: 'pescaenergia',
        audience: 'pescaenergia-users'
      });
    } catch (error) {
      logger.error('Error verificando JWT:', error);
      throw new Error('Token invàlid o caducat');
    }
  }

  // Registro de usuario
  async register(userData) {
    try {
      const { email, name, password } = userData;

      // Verificar si el usuario ya existe
      const existingUser = await User.findByEmail(email);
      if (existingUser) {
        throw new Error('Ja existeix un usuari amb aquest email');
      }

      // Crear el usuario
      const user = await User.create({
        email,
        name,
        password,
        role: 'user',
        email_validated: false
      });

      // Generar token de verificación
      const verificationToken = await user.generateEmailVerificationToken();

      // Enviar email de verificación
      await emailService.sendEmailVerification(user, verificationToken);

      logger.info('Usuario registrado exitosamente', { 
        userId: user.id, 
        email: user.email 
      });

      return {
        user: user.toJSON(),
        message: 'Usuario registrado. Por favor verifica tu email para completar el registro.'
      };
    } catch (error) {
      logger.error('Error en registro de usuario:', error);
      throw error;
    }
  }

  // Login con email y password
  async login(email, password) {
    try {
      // Buscar usuario
      const user = await User.findByEmail(email);
      if (!user) {
        throw new Error('Credencials invàlides');
      }

      // Verificar password
      const isValidPassword = await user.verifyPassword(password);
      if (!isValidPassword) {
        throw new Error('Credencials invàlides');
      }

      // Verificar que el email esté validado
      if (!user.email_validated) {
        const error = new Error('Email verification required');
        error.code = 'EMAIL_NOT_VERIFIED';
        throw error;
      }

      // Generar tokens
      const accessToken = this.generateJWT(user);
      const refreshToken = this.generateRefreshToken(user);

      logger.info('Login exitoso', { 
        userId: user.id, 
        email: user.email 
      });

      return {
        user: user.toJSON(),
        accessToken,
        refreshToken,
        expiresIn: this.jwtExpiresIn
      };
    } catch (error) {
      logger.error('Error en login:', error);
      throw error;
    }
  }

  // Login con Google
  async loginWithGoogle(idToken) {
    try {
      // Verificar el token de Google
      const googleUserInfo = await googleAuthService.verifyIdToken(idToken);

      // Validar datos de Google
      const validation = googleAuthService.validateGoogleUserData(googleUserInfo);
      if (!validation.isValid) {
        throw new Error(`Dades de Google invàlides: ${validation.errors.join(', ')}`);
      }

      // Buscar usuario existente por Google ID
      let user = await User.findByGoogleId(googleUserInfo.googleId);

      if (!user) {
        // Buscar por email en caso de que el usuario ya exista
        user = await User.findByEmail(googleUserInfo.email);
        
        if (user) {
          // Usuario existe pero no tiene Google ID, actualizar
          const query = `
            UPDATE users 
            SET google_id = $1, email_validated = true, updated_at = NOW()
            WHERE id = $2
            RETURNING *
          `;
          const result = await require('../utils/database').query(query, [googleUserInfo.googleId, user.id]);
          user = new User(result.rows[0]);
        } else {
          // Crear nuevo usuario
          user = await User.create({
            email: googleUserInfo.email,
            name: googleUserInfo.name,
            role: 'user',
            google_id: googleUserInfo.googleId,
            email_validated: true // Google ya verificó el email
          });

          // Enviar email de bienvenida
          await emailService.sendWelcomeEmail(user);
        }
      }

      // Generar tokens
      const accessToken = this.generateJWT(user);
      const refreshToken = this.generateRefreshToken(user);

      logger.info('Login con Google exitoso', { 
        userId: user.id, 
        email: user.email 
      });

      return {
        user: user.toJSON(),
        accessToken,
        refreshToken,
        expiresIn: this.jwtExpiresIn
      };
    } catch (error) {
      logger.error('Error en login con Google:', error);
      throw error;
    }
  }

  // Verificar email
  async verifyEmail(token) {
    try {
      const user = await User.findByEmailVerificationToken(token);
      if (!user) {
        throw new Error('Token de verificació invàlid o caducat');
      }

      await user.verifyEmail();

      // Enviar email de bienvenida
      await emailService.sendWelcomeEmail(user);

      logger.info('Email verificado exitosamente', { 
        userId: user.id, 
        email: user.email 
      });

      return {
        user: user.toJSON(),
        message: 'Email verificado exitosamente'
      };
    } catch (error) {
      logger.error('Error verificando email:', error);
      throw error;
    }
  }

  // Reenviar verificación de email
  async resendEmailVerification(email) {
    try {
      const user = await User.findByEmail(email);
      if (!user) {
        throw new Error('Usuari no trobat');
      }

      if (user.email_validated) {
        throw new Error('L\'email ja està verificat');
      }

      // Generar nuevo token
      const verificationToken = await user.generateEmailVerificationToken();

      // Enviar email
      await emailService.sendEmailVerification(user, verificationToken);

      logger.info('Email de verificación reenviado', { 
        userId: user.id, 
        email: user.email 
      });

      return {
        message: 'Email de verificación enviado'
      };
    } catch (error) {
      logger.error('Error reenviando verificación:', error);
      throw error;
    }
  }

  // Solicitar reset de password
  async forgotPassword(email) {
    try {
      const user = await User.findByEmail(email);
      if (!user) {
        // Por seguridad, no revelamos si el email existe o no
        return {
          message: 'Si el email existe, recibirás instrucciones para restablecer tu contraseña'
        };
      }

      // Generar token de reset
      const resetToken = await user.generatePasswordResetToken();

      // Enviar email
      await emailService.sendPasswordReset(user, resetToken);

      logger.info('Email de reset de password enviado', { 
        userId: user.id, 
        email: user.email 
      });

      return {
        message: 'Si el email existe, recibirás instrucciones para restablecer tu contraseña'
      };
    } catch (error) {
      logger.error('Error en forgot password:', error);
      throw error;
    }
  }

  // Reset de password
  async resetPassword(token, newPassword) {
    try {
      const user = await User.findByPasswordResetToken(token);
      if (!user) {
        throw new Error('Token de reset invàlid o caducat');
      }

      await user.updatePassword(newPassword);

      logger.info('Password restablecido exitosamente', { 
        userId: user.id, 
        email: user.email 
      });

      return {
        message: 'Contraseña restablecida exitosamente'
      };
    } catch (error) {
      logger.error('Error restableciendo password:', error);
      throw error;
    }
  }

  // Renovar token
  async refreshToken(refreshToken) {
    try {
      const decoded = this.verifyJWT(refreshToken);
      
      if (decoded.type !== 'refresh') {
        throw new Error('Token de refresh invàlid');
      }

      const user = await User.findById(decoded.userId);
      if (!user) {
        throw new Error('Usuari no trobat');
      }

      // Generar nuevos tokens
      const newAccessToken = this.generateJWT(user);
      const newRefreshToken = this.generateRefreshToken(user);

      logger.info('Token renovado exitosamente', { 
        userId: user.id 
      });

      return {
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
        expiresIn: this.jwtExpiresIn
      };
    } catch (error) {
      logger.error('Error renovando token:', error);
      throw error;
    }
  }

  // Obtener perfil de usuario
  async getProfile(userId) {
    try {
      const user = await User.findById(userId);
      if (!user) {
        throw new Error('Usuari no trobat');
      }

      return user.toJSON();
    } catch (error) {
      logger.error('Error obteniendo perfil:', error);
      throw error;
    }
  }

  // Actualizar perfil
  async updateProfile(userId, updates) {
    try {
      const user = await User.findById(userId);
      if (!user) {
        throw new Error('Usuari no trobat');
      }

      await user.updateProfile(updates);

      logger.info('Perfil actualizado', { 
        userId: user.id 
      });

      return user.toJSON();
    } catch (error) {
      logger.error('Error actualizando perfil:', error);
      throw error;
    }
  }

  // Cambiar password (usuario autenticado)
  async changePassword(userId, currentPassword, newPassword) {
    try {
      const user = await User.findById(userId);
      if (!user) {
        throw new Error('Usuari no trobat');
      }

      // Verificar password actual
      const isValidPassword = await user.verifyPassword(currentPassword);
      if (!isValidPassword) {
        throw new Error('Contrasenya actual incorrecta');
      }

      await user.updatePassword(newPassword);

      logger.info('Password cambiado exitosamente', { 
        userId: user.id 
      });

      return {
        message: 'Contraseña actualizada exitosamente'
      };
    } catch (error) {
      logger.error('Error cambiando password:', error);
      throw error;
    }
  }
}

// Singleton instance
const authService = new AuthService();

module.exports = authService;
