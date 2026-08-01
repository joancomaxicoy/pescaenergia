const database = require('../utils/database');
const logger = require('../utils/logger');
const { getTodayLocal } = require('../utils/dateUtils');
const PoolService = require('./poolService');
const PowerDifferenceService = require('./powerDifferenceService');

class PoolAutomationService {
  constructor() {
    this.interval = null;
    this.poolService = new PoolService();
    this.powerDifferenceService = new PowerDifferenceService();
  }

  start() {
    logger.info('Iniciant PoolAutomationService (cada 30s)');
    this.process();
    this.interval = setInterval(() => this.process(), 30000);
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  async process() {
    try {
      const devicesQuery = `
        SELECT id, shelly_device_id, device_name, user_id
        FROM devices
        WHERE (device_type = 'POOL' OR shelly_device_id LIKE 'DepuradoraPiscina/%')
        AND user_id IS NOT NULL
      `;
      const devices = await database.query(devicesQuery);

      for (const device of devices.rows) {
        await this.processDevice(device).catch(err => {
          logger.error('Error processant dispositiu de piscina', {
            deviceId: device.shelly_device_id,
            error: err.message
          });
        });
      }
    } catch (error) {
      logger.error('PoolAutomationService.process error:', { error: error.message });
    }
  }

  async processDevice(device, options = {}) {
    const config = await this.poolService.getPoolAutomation(device.shelly_device_id);
    if (!config || config.mode === 'manual') return;

    const status = await this.poolService.getPoolStatus(device.shelly_device_id);
    const elements = status.elements;

    const hours = await this.poolService.getPoolHours(device.shelly_device_id);
    const today = getTodayLocal();
    const hoursToday = hours.date === today ? hours : {
      date: today,
      bombaDepuradora: 0,
      bombaNeteja: 0,
      cloradorSali: 0
    };

    const powerData = await this.powerDifferenceService.getPowerDifference([device.user_id]);
    const userPower = powerData[device.user_id];
    const excedentKW = options.simulatedExcedentKW ?? (userPower ? userPower.difference : 0);
    const isSimulated = options.simulatedExcedentKW !== undefined;

    const poolStateCache = require('./poolStateCache');
    poolStateCache.updateSolarExcedent(excedentKW);

    let newStates;
    if (config.mode === 'schedule') {
      newStates = this.evaluateSchedule(config.schedule);
    } else if (config.mode === 'automatic') {
      newStates = this.evaluateAutomatic(elements, hoursToday, config.automatic, excedentKW);
    } else {
      return;
    }

    if (isSimulated) {
      logger.info('PoolAutomation: test amb excedent simulat', {
        device: device.shelly_device_id,
        simulatedExcedentKW: options.simulatedExcedentKW,
        newStates
      });
    }

    await this.executeActions(device, elements, newStates);
  }

  evaluateSchedule(schedule) {
    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    function timeToMinutes(t) {
      const [h, m] = t.split(':').map(Number);
      return h * 60 + m;
    }

    const bombaOn = currentMinutes >= timeToMinutes(schedule.bombaDepuradora.start) &&
      currentMinutes <= timeToMinutes(schedule.bombaDepuradora.end);

    let netejaOn = false;
    let cloradorOn = false;

    if (bombaOn) {
      netejaOn = currentMinutes >= timeToMinutes(schedule.bombaNeteja.start) &&
        currentMinutes <= timeToMinutes(schedule.bombaNeteja.end);
      cloradorOn = currentMinutes >= timeToMinutes(schedule.cloradorSali.start) &&
        currentMinutes <= timeToMinutes(schedule.cloradorSali.end);
    }

    return {
      bombaDepuradora: bombaOn,
      bombaNeteja: netejaOn,
      cloradorSali: cloradorOn
    };
  }

  evaluateAutomatic(elements, hoursToday, automatic, excedentKW) {
    function shouldBeOn(el, onThreshold, offThreshold, maxHours, currentHoursToday) {
      if (currentHoursToday >= maxHours * 60) return false;
      if (el.isOn) {
        return excedentKW >= offThreshold;
      } else {
        return excedentKW >= onThreshold;
      }
    }

    const bombaOn = shouldBeOn(
      elements.bombaDepuradora,
      automatic.thresholds.bombaDepuradora,
      automatic.offThresholds.bombaDepuradora,
      automatic.maxHours.bombaDepuradora,
      hoursToday.bombaDepuradora
    );

    let netejaOn = false;
    let cloradorOn = false;

    if (bombaOn) {
      netejaOn = shouldBeOn(
        elements.bombaNeteja,
        automatic.thresholds.bombaNeteja,
        automatic.offThresholds.bombaNeteja,
        automatic.maxHours.bombaNeteja,
        hoursToday.bombaNeteja
      );
      cloradorOn = shouldBeOn(
        elements.cloradorSali,
        automatic.thresholds.cloradorSali,
        automatic.offThresholds.cloradorSali,
        automatic.maxHours.cloradorSali,
        hoursToday.cloradorSali
      );
    }

    return {
      bombaDepuradora: bombaOn,
      bombaNeteja: netejaOn,
      cloradorSali: cloradorOn
    };
  }

  async executeActions(device, currentElements, newStates) {
    for (const [key, shouldBeOn] of Object.entries(newStates)) {
      const current = currentElements[key];
      if (current.isOn !== shouldBeOn) {
        const action = shouldBeOn ? 'on' : 'off';
        logger.info('PoolAutomation: canviant estat', {
          device: device.shelly_device_id,
          element: key,
          action,
          wasOn: current.isOn
        });
        try {
          await this.poolService.controlElement(device.shelly_device_id, key, action);
        } catch (err) {
          logger.error('PoolAutomation: error enviant comanda', {
            device: device.shelly_device_id,
            element: key,
            action,
            error: err.message
          });
        }
      }
    }
  }
}

module.exports = PoolAutomationService;
