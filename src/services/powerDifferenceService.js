const database = require('../utils/database');
const logger = require('../utils/logger');
const configLoader = require('../utils/configLoader');
const { getPowerMetrics } = require('../config/device-metrics-config');

class PowerDifferenceService {
  constructor() {
    this.database = database;
    this.cache = new Map();
    this.CACHE_TTL_MS = 30000;
  }

  generateCacheKey(userIds) {
    return [...userIds].sort().join(',');
  }

  /**
   * Calcula la diferencia entre generación asignada y consumo para múltiples usuarios
   * @param {Array<string>} userIds - Array de IDs de usuarios
   * @returns {Object} - Diferencias por usuario
   */
  async getPowerDifference(userIds) {
    const cacheKey = this.generateCacheKey(userIds);
    const cached = this.cache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < this.CACHE_TTL_MS) {
      logger.debug('Usando cache de powerDifference', { cacheKey });
      return cached.data;
    }

    try {
      logger.info('Iniciando cálculo de diferencias de potencia', { userCount: userIds.length });

      // 1. Obtener CUPS de los usuarios
      const userCupsMap = await this.getUserCups(userIds);
     
      if (userCupsMap.size === 0) {
        logger.warn('No se encontraron usuarios válidos', { userIds });
        return {};
      }

      // 2. Obtener dispositivos EM de estos usuarios
      const emDevices = await this.getEmDevices(Array.from(userCupsMap.values()));

      // 3. Obtener participaciones de los usuarios
      const participations = await this.getUserParticipations(userIds);

      // 4. Construir device_ids para generadores (formato: "gen-" + generatorCode)
      const generatorCodes = [...new Set(participations.map(p => p.generator_code))];
      const generatorDeviceIds = generatorCodes.map(code => `gen-${code}`);

      // 5. Obtener últimas métricas de potencia
      const allDeviceIds = [
        ...emDevices.map(d => d.id),
        ...generatorDeviceIds
      ];

      if (allDeviceIds.length === 0) {
        logger.info('No se encontraron dispositivos para calcular diferencias');
        return {};
      }

      const powerMetrics = await this.getLatestPowerMetrics(allDeviceIds);

      // 6. Calcular diferencias por usuario
      const results = {};
      for (const userId of userIds) {
        const userCups = userCupsMap.get(userId);
        if (!userCups) continue;

        const userResult = await this.calculateUserDifference(
          userId,
          userCups,
          emDevices,
          participations,
          powerMetrics
        );

        if (userResult) {
          results[userId] = userResult;
        }
      }

      this.cache.set(cacheKey, { data: results, timestamp: Date.now() });

      logger.info('Cálculo de diferencias completado', {
        usersProcessed: Object.keys(results).length,
        totalUsers: userIds.length
      });

      return results;

    } catch (error) {
      logger.error('Error calculando diferencias de potencia:', error);
      throw error;
    }
  }

  /**
   * Obtiene los CUPS de los usuarios especificados
   * @param {Array<string>} userIds - IDs de usuarios
   * @returns {Map<string, string>} - Map de userId -> cups
   */
  async getUserCups(userIds) {
    const query = `
      SELECT id, cups
      FROM users
      WHERE id = ANY($1) AND cups IS NOT NULL
    `;

    const result = await this.database.query(query, [userIds]);
    const cupsMap = new Map();

    for (const row of result.rows) {
      cupsMap.set(row.id, row.cups);
    }

    return cupsMap;
  }

  /**
   * Obtiene dispositivos tipo EM de los CUPS especificados
   * @param {Array<string>} cupsList - Lista de CUPS
   * @returns {Array<Object>} - Lista de dispositivos EM
   */
  async getEmDevices(cupsList) {
    const query = `
      SELECT id, shelly_device_id, device_name
      FROM devices
      WHERE shelly_device_id = ANY($1) AND device_type = 'SHELLY_SHELLYEM'
    `;

    const result = await this.database.query(query, [cupsList]);
    return result.rows;
  }

  /**
   * Obtiene participaciones de los usuarios
   * @param {Array<string>} userIds - IDs de usuarios
   * @returns {Array<Object>} - Lista de participaciones
   */
  async getUserParticipations(userIds) {
    const query = `
      SELECT user_id, generator_code, participation_percentage
      FROM user_participation
      WHERE user_id = ANY($1)
      ORDER BY user_id, generator_code
    `;

    const result = await this.database.query(query, [userIds]);
    return result.rows;
  }


  /**
   * Obtiene las últimas métricas de potencia para los dispositivos
   * @param {Array<string>} deviceIds - IDs de dispositivos
   * @returns {Map<string, number>} - Map de deviceId -> valor de potencia en kW
   */
  async getLatestPowerMetrics(deviceIds) {
    if (deviceIds.length === 0) {
      return new Map();
    }

    const powerMetricNames = new Set();
    const emPowerMetrics = getPowerMetrics('SHELLY_EM');
    emPowerMetrics.forEach(metric => powerMetricNames.add(`${metric}_avg`));
    const generatorPowerMetrics = getPowerMetrics('GENERATOR');
    generatorPowerMetrics.forEach(metric => powerMetricNames.add(`${metric}_avg`));

    const metricNamesArray = Array.from(powerMetricNames);

    const query = `
      SELECT DISTINCT ON (device_id, metric_name)
        device_id,
        value
      FROM energy_metrics
      WHERE device_id = ANY($1)
        AND metric_name = ANY($2)
        AND timestamp >= NOW() - INTERVAL '1 hour'
      ORDER BY device_id, metric_name, timestamp DESC
    `;

    const result = await this.database.query(query, [deviceIds, metricNamesArray]);

    const metricsMap = new Map();
    for (const row of result.rows) {
      if (!metricsMap.has(row.device_id)) {
        metricsMap.set(row.device_id, row.value / 1000);
      }
    }

    return metricsMap;
  }

  /**
   * Calcula la diferencia para un usuario específico
   * @param {string} userId - ID del usuario
   * @param {string} userCups - CUPS del usuario
   * @param {Array<Object>} emDevices - Dispositivos EM
   * @param {Array<Object>} participations - Participaciones del usuario
   * @param {Map<string, number>} powerMetrics - Métricas de potencia
   * @returns {Object|null} - Resultado del cálculo o null si no hay datos
   */
  async calculateUserDifference(userId, userCups, emDevices, participations, powerMetrics) {
    // Filtrar participaciones del usuario
    const userParticipations = participations.filter(p => p.user_id === userId);

    if (userParticipations.length === 0) {
      logger.debug('Usuario sin participaciones en generadores', { userId });
      return null;
    }

    // Calcular generación asignada
    let totalAssignedGeneration = 0;
    const generatorDetails = [];

    for (const participation of userParticipations) {
      // Construir device_id del generador (formato: "gen-" + generatorCode)
      const generatorDeviceId = `gen-${participation.generator_code}`;

      // Obtener potencia del generador usando el device_id construido
      const generatorPower = powerMetrics.get(generatorDeviceId) || 0;

      // Calcular asignación del usuario
      const assignedAmount = generatorPower * (participation.participation_percentage / 100);

      totalAssignedGeneration += assignedAmount;

      generatorDetails.push({
        generatorCode: participation.generator_code,
        totalGeneration: generatorPower,
        participation: participation.participation_percentage / 100,
        assigned: assignedAmount
      });
    }

    // Calcular consumo total de dispositivos EM del usuario
    const userEmDevices = emDevices.filter(d => d.shelly_device_id === userCups);
    let totalConsumption = 0;

    for (const device of userEmDevices) {
      const devicePower = powerMetrics.get(device.id) || 0;
      totalConsumption += devicePower;
    }

    // Calcular diferencia
    const difference = totalAssignedGeneration - totalConsumption;

    return {
      userCups,
      assignedGeneration: Math.round(totalAssignedGeneration * 1000) / 1000, // Redondear a 3 decimales
      totalConsumption: Math.round(totalConsumption * 1000) / 1000,
      difference: Math.round(difference * 1000) / 1000,
      details: {
        generators: generatorDetails
      }
    };
  }
}

module.exports = PowerDifferenceService;
