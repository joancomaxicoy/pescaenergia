const UserParticipationService = require('./userParticipationService');
const DeviceHistoryService = require('./deviceHistoryService');
const logger = require('../utils/logger');

class DashboardService {
  constructor() {
    this.userParticipationService = new UserParticipationService();
    this.deviceHistoryService = new DeviceHistoryService();
  }

  /**
   * Obtiene los datos completos del dashboard para un usuario
   * @param {string} userId - ID del usuario
   * @returns {Object} - Datos del dashboard con generadores y métricas
   */
  async getUserDashboardData(userId) {
    try {
      // Obtener todos los generadores disponibles
      const allGenerators = this.userParticipationService.getAvailableGenerators();
      
      // Obtener las participaciones del usuario
      const participations = await this.userParticipationService.getUserParticipations(userId);
      
      // Crear un mapa de participaciones por código de generador
      const participationMap = new Map();
      participations.forEach(participation => {
        participationMap.set(participation.generator_code, participation);
      });

      // Para cada generador disponible, obtener las métricas y combinar con participaciones
      const generatorsData = await Promise.all(
        allGenerators.map(async (generator) => {
          const participation = participationMap.get(generator.code);
          
          try {
            // Usar el generator_code como deviceId para el DeviceHistoryService
            const deviceId = generator.code;
            
            // Obtener las métricas más recientes
            const metricsData = await this.deviceHistoryService.getLatestMetrics(
              deviceId,
              ['power_generation_avg', 'voltage_avg', 'frequency_avg', 'power_avg', 'voltage', 'frequency']
            );

            // Normalizar las métricas (diferentes nombres posibles)
            const normalizedMetrics = this.normalizeMetrics(metricsData.metrics);

            return {
              generatorCode: generator.code,
              generatorName: generator.name,
              participationPercentage: participation ? participation.participation_percentage : 0,
              hasParticipation: !!participation,
              isActive: generator.active,
              metrics: normalizedMetrics,
              lastUpdate: metricsData.timestamp,
              hasData: Object.keys(normalizedMetrics).length > 0
            };

          } catch (error) {
            logger.warn('Error obteniendo métricas para generador:', {
              generatorCode: generator.code,
              error: error.message
            });

            // Retornar datos básicos sin métricas si hay error
            return {
              generatorCode: generator.code,
              generatorName: generator.name,
              participationPercentage: participation ? participation.participation_percentage : 0,
              hasParticipation: !!participation,
              isActive: generator.active,
              metrics: {},
              lastUpdate: null,
              hasData: false,
              error: 'Sin datos disponibles'
            };
          }
        })
      );

      // Filtrar solo generadores activos
      const activeGenerators = generatorsData.filter(gen => gen.isActive);
      
      // Separar generadores con y sin participación
      const generatorsWithParticipation = activeGenerators.filter(gen => gen.hasParticipation);
      const generatorsWithoutParticipation = activeGenerators.filter(gen => !gen.hasParticipation);
      
      // Ordenar: primero los que tienen participación, luego los que no
      const sortedGenerators = [...generatorsWithParticipation, ...generatorsWithoutParticipation];

      logger.info('Datos del dashboard obtenidos exitosamente', {
        userId,
        totalGenerators: allGenerators.length,
        activeGenerators: activeGenerators.length,
        generatorsWithParticipation: generatorsWithParticipation.length,
        generatorsWithData: activeGenerators.filter(g => g.hasData).length
      });

      return {
        hasGenerators: activeGenerators.length > 0,
        hasParticipations: generatorsWithParticipation.length > 0,
        generators: sortedGenerators,
        totalParticipations: participations.length,
        activeGenerators: activeGenerators.length,
        generatorsWithParticipation: generatorsWithParticipation.length
      };

    } catch (error) {
      logger.error('Error obteniendo datos del dashboard:', {
        userId,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Normaliza las métricas para tener nombres consistentes
   * @param {Object} metrics - Métricas brutas
   * @returns {Object} - Métricas normalizadas
   */
  normalizeMetrics(metrics) {
    const normalized = {};

    // Potencia (priorizar power_generation_avg, luego power_avg, luego power)
    if (metrics.power_generation_avg !== undefined) {
      normalized.power = metrics.power_generation_avg;
    } else if (metrics.power_avg !== undefined) {
      normalized.power = metrics.power_avg;
    } else if (metrics.power !== undefined) {
      normalized.power = metrics.power;
    }

    // Tensión/Voltaje (priorizar voltage_avg, luego voltage)
    if (metrics.voltage_avg !== undefined) {
      normalized.voltage = metrics.voltage_avg;
    } else if (metrics.voltage !== undefined) {
      normalized.voltage = metrics.voltage;
    }

    // Frecuencia (priorizar frequency_avg, luego frequency)
    if (metrics.frequency_avg !== undefined) {
      normalized.frequency = metrics.frequency_avg;
    } else if (metrics.frequency !== undefined) {
      normalized.frequency = metrics.frequency;
    }

    return normalized;
  }

  /**
   * Obtiene las métricas de evolución para un generador específico
   * @param {string} userId - ID del usuario
   * @param {string} generatorCode - Código del generador
   * @param {string} period - Período ('1h', '24h', '7d', '30d')
   * @returns {Object} - Datos de evolución
   */
  async getGeneratorEvolution(userId, generatorCode, period = '24h') {
    try {
      // Verificar que el usuario tiene participación en este generador
      const participation = await this.userParticipationService.getUserGeneratorParticipation(userId, generatorCode);
      
      if (!participation) {
        throw new Error('No tienes participación en este generador');
      }

      // Calcular fechas según el período
      const endDate = new Date();
      const startDate = new Date();
      let aggregation = '1h';

      switch (period) {
        case '1h':
          startDate.setHours(startDate.getHours() - 1);
          aggregation = '1m';
          break;
        case '24h':
          startDate.setHours(startDate.getHours() - 24);
          aggregation = '1h';
          break;
        case '7d':
          startDate.setDate(startDate.getDate() - 7);
          aggregation = '6h';
          break;
        case '30d':
          startDate.setDate(startDate.getDate() - 30);
          aggregation = '1d';
          break;
        default:
          throw new Error('Período no válido');
      }

      // Obtener evolución de las métricas principales
      const [powerEvolution, voltageEvolution, frequencyEvolution] = await Promise.allSettled([
        this.deviceHistoryService.getMetricEvolution(generatorCode, 'power_generation_avg', startDate, endDate, aggregation),
        this.deviceHistoryService.getMetricEvolution(generatorCode, 'voltage_avg', startDate, endDate, aggregation),
        this.deviceHistoryService.getMetricEvolution(generatorCode, 'frequency_avg', startDate, endDate, aggregation)
      ]);

      const result = {
        generatorCode,
        generatorName: participation.generator_name,
        participationPercentage: participation.participation_percentage,
        period,
        evolution: {}
      };

      // Procesar resultados
      if (powerEvolution.status === 'fulfilled') {
        result.evolution.power = powerEvolution.value.data;
      }
      if (voltageEvolution.status === 'fulfilled') {
        result.evolution.voltage = voltageEvolution.value.data;
      }
      if (frequencyEvolution.status === 'fulfilled') {
        result.evolution.frequency = frequencyEvolution.value.data;
      }

      return result;

    } catch (error) {
      logger.error('Error obteniendo evolución del generador:', {
        userId,
        generatorCode,
        period,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Obtiene estadísticas resumidas para el dashboard
   * @param {string} userId - ID del usuario
   * @returns {Object} - Estadísticas resumidas
   */
  async getDashboardStats(userId) {
    try {
      const participations = await this.userParticipationService.getUserParticipations(userId);
      
      const stats = {
        totalParticipations: participations.length,
        totalPercentage: participations.reduce((sum, p) => sum + p.participation_percentage, 0),
        activeGenerators: participations.filter(p => p.generator_active).length,
        averageParticipation: participations.length > 0 
          ? participations.reduce((sum, p) => sum + p.participation_percentage, 0) / participations.length 
          : 0
      };

      return stats;

    } catch (error) {
      logger.error('Error obteniendo estadísticas del dashboard:', {
        userId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Obtiene datos históricos combinados para el gráfico del dashboard
   * @param {string} userId - ID del usuario
   * @param {string} period - Período ('24h', '7d', '30d')
   * @returns {Object} - Datos formateados para Chart.js
   */
  async getHistoricalChartData(userId, period = '24h') {
    try {
      // Obtener información del usuario
      const userInfo = await this.getUserInfo(userId);
      if (!userInfo) {
        throw new Error('Usuario no encontrado');
      }

      // Obtener todos los devices asociados al usuario
      const userDevices = await this.getUserDevices(userId);
      
      // Obtener participaciones del usuario
      const participations = await this.userParticipationService.getUserParticipations(userId);
      
      // Calcular fechas y agregación según el período
      const { startDate, endDate, aggregation } = this.calculatePeriodParams(period);

      // Preparar promesas para obtener datos históricos
      const dataPromises = [];

      // 1. Datos de consumo para cada device del usuario
      if (userDevices && userDevices.length > 0) {
        for (const device of userDevices) {
          dataPromises.push(
            this.deviceHistoryService.getMetricEvolution(
              device.id, // Usar device_id en lugar de CUPS
              'potencia_circutor_avg', 
              startDate, 
              endDate, 
              aggregation
            ).then(result => ({
              ...result,
              deviceId: device.id,
              deviceName: device.device_name,
              deviceType: device.device_type,
              userCups: device.user_cups
            })).catch(error => {
              logger.warn('Error obteniendo datos de consumo para device:', {
                deviceId: device.id,
                deviceName: device.device_name,
                error: error.message
              });
              return { 
                data: [],
                deviceId: device.id,
                deviceName: device.device_name,
                deviceType: device.device_type,
                userCups: device.user_cups
              };
            })
          );
        }
      }

      // 2. Datos de generación para cada participación (solo si tiene participaciones)
      if (participations && participations.length > 0) {
        for (const participation of participations) {
          if (participation.generator_active) {
            dataPromises.push(
              this.deviceHistoryService.getMetricEvolution(
                participation.generator_code,
                'potenciaFotovoltaica_avg',
                startDate,
                endDate,
                aggregation
              ).then(result => ({
                ...result,
                generatorCode: participation.generator_code,
                generatorName: participation.generator_name,
                participationPercentage: participation.participation_percentage,
                type: 'generation'
              })).catch(error => {
                logger.warn('Error obteniendo datos de generador:', {
                  generatorCode: participation.generator_code,
                  error: error.message
                });
                return { 
                  data: [],
                  generatorCode: participation.generator_code,
                  generatorName: participation.generator_name,
                  participationPercentage: participation.participation_percentage,
                  type: 'generation'
                };
              })
            );
          }
        }
      }

      // Ejecutar todas las consultas en paralelo
      const results = await Promise.all(dataPromises);
      
      // Separar resultados de consumo y generación
      const consumptionResults = results.filter(r => !r.type || r.type !== 'generation');
      const generationResults = results.filter(r => r.type === 'generation');

      // Crear conjunto unificado de timestamps
      const allTimestamps = new Set();
      
      // Agregar timestamps de consumo
      consumptionResults.forEach(result => {
        if (result.data) {
          result.data.forEach(point => {
            allTimestamps.add(new Date(point.timestamp).toISOString());
          });
        }
      });

      // Agregar timestamps de generación
      generationResults.forEach(result => {
        if (result.data) {
          result.data.forEach(point => {
            allTimestamps.add(new Date(point.timestamp).toISOString());
          });
        }
      });

      // Convertir a array ordenado
      const sortedTimestamps = Array.from(allTimestamps).sort();

      // Si no hay timestamps, crear un conjunto básico para mostrar al menos la estructura
      if (sortedTimestamps.length === 0) {
        const now = new Date();
        const { startDate: fallbackStart } = this.calculatePeriodParams(period);
        
        // Crear timestamps de ejemplo para mostrar estructura vacía
        const timeDiff = now - fallbackStart;
        const intervals = period === '24h' ? 24 : (period === '7d' ? 28 : 30); // 24h=24 points, 7d=28 points (every 6h), 30d=30 points (daily)
        
        for (let i = 0; i < intervals; i++) {
          const timestamp = new Date(fallbackStart.getTime() + (timeDiff / intervals) * i);
          sortedTimestamps.push(timestamp.toISOString());
        }
      }

      // Crear datasets para Chart.js
      const datasets = [];

      // Datasets de consumo (uno por cada device del usuario)
      consumptionResults.forEach(result => {
        const consumptionMap = new Map();
        if (result.data) {
          result.data.forEach(point => {
            consumptionMap.set(new Date(point.timestamp).toISOString(), point.value);
          });
        }

        // Determinar el label del dataset
        let label = `Consum ${result.deviceName || 'Device'}`;
        if (result.userCups) {
          label += ` (${result.userCups})`;
        }

        datasets.push({
          label,
          data: sortedTimestamps.map(timestamp => consumptionMap.get(timestamp) || null),
          borderColor: '#1b4444',
          backgroundColor: 'rgba(27, 68, 68, 0.1)',
          fill: false,
          tension: 0.1,
          type: 'consumption'
        });
      });

      // Datasets de generación (solo si hay participaciones)
      generationResults.forEach(result => {
        if (result.data && result.data.length > 0) {
          const generationMap = new Map();
          result.data.forEach(point => {
            // Aplicar fórmula: (potenciaFotovoltaica_avg / 100) * participationPercentage
            const adjustedValue = (point.value / 100) * result.participationPercentage;
            generationMap.set(new Date(point.timestamp).toISOString(), adjustedValue);
          });

          datasets.push({
            label: `${result.generatorName} (${result.participationPercentage}%)`,
            data: sortedTimestamps.map(timestamp => generationMap.get(timestamp) || null),
            borderColor: '#459f49',
            backgroundColor: 'rgba(69, 159, 73, 0.1)',
            fill: false,
            tension: 0.1,
            type: 'generation'
          });
        }
      });

      // Formatear labels para mostrar
      const labels = sortedTimestamps.map(timestamp => {
        const date = new Date(timestamp);
        if (period === '24h') {
          return date.toLocaleTimeString('ca-ES', { hour: '2-digit', minute: '2-digit' });
        } else if (period === '7d') {
          return date.toLocaleDateString('ca-ES', { weekday: 'short', hour: '2-digit' });
        } else {
          return date.toLocaleDateString('ca-ES', { day: 'numeric', month: 'short' });
        }
      });

      logger.info('Datos históricos del gráfico obtenidos exitosamente', {
        userId,
        period,
        totalDatasets: datasets.length,
        totalDataPoints: sortedTimestamps.length,
        consumptionDatasets: datasets.filter(d => d.type === 'consumption').length,
        generationDatasets: datasets.filter(d => d.type === 'generation').length,
        userDevicesCount: userDevices.length,
        hasParticipations: participations.length > 0
      });

      return {
        period,
        labels,
        datasets,
        totalDataPoints: sortedTimestamps.length,
        dateRange: {
          start: startDate.toISOString(),
          end: endDate.toISOString()
        }
      };

    } catch (error) {
      logger.error('Error obteniendo datos históricos del gráfico:', {
        userId,
        period,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Obtiene información básica del usuario
   * @param {string} userId - ID del usuario
   * @returns {Object} - Información del usuario
   */
  async getUserInfo(userId) {
    try {
      const database = require('../utils/database');
      const query = `
        SELECT id, name, email, cups
        FROM users
        WHERE id = $1::uuid
        LIMIT 1
      `;
      
      const result = await database.query(query, [userId]);
      
      if (result.rows.length === 0) {
        return null;
      }

      return result.rows[0];

    } catch (error) {
      logger.error('Error obteniendo información del usuario:', {
        userId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Obtiene todos los devices asociados a un usuario
   * @param {string} userId - ID del usuario
   * @returns {Array} - Lista de devices del usuario
   */
  async getUserDevices(userId) {
    try {
      const database = require('../utils/database');
      
      // Verificar si el userId es un UUID válido
      const isValidUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId);
      
      if (!isValidUUID) {
        logger.warn('UserId no es un UUID válido, retornando array vacío', { userId });
        return [];
      }

      const query = `
        SELECT 
          d.id,
          d.device_name,
          d.device_type,
          d.shelly_device_id,
          d.created_at,
          u.cups as user_cups,
          u.name as user_name
        FROM devices d
        JOIN users u ON d.user_id = u.id::text
        WHERE d.user_id = $1
        ORDER BY d.device_name ASC
      `;
      
      const result = await database.query(query, [userId]);
      
      logger.info('Devices del usuario obtenidos', {
        userId,
        devicesCount: result.rows.length
      });

      return result.rows;

    } catch (error) {
      logger.error('Error obteniendo devices del usuario:', {
        userId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Calcula parámetros de fecha y agregación según el período
   * @param {string} period - Período solicitado
   * @returns {Object} - Parámetros calculados
   */
  calculatePeriodParams(period) {
    const endDate = new Date();
    const startDate = new Date();
    let aggregation;

    switch (period) {
      case '24h':
        startDate.setHours(startDate.getHours() - 24);
        aggregation = '1h';
        break;
      case '7d':
        startDate.setDate(startDate.getDate() - 7);
        aggregation = '6h';
        break;
      case '30d':
        startDate.setDate(startDate.getDate() - 30);
        aggregation = '1d';
        break;
      default:
        throw new Error('Período no válido');
    }

    return { startDate, endDate, aggregation };
  }

  /**
   * Verifica la salud del servicio de dashboard
   * @returns {Object} - Estado de salud
   */
  async healthCheck() {
    try {
      const [participationHealth, deviceHistoryHealth] = await Promise.all([
        // Verificar que el servicio de participaciones funciona
        this.userParticipationService.getAvailableGenerators(),
        // Verificar que el servicio de historial funciona
        this.deviceHistoryService.healthCheck()
      ]);

      return {
        status: 'healthy',
        services: {
          userParticipation: participationHealth.length > 0,
          deviceHistory: deviceHistoryHealth
        },
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      logger.error('Health check del dashboard falló:', error);
      return {
        status: 'unhealthy',
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }
}

module.exports = DashboardService;
