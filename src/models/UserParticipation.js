const { Pool } = require('pg');
const database = require('../utils/database');
const logger = require('../utils/logger');

class UserParticipation {
  constructor() {
    this.database = database;
  }

  async getPool() {
    if (!this.database.pool) {
      await this.database.connect();
    }
    return this.database.pool;
  }

  /**
   * Crear una nueva participación de usuario en un generador
   */
  async create({ userId, generatorCode, participationPercentage, assignedBy }) {
    const query = `
      INSERT INTO user_participation (user_id, generator_code, participation_percentage, assigned_by)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `;
    
    try {
      const pool = await this.getPool();
      const result = await pool.query(query, [userId, generatorCode, participationPercentage, assignedBy]);
      return result.rows[0];
    } catch (error) {
      logger.error('Error creando participación de usuario:', error);
      throw error;
    }
  }

  /**
   * Obtener participación específica por ID
   */
  async findById(id) {
    const query = `
      SELECT up.*, u.name as user_name, u.email as user_email,
             admin.name as assigned_by_name, admin.email as assigned_by_email
      FROM user_participation up
      LEFT JOIN users u ON up.user_id = u.id
      LEFT JOIN users admin ON up.assigned_by = admin.id
      WHERE up.id = $1
    `;
    
    try {
      const pool = await this.getPool();
      const result = await pool.query(query, [id]);
      return result.rows[0] || null;
    } catch (error) {
      logger.error('Error obteniendo participación por ID:', error);
      throw error;
    }
  }

  /**
   * Obtener todas las participaciones de un usuario
   */
  async findByUserId(userId) {
    const query = `
      SELECT up.*, admin.name as assigned_by_name, admin.email as assigned_by_email
      FROM user_participation up
      LEFT JOIN users admin ON up.assigned_by = admin.id
      WHERE up.user_id = $1
      ORDER BY up.created_at DESC
    `;
    
    try {
      const pool = await this.getPool();
      const result = await pool.query(query, [userId]);
      return result.rows;
    } catch (error) {
      logger.error('Error obteniendo participaciones por usuario:', error);
      throw error;
    }
  }

  /**
   * Obtener todas las participaciones de un generador específico
   */
  async findByGeneratorCode(generatorCode) {
    const query = `
      SELECT up.*, u.name as user_name, u.email as user_email,
             admin.name as assigned_by_name, admin.email as assigned_by_email
      FROM user_participation up
      LEFT JOIN users u ON up.user_id = u.id
      LEFT JOIN users admin ON up.assigned_by = admin.id
      WHERE up.generator_code = $1
      ORDER BY up.participation_percentage DESC, up.created_at DESC
    `;
    
    try {
      const pool = await this.getPool();
      const result = await pool.query(query, [generatorCode]);
      return result.rows;
    } catch (error) {
      logger.error('Error obteniendo participaciones por generador:', error);
      throw error;
    }
  }

  /**
   * Obtener participación específica de un usuario en un generador
   */
  async findByUserAndGenerator(userId, generatorCode) {
    const query = `
      SELECT up.*, admin.name as assigned_by_name, admin.email as assigned_by_email
      FROM user_participation up
      LEFT JOIN users admin ON up.assigned_by = admin.id
      WHERE up.user_id = $1 AND up.generator_code = $2
    `;
    
    try {
      const pool = await this.getPool();
      const result = await pool.query(query, [userId, generatorCode]);
      return result.rows[0] || null;
    } catch (error) {
      logger.error('Error obteniendo participación específica:', error);
      throw error;
    }
  }

  /**
   * Actualizar una participación existente
   */
  async update(id, { participationPercentage, assignedBy }) {
    const query = `
      UPDATE user_participation 
      SET participation_percentage = $2, assigned_by = $3, updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `;
    
    try {
      const pool = await this.getPool();
      const result = await pool.query(query, [id, participationPercentage, assignedBy]);
      return result.rows[0] || null;
    } catch (error) {
      logger.error('Error actualizando participación:', error);
      throw error;
    }
  }

  /**
   * Eliminar una participación
   */
  async delete(id) {
    const query = 'DELETE FROM user_participation WHERE id = $1 RETURNING *';
    
    try {
      const pool = await this.getPool();
      const result = await pool.query(query, [id]);
      return result.rows[0] || null;
    } catch (error) {
      logger.error('Error eliminando participación:', error);
      throw error;
    }
  }

  /**
   * Obtener todas las participaciones (para administradores)
   */
  async findAll({ limit = 50, offset = 0, generatorCode = null, userId = null } = {}) {
    let query = `
      SELECT up.*, u.name as user_name, u.email as user_email,
             admin.name as assigned_by_name, admin.email as assigned_by_email
      FROM user_participation up
      LEFT JOIN users u ON up.user_id = u.id
      LEFT JOIN users admin ON up.assigned_by = admin.id
    `;
    
    const conditions = [];
    const params = [];
    let paramCount = 0;

    if (generatorCode) {
      paramCount++;
      conditions.push(`up.generator_code = $${paramCount}`);
      params.push(generatorCode);
    }

    if (userId) {
      paramCount++;
      conditions.push(`up.user_id = $${paramCount}`);
      params.push(userId);
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    query += ` ORDER BY up.created_at DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
    params.push(limit, offset);
    
    try {
      const pool = await this.getPool();
      const result = await pool.query(query, params);
      return result.rows;
    } catch (error) {
      logger.error('Error obteniendo todas las participaciones:', error);
      throw error;
    }
  }

  /**
   * Contar total de participaciones (para paginación)
   */
  async count({ generatorCode = null, userId = null } = {}) {
    let query = 'SELECT COUNT(*) as total FROM user_participation';
    
    const conditions = [];
    const params = [];
    let paramCount = 0;

    if (generatorCode) {
      paramCount++;
      conditions.push(`generator_code = $${paramCount}`);
      params.push(generatorCode);
    }

    if (userId) {
      paramCount++;
      conditions.push(`user_id = $${paramCount}`);
      params.push(userId);
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }
    
    try {
      const pool = await this.getPool();
      const result = await pool.query(query, params);
      return parseInt(result.rows[0].total);
    } catch (error) {
      logger.error('Error contando participaciones:', error);
      throw error;
    }
  }

  /**
   * Verificar si existe una participación específica
   */
  async exists(userId, generatorCode) {
    const query = `
      SELECT EXISTS(
        SELECT 1 FROM user_participation 
        WHERE user_id = $1 AND generator_code = $2
      ) as exists
    `;
    
    try {
      const pool = await this.getPool();
      const result = await pool.query(query, [userId, generatorCode]);
      return result.rows[0].exists;
    } catch (error) {
      logger.error('Error verificando existencia de participación:', error);
      throw error;
    }
  }

  /**
   * Obtener resumen de participaciones por generador
   */
  async getGeneratorSummary(generatorCode) {
    const query = `
      SELECT 
        generator_code,
        COUNT(*) as total_participants,
        SUM(participation_percentage) as total_percentage,
        AVG(participation_percentage) as avg_percentage,
        MIN(participation_percentage) as min_percentage,
        MAX(participation_percentage) as max_percentage
      FROM user_participation 
      WHERE generator_code = $1
      GROUP BY generator_code
    `;
    
    try {
      const pool = await this.getPool();
      const result = await pool.query(query, [generatorCode]);
      return result.rows[0] || null;
    } catch (error) {
      logger.error('Error obteniendo resumen del generador:', error);
      throw error;
    }
  }
}

module.exports = UserParticipation;
