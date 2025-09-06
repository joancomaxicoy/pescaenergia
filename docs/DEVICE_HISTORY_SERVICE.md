# **Servicio de Historial de Dispositivos**

## **Descripción General**

El `DeviceHistoryService` es un servicio especializado para consultar y analizar datos históricos de dispositivos energéticos almacenados en la base de datos TimescaleDB. Proporciona funcionalidades optimizadas para obtener métricas recientes y evoluciones temporales de forma eficiente.

## **Características Principales**

- **Consultas optimizadas** con TimescaleDB y funciones `time_bucket()`
- **Cache inteligente** para metadatos de dispositivos frecuentemente consultados
- **Validaciones robustas** de parámetros y rangos de fechas
- **Agregaciones temporales** flexibles (minutos, horas, días, semanas)
- **Límites de seguridad** para prevenir consultas excesivamente grandes
- **Estadísticas detalladas** de rendimiento y uso
- **Manejo completo de errores** con logging estructurado

## **Métodos Principales**

### **1. getLatestMetrics(deviceId, metricNames?)**

Obtiene las métricas más recientes para un dispositivo específico.

**Parámetros:**
- `deviceId` (string): UUID del dispositivo
- `metricNames` (Array<string>, opcional): Lista de métricas específicas a obtener

**Respuesta:**
```javascript
{
  deviceId: "uuid-del-dispositivo",
  timestamp: "2025-01-09T18:30:00Z",
  metrics: {
    "power_consumption_avg": 1250.5,
    "voltage_avg": 230.2,
    "power_generation_avg": 850.0
  },
  totalMetrics: 3
}
```

**Ejemplo de uso:**
```javascript
const historyService = new DeviceHistoryService();

// Obtener todas las métricas más recientes
const allMetrics = await historyService.getLatestMetrics(deviceId);

// Obtener solo métricas específicas
const powerMetrics = await historyService.getLatestMetrics(
  deviceId, 
  ['power_consumption_avg', 'power_generation_avg']
);
```

### **2. getMetricEvolution(deviceId, metricName, startDate, endDate, aggregation?, limit?)**

Obtiene la evolución temporal de una métrica específica en un rango de fechas.

**Parámetros:**
- `deviceId` (string): UUID del dispositivo
- `metricName` (string): Nombre de la métrica a consultar
- `startDate` (Date|string): Fecha de inicio del rango
- `endDate` (Date|string): Fecha de fin del rango
- `aggregation` (string, opcional): Nivel de agregación temporal (por defecto: '1h')
- `limit` (number, opcional): Límite máximo de puntos de datos

**Agregaciones válidas:**
- `'1m'`, `'5m'`, `'15m'`, `'30m'` - Agregaciones por minutos
- `'1h'`, `'2h'`, `'6h'`, `'12h'` - Agregaciones por horas
- `'1d'`, `'1w'`, `'1M'` - Agregaciones por días, semanas, meses

**Respuesta:**
```javascript
{
  deviceId: "uuid-del-dispositivo",
  metricName: "power_consumption_avg",
  aggregation: "1h",
  period: {
    start: "2025-01-08T00:00:00Z",
    end: "2025-01-09T00:00:00Z"
  },
  data: [
    {
      timestamp: "2025-01-08T00:00:00Z",
      value: 1200.5,
      min: 1150.0,
      max: 1250.0,
      dataPoints: 60
    },
    // ... más puntos de datos
  ],
  totalPoints: 24,
  queryTime: 45
}
```

**Ejemplo de uso:**
```javascript
// Evolución de consumo en las últimas 24 horas con agregación horaria
const evolution = await historyService.getMetricEvolution(
  deviceId,
  'power_consumption_avg',
  new Date(Date.now() - 24 * 60 * 60 * 1000), // 24 horas atrás
  new Date(),
  '1h'
);

// Evolución semanal con agregación diaria
const weeklyEvolution = await historyService.getMetricEvolution(
  deviceId,
  'power_consumption_avg',
  new Date('2025-01-01'),
  new Date('2025-01-08'),
  '1d'
);
```

### **3. getDeviceMetrics(deviceId, startDate, endDate, metricNames?, aggregation?, limit?)**

Obtiene múltiples métricas para un dispositivo en un rango de tiempo específico.

**Parámetros:**
- `deviceId` (string): UUID del dispositivo
- `startDate` (Date|string): Fecha de inicio
- `endDate` (Date|string): Fecha de fin
- `metricNames` (Array<string>, opcional): Métricas específicas a obtener
- `aggregation` (string, opcional): Nivel de agregación (por defecto: '1h')
- `limit` (number, opcional): Límite de resultados (por defecto: 1000)

**Respuesta:**
```javascript
{
  deviceId: "uuid-del-dispositivo",
  aggregation: "1h",
  period: {
    start: "2025-01-08T00:00:00Z",
    end: "2025-01-09T00:00:00Z"
  },
  metrics: {
    "power_consumption_avg": [
      { timestamp: "2025-01-08T00:00:00Z", value: 1200.5, min: 1150.0, max: 1250.0, dataPoints: 60 },
      // ... más puntos
    ],
    "voltage_avg": [
      { timestamp: "2025-01-08T00:00:00Z", value: 230.2, min: 228.0, max: 232.0, dataPoints: 60 },
      // ... más puntos
    ]
  },
  totalMetrics: 2,
  totalDataPoints: 48,
  queryTime: 78
}
```

### **4. getDeviceInfo(deviceId)**

Obtiene información básica de un dispositivo (con cache).

**Respuesta:**
```javascript
{
  id: "uuid-del-dispositivo",
  device_name: "Contador Principal",
  device_type: "CONSUMO_GENERAL",
  shelly_device_id: "shellyem-abc123",
  created_at: "2025-01-01T00:00:00Z",
  user_cups: "ES0031446450479001ZC0F",
  user_name: "Usuario Ejemplo"
}
```

### **5. getAvailableMetrics(deviceId)**

Obtiene la lista de métricas disponibles para un dispositivo.

**Respuesta:**
```javascript
[
  "power_consumption_avg",
  "power_consumption_max",
  "power_generation_avg",
  "voltage_avg",
  "energy_total_sum"
]
```

## **Métodos Utilitarios**

### **getStats()**
Obtiene estadísticas detalladas del servicio:
```javascript
{
  totalQueries: 150,
  totalLatestMetricsQueries: 45,
  totalEvolutionQueries: 80,
  totalErrors: 2,
  averageQueryTime: 67,
  totalQueryTime: 10050,
  cacheHits: 120,
  cacheMisses: 30,
  cacheSize: 25,
  cacheHitRate: "80.00%",
  limits: {
    maxDataPoints: 10000,
    maxDaysRange: 365,
    defaultPageSize: 1000
  }
}
```

### **clearCache()**
Limpia el cache de metadatos de dispositivos.

### **resetStats()**
Resetea todas las estadísticas del servicio.

### **healthCheck()**
Verifica la conectividad con la base de datos.

## **Configuración y Límites**

El servicio incluye límites de seguridad configurables:

```javascript
this.limits = {
  maxDataPoints: 10000,    // Máximo número de puntos de datos por consulta
  maxDaysRange: 365,       // Máximo rango de días permitido
  defaultPageSize: 1000    // Tamaño de página por defecto
};
```

## **Manejo de Errores**

El servicio incluye validaciones completas:

- **Validación de UUID**: Verifica que el deviceId sea válido
- **Validación de fechas**: Comprueba rangos y formatos de fechas
- **Validación de agregaciones**: Solo permite agregaciones válidas
- **Validación de existencia**: Verifica que el dispositivo exista en la BD
- **Límites de consulta**: Previene consultas excesivamente grandes

## **Optimizaciones de Rendimiento**

### **Cache de Dispositivos**
- Cache en memoria para metadatos de dispositivos
- Reduce consultas repetidas a la tabla `devices`
- Estadísticas de hit/miss ratio

### **Consultas Optimizadas**
- Uso de `time_bucket()` de TimescaleDB para agregaciones eficientes
- Índices optimizados en `device_id`, `timestamp` y `metric_name`
- Consultas preparadas para mejor rendimiento

### **Agregaciones Inteligentes**
- Cálculo automático de `AVG`, `MIN`, `MAX` y `COUNT`
- Agregaciones temporales nativas de TimescaleDB
- Soporte para múltiples niveles de granularidad

## **Casos de Uso Típicos**

### **Dashboard en Tiempo Real**
```javascript
// Obtener métricas más recientes para mostrar en dashboard
const currentMetrics = await historyService.getLatestMetrics(deviceId);
```

### **Gráficos de Evolución**
```javascript
// Gráfico de consumo de las últimas 24 horas
const hourlyConsumption = await historyService.getMetricEvolution(
  deviceId,
  'power_consumption_avg',
  new Date(Date.now() - 24 * 60 * 60 * 1000),
  new Date(),
  '1h'
);
```

### **Análisis Comparativo**
```javascript
// Comparar múltiples métricas en el mismo período
const comparison = await historyService.getDeviceMetrics(
  deviceId,
  startDate,
  endDate,
  ['power_consumption_avg', 'power_generation_avg'],
  '1d'
);
```

### **Reportes Históricos**
```javascript
// Reporte mensual con agregación diaria
const monthlyReport = await historyService.getMetricEvolution(
  deviceId,
  'energy_total_sum',
  new Date('2025-01-01'),
  new Date('2025-02-01'),
  '1d'
);
```

## **Integración con la Arquitectura**

El servicio se integra perfectamente con:

- **Database Utility**: Usa el pool de conexiones existente
- **Logger Utility**: Logging estructurado y consistente
- **Estructura de Tablas**: Compatible con `devices` y `energy_metrics`
- **TimescaleDB**: Aprovecha las funciones nativas de series temporales

## **Pruebas**

Ejecutar las pruebas del servicio:

```bash
cd backend && node tests/device-history-test.js
```

Las pruebas incluyen:
- Health check del servicio
- Consultas de métricas recientes
- Evoluciones temporales
- Validaciones de parámetros
- Pruebas de rendimiento
- Manejo de errores

## **Consideraciones de Producción**

1. **Monitoreo**: Usar `getStats()` para monitorear rendimiento
2. **Cache**: Limpiar cache periódicamente si es necesario
3. **Límites**: Ajustar límites según recursos disponibles
4. **Índices**: Asegurar que los índices de TimescaleDB estén optimizados
5. **Logging**: Configurar nivel de logging apropiado para producción
