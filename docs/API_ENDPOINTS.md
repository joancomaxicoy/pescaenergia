# **API Endpoints - PescaEnergia Backend v2.0**

## **Descripción General**

La API de PescaEnergia proporciona endpoints RESTful para consultar métricas históricas de dispositivos energéticos. Todos los endpoints están documentados con OpenAPI/Swagger y son accesibles a través de la interfaz web de documentación.

## **Acceso a la Documentación**

- **Swagger UI**: `http://localhost:3000/api-docs`
- **JSON Schema**: `http://localhost:3000/api-docs.json`
- **Health Check**: `http://localhost:3000/health`

## **Endpoints Disponibles**

### **1. Métricas Más Recientes**

**GET** `/api/devices/{deviceId}/metrics/latest`

Obtiene las métricas más recientes de un dispositivo específico.

**Parámetros:**
- `deviceId` (path, requerido): UUID del dispositivo
- `metrics` (query, opcional): Lista de métricas específicas separadas por comas

**Ejemplo de uso:**
```bash
# Todas las métricas más recientes
curl "http://localhost:3000/api/devices/123e4567-e89b-12d3-a456-426614174000/metrics/latest"

# Métricas específicas
curl "http://localhost:3000/api/devices/123e4567-e89b-12d3-a456-426614174000/metrics/latest?metrics=power_consumption_avg,voltage_avg"
```

**Respuesta de ejemplo:**
```json
{
  "deviceId": "123e4567-e89b-12d3-a456-426614174000",
  "timestamp": "2025-01-09T18:30:00Z",
  "metrics": {
    "power_consumption_avg": 1250.5,
    "voltage_avg": 230.2,
    "power_generation_avg": 850.0
  },
  "totalMetrics": 3
}
```

### **2. Evolución Temporal de una Métrica**

**GET** `/api/devices/{deviceId}/metrics/{metricName}/evolution`

Obtiene la evolución temporal de una métrica específica en un rango de fechas.

**Parámetros:**
- `deviceId` (path, requerido): UUID del dispositivo
- `metricName` (path, requerido): Nombre de la métrica
- `startDate` (query, requerido): Fecha de inicio (ISO8601)
- `endDate` (query, requerido): Fecha de fin (ISO8601)
- `aggregation` (query, opcional): Nivel de agregación (por defecto: '1h')
- `limit` (query, opcional): Límite de puntos de datos

**Agregaciones válidas:**
- Minutos: `1m`, `5m`, `15m`, `30m`
- Horas: `1h`, `2h`, `6h`, `12h`
- Días/Semanas/Meses: `1d`, `1w`, `1M`

**Ejemplo de uso:**
```bash
# Evolución horaria de las últimas 24 horas
curl "http://localhost:3000/api/devices/123e4567-e89b-12d3-a456-426614174000/metrics/power_consumption_avg/evolution?startDate=2025-01-08T00:00:00Z&endDate=2025-01-09T00:00:00Z&aggregation=1h"
```

**Respuesta de ejemplo:**
```json
{
  "deviceId": "123e4567-e89b-12d3-a456-426614174000",
  "metricName": "power_consumption_avg",
  "aggregation": "1h",
  "period": {
    "start": "2025-01-08T00:00:00Z",
    "end": "2025-01-09T00:00:00Z"
  },
  "data": [
    {
      "timestamp": "2025-01-08T00:00:00Z",
      "value": 1200.5,
      "min": 1150.0,
      "max": 1250.0,
      "dataPoints": 60
    }
  ],
  "totalPoints": 24,
  "queryTime": 45
}
```

### **3. Múltiples Métricas en Rango de Tiempo**

**GET** `/api/devices/{deviceId}/metrics`

Obtiene múltiples métricas para un dispositivo en un período específico.

**Parámetros:**
- `deviceId` (path, requerido): UUID del dispositivo
- `startDate` (query, requerido): Fecha de inicio (ISO8601)
- `endDate` (query, requerido): Fecha de fin (ISO8601)
- `metrics` (query, opcional): Lista de métricas específicas separadas por comas
- `aggregation` (query, opcional): Nivel de agregación (por defecto: '1h')
- `limit` (query, opcional): Límite de resultados (por defecto: 1000)

**Ejemplo de uso:**
```bash
# Múltiples métricas con agregación diaria
curl "http://localhost:3000/api/devices/123e4567-e89b-12d3-a456-426614174000/metrics?startDate=2025-01-01T00:00:00Z&endDate=2025-01-08T00:00:00Z&aggregation=1d&metrics=power_consumption_avg,power_generation_avg"
```

### **4. Información del Dispositivo**

**GET** `/api/devices/{deviceId}/info`

Obtiene información básica y metadatos de un dispositivo.

**Parámetros:**
- `deviceId` (path, requerido): UUID del dispositivo

**Ejemplo de uso:**
```bash
curl "http://localhost:3000/api/devices/123e4567-e89b-12d3-a456-426614174000/info"
```

**Respuesta de ejemplo:**
```json
{
  "id": "123e4567-e89b-12d3-a456-426614174000",
  "device_name": "Contador Principal",
  "device_type": "CONSUMO_GENERAL",
  "shelly_device_id": "shellyem-abc123",
  "created_at": "2025-01-01T00:00:00Z",
  "user_cups": "ES0031446450479001ZC0F",
  "user_name": "Usuario Ejemplo"
}
```

### **5. Métricas Disponibles**

**GET** `/api/devices/{deviceId}/metrics/available`

Obtiene la lista de métricas disponibles para un dispositivo.

**Parámetros:**
- `deviceId` (path, requerido): UUID del dispositivo

**Ejemplo de uso:**
```bash
curl "http://localhost:3000/api/devices/123e4567-e89b-12d3-a456-426614174000/metrics/available"
```

**Respuesta de ejemplo:**
```json
{
  "deviceId": "123e4567-e89b-12d3-a456-426614174000",
  "availableMetrics": [
    "power_consumption_avg",
    "power_consumption_max",
    "voltage_avg",
    "energy_total_sum"
  ],
  "totalMetrics": 4
}
```

### **6. Estadísticas del Servicio**

**GET** `/api/devices/history/stats`

Obtiene estadísticas detalladas del servicio de historial.

**Ejemplo de uso:**
```bash
curl "http://localhost:3000/api/devices/history/stats"
```

**Respuesta de ejemplo:**
```json
{
  "totalQueries": 150,
  "totalLatestMetricsQueries": 45,
  "totalEvolutionQueries": 80,
  "totalErrors": 2,
  "averageQueryTime": 67,
  "totalQueryTime": 10050,
  "cacheHits": 120,
  "cacheMisses": 30,
  "cacheSize": 25,
  "cacheHitRate": "80.00%",
  "limits": {
    "maxDataPoints": 10000,
    "maxDaysRange": 365,
    "defaultPageSize": 1000
  }
}
```

### **7. Health Check del Servicio**

**GET** `/api/devices/history/health`

Verifica la salud del servicio de historial.

**Ejemplo de uso:**
```bash
curl "http://localhost:3000/api/devices/history/health"
```

**Respuesta de ejemplo:**
```json
{
  "status": "healthy",
  "timestamp": "2025-01-09T18:30:00Z",
  "service": "DeviceHistoryService"
}
```

### **8. Limpiar Cache**

**POST** `/api/devices/history/cache/clear`

Limpia el cache de metadatos de dispositivos.

**Ejemplo de uso:**
```bash
curl -X POST "http://localhost:3000/api/devices/history/cache/clear"
```

**Respuesta de ejemplo:**
```json
{
  "message": "Cache limpiado exitosamente",
  "timestamp": "2025-01-09T18:30:00Z",
  "previousCacheSize": 25
}
```

### **9. Resetear Estadísticas**

**POST** `/api/devices/history/stats/reset`

Resetea todas las estadísticas del servicio.

**Ejemplo de uso:**
```bash
curl -X POST "http://localhost:3000/api/devices/history/stats/reset"
```

**Respuesta de ejemplo:**
```json
{
  "message": "Estadísticas reseteadas exitosamente",
  "timestamp": "2025-01-09T18:30:00Z"
}
```

## **Códigos de Estado HTTP**

| Código | Descripción |
|--------|-------------|
| 200 | Éxito - Operación completada correctamente |
| 400 | Error de validación - Parámetros inválidos |
| 404 | No encontrado - Dispositivo no existe |
| 500 | Error interno del servidor |

## **Formato de Errores**

Todos los errores siguen un formato consistente:

```json
{
  "error": "Descripción del error",
  "details": "Detalles adicionales (solo en desarrollo)",
  "timestamp": "2025-01-09T18:30:00Z"
}
```

## **Validaciones**

### **UUID de Dispositivo**
- Debe ser un UUID válido (formato: `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`)
- El dispositivo debe existir en la base de datos

### **Fechas**
- Formato ISO8601 requerido (ejemplo: `2025-01-09T18:30:00Z`)
- La fecha de inicio debe ser anterior a la fecha de fin
- El rango máximo permitido es de 365 días

### **Agregaciones**
- Solo se permiten valores específicos: `1m`, `5m`, `15m`, `30m`, `1h`, `2h`, `6h`, `12h`, `1d`, `1w`, `1M`

### **Límites**
- Máximo 10,000 puntos de datos por consulta
- Límite por defecto de 1,000 resultados para consultas múltiples

## **Casos de Uso Típicos**

### **Dashboard en Tiempo Real**
```bash
# Obtener métricas actuales para mostrar en dashboard
curl "http://localhost:3000/api/devices/{deviceId}/metrics/latest"
```

### **Gráficos de Evolución**
```bash
# Gráfico de consumo de las últimas 24 horas
curl "http://localhost:3000/api/devices/{deviceId}/metrics/power_consumption_avg/evolution?startDate=2025-01-08T00:00:00Z&endDate=2025-01-09T00:00:00Z&aggregation=1h"
```

### **Análisis Comparativo**
```bash
# Comparar consumo vs generación en el mismo período
curl "http://localhost:3000/api/devices/{deviceId}/metrics?startDate=2025-01-01T00:00:00Z&endDate=2025-01-08T00:00:00Z&metrics=power_consumption_avg,power_generation_avg&aggregation=1d"
```

### **Reportes Históricos**
```bash
# Reporte mensual con agregación diaria
curl "http://localhost:3000/api/devices/{deviceId}/metrics/energy_total_sum/evolution?startDate=2025-01-01T00:00:00Z&endDate=2025-02-01T00:00:00Z&aggregation=1d"
```

## **Métricas Disponibles**

Las métricas disponibles dependen del tipo de dispositivo, pero típicamente incluyen:

### **Métricas de Consumo**
- `power_consumption_avg`: Potencia promedio consumida (W)
- `power_consumption_max`: Potencia máxima consumida (W)
- `power_consumption_min`: Potencia mínima consumida (W)

### **Métricas de Generación**
- `power_generation_avg`: Potencia promedio generada (W)
- `power_generation_max`: Potencia máxima generada (W)
- `power_generation_min`: Potencia mínima generada (W)

### **Métricas Eléctricas**
- `voltage_avg`: Voltaje promedio (V)
- `voltage_max`: Voltaje máximo (V)
- `voltage_min`: Voltaje mínimo (V)

### **Métricas de Energía**
- `energy_total_sum`: Energía total acumulada (Wh)
- `energy_consumption_sum`: Energía consumida acumulada (Wh)
- `energy_generation_sum`: Energía generada acumulada (Wh)

## **Rate Limiting**

La API implementa rate limiting para prevenir abuso:

- **Límite**: 1,000 requests por IP cada 15 minutos
- **Headers de respuesta**:
  - `X-RateLimit-Limit`: Límite total
  - `X-RateLimit-Remaining`: Requests restantes
  - `X-RateLimit-Reset`: Timestamp de reset

## **Seguridad**

### **Headers de Seguridad**
La API incluye headers de seguridad estándar:
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `X-XSS-Protection: 1; mode=block`

### **CORS**
- Configurado para permitir requests desde el frontend
- Credenciales habilitadas para autenticación futura

## **Monitoreo y Observabilidad**

### **Logging**
- Todos los requests se registran con información detallada
- Errores se logean con stack traces (solo en desarrollo)
- Métricas de rendimiento incluidas en logs

### **Health Checks**
- Endpoint general: `/health`
- Health check específico del servicio: `/api/devices/history/health`

### **Métricas de Rendimiento**
- Tiempo de respuesta promedio
- Cache hit rate
- Número de consultas por tipo
- Estadísticas de errores

## **Desarrollo y Testing**

### **Ejecutar el Servidor**
```bash
# Desarrollo
npm run dev

# Producción
npm start
```

### **Testing de Endpoints**
```bash
# Health check general
curl http://localhost:3000/health

# Health check del servicio
curl http://localhost:3000/api/devices/history/health

# Estadísticas del servicio
curl http://localhost:3000/api/devices/history/stats
```

### **Variables de Entorno**
```bash
PORT=3000                    # Puerto del servidor
NODE_ENV=development         # Entorno de ejecución
FRONTEND_URL=http://localhost:3001  # URL del frontend para CORS
API_BASE_URL=http://localhost:3000  # URL base para Swagger
```

## **Próximas Funcionalidades**

### **Autenticación**
- JWT tokens para autenticación de usuarios
- Autorización basada en roles
- Rate limiting por usuario autenticado

### **Filtros Avanzados**
- Filtros por tipo de dispositivo
- Filtros por ubicación geográfica
- Filtros por rango de valores

### **Exportación de Datos**
- Exportación a CSV
- Exportación a Excel
- Reportes PDF automatizados

### **Alertas y Notificaciones**
- Configuración de alertas por umbrales
- Notificaciones en tiempo real
- Integración con sistemas externos

## **Soporte**

Para soporte técnico o reportar problemas:
- **Documentación**: Consultar `/api-docs` para detalles específicos
- **Logs**: Revisar logs del servidor para debugging
- **Health Checks**: Usar endpoints de health para diagnóstico
