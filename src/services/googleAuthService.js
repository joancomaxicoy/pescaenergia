const { OAuth2Client } = require('google-auth-library');
const logger = require('../utils/logger');

class GoogleAuthService {
  constructor() {
    this.client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
  }

  async verifyIdToken(idToken) {
    try {
      const ticket = await this.client.verifyIdToken({
        idToken: idToken,
        audience: process.env.GOOGLE_CLIENT_ID,
      });

      const payload = ticket.getPayload();
      
      // Verificar que el token es válido
      if (!payload) {
        throw new Error('Token de Google invàlid');
      }

      // Extraer información del usuario
      const googleUserInfo = {
        googleId: payload.sub,
        email: payload.email,
        name: payload.name,
        emailVerified: payload.email_verified,
        picture: payload.picture,
        locale: payload.locale
      };

      logger.info('Token de Google verificado exitosamente', { 
        googleId: googleUserInfo.googleId,
        email: googleUserInfo.email 
      });

      return googleUserInfo;
    } catch (error) {
      logger.error('Error verificando token de Google:', error);
      throw new Error('Token de Google invàlid o caducat');
    }
  }

  async getUserInfo(accessToken) {
    try {
      // Obtener información adicional del usuario usando el access token
      const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      });
      
      if (!response.ok) {
        throw new Error('Error obtenint informació de l\'usuari de Google');
      }

      const userInfo = await response.json();
      
      logger.info('Información de usuario de Google obtenida', { 
        id: userInfo.id,
        email: userInfo.email 
      });

      return {
        googleId: userInfo.id,
        email: userInfo.email,
        name: userInfo.name,
        emailVerified: userInfo.verified_email,
        picture: userInfo.picture,
        locale: userInfo.locale
      };
    } catch (error) {
      logger.error('Error obteniendo información del usuario de Google:', error);
      throw error;
    }
  }

  validateGoogleUserData(googleUserInfo) {
    const errors = [];

    if (!googleUserInfo.googleId) {
      errors.push('ID de Google requerido');
    }

    if (!googleUserInfo.email) {
      errors.push('Email requerido');
    }

    if (!googleUserInfo.name) {
      errors.push('Nombre requerido');
    }

    // Nota: No validamos emailVerified porque Google puede devolver false
    // en algunos casos durante desarrollo o con ciertos tipos de cuentas
    // El email de Google se considera confiable por defecto

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  generateGoogleAuthUrl(redirectUri, state = null) {
    try {
      const scopes = [
        'https://www.googleapis.com/auth/userinfo.email',
        'https://www.googleapis.com/auth/userinfo.profile'
      ];

      const authUrl = this.client.generateAuthUrl({
        access_type: 'offline',
        scope: scopes,
        redirect_uri: redirectUri,
        state: state,
        prompt: 'consent'
      });

      logger.info('URL de autenticación de Google generada', { redirectUri });
      return authUrl;
    } catch (error) {
      logger.error('Error generando URL de autenticación de Google:', error);
      throw error;
    }
  }

  async exchangeCodeForTokens(code, redirectUri) {
    try {
      const { tokens } = await this.client.getToken({
        code: code,
        redirect_uri: redirectUri
      });

      this.client.setCredentials(tokens);

      logger.info('Tokens de Google intercambiados exitosamente');
      return tokens;
    } catch (error) {
      logger.error('Error intercambiando código por tokens de Google:', error);
      throw new Error('Error en el procés d\'autenticació amb Google');
    }
  }

  async refreshAccessToken(refreshToken) {
    try {
      this.client.setCredentials({
        refresh_token: refreshToken
      });

      const { credentials } = await this.client.refreshAccessToken();
      
      logger.info('Token de acceso de Google renovado');
      return credentials;
    } catch (error) {
      logger.error('Error renovando token de acceso de Google:', error);
      throw new Error('Error renovant token de Google');
    }
  }

  async revokeTokens(accessToken) {
    try {
      await this.client.revokeToken(accessToken);
      logger.info('Tokens de Google revocados exitosamente');
      return true;
    } catch (error) {
      logger.error('Error revocando tokens de Google:', error);
      throw error;
    }
  }
}

// Singleton instance
const googleAuthService = new GoogleAuthService();

module.exports = googleAuthService;
