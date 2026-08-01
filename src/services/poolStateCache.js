const logger = require('../utils/logger');
const mqttServiceRegistry = require('./mqtt/mqttServiceRegistry');

class PoolStateCache {
    constructor() {
        this._state = {
            elements: {
                bombaDepuradora: { isOn: false, power: 0 },
                bombaNeteja: { isOn: false, power: 0 },
                cloradorSali: { isOn: false, power: 0 }
            },
            solarExcedent: 0,
            lastUpdate: null
        };
        this._initialized = false;
    }

    init() {
        if (this._initialized) return;
        const mqttDataService = mqttServiceRegistry.getMqttDataService();
        if (!mqttDataService || !mqttDataService.mqttService) {
            logger.warn('PoolStateCache: servei MQTT no disponible');
            return;
        }
        mqttDataService.mqttService.addMessageHandler((msg) => this._handle(msg));
        this._initialized = true;
        logger.info('PoolStateCache: handler MQTT registrat');
    }

    _handle(messageData) {
        try {
            const { topic, payload } = messageData;
            const m = topic.match(/^shellies\/(BombaDepuradora|BombaNet|CloradorSali)\/([^/]+)\/(.+)$/);
            if (!m) return;

            const elementMap = {
                BombaDepuradora: 'bombaDepuradora',
                BombaNet: 'bombaNeteja',
                CloradorSali: 'cloradorSali'
            };
            const elementKey = elementMap[m[1]];
            const subtopic = m[3];
            const el = this._state.elements[elementKey];
            if (!el) return;

            const num = parseFloat(payload);
            const isNum = !isNaN(num) && payload !== 'true' && payload !== 'false';

            if (subtopic === 'relay/0') {
                el.isOn = payload === 'on' || payload === 'true' || num === 1;
            } else if (subtopic === 'emeter/0/power' && isNum) {
                el.power = num;
            } else {
                return;
            }
            this._state.lastUpdate = new Date().toISOString();
        } catch (e) {
            logger.warn('PoolStateCache: error', { error: e.message });
        }
    }

    setElementState(elementKey, isOn) {
        const el = this._state.elements[elementKey];
        if (!el) return;
        el.isOn = isOn;
        this._state.lastUpdate = new Date().toISOString();
    }

    updateSolarExcedent(valueKw) {
        this._state.solarExcedent = valueKw;
    }

    getState() {
        const now = new Date();
        const fiveMinAgo = new Date(now.getTime() - 5 * 60 * 1000);
        const elements = {};
        for (const [key, el] of Object.entries(this._state.elements)) {
            elements[key] = {
                isOn: el.isOn,
                power: el.power,
                isOnline: this._state.lastUpdate
                    ? new Date(this._state.lastUpdate) > fiveMinAgo
                    : false
            };
        }
        const totalPower = Object.values(elements)
            .reduce((sum, el) => sum + (el.isOn ? el.power : 0), 0);
        return {
            elements,
            totalPower,
            solarExcedent: this._state.solarExcedent,
            lastUpdate: this._state.lastUpdate
        };
    }
}

module.exports = new PoolStateCache();
