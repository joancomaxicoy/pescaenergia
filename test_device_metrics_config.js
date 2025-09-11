/**
 * Test script para verificar la configuración de métricas de dispositivos
 */

const {
  getDeviceTypeFromTopic,
  getPowerMetrics,
  getVoltageMetrics,
  getFrequencyMetrics,
  getMetricsByType,
  getMetricUnit,
  getDeviceMetricsInfo
} = require('./src/config/device-metrics-config');

console.log('=== TEST: Configuración de Métricas de Dispositivos ===\n');

// Test 1: Verificar detección de tipos de dispositivo
console.log('1. Detección de tipos de dispositivo:');
console.log('   shellies/shellyem/ES123/emeter/0/power ->', getDeviceTypeFromTopic('shellies/shellyem/ES123/emeter/0/power'));
console.log('   acs/ES456/status/switch:0 ->', getDeviceTypeFromTopic('acs/ES456/status/switch:0'));
console.log('   pepe/ES789/status/switch:0 ->', getDeviceTypeFromTopic('pepe/ES789/status/switch:0'));

// Test 2: Verificar métricas de potencia
console.log('\n2. Métricas de Potencia:');
console.log('   SHELLY_EM:', getPowerMetrics('SHELLY_EM'));
console.log('   PLUG:', getPowerMetrics('PLUG'));
console.log('   GENERATOR:', getPowerMetrics('GENERATOR'));

// Test 3: Verificar métricas de tensión
console.log('\n3. Métricas de Tensión:');
console.log('   SHELLY_EM:', getVoltageMetrics('SHELLY_EM'));
console.log('   PLUG:', getVoltageMetrics('PLUG'));
console.log('   GENERATOR:', getVoltageMetrics('GENERATOR'));

// Test 4: Verificar métricas de frecuencia
console.log('\n4. Métricas de Frecuencia:');
