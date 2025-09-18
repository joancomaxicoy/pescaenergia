# Sistema de Automatización Avanzado

Este directorio contiene el nuevo sistema de automatización para PescaEnergía, diseñado para ser más robusto, eficiente y escalable que el sistema anterior.

## 🏗️ Arquitectura

El sistema está compuesto por los siguientes componentes principales:

### 1. **** (Gestor Principal)
- **Archivo**: `AutomationManager.js`
- **Función**: Coordina todos los componentes y ejecuta el timer principal
- **Características**:
  - Timer configurable (por defecto 1 segundo)
  - Manejo de eventos MQTT en tiempo real
  - Estadísticas y monitoreo
  - Gestión de errores robusta

### 2. **MemoryCache** (Cache en Memoria)
- **Archivo**: `MemoryCache.js`
- **Función**: Almacena configuraciones, estados y métricas en memoria
- **Características**:
  - Recarga automática cada 5 minutos
  - Soporte para generadores del YAML
  - Métricas de potencia con sufijo `_avg`
  - Detección de cambios en tiempo real

### 3. **ScheduleEvaluator** (Evaluador de Horarios)
- **Archivo**: `ScheduleEvaluator.js`
- **Función**: Evalúa automatizaciones basadas en horarios
- **Características**:
  - Soporte para múltiples franjas horarias
  - Configuración por días de la semana
  - Validación de configuraciones
  - Zona horaria configurable

### 4. **PowerEvaluator** (Evaluador de Potencia)
- **Archivo**: `PowerEvaluator.js`
- **Función**: Evalúa automatizaciones basadas en exceso de generación
- **Características**:
  - Cálculo de diferencia generación-consumo
  - Umbrales configurables
  - Evaluación múltiple eficiente
  - Simulaciones para testing

## 🔧 Configuración

### Variables de Entorno

```bash
# Intervalo del timer de automatización (en segundos)
AUTOMATION_TIMER_INTERVAL=1

# Zona horaria de los usuarios
USERS_TIMEZONE=Europe/Madrid
```

### Tipos de Automatización

#### 1. **Schedule** (Por Horario)
```json
{
  "type": "schedule",
  "schedule": [
    {
      "id": 1,
      "enabled": true,
      "days": [1, 2, 3, 4, 5],  // 0=Domingo, 6=Sábado
      "startTime": "08:00",
      "endTime": "18:00"
    }
  ]
}
```

#### 2. **Power** (Por Potencia)
```json
{
  "type": "power",
  "power": 5  // Umbral en kW
}
```

#### 3. **Manual** (Sin Automatización)
```json
{
  "type": "manual"
}
```

## 🚀 Uso

### Inicialización Básica

```javascript
const AutomationManager = require('./src/services/automation/AutomationManager');

// Crear instancia (sin servicios externos para testing)
const automationManager = new AutomationManager();

// Inicializar
await automationManager.initialize();

// Iniciar
automationManager.start();

// Detener
automationManager.stop();

// Cerrar
await automationManager.close();
```

### Integración con PlugsService y MQTT

```javascript
const AutomationManager = require('./src/services/automation/AutomationManager');
const PlugsService = require('../plugsService');
const MqttService = require('../mqtt/mqttService');

// Crear servicios
const plugsService = new PlugsService();
const mqttService = new MqttService();

// Crear manager con servicios
const automationManager = new AutomationManager(plugsService, mqttService);

await automationManager.initialize();
automationManager.start();
```

### Uso Individual de Evaluadores

```javascript
const ScheduleEvaluator = require('./ScheduleEvaluator');
const PowerEvaluator = require('./PowerEvaluator');

// Evaluador de horarios
const scheduleEvaluator = new ScheduleEvaluator();
const shouldBeOn = scheduleEvaluator.evaluate(scheduleConfig);

// Evaluador de potencia (requiere cache)
const powerEvaluator = new PowerEvaluator(memoryCache);
const shouldBeOn = powerEvaluator.evaluate(powerConfig);
```

## 📊 Monitoreo y Debug

### Estadísticas del Sistema

```javascript
const stats = automationManager.getStats();
console.log('Estadísticas:', {
  cyclesExecuted: stats.cyclesExecuted,
  actionsExecuted: stats.actionsExecuted,
  errors: stats.errors,
  uptime: stats.uptime
});
```

### Información de Debug

```javascript
const debugInfo = automationManager.getDebugInfo();
console.log('Debug:', {
  activeConfigs: debugInfo.activeConfigs,
  cacheSize: debugInfo.cache.currentSize,
  powerAvailable: debugInfo.powerEvaluator.available
});
```

### Debug de Evaluadores

```javascript
// Debug de horarios
const scheduleDebug = scheduleEvaluator.getDebugInfo(config);
console.log('Schedule Debug:', scheduleDebug);

// Debug de potencia
const powerDebug = powerEvaluator.getDebugInfo(config);
console.log('Power Debug:', powerDebug);
```

## 🧪 Testing

### Test de Lógica (Sin BD)

```bash
node test_automation_logic_only.js
```

### Test Completo (Con BD)

```bash
node test_new_automation_system.js
```

### Simulaciones

```javascript
// Simular evaluación de potencia
const simulation = powerEvaluator.simulate(config, 8000, 3000);
console.log('Simulación:', simulation.reason);
```

## 🔄 Flujo de Funcionamiento

### 1. **Inicialización**
1. Se carga el cache en memoria con configuraciones, estados y métricas
2. Se cargan los generadores desde el YAML
3. Se registra el handler MQTT para eventos de potencia
4. Se inicia el timer de ejecución

### 2. **Ciclo de Evaluación (cada segundo)**
1. Se obtienen todas las configuraciones activas
2. Se evalúan las automatizaciones por horario
3. Se evalúan las automatizaciones por potencia
4. Se ejecutan las acciones necesarias
5. Se actualizan los estados en cache

### 3. **Eventos MQTT en Tiempo Real**
1. Se reciben eventos de potencia de generadores y dispositivos
2. Se actualizan las métricas en cache
3. Se evalúan inmediatamente las automatizaciones por potencia
4. Se ejecutan acciones si es necesario

### 4. **Recarga Automática (cada 5 minutos)**
1. Se recargan las configuraciones desde la BD
2. Se recargan los estados de dispositivos
3. Se recargan las métricas de potencia
4. Se recargan los generadores del YAML

## 🛠️ Mantenimiento

### Actualización de Configuración

```javascript
// Forzar actualización de un dispositivo específico
await automationManager.updateDeviceConfig(deviceId);
```

### Limpieza de Cache

```javascript
// Limpiar cache completo
memoryCache.clear();

// Invalidar cache de un dispositivo
memoryCache.updateDeviceState(deviceId, newState);
```

### Logs y Errores

El sistema utiliza el logger centralizado y registra:
- Inicializaciones y cierres
- Evaluaciones y acciones ejecutadas
- Errores y warnings
- Estadísticas de rendimiento

## 📈 Rendimiento

### Optimizaciones Implementadas

1. **Cache en Memoria**: Evita consultas constantes a la BD
2. **Evaluación Múltiple**: Las automatizaciones por potencia se evalúan en lote
3. **Eventos Asíncronos**: Los eventos MQTT no bloquean el timer principal
4. **Recarga Inteligente**: Solo se recargan los datos que han cambiado

### Métricas de Rendimiento

- **Duración de Ciclo**: Normalmente < 100ms
- **Memoria**: Cache optimizado con limpieza automática
- **CPU**: Evaluaciones eficientes sin bucles innecesarios
- **Red**: Mínimas consultas a BD gracias al cache

## 🔒 Seguridad y Robustez

### Manejo de Errores

- Errores en evaluaciones individuales no afectan al sistema completo
- Reconexión automática de servicios externos
- Logs detallados para debugging
- Fallback a modo simulación si no hay servicios

### Validaciones

- Configuraciones validadas antes de ser procesadas
- Verificación de tipos y rangos de valores
- Protección contra configuraciones malformadas

## 🆚 Comparación con Sistema Anterior

| Característica | Sistema Anterior | Sistema Nuevo |
|---|---|---|
| **Intervalo** | 30 segundos | 1 segundo (configurable) |
| **Cache** | Sin cache | Cache en memoria completo |
| **Tipos** | Solo schedule | Schedule + Power + Manual |
| **MQTT** | No integrado | Eventos en tiempo real |
| **Generadores** | No soportado | Soporte completo desde YAML |
| **Validación** | Básica | Validación completa |
| **Testing** | Limitado | Tests completos + simulaciones |
| **Monitoreo** | Básico | Estadísticas detalladas |
| **Escalabilidad** | Limitada | Altamente escalable |

## 📝 Notas de Desarrollo

### Próximas Mejoras

1. **Dashboard de Monitoreo**: Interfaz web para ver estadísticas
2. **Alertas**: Notificaciones por errores o anomalías
3. **Histórico**: Registro de acciones ejecutadas
4. **API REST**: Endpoints para gestión remota
5. **Predicciones**: ML para optimizar automatizaciones

### Consideraciones

- El sistema está diseñado para ser backward-compatible
- Se puede ejecutar en paralelo con el sistema anterior durante la transición
- Todos los componentes son modulares y testeable independientemente
- La configuración se mantiene en la misma estructura de BD
