# **PescaEnergia Backend API v2.0**

## **Descripción**

Backend completo para la plataforma de gestión energética PescaEnergia, que incluye:

- **Ingesta de datos MQTT** en tiempo real desde dispositivos Shelly
- **API RESTful** para consultar métricas históricas
- **Documentación Swagger** completa
- **Base de datos TimescaleDB** optimizada para series temporales
- **Sistema de compactación** para eficiencia de almacenamiento

## **Arquitectura**

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Dispositivos  │    │   MQTT Broker   │    │   Backend API   │
│     Shelly      │───▶│   (Mosquitto)   │───▶│   (Node.js)     │
└─────────────────┘    └─────────────────┘    └─────────────────┘
                                                        │
                                                        ▼
                                              ┌─────────────────┐
                                              │   PostgreSQL    │
                                              │  + TimescaleDB  │
                                              └─────────────────┘
```

## **Inicio Rápido**

### **1. Instalación**

```bash
# Clonar el repositorio
git clone <repository-url>
cd pescaenergia-backend

# Instalar dependencias
npm install

# Configurar variables de entorno
cp .env.example .env
# Editar .env con tus configuraciones
```

### **2. Base de Datos**

```bash
# Ejecutar migraciones
npm run migrate:up

# Verificar estado de la base de datos
npm run migrate:status
```

### **3. Ejecutar el Servidor**

```bash
# Desarrollo (con auto-reload)
npm run dev

# Producción
npm start
```

### **4. Verificar Funcionamiento**

```bash
# Health check
curl http://localhost:3000/health

# Documentación Swagger
open http://localhost:3000/api-docs
```

## **Endpoints Principales**

### **📊 Métricas de Dispositivos**

| Endpoint | Método | Descripción |
|----------|--------|-------------|
| `/api/devices/{id}/metrics/latest` | GET | Métricas más recientes |
| `/api/devices/{id}/metrics/{metric}/evolution` | GET | Evolución temporal |
| `/api/devices/{id}/metrics` | GET | Múltiples métricas |
| `/api/devices/{id}/metrics/available` | GET | Métricas disponibles |
| `/api/devices/{id}/info` | GET | Información del dispositivo |

### **🔧 Gestión del Servicio**

| Endpoint | Método | Descripción |
|----------|--------|-------------|
| `/api/devices/history/stats` | GET | Estadísticas del servicio |
| `/api/devices/history/health` | GET | Health check |
| `/api/devices/history/cache/clear` | POST | Limpiar cache |
| `/api/devices/history/stats/reset` | POST | Resetear estadísticas |

### **📚 Documentación**

| Endpoint | Descripción |
|----------|-------------|
| `/api-docs` | Interfaz Swagger UI |
| `/api-docs.json` | Especificación OpenAPI |
| `/health` | Health check general |

## **Ejemplos de Uso**

### **Obtener Métricas Más Recientes**

```bash
curl "http://localhost:3000/api/devices/123e4567-e89b-12d3-a456-426614174000/metrics/latest"
```

**Respuesta:**
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

### **Evolución de Consumo (24 horas)**

```bash
curl "http://localhost:3000/api/devices/123e4567-e89b-12d3-a456-426614174000/metrics/power_consumption_avg/evolution?startDate=2025-01-08T00:00:00Z&endDate=2025-01-09T00:00:00Z&aggregation=1h"
```

### **Comparar Consumo vs Generación**

```bash
curl "http://localhost:3000/api/devices/123e4567-e89b-12d3-a456-426614174000/metrics?startDate=2025-01-01T00:00:00Z&endDate=2025-01-08T00:00:00Z&metrics=power_consumption_avg,power_generation_avg&aggregation=1d"
```

## **Características Técnicas**

### **🚀 Rendimiento**

- **Cache inteligente** para metadatos de dispositivos
- **Agregaciones temporales** nativas de TimescaleDB
- **Consultas optimizadas** con índices específicos
- **Rate limiting** para prevenir abuso (1000 req/15min)

### **🔒 Seguridad**

- **Headers de seguridad** estándar (Helmet.js)
- **Validación robusta** de parámetros
- **CORS configurado** para frontend
- **Logging detallado** de todas las operaciones

### **📈 Monitoreo**

- **Métricas de rendimiento** en tiempo real
- **Health checks** automáticos
- **Estadísticas de cache** y consultas
- **Logging estructurado** con Winston

### **⚡ Escalabilidad**

- **Compactación automática** de datos MQTT
- **Límites configurables** para consultas
- **Agregaciones eficientes** por tiempo
- **Particionado automático** con TimescaleDB

## **Configuración**

### **Variables de Entorno**

```bash
# Servidor
PORT=3000
NODE_ENV=development

# Base de Datos
DATABASE_URL=postgresql://user:pass@host:5432/db

# MQTT
MQTT_BROKER_URL=mqtt://localhost:1883
MQTT_USERNAME=username
MQTT_PASSWORD=password

# API
FRONTEND_URL=http://localhost:3001
API_BASE_URL=http://localhost:3000
```

### **Límites del Servicio**

```javascript
{
  maxDataPoints: 10000,    // Máximo puntos por consulta
  maxDaysRange: 365,       // Máximo rango de días
  defaultPageSize: 1000    // Tamaño de página por defecto
}
```

## **Desarrollo**

### **Scripts Disponibles**

```bash
npm run dev          # Servidor de desarrollo
npm start            # Servidor de producción
npm test             # Ejecutar tests
npm run test:watch   # Tests en modo watch
npm run migrate:up   # Ejecutar migraciones
npm run migrate:down # Revertir migraciones
```

### **Testing**

```bash
# Tests unitarios
npm test

# Tests de endpoints
npm test tests/api-endpoints-test.js

# Tests del servicio de historial
npm test tests/device-history-test.js
```

### **Estructura del Proyecto**

```
src/
├── app.js                 # Configuración Express + Swagger
├── index.js              # Punto de entrada principal
├── routes/
│   └── deviceHistory.js  # Rutas de la API
├── services/
│   ├── deviceHistoryService.js  # Lógica de consultas
│   └── mqtt/             # Servicios MQTT
├── utils/
│   ├── database.js       # Conexión a BD
│   └── logger.js         # Sistema de logging
└── middleware/           # Middlewares personalizados

docs/
├── API_ENDPOINTS.md      # Documentación de endpoints
├── DEVICE_HISTORY_SERVICE.md  # Documentación del servicio
└── ...                   # Más documentación

tests/
├── api-endpoints-test.js # Tests de la API
├── device-history-test.js # Tests del servicio
└── ...                   # Más tests
```

## **Métricas Disponibles**

### **Consumo Energético**
- `power_consumption_avg/max/min` - Potencia consumida (W)
- `energy_consumption_sum` - Energía consumida acumulada (Wh)

### **Generación Solar**
- `power_generation_avg/max/min` - Potencia generada (W)
- `energy_generation_sum` - Energía generada acumulada (Wh)

### **Parámetros Eléctricos**
- `voltage_avg/max/min` - Voltaje (V)
- `current_avg/max/min` - Corriente (A)
- `power_factor_avg` - Factor de potencia

### **Totales**
- `energy_total_sum` - Energía total (Wh)
- `power_total_avg` - Potencia total promedio (W)

## **Agregaciones Temporales**

| Agregación | Descripción | Uso Típico |
|------------|-------------|------------|
| `1m`, `5m`, `15m`, `30m` | Por minutos | Análisis detallado |
| `1h`, `2h`, `6h`, `12h` | Por horas | Dashboards diarios |
| `1d` | Por días | Reportes semanales/mensuales |
| `1w` | Por semanas | Análisis de tendencias |
| `1M` | Por meses | Reportes anuales |

## **Casos de Uso**

### **🏠 Dashboard Doméstico**
- Consumo actual en tiempo real
- Generación solar del día
- Comparativa semanal/mensual
- Alertas de consumo elevado

### **📊 Análisis Energético**
- Patrones de consumo por horas
- Eficiencia de paneles solares
- Correlación clima-generación
- Optimización de tarifas

### **📈 Reportes Empresariales**
- Informes mensuales automatizados
- KPIs de sostenibilidad
- Análisis de ROI solar
- Cumplimiento normativo

## **Roadmap**

### **v2.1 - Autenticación**
- [ ] JWT tokens
- [ ] Roles de usuario
- [ ] Rate limiting por usuario

### **v2.2 - Alertas**
- [ ] Sistema de notificaciones
- [ ] Umbrales configurables
- [ ] Integración email/SMS

### **v2.3 - Analytics**
- [ ] Machine Learning para predicciones
- [ ] Detección de anomalías
- [ ] Optimización automática

### **v2.4 - Integración**
- [ ] API para terceros
- [ ] Webhooks
- [ ] Exportación de datos

## **Soporte**

### **Documentación**
- **API**: `/api-docs` en el servidor
- **Código**: Comentarios inline y JSDoc
- **Arquitectura**: Documentos en `/docs`

### **Debugging**
- **Logs**: Revisar archivos en `/logs`
- **Health**: Usar endpoints `/health`
- **Stats**: Consultar `/api/devices/history/stats`

### **Contribución**
1. Fork del repositorio
2. Crear rama feature (`git checkout -b feature/nueva-funcionalidad`)
3. Commit cambios (`git commit -am 'Agregar nueva funcionalidad'`)
4. Push a la rama (`git push origin feature/nueva-funcionalidad`)
5. Crear Pull Request

## **Licencia**

