const UserParticipation = require('../models/UserParticipation');
const User = require('../models/User');
const configLoader = require('../utils/configLoader');
const logger = require('../utils/logger');

class UserParticipationService {
  constructor() {
    this.userParticipation = new UserParticipation();
  }

  /**
   * Validar que el generador existe y está activo
   */
  validateGenerator(generatorCode) {
    try {
      const generators = configLoader.loadEnergyGenerators();
      const generator = generators[generatorCode];
      
      if (!generator) {
        throw new Error(`El generador '${generatorCode}' no existeix`);
      }
      
      if (!generator.active) {
        throw new Error(`El generador '${generatorCode}' no està actiu`);
      }
      
      return generator;
    } catch (error) {
      logger.error('Error validando generador:', error);
      throw error;
    }
  }

  /**
   * Validar porcentaje de participación
   */
  validatePercentage(percentage) {
    const num = parseFloat(percentage);
    
    if (isNaN(num)) {
      throw new Error('El percentatge ha de ser un número vàlid');
    }
    
    if (num < 0 || num > 100) {
      throw new Error('El percentatge ha d\'estar entre 0 i 100');
    }
    
    return num;
  }

  /**
   * Asignar participación a un usuario en un generador
   */
  async assignParticipation({ userId, generatorCode, participationPercentage, assignedBy }) {
    try {
      // Validar que el usuario existe
      const user = await User.findById(userId);
      if (!user) {
        throw new Error('Usuari no trobat');
      }

      // Validar que el admin existe
      const admin = await User.findById(assignedBy);
      if (!admin) {
        throw new Error('Administrador no trobat');
      }

      // Validar que el generador existe y está activo
      const generator = this.validateGenerator(generatorCode);

      // Validar porcentaje
      const validPercentage = this.validatePercentage(participationPercentage);

      // Verificar si ya existe una participación para este usuario y generador
      const existingParticipation = await this.userParticipation.exists(userId, generatorCode);
      if (existingParticipation) {
        throw new Error(`L'usuari ja té una participació assignada al generador '${generatorCode}'`);
      }

      // Crear la participación
      const participation = await this.userParticipation.create({
        userId,
        generatorCode,
        participationPercentage: validPercentage,
        assignedBy
      });

      logger.info('Participación asignada exitosamente', {
        participationId: participation.id,
        userId,
        generatorCode,
        percentage: validPercentage,
        assignedBy
      });

      return {
        ...participation,
        generator_name: generator.name,
        user_name: user.name,
        user_email: user.email
      };

    } catch (error) {
      logger.error('Error asignando participación:', error);
      throw error;
    }
  }

  /**
   * Actualizar participación existente
   */
  async updateParticipation(participationId, { participationPercentage, assignedBy }) {
    try {
      // Verificar que la participación existe
      const existingParticipation = await this.userParticipation.findById(participationId);
      if (!existingParticipation) {
        throw new Error('Participació no trobada');
      }

      // Validar que el admin existe
      const admin = await User.findById(assignedBy);
      if (!admin) {
        throw new Error('Administrador no trobat');
      }

      // Validar porcentaje
      const validPercentage = this.validatePercentage(participationPercentage);

      // Actualizar la participación
      const updatedParticipation = await this.userParticipation.update(participationId, {
        participationPercentage: validPercentage,
        assignedBy
      });

      logger.info('Participación actualizada exitosamente', {
        participationId,
        newPercentage: validPercentage,
        assignedBy
      });

      return updatedParticipation;

    } catch (error) {
      logger.error('Error actualizando participación:', error);
      throw error;
    }
  }

  /**
   * Eliminar participación
   */
  async deleteParticipation(participationId) {
    try {
      // Verificar que la participación existe
      const existingParticipation = await this.userParticipation.findById(participationId);
      if (!existingParticipation) {
        throw new Error('Participació no trobada');
      }

      // Eliminar la participación
      const deletedParticipation = await this.userParticipation.delete(participationId);

      logger.info('Participación eliminada exitosamente', {
        participationId,
        userId: existingParticipation.user_id,
        generatorCode: existingParticipation.generator_code
      });

      return deletedParticipation;

    } catch (error) {
      logger.error('Error eliminando participación:', error);
      throw error;
    }
  }

  /**
   * Obtener participaciones de un usuario con información de generadores
   */
  async getUserParticipations(userId) {
    try {
      const participations = await this.userParticipation.findByUserId(userId);
      const generators = configLoader.loadEnergyGenerators();

      // Enriquecer con información del generador
      const enrichedParticipations = participations.map(participation => ({
        ...participation,
        generator_name: generators[participation.generator_code]?.name || participation.generator_code,
        generator_active: generators[participation.generator_code]?.active || false
      }));

      return enrichedParticipations;

    } catch (error) {
      logger.error('Error obteniendo participaciones del usuario:', error);
      throw error;
    }
  }

  /**
   * Obtener participación específica de un usuario en un generador
   */
  async getUserGeneratorParticipation(userId, generatorCode) {
    try {
      // Validar que el generador existe
      const generator = this.validateGenerator(generatorCode);

      const participation = await this.userParticipation.findByUserAndGenerator(userId, generatorCode);
      
      if (!participation) {
        return null;
      }

      return {
        ...participation,
        generator_name: generator.name,
        generator_active: generator.active
      };

    } catch (error) {
      logger.error('Error obteniendo participación específica:', error);
      throw error;
    }
  }

  /**
   * Obtener todas las participaciones de un generador
   */
  async getGeneratorParticipations(generatorCode) {
    try {
      // Validar que el generador existe
      const generator = this.validateGenerator(generatorCode);

      const participations = await this.userParticipation.findByGeneratorCode(generatorCode);

      return {
        generator: {
          code: generatorCode,
          name: generator.name,
          active: generator.active
        },
        participations
      };

    } catch (error) {
      logger.error('Error obteniendo participaciones del generador:', error);
      throw error;
    }
  }

  /**
   * Obtener todas las participaciones (para administradores)
   */
  async getAllParticipations({ page = 1, limit = 50, generatorCode = null, userId = null } = {}) {
    try {
      const offset = (page - 1) * limit;
      
      // Validar generador si se especifica
      if (generatorCode) {
        this.validateGenerator(generatorCode);
      }

      const [participations, total] = await Promise.all([
        this.userParticipation.findAll({ limit, offset, generatorCode, userId }),
        this.userParticipation.count({ generatorCode, userId })
      ]);

      const generators = configLoader.loadEnergyGenerators();

      // Enriquecer con información del generador
      const enrichedParticipations = participations.map(participation => ({
        ...participation,
        generator_name: generators[participation.generator_code]?.name || participation.generator_code,
        generator_active: generators[participation.generator_code]?.active || false
      }));

      return {
        participations: enrichedParticipations,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
          hasNext: page < Math.ceil(total / limit),
          hasPrev: page > 1
        }
      };

    } catch (error) {
      logger.error('Error obteniendo todas las participaciones:', error);
      throw error;
    }
  }

  /**
   * Obtener resumen de un generador
   */
  async getGeneratorSummary(generatorCode) {
    try {
      // Validar que el generador existe
      const generator = this.validateGenerator(generatorCode);

      const summary = await this.userParticipation.getGeneratorSummary(generatorCode);

      if (!summary) {
        return {
          generator: {
            code: generatorCode,
            name: generator.name,
            active: generator.active
          },
          statistics: {
            total_participants: 0,
            total_percentage: 0,
            avg_percentage: 0,
            min_percentage: 0,
            max_percentage: 0
          }
        };
      }

      return {
        generator: {
          code: generatorCode,
          name: generator.name,
          active: generator.active
        },
        statistics: {
          total_participants: parseInt(summary.total_participants),
          total_percentage: parseFloat(summary.total_percentage),
          avg_percentage: parseFloat(summary.avg_percentage),
          min_percentage: parseFloat(summary.min_percentage),
          max_percentage: parseFloat(summary.max_percentage)
        }
      };

    } catch (error) {
      logger.error('Error obteniendo resumen del generador:', error);
      throw error;
    }
  }

  /**
   * Obtener lista de generadores disponibles
   */
  getAvailableGenerators() {
    try {
      const generators = configLoader.loadEnergyGenerators();
      
      return Object.entries(generators)
        .filter(([code, config]) => config.active === true)
        .map(([code, config]) => ({
          code,
          name: config.name,
          active: config.active
        }));

    } catch (error) {
      logger.error('Error obteniendo generadores disponibles:', error);
      throw error;
    }
  }
}

module.exports = UserParticipationService;
