const logger = require('../utils/logger');
const database = require('../utils/database');
const PlugsService = require('./plugsService');

class AutomationTimerService {
  constructor() {
    this.plugsService = new PlugsService();
    this.timer = null;
    this.isRunning = false;
    this.intervalMinutes = parseInt(process.env.AUTOMATION_TIMMER_INTERVAL) || 5;
    this.userTimezone = process.env.USERS_TIMEZONE || 'Europe/Madrid';
    this.lastStateCache = new Map(); // Cache para evitar spam de comandos
    this.logger = logger;
  }

  /**
   * Inicia el servicio de timer de automatización
   */
  async start() {
    try {
      if (this.isRunning) {
        this.logger.warn('AutomationTimerService ya está ejecutándose');
        return;
      }

      this.logger.info('Iniciando AutomationTimerService', {
        intervalMinutes: this.intervalMinutes,
        userTimezone: this.userTimezone
      });

      // Ejecutar inmediatamente la primera vez
      await this.processScheduleAutomations();

      // Configurar timer para ejecutar cada X minutos
      this.timer = setInterval(async () => {
        try {
          await this.processScheduleAutomations();
        } catch (error) {
          this.logger.error('Error en ciclo de automatización', {
            error: error.message,
            stack: error.stack
          });
        }
      }, this.intervalMinutes * 60 * 1000); // Convertir minutos a milisegundos

      this.isRunning = true;
      this.logger.info('AutomationTimerService iniciado exitosamente', {
        intervalMs: this.intervalMinutes * 60 * 1000
      });

    } catch (error) {
      this.logger.error('Error iniciando AutomationTimerService', {
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Detiene el servicio de timer de automatización
   */
  async stop() {
    try {
      if (!this.isRunning) {
        this.logger.warn('AutomationTimerService no está ejecutándose');
        return;
      }

      this.logger.info('Deteniendo AutomationTimerService...');

      if (this.timer) {
        clearInterval(this.timer);
        this.timer = null;
      }

      this.isRunning = false;
      this.lastStateCache.clear();

      this.logger.info('AutomationTimerService detenido exitosamente');

    } catch (error) {
      this.logger.error('Error deteniendo AutomationTimerService', {
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Procesa todas las automatizaciones de tipo 'schedule' activas
   */
  async processScheduleAutomations() {
    try {
      const startTime = Date.now();
      
      this.logger.info('Iniciando ciclo de procesamiento de automatizaciones schedule');

      // Obtener automatizaciones activas de tipo 'schedule'
      const query = `
        SELECT 
          ac.id as automation_id,
          ac.device_id,
          ac.config_data,
          d.user_id,
          d.device_name,
          d.shelly_device_id
        FROM automation_configs ac
        JOIN devices d ON ac.device_id = d.id
        WHERE ac.is_active = true 
        AND ac.config_data->>'type' = 'schedule'
        ORDER BY d.device_name
      `;

      const result = await database.query(query);
      const automations = result.rows;
      this.logger.info('Automatizaciones schedule encontradas', {
        count: automations.length
      });

      if (automations.length === 0) {
        this.logger.info('No hay automatizaciones schedule activas para procesar');
        return;
      }

      // Obtener tiempo actual en timezone del usuario
      const currentTime = this.getCurrentTimeInUserTimezone();
     
      const currentDay = currentTime.getDay(); // 0=domingo, 1=lunes, etc.
      const currentHour = currentTime.getHours();
      const currentMinute = currentTime.getMinutes();
      const currentTimeString = `${currentHour.toString().padStart(2, '0')}:${currentMinute.toString().padStart(2, '0')}`;

      this.logger.info('Tiempo actual para evaluación', {
        timezone: this.userTimezone,
        currentDay,
        currentTimeString,
        timestamp: currentTime.toISOString()
      });

      let processedCount = 0;
      let actionsExecuted = 0;
      let errorsCount = 0;

      // Procesar cada automatización
      for (const automation of automations) {
        try {
          const shouldBeOn = this.evaluateScheduleAutomation(
            automation.config_data,
            currentDay,
            currentTimeString
          );

          if (shouldBeOn !== null) {
            const actionExecuted = await this.executePlugControl(
              automation.device_id,
              automation.user_id,
              shouldBeOn,
              automation.device_name,
              automation.shelly_device_id
            );

            if (actionExecuted) {
              actionsExecuted++;
            }
          }

          processedCount++;

        } catch (automationError) {
          errorsCount++;
          this.logger.error('Error procesando automatización individual', {
            automationId: automation.automation_id,
            deviceId: automation.device_id,
            deviceName: automation.device_name,
            error: automationError.message
          });
        }
      }

      const processingTime = Date.now() - startTime;

      this.logger.info('Ciclo de automatización completado', {
        totalAutomations: automations.length,
        processedCount,
        actionsExecuted,
        errorsCount,
        processingTimeMs: processingTime
      });

    } catch (error) {
      this.logger.error('Error en processScheduleAutomations', {
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Evalúa si una automatización de tipo schedule debe estar activa
   * @param {Object} configData - Configuración de la automatización
   * @param {number} currentDay - Día actual (0=domingo, 1=lunes, etc.)
   * @param {string} currentTimeString - Hora actual en formato HH:MM
   * @returns {boolean|null} - true si debe estar ON, false si debe estar OFF, null si no debe cambiar
   */
  evaluateScheduleAutomation(configData, currentDay, currentTimeString) {
    try {
      if (!configData || configData.type !== 'schedule') {
        return null;
      }

      const schedule = configData.schedule || [];
      
      if (!Array.isArray(schedule) || schedule.length === 0) {
        this.logger.debug('No hay horarios configurados en la automatización');
        return false; // Sin horarios = debe estar OFF
      }

      // Verificar si algún slot está activo
      for (const slot of schedule) {
        if (this.isScheduleSlotActive(slot, currentDay, currentTimeString)) {
          this.logger.debug('Slot de horario activo encontrado', {
            slotId: slot.id,
            days: slot.days,
            startTime: slot.startTime,
            endTime: slot.endTime,
            currentDay,
            currentTimeString
          });
          return true; // Al menos un slot está activo = debe estar ON
        }
      }

      // Ningún slot está activo = debe estar OFF
      return false;

    } catch (error) {
      this.logger.error('Error evaluando automatización schedule', {
        error: error.message,
        configData
      });
      return null;
    }
  }

  /**
   * Verifica si un slot de horario específico está activo
   * @param {Object} slot - Slot de horario
   * @param {number} currentDay - Día actual
   * @param {string} currentTimeString - Hora actual
   * @returns {boolean} - true si el slot está activo
   */
  isScheduleSlotActive(slot, currentDay, currentTimeString) {
    try {
      // Verificar que el día actual esté en los días del slot
      if (!Array.isArray(slot.days) || !slot.days.includes(currentDay)) {
        return false;
      }

      // Verificar que la hora actual esté dentro del rango
      const startTime = slot.startTime;
      const endTime = slot.endTime;

      if (!startTime || !endTime) {
        this.logger.warn('Slot sin horarios válidos', { slot });
        return false;
      }

      // Comparar strings de tiempo (formato HH:MM)
      const isWithinTimeRange = currentTimeString >= startTime && currentTimeString <= endTime;

      this.logger.debug('Evaluación de slot', {
        slotId: slot.id,
        currentDay,
        currentTimeString,
        startTime,
        endTime,
        daysMatch: slot.days.includes(currentDay),
        timeMatch: isWithinTimeRange,
        result: isWithinTimeRange
      });

      return isWithinTimeRange;

    } catch (error) {
      this.logger.error('Error evaluando slot de horario', {
        error: error.message,
        slot
      });
      return false;
    }
  }

  /**
   * Ejecuta control del plug si es necesario
   * @param {string} deviceId - ID del dispositivo
   * @param {string} userId - ID del usuario
   * @param {boolean} shouldBeOn - Si el plug debe estar encendido
   * @param {string} deviceName - Nombre del dispositivo (para logs)
   * @param {string} shellyDeviceId - ID del dispositivo Shelly (para logs)
   * @returns {boolean} - true si se ejecutó una acción
   */
  async executePlugControl(deviceId, userId, shouldBeOn, deviceName, shellyDeviceId) {
    try {
      // Verificar cache para evitar spam de comandos
      const cacheKey = deviceId;
      const lastState = this.lastStateCache.get(cacheKey);

      if (lastState === shouldBeOn) {
        this.logger.debug('Estado del plug ya es el deseado, no se envía comando', {
          deviceId,
          deviceName,
          currentState: lastState,
          desiredState: shouldBeOn
        });
        return false; // No se ejecutó acción
      }

      // Ejecutar comando usando el método existente
      const action = shouldBeOn ? 'on' : 'off';
      
      this.logger.info('Ejecutando control de plug por automatización', {
        deviceId,
        deviceName,
        shellyDeviceId,
        action,
        previousState: lastState,
        newState: shouldBeOn
      });

      const result = await this.plugsService.controlPlug(deviceId, userId, action);

      if (result.success) {
        // Actualizar cache
        this.lastStateCache.set(cacheKey, shouldBeOn);

        this.logger.info('Control de plug ejecutado exitosamente', {
          deviceId,
          deviceName,
          action,
          mqttTopic: result.topic,
          timestamp: result.timestamp
        });

        return true; // Se ejecutó acción
      } else {
        this.logger.error('Error en control de plug', {
          deviceId,
          deviceName,
          action,
          result
        });
        return false;
      }

    } catch (error) {
      this.logger.error('Error ejecutando control de plug', {
        deviceId,
        deviceName,
        shouldBeOn,
        error: error.message
      });
      return false;
    }
  }

  /**
   * Evalúa automatización por potencia (placeholder)
   * @param {Object} automation - Configuración de automatización
   * @returns {null} - Por ahora no implementado
   */
  evaluatePowerAutomation(automation) {
    // TODO: Implementar lógica de automatización por potencia
    // Por ahora retornar null (no hacer nada)
    this.logger.debug('Automatización por potencia no implementada aún', {
      automationId: automation.automation_id
    });
    return null;
  }

  /**
   * Obtiene el tiempo actual en el timezone del usuario
   * @returns {Date} - Fecha actual en timezone del usuario
   */
  getCurrentTimeInUserTimezone() {
    try {
      // Crear fecha actual
      const now = new Date();
      
      // Convertir a timezone del usuario usando Intl.DateTimeFormat
      const timeInUserTz = new Intl.DateTimeFormat('en-CA', {
        timeZone: this.userTimezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      }).formatToParts(now);

      // Construir objeto Date con el tiempo en timezone del usuario
      const year = parseInt(timeInUserTz.find(part => part.type === 'year').value);
      const month = parseInt(timeInUserTz.find(part => part.type === 'month').value) - 1; // Month is 0-indexed
      const day = parseInt(timeInUserTz.find(part => part.type === 'day').value);
      const hour = parseInt(timeInUserTz.find(part => part.type === 'hour').value);
      const minute = parseInt(timeInUserTz.find(part => part.type === 'minute').value);
      const second = parseInt(timeInUserTz.find(part => part.type === 'second').value);

      return new Date(year, month, day, hour, minute, second);

    } catch (error) {
      this.logger.error('Error obteniendo tiempo en timezone del usuario', {
        timezone: this.userTimezone,
        error: error.message
      });
      // Fallback a tiempo local
      return new Date();
    }
  }

  /**
   * Obtiene estadísticas del servicio
   * @returns {Object} - Estadísticas del servicio
   */
  getStats() {
    return {
      isRunning: this.isRunning,
      intervalMinutes: this.intervalMinutes,
      userTimezone: this.userTimezone,
      cacheSize: this.lastStateCache.size,
      lastStates: Object.fromEntries(this.lastStateCache)
    };
  }

  /**
   * Health check del servicio
   * @returns {Object} - Estado de salud del servicio
   */
  async healthCheck() {
    try {
      const stats = this.getStats();
      
      return {
        status: this.isRunning ? 'healthy' : 'stopped',
        service: 'AutomationTimerService',
        ...stats,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      return {
        status: 'unhealthy',
        service: 'AutomationTimerService',
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Limpia el cache de estados
   */
  clearCache() {
    this.lastStateCache.clear();
    this.logger.info('Cache de estados limpiado');
  }

  /**
   * Ejecuta un ciclo manual de procesamiento (para testing)
   */
  async runManualCycle() {
    this.logger.info('Ejecutando ciclo manual de automatización');
    await this.processScheduleAutomations();
  }
}

module.exports = AutomationTimerService;
