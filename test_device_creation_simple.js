#!/usr/bin/env node

/**
 * Test script simplificado para verificar la creación automática de dispositivos
 * Este script testea solo la lógica de creación sin conectar a MQTT
 */

const logger = require('./src/utils/logger');
const NormalizerService = require('./src/services/mqtt/normalizerService');
const PersistenceService = require('./src/services/mqtt/persistenceService');
const DeviceStateService = require('./src/services/mqtt/deviceStateService');

