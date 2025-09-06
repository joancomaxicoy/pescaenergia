# CompactorService - Documentación del Sistema de Agregación

## Descripción General

El `CompactorService` es el corazón del sistema de ingesta y persistencia de datos MQTT. Su responsabilidad principal es procesar los datos acumulados en el buffer, calcular agregados estadísticos y persistirlos de forma eficiente en la base de datos TimescaleDB.

## Arquitectura del Sistema

```
mqttService → normalizerService → bufferService → compactorService → persistenceService
                                                        ↓
                                                  PostgreSQL + TimescaleDB
```

### Principio de Funcionamiento

El CompactorService implementa una estrategia de **compactación en memoria** que:

1. **No guarda eventos MQTT en bruto** en la base de datos
2. **Acumula datos en memoria** durante intervalos regulares (60 segundos por defecto)
3. **Calcula agregados estadísticos** (avg, min, max, sum, count)
4. **Persiste únicamente los resúmenes** en la hypertable `energy_metrics`

## Configuración y Parámetros

### Intervalo de Compactación

```javascript
// Por defecto: 60 segundos (60000 ms)
compactorService.setCompactionInterval(60000);

// Para testing: 10 segundos
compactorService.setCompactionInterval(10000);

// Mínimo permitido: 1 segundo
compactorService.setCompactionInterval(1000);
```

### Tipos de Agregación

```javascript
// Configuración por defecto
const defaultAggregationTypes = ['avg', 'min', 'max', 'sum', 'count'];

// Configuración personalizada
compactorService.setAggregationTypes(['avg', 'max', 'sum']);
```

| Tipo | Descripción | Uso Típico |
|------|-------------|------------|
| `avg` | Promedio de valores | Potencia media, voltaje promedio |
| `min` | Valor mínimo | Mínima potencia registrada |
| `max` | Valor máximo | Pico de consumo |
| `sum` | Suma total | Energía total consumida |
| `count` | Número de lecturas | Frecuencia de datos |

## Flujo de Procesamiento Detallado

### 1. Ciclo de Compactación (cada 60 segundos)

```javascript
async runCompactionCycle() {
  // 1. Tomar snapshot del buffer y vaciarlo
  const bufferSnapshot = this.bufferService.takeSnapshot();
  
  // 2. Resolver device IDs a UUIDs de BD
  const deviceIdMap = await this.persistenceService.resolveMultipleDeviceIds(deviceIds);
  
  // 3. Procesar cada dispositivo
  for (const [deviceId, metrics] of bufferSnapshot) {
    const deviceAggregates = this.aggregateDeviceMetrics(deviceUuid, metrics, timestamp);
    aggregatedMetrics.push(...deviceAggregates);
  }
  
  // 4. Inserción masiva en BD
  await this.persistenceService.bulkInsert(aggregatedMetrics);
}
```

### 2. Agregación por Dispositivo

Para cada dispositivo, el proceso es:

1. **Agrupar métricas por nombre** (ej: todas las lecturas de `emeter_0_power`)
2. **Validar valores numéricos** (omitir strings, nulls, NaN)
3. **Calcular estadísticas** para cada grupo
4. **Generar métricas agregadas** con nombres normalizados

### 3. Ejemplo de Transformación

**Datos de entrada (buffer de 1 minuto):**
```javascript
// Dispositivo: ES0031446450479001ZC0F
// Métricas recibidas:
[
  { metricName: 'emeter_0_power', value: 89.5, timestamp: '15:30:10' },
  { metricName: 'emeter_0_power', value: 91.2, timestamp: '15:30:20' },
  { metricName: 'emeter_0_power', value: 88.8, timestamp: '15:30:30' },
  { metricName: 'emeter_0_power', value: 90.1, timestamp: '15:30:40' },
  { metricName: 'emeter_0_power', value: 89.9, timestamp: '15:30:50' }
]
```

**Datos de salida (agregados):**
```javascript
[
  {
    timestamp: '2025-01-09T15:30:00.000Z',  // Redondeado al minuto
    device_id: 'uuid-del-dispositivo',
    metric_name: 'emeter_0_power_avg',
    value: 89.9                             // (89.5+91.2+88.8+90.1+89.9)/5
  },
  {
    timestamp: '2025-01-09T15:30:00.000Z',
    device_id: 'uuid-del-dispositivo', 
    metric_name: 'emeter_0_power_min',
    value: 88.8
  },
  {
    timestamp: '2025-01-09T15:30:00.000Z',
    device_id: 'uuid-del-dispositivo',
    metric_name: 'emeter_0_power_max', 
    value: 91.2
  },
  {
    timestamp: '2025-01-09T15:30:00.000Z',
    device_id: 'uuid-del-dispositivo',
    metric_name: 'emeter_0_power_sum',
    value: 449.5                            // Suma total
  },
  {
    timestamp: '2025-01-09T15:30:00.000Z',
    device_id: 'uuid-del-dispositivo',
    metric_name: 'emeter_0_power_count',
    value: 5                                // Número de lecturas
  }
]
```

## Resolución de Device IDs

### Cache de Dispositivos

El CompactorService utiliza el `PersistenceService` para resolver `shelly_device_id` → `UUID`:

```javascript
// Resolución en lote (optimizada)
const deviceIdMap = await persistenceService.resolveMultipleDeviceIds([
  'ES0031446450479001ZC0F',
  'giravolt',
  'ES0031446450479001ZC0G'
]);

// Resultado:
// Map {
//   'ES0031446450479001ZC0F' => 'uuid-1',
//   'giravolt' => 'uuid-2', 
//   'ES0031446450479001ZC0G' => null  // No encontrado
// }
```

### Manejo de Dispositivos No Registrados

- **Dispositivos no encontrados**: Se logean como warning y se omiten sus métricas
- **Cache negativo**: Los IDs no encontrados se cachean para evitar consultas repetidas
- **Inserción automática**: Los dispositivos nuevos deben registrarse manualmente en la tabla `devices`

## Optimizaciones de Rendimiento

### 1. Agregación en Memoria

- **Sin acceso a BD durante agregación**: Todo el procesamiento se hace en RAM
- **Agrupación eficiente**: Uso de `Map` para agrupar métricas por nombre
- **Validación temprana**: Filtrado de valores no numéricos antes de agregar

### 2. Inserción Masiva

```sql
-- Ejemplo de inserción masiva generada
INSERT INTO energy_metrics (timestamp, device_id, metric_name, value)
VALUES 
  ('2025-01-09T15:30:00.000Z', 'uuid-1', 'emeter_0_power_avg', 89.9),
  ('2025-01-09T15:30:00.000Z', 'uuid-1', 'emeter_0_power_min', 88.8),
  ('2025-01-09T15:30:00.000Z', 'uuid-1', 'emeter_0_power_max', 91.2),
  -- ... hasta 1000+ filas en una sola transacción
```

### 3. Redondeo de Timestamps

```javascript
// Redondear al minuto para consistencia
const timestamp = new Date(Math.floor(cycleStartTime / 60000) * 60000);
// 15:30:45 → 15:30:00
// 15:31:12 → 15:31:00
```

## Estadísticas y Monitoreo

### Métricas del Compactador

```javascript
{
  cyclesCompleted: 1440,              // Ciclos completados (1 día = 1440 minutos)
  totalDevicesProcessed: 25,          // Dispositivos únicos procesados
  totalMetricsAggregated: 15000,      // Métricas originales procesadas
  totalMetricsInserted: 75000,        // Métricas agregadas insertadas (15000 * 5 tipos)
  lastCycleTime: 1250,                // Tiempo del último ciclo (ms)
  averageCycleTime: 980,              // Tiempo promedio por ciclo
  compressionRatio: "1:5.00",         // Ratio de compresión (1 original → 5 agregadas)
  metricsPerCycle: 10,                // Métricas promedio por ciclo
  errors: 0,                          // Errores totales
  isRunning: true                     // Estado del servicio
}
```

### Health Check

```javascript
const health = await compactorService.healthCheck();
// {
//   status: 'healthy',           // 'healthy', 'degraded', 'unhealthy', 'stopped'
//   isRunning: true,
//   lastCycleTime: 1250,
//   errors: 0,
//   bufferHealth: {...},
//   persistenceHealth: true
// }
```

## Manejo de Errores

### Tipos de Errores

1. **Errores de BD**: Fallos en inserción masiva
2. **Dispositivos no encontrados**: IDs no registrados en tabla `devices`
3. **Datos corruptos**: Valores no numéricos o malformados
4. **Errores de memoria**: Buffer demasiado grande (poco probable)

### Estrategias de Recuperación

```javascript
// Error en inserción → Rollback automático
try {
  await client.query('BEGIN');
  await client.query(insertQuery, values);
  await client.query('COMMIT');
} catch (error) {
  await client.query('ROLLBACK');
  this.stats.errors++;
  // El ciclo continúa, los datos se pierden pero el servicio sigue funcionando
}
```

### Logging de Errores

- **Error level**: Errores críticos que impiden la persistencia
- **Warn level**: Dispositivos no encontrados, datos omitidos
- **Debug level**: Valores no numéricos, métricas individuales procesadas

## Configuración Avanzada

### Cambio de Intervalo en Tiempo Real

```javascript
// Cambiar de 60s a 30s
compactorService.setCompactionInterval(30000);
// El servicio se reinicia automáticamente con el nuevo intervalo
```

### Agregación Personalizada

```javascript
// Solo promedios y máximos (reduce carga de BD)
compactorService.setAggregationTypes(['avg', 'max']);

// Todas las estadísticas disponibles
compactorService.setAggregationTypes(['avg', 'min', 'max', 'sum', 'count']);
```

### Ejecución Manual

```javascript
// Forzar un ciclo de compactación inmediato
await compactorService.runManualCycle();

// Útil para:
// - Testing
// - Procesamiento de datos acumulados antes de mantenimiento
// - Debugging
```

## Integración con TimescaleDB

### Estructura de la Hypertable

```sql
-- La tabla energy_metrics es una hypertable particionada por timestamp
CREATE TABLE energy_metrics (
    timestamp TIMESTAMPTZ NOT NULL,
    device_id UUID NOT NULL REFERENCES devices(id),
    metric_name TEXT NOT NULL,
    value DOUBLE PRECISION NOT NULL
);

SELECT create_hypertable('energy_metrics', 'timestamp');
```

### Consultas Optimizadas

```sql
-- Consumo promedio por dispositivo en la última hora
SELECT 
  d.device_name,
  AVG(em.value) as avg_power
FROM energy_metrics em
JOIN devices d ON em.device_id = d.id
WHERE em.timestamp >= NOW() - INTERVAL '1 hour'
  AND em.metric_name = 'emeter_0_power_avg'
GROUP BY d.device_name;

-- Picos de consumo diarios
SELECT 
  DATE_TRUNC('day', timestamp) as day,
  MAX(value) as peak_power
FROM energy_metrics 
WHERE metric_name = 'emeter_0_power_max'
  AND timestamp >= NOW() - INTERVAL '30 days'
GROUP BY day
ORDER BY day;
```

## Casos de Uso y Ejemplos

### 1. Monitoreo de Consumo Residencial

```javascript
// Datos de entrada: Lecturas cada 10 segundos
// Datos de salida: Agregados cada minuto
// Reducción: 6:1 en frecuencia, 1:5 en número de métricas
```

### 2. Generación Solar

```javascript
// Entrada: potenciaFotovoltaica cada 30 segundos
// Salida: Promedios, máximos y totales por minuto
// Permite calcular: Producción total, picos de generación, eficiencia
```

### 3. Control de ACS (Agua Caliente Sanitaria)

```javascript
// Entrada: Estados on/off del relé
// Salida: Tiempo total encendido (sum), número de activaciones (count)
// Permite calcular: Ciclos de trabajo, eficiencia energética
```

## Consideraciones de Escalabilidad

### Volumen de Datos

- **Entrada**: ~100 dispositivos × 5 métricas × 6 lecturas/min = 3000 métricas/min
- **Salida**: 3000 métricas × 5 agregados = 15000 inserciones/min
- **BD**: ~21M registros/día (manejable con TimescaleDB)

### Memoria RAM

- **Buffer típico**: 3000 métricas × 60 segundos = ~180KB en memoria
- **Picos**: Hasta 1MB en casos extremos (manejable)
- **Limpieza**: Buffer se vacía cada minuto automáticamente

### Rendimiento de BD

- **Inserción masiva**: 15000 registros en ~100-500ms
- **Índices optimizados**: Consultas rápidas por dispositivo y timestamp
- **Particionado automático**: TimescaleDB maneja la distribución de datos

Este CompactorService proporciona una base sólida y escalable para el procesamiento eficiente de datos energéticos en tiempo real, manteniendo un equilibrio óptimo entre precisión de datos y rendimiento del sistema.
