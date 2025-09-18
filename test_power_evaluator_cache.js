const PowerEvaluator = require('./src/services/automation/PowerEvaluator');

// Mock del PowerDifferenceService para testing
const mockPowerDifferenceService = {
  getPowerDifference: async (userIds) => {
    console.log(`[SERVICE] Llamando al servicio real para userIds: ${userIds.join(',')}`);
    // Simular datos de respuesta
    const result = {};
    userIds.forEach(userId => {
      result[userId] = {
      result[userId] = {
        difference: Math.random() * 10, // Valor aleatorio para simular
        timestamp: new Date().toISOString()
      };
    });
    return result;
  }
};

// Mock del MemoryCache
const mockMemoryCache = {};

// Reemplazar el servicio real con el mock
const originalRequire = require;
require = function(id) {
  if (id === '../powerDifferenceService') {
    return function() {
      return mockPowerDifferenceService;
    };
  }
  return originalRequire(id);
};

// Crear instancia del evaluador
const evaluator = new PowerEvaluator(mockMemoryCache);

// Función de prueba
async function testCache() {
  console.log('🧪 Probando cache de PowerEvaluator...\n');

  // Configuraciones de prueba
  const configs = [
    {
      userId: 'user1',
      deviceId: 'device1',
      deviceName: 'Device 1',
      config: { power: 5 }
    },
    {
      userId: 'user2',
      deviceId: 'device2',
      deviceName: 'Device 2',
      config: { power: 3 }
    }
  ];

  console.log('📝 Primera llamada (debería ir al servicio real):');
  const start1 = Date.now();
  const result1 = await evaluator.evaluateMultiple(configs);
  const end1 = Date.now();
  console.log(`⏱️  Tiempo: ${end1 - start1}ms`);
  console.log('📊 Resultados:', result1.map(r => ({
    device: r.deviceName,
    evaluation: r.evaluation
  })));
  console.log();

  console.log('📝 Segunda llamada inmediata (debería usar cache):');
  const start2 = Date.now();
  const result2 = await evaluator.evaluateMultiple(configs);
  const end2 = Date.now();
  console.log(`⏱️  Tiempo: ${end2 - start2}ms`);
  console.log('📊 Resultados:', result2.map(r => ({
    device: r.deviceName,
    evaluation: r.evaluation
  })));
  console.log();

  // Verificar que los resultados son idénticos (cache funcionando)
  const resultsEqual = JSON.stringify(result1) === JSON.stringify(result2);
  console.log(`✅ Resultados idénticos: ${resultsEqual}`);
  console.log(`✅ Cache funcionando: ${end2 - start2 < end1 - start1 ? 'SÍ' : 'NO'}`);

  // Verificar estado del cache
  const cacheKey = evaluator.generateCacheKey(['user1', 'user2']);
  const isValid = evaluator.isCacheValid(cacheKey);
  console.log(`📋 Cache válido para clave "${cacheKey}": ${isValid}`);

  console.log('\n🎉 Prueba completada!');
}

// Ejecutar prueba
testCache().catch(console.error);
