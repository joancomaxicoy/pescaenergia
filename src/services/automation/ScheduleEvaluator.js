const logger = require('../../utils/logger');

/**
 * Evaluador de automatizaciones por horario
 * Determina si un dispositivo debe estar encendido o apagado según su configuración de horarios
 */
class ScheduleEvaluator {
  constructor() {
    this.userTimezone = process.env.USERS_TIMEZONE || 'Europe/Madrid';
    this.dayNames = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
  }

  /**
   * Evalúa si un dispositivo debe estar encendido según su configuración de horarios
   * @param {Object} config - Configuración de automatización del dispositivo
   * @param {Date} currentTime - Tiempo actual (opcional, usa tiempo actual si no se proporciona)
   * @returns {boolean|null} - true si debe estar ON, false si debe estar OFF, null si no hay cambio
   */
  evaluate(config, currentTime = null) {
    try {
      if (!config || config.type !== 'schedule') {
        logger.debug('Configuración no es de tipo schedule', { configType: config?.type });
        return null;
      }

      const now = currentTime || this.getCurrentTimeInUserTimezone();
      const currentDay = now.getDay();
      const currentHour = now.getHours();
      const currentMinute = now.getMinutes();
      const currentTimeString = `${currentHour.toString().padStart(2, '0')}:${currentMinute.toString().padStart(2, '0')}`;

      logger.debug('Evaluando configuración schedule', {
        currentDay: currentDay,
        currentDayName: this.dayNames[currentDay],
        currentTime: currentTimeString,
        scheduleSlots: config.schedule?.length || 0
      });

      const schedule = config.schedule || [];

      if (!Array.isArray(schedule) || schedule.length === 0) {
        logger.debug('No hay horarios configurados → OFF');
        return false;
      }

      // Verificar si algún slot está activo
      for (const slot of schedule) {
        if (this.isScheduleSlotActive(slot, currentDay, currentTimeString)) {
          logger.debug('Slot activo encontrado → ON', {
            slotId: slot.id,
            timeRange: `${slot.startTime}-${slot.endTime}`,
            days: slot.days?.map(d => this.dayNames[d]).join(', ')
          });
          return true;
        }
      }

      logger.debug('Ningún slot activo → OFF');
      return false;

    } catch (error) {
      logger.error('Error evaluando configuración schedule', {
        error: error.message,
        config
      });
      return null;
    }
  }

  /**
   * Verifica si un slot de horario específico está activo
   * @param {Object} slot - Slot de horario
   * @param {number} currentDay - Día actual (0=domingo, 6=sábado)
   * @param {string} currentTimeString - Hora actual en formato HH:MM
   * @returns {boolean} - true si el slot está activo
   */
  isScheduleSlotActive(slot, currentDay, currentTimeString) {
    try {
      // Verificar si el slot está habilitado (por defecto true si no se especifica)
      if (slot.enabled === false) {
        logger.debug('Slot deshabilitado', { slotId: slot.id });
        return false;
      }

      // Verificar día
      if (!Array.isArray(slot.days) || !slot.days.includes(currentDay)) {
        logger.debug('Día no coincide', {
          slotId: slot.id,
          configuredDays: slot.days?.map(d => this.dayNames[d]),
          currentDay: this.dayNames[currentDay]
        });
        return false;
      }

      // Verificar hora
      const startTime = slot.startTime;
      const endTime = slot.endTime;

      if (!startTime || !endTime) {
        logger.warn('Horarios inválidos', { 
          slotId: slot.id,
          startTime, 
          endTime 
        });
        return false;
      }

      // Verificar si está dentro del rango horario
      const isAfterStart = currentTimeString >= startTime;
      const isBeforeEnd = currentTimeString <= endTime;
      const isWithinTimeRange = isAfterStart && isBeforeEnd;

      logger.debug('Verificación horaria', {
        slotId: slot.id,
        currentTime: currentTimeString,
        startTime: startTime,
        endTime: endTime,
        isAfterStart: isAfterStart,
        isBeforeEnd: isBeforeEnd,
        isWithinRange: isWithinTimeRange
      });

      return isWithinTimeRange;

    } catch (error) {
      logger.error('Error evaluando slot de horario', {
        error: error.message,
        slot
      });
      return false;
    }
  }

  /**
   * Obtiene el tiempo actual en la zona horaria del usuario
   * @returns {Date} - Fecha actual en la zona horaria configurada
   */
  getCurrentTimeInUserTimezone() {
    try {
      const now = new Date();

      // Usar Intl.DateTimeFormat para convertir UTC a la zona horaria del usuario
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

      const year = parseInt(timeInUserTz.find(part => part.type === 'year').value);
      const month = parseInt(timeInUserTz.find(part => part.type === 'month').value) - 1;
      const day = parseInt(timeInUserTz.find(part => part.type === 'day').value);
      const hour = parseInt(timeInUserTz.find(part => part.type === 'hour').value);
      const minute = parseInt(timeInUserTz.find(part => part.type === 'minute').value);
      const second = parseInt(timeInUserTz.find(part => part.type === 'second').value);

      const userTime = new Date(year, month, day, hour, minute, second);

      logger.debug('Conversión de timezone realizada', {
        utcTime: now.toISOString(),
        userTimezone: this.userTimezone,
        userTime: userTime.toISOString(),
        offset: (userTime.getTime() - now.getTime()) / (1000 * 60) + ' minutos'
      });

      return userTime;

    } catch (error) {
      logger.error('Error obteniendo tiempo en timezone del usuario', {
        timezone: this.userTimezone,
        error: error.message
      });
      return new Date();
    }
  }

  /**
   * Valida una configuración de horarios
   * @param {Object} config - Configuración a validar
   * @returns {Object} - { valid: boolean, errors: string[] }
   */
  validateConfig(config) {
    const errors = [];

    if (!config || typeof config !== 'object') {
      errors.push('La configuración debe ser un objeto');
      return { valid: false, errors };
    }

    if (config.type !== 'schedule') {
      errors.push('El tipo debe ser "schedule"');
      return { valid: false, errors };
    }

    if (!Array.isArray(config.schedule)) {
      errors.push('El horario debe ser un array');
      return { valid: false, errors };
    }

    config.schedule.forEach((slot, index) => {
      const slotErrors = this.validateScheduleSlot(slot, index);
      errors.push(...slotErrors);
    });

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Valida un slot de horario individual
   * @param {Object} slot - Slot a validar
   * @param {number} index - Índice del slot
   * @returns {string[]} - Array de errores
   */
  validateScheduleSlot(slot, index) {
    const errors = [];

    if (!slot || typeof slot !== 'object') {
      errors.push(`El slot ${index + 1} debe ser un objeto`);
      return errors;
    }

    // Validar ID
    if (slot.id === undefined || typeof slot.id !== 'number') {
      errors.push(`El slot ${index + 1} debe tener un ID numérico`);
    }

    // Validar días
    if (!Array.isArray(slot.days)) {
      errors.push(`El slot ${index + 1} debe tener un array de días`);
    } else {
      if (slot.days.length === 0) {
        errors.push(`El slot ${index + 1} debe tener al menos un día seleccionado`);
      }

      slot.days.forEach(day => {
        if (typeof day !== 'number' || day < 0 || day > 6) {
          errors.push(`Los días en el slot ${index + 1} deben ser números entre 0 y 6`);
        }
      });
    }

    // Validar horarios
    const timeRegex = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;
    
    if (!slot.startTime || !timeRegex.test(slot.startTime)) {
      errors.push(`El slot ${index + 1} debe tener una hora de inicio válida (HH:MM)`);
    }

    if (!slot.endTime || !timeRegex.test(slot.endTime)) {
      errors.push(`El slot ${index + 1} debe tener una hora de fin válida (HH:MM)`);
    }

    // Validar que la hora de fin sea posterior a la de inicio
    if (slot.startTime && slot.endTime && slot.startTime >= slot.endTime) {
      errors.push(`En el slot ${index + 1}, la hora de fin debe ser posterior a la hora de inicio`);
    }

    // Validar enabled
    if (slot.enabled !== undefined && typeof slot.enabled !== 'boolean') {
      errors.push(`El campo 'enabled' del slot ${index + 1} debe ser un booleano`);
    }

    return errors;
  }

  /**
   * Obtiene información de debug sobre la evaluación actual
   * @param {Object} config - Configuración de automatización
   * @param {Date} currentTime - Tiempo actual (opcional)
   * @returns {Object} - Información de debug
   */
  getDebugInfo(config, currentTime = null) {
    const now = currentTime || this.getCurrentTimeInUserTimezone();
    const currentDay = now.getDay();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    const currentTimeString = `${currentHour.toString().padStart(2, '0')}:${currentMinute.toString().padStart(2, '0')}`;

    const debugInfo = {
      currentTime: {
        day: currentDay,
        dayName: this.dayNames[currentDay],
        time: currentTimeString,
        fullDate: now.toISOString()
      },
      config: {
        type: config?.type,
        scheduleSlots: config?.schedule?.length || 0
      },
      evaluation: null,
      activeSlots: [],
      inactiveSlots: []
    };

    if (config && config.type === 'schedule' && Array.isArray(config.schedule)) {
      for (const slot of config.schedule) {
        const isActive = this.isScheduleSlotActive(slot, currentDay, currentTimeString);
        
        const slotInfo = {
          id: slot.id,
          enabled: slot.enabled,
          days: slot.days?.map(d => this.dayNames[d]),
          timeRange: `${slot.startTime}-${slot.endTime}`,
          isActive
        };

        if (isActive) {
          debugInfo.activeSlots.push(slotInfo);
        } else {
          debugInfo.inactiveSlots.push(slotInfo);
        }
      }

      debugInfo.evaluation = this.evaluate(config, now);
    }

    return debugInfo;
  }
}

module.exports = ScheduleEvaluator;
