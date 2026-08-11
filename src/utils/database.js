const { Pool } = require('pg');
const logger = require('./logger');

class Database {
  constructor() {
    this.pool = null;
  }

  async connect() {
    try {
      // Parsear la URL de la base de datos desde .env
      const dbUrl = new URL(process.env.DATABASE_URL);
      
      this.pool = new Pool({
        host: dbUrl.hostname,
        port: parseInt(dbUrl.port) || 5432,
        database: dbUrl.pathname.slice(1), // Remover el '/' inicial
        user: dbUrl.username,
        password: decodeURIComponent(dbUrl.password), // Decodificar caracteres especiales como %24 -> $
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 2000,
      });

      // Probar la conexión
      const client = await this.pool.connect();
      await client.query('SELECT NOW()');
      client.release();

      logger.info('Conexión a PostgreSQL establecida correctamente');
      return this.pool;
    } catch (error) {
      logger.error('Error conectando a PostgreSQL:', error);
      throw error;
    }
  }

  async query(text, params) {
    const start = Date.now();
    try {
      const res = await this.pool.query(text, params);
      const duration = Date.now() - start;
      logger.debug('Query ejecutada', { text, duration, rows: res.rowCount });
      return res;
    } catch (error) {
      logger.error('Error en query de base de datos:', {
        text,
        parameterCount: Array.isArray(params) ? params.length : 0,
        error: error.message
      });
      throw error;
    }
  }

  async getClient() {
    return await this.pool.connect();
  }

  async close() {
    if (this.pool) {
      await this.pool.end();
      logger.info('Conexión a PostgreSQL cerrada');
    }
  }
}

// Singleton instance
const database = new Database();

// Exportar tanto la instancia como una función para obtener el pool
module.exports = database;
module.exports.pool = database.pool; // Para compatibilidad inicial
module.exports.getPool = () => database.pool; // Función para obtener el pool actual
