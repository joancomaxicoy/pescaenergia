const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const database = require('../utils/database');
const logger = require('../utils/logger');

class User {
  constructor(userData) {
    this.id = userData.id;
    this.cups = userData.cups;
    this.email = userData.email;
    this.name = userData.name;
    this.password_hash = userData.password_hash;
    this.role = userData.role;
    this.google_id = userData.google_id;
    this.dni = userData.dni;
    this.clau_datadis = userData.clau_datadis;
    this.email_validated = userData.email_validated;
    this.is_temp_password = userData.is_temp_password;
    this.email_verification_token = userData.email_verification_token;
    this.email_verification_expires = userData.email_verification_expires;
    this.password_reset_token = userData.password_reset_token;
    this.password_reset_expires = userData.password_reset_expires;
    this.created_at = userData.created_at;
    this.updated_at = userData.updated_at;
  }

  // Crear un nuevo usuario
  static async create(userData) {
    try {
      const {
        cups = null,
        email,
        name,
        password,
        role = 'user',
        google_id = null,
        dni = null,
        clau_datadis = null,
        email_validated = false
      } = userData;

      let password_hash = null;
      if (password) {
        password_hash = await bcrypt.hash(password, 12);
      }

      const query = `
        INSERT INTO users (
          cups, email, name, password_hash, role, google_id, dni, clau_datadis, email_validated, is_temp_password
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING *
      `;

      const values = [cups, email, name, password_hash, role, google_id, dni, clau_datadis, email_validated, false];
      const result = await database.query(query, values);

      logger.info('Usuario creado', { userId: result.rows[0].id, email });
      return new User(result.rows[0]);
    } catch (error) {
      logger.error('Error creando usuario:', error);
      throw error;
    }
  }

  // Buscar usuario por email
  static async findByEmail(email) {
    try {
      const query = 'SELECT * FROM users WHERE email = $1';
      const result = await database.query(query, [email]);
      
      if (result.rows.length === 0) {
        return null;
      }

      return new User(result.rows[0]);
    } catch (error) {
      logger.error('Error buscando usuario por email:', error);
      throw error;
    }
  }

  // Buscar usuario por ID
  static async findById(id) {
    try {
      const query = 'SELECT * FROM users WHERE id = $1';
      const result = await database.query(query, [id]);
      
      if (result.rows.length === 0) {
        return null;
      }

      return new User(result.rows[0]);
    } catch (error) {
      logger.error('Error buscando usuario por ID:', error);
      throw error;
    }
  }

  // Buscar usuario por Google ID
  static async findByGoogleId(googleId) {
    try {
      const query = 'SELECT * FROM users WHERE google_id = $1';
      const result = await database.query(query, [googleId]);
      
      if (result.rows.length === 0) {
        return null;
      }

      return new User(result.rows[0]);
    } catch (error) {
      logger.error('Error buscando usuario por Google ID:', error);
      throw error;
    }
  }

  // Buscar usuario por token de verificación de email
  static async findByEmailVerificationToken(token) {
    try {
      const query = `
        SELECT * FROM users 
        WHERE email_verification_token = $1 
        AND email_verification_expires > NOW()
      `;
      const result = await database.query(query, [token]);
      
      if (result.rows.length === 0) {
        return null;
      }

      return new User(result.rows[0]);
    } catch (error) {
      logger.error('Error buscando usuario por token de verificación:', error);
      throw error;
    }
  }

  // Buscar usuario por token de reset de password
  static async findByPasswordResetToken(token) {
    try {
      const query = `
        SELECT * FROM users 
        WHERE password_reset_token = $1 
        AND password_reset_expires > NOW()
      `;
      const result = await database.query(query, [token]);
      
      if (result.rows.length === 0) {
        return null;
      }

      return new User(result.rows[0]);
    } catch (error) {
      logger.error('Error buscando usuario por token de reset:', error);
      throw error;
    }
  }

  // Buscar usuario por CUPS
  static async findByCups(cups) {
    try {
      const query = 'SELECT * FROM users WHERE cups = $1';
      const result = await database.query(query, [cups]);
      
      if (result.rows.length === 0) {
        return null;
      }

      return new User(result.rows[0]);
    } catch (error) {
      logger.error('Error buscando usuario por CUPS:', error);
      throw error;
    }
  }

  // Buscar todos los usuarios con paginación
  static async findAll({ limit = 50, offset = 0 } = {}) {
    try {
      const query = 'SELECT * FROM users ORDER BY created_at DESC LIMIT $1 OFFSET $2';
      const result = await database.query(query, [limit, offset]);
      
      return result.rows.map(row => new User(row));
    } catch (error) {
      logger.error('Error buscando todos los usuarios:', error);
      throw error;
    }
  }

  // Buscar usuarios por rol
  static async findByRole(role) {
    try {
      const query = 'SELECT * FROM users WHERE role = $1 ORDER BY created_at DESC';
      const result = await database.query(query, [role]);
      
      return result.rows.map(row => new User(row));
    } catch (error) {
      logger.error('Error buscando usuarios por rol:', error);
      throw error;
    }
  }

  // Eliminar usuario
  static async delete(id) {
    try {
      const query = 'DELETE FROM users WHERE id = $1 RETURNING *';
      const result = await database.query(query, [id]);
      
      if (result.rows.length === 0) {
        return null;
      }

      logger.info('Usuario eliminado', { userId: id });
      return new User(result.rows[0]);
    } catch (error) {
      logger.error('Error eliminando usuario:', error);
      throw error;
    }
  }

  // Verificar password
  async verifyPassword(password) {
    if (!this.password_hash) {
      return false;
    }
    return await bcrypt.compare(password, this.password_hash);
  }

  // Generar token de verificación de email
  async generateEmailVerificationToken() {
    try {
      const token = crypto.randomBytes(32).toString('hex');
      const expires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 horas

      const query = `
        UPDATE users 
        SET email_verification_token = $1, email_verification_expires = $2, updated_at = NOW()
        WHERE id = $3
        RETURNING *
      `;

      const result = await database.query(query, [token, expires, this.id]);
      
      if (result.rows.length > 0) {
        this.email_verification_token = token;
        this.email_verification_expires = expires;
        this.updated_at = result.rows[0].updated_at;
      }

      return token;
    } catch (error) {
      logger.error('Error generando token de verificación:', error);
      throw error;
    }
  }

  // Generar token de reset de password
  async generatePasswordResetToken() {
    try {
      const token = crypto.randomBytes(32).toString('hex');
      const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hora

      const query = `
        UPDATE users 
        SET password_reset_token = $1, password_reset_expires = $2, updated_at = NOW()
        WHERE id = $3
        RETURNING *
      `;

      const result = await database.query(query, [token, expires, this.id]);
      
      if (result.rows.length > 0) {
        this.password_reset_token = token;
        this.password_reset_expires = expires;
        this.updated_at = result.rows[0].updated_at;
      }

      return token;
    } catch (error) {
      logger.error('Error generando token de reset:', error);
      throw error;
    }
  }

  // Verificar email
  async verifyEmail() {
    try {
      const query = `
        UPDATE users 
        SET email_validated = true, 
            email_verification_token = NULL, 
            email_verification_expires = NULL,
            updated_at = NOW()
        WHERE id = $1
        RETURNING *
      `;

      const result = await database.query(query, [this.id]);
      
      if (result.rows.length > 0) {
        this.email_validated = true;
        this.email_verification_token = null;
        this.email_verification_expires = null;
        this.updated_at = result.rows[0].updated_at;
      }

      logger.info('Email verificado', { userId: this.id, email: this.email });
      return true;
    } catch (error) {
      logger.error('Error verificando email:', error);
      throw error;
    }
  }

  // Actualizar password
  async updatePassword(newPassword) {
    try {
      const password_hash = await bcrypt.hash(newPassword, 12);

      const query = `
        UPDATE users 
        SET password_hash = $1, 
            password_reset_token = NULL, 
            password_reset_expires = NULL,
            is_temp_password = false,
            updated_at = NOW()
        WHERE id = $2
        RETURNING *
      `;

      const result = await database.query(query, [password_hash, this.id]);
      
      if (result.rows.length > 0) {
        this.password_hash = password_hash;
        this.password_reset_token = null;
        this.password_reset_expires = null;
        this.is_temp_password = false;
        this.updated_at = result.rows[0].updated_at;
      }

      logger.info('Password actualizado', { userId: this.id });
      return true;
    } catch (error) {
      logger.error('Error actualizando password:', error);
      throw error;
    }
  }

  async updateEmail(newEmail) {
    try {
      const query = `
        UPDATE users 
        SET email = $1, 
            updated_at = NOW()
        WHERE id = $2
        RETURNING *
      `;

      const result = await database.query(query, [newEmail, this.id]);

      if (result.rows.length > 0) {
        this.email = result.rows[0].email;
        this.updated_at = result.rows[0].updated_at;
      }

      logger.info('Email actualizado', { userId: this.id });
      return true;
    } catch (error) {
      logger.error('Error actualizando email:', error);
      throw error;
    }
  }

  // Crear usuario con password temporal
  static async createWithTempPassword(userData) {
    try {
      const {
        cups = null,
        email,
        name,
        role = 'user',
        google_id = null,
        dni = null,
        clau_datadis = null,
        email_validated = false
      } = userData;

      // Generar password temporal sin hashear
      const tempPassword = 'tmp-' + crypto.randomBytes(16).toString('hex');

      const query = `
        INSERT INTO users (
          cups, email, name, password_hash, role, google_id, dni, clau_datadis, email_validated, is_temp_password
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING *
      `;

      const values = [cups, email, name, tempPassword, role, google_id, dni, clau_datadis, email_validated, true];
      const result = await database.query(query, values);

      logger.info('Usuario creado con password temporal', { userId: result.rows[0].id, email });
      return new User(result.rows[0]);
    } catch (error) {
      logger.error('Error creando usuario con password temporal:', error);
      throw error;
    }
  }

  // Actualizar perfil
  async updateProfile(updates) {
    try {
      const allowedFields = ['name', 'cups'];
      const fields = [];
      const values = [];
      let paramCount = 1;

      for (const [key, value] of Object.entries(updates)) {
        if (allowedFields.includes(key) && value !== undefined) {
          fields.push(`${key} = $${paramCount}`);
          values.push(value);
          paramCount++;
        }
      }

      if (fields.length === 0) {
        return this;
      }

      fields.push(`updated_at = NOW()`);
      values.push(this.id);

      const query = `
        UPDATE users 
        SET ${fields.join(', ')}
        WHERE id = $${paramCount}
        RETURNING *
      `;

      const result = await database.query(query, values);
      
      if (result.rows.length > 0) {
        const updatedUser = result.rows[0];
        Object.assign(this, updatedUser);
      }

      logger.info('Perfil actualizado', { userId: this.id });
      return this;
    } catch (error) {
      logger.error('Error actualizando perfil:', error);
      throw error;
    }
  }

  // Convertir a JSON (sin datos sensibles)
  toJSON() {
    return {
      id: this.id,
      dni: this.dni,
      cups: this.cups,
      email: this.email,
      name: this.name,
      role: this.role,
      datadis_configured: !!(this.clau_datadis),
      email_validated: this.email_validated,
      created_at: this.created_at,
      updated_at: this.updated_at
    };
  }

  // Convertir a JSON con datos completos (para uso interno)
  toFullJSON() {
    return {
      id: this.id,
      cups: this.cups,
      email: this.email,
      name: this.name,
      role: this.role,
      google_id: this.google_id,
      email_validated: this.email_validated,
      email_verification_token: this.email_verification_token,
      email_verification_expires: this.email_verification_expires,
      password_reset_token: this.password_reset_token,
      password_reset_expires: this.password_reset_expires,
      created_at: this.created_at,
      updated_at: this.updated_at
    };
  }
}

module.exports = User;
