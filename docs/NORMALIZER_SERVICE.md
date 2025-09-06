# NormalizerService - Documentación de Transformación de Datos

## Descripción General

El `NormalizerService` es el componente responsable de convertir todos los mensajes MQTT heterogéneos en un formato estándar y predecible. Actúa como el segundo eslabón en la cadena de procesamiento de datos:

```
mqttService → normalizerService → bufferService → compactorService → persistenceService
```

## Arquitectura del Normalizador

### Tipos de Parsers

El normalizador utiliza dos tipos de parsers:

1. **Parsers Estáticos**: Para tipos de topics conocidos y fijos
2. **Parsers Dinámicos**: Cargados desde la configuración YAML para generadores de energía

### Configuración Dinámica

Los parsers dinámicos se cargan automáticamente desde `src/config/energy-generators.yml`:

```yaml
giravolt:
  active: true
  name: Giravolt
  mqtt_topic: Dades-Fotovoltaiques-consum-giravolt32

residencia:
  active: true
  name: Residència
  mqtt_topic: Generacio-Residencia
```

## Formato de Salida Normalizado

Todos los mensajes normalizados siguen esta estructura estándar:

```javascript
{
  deviceId: "ES0031446450479001ZC0F",    // ID del dispositivo extraído del topic
  deviceType: "SHELLY_SHELLYEM",         // Tipo de dispositivo detectado
  timestamp: "2025-09-05T15:29:38.000Z", // Timestamp del mensaje
  generatorName: "Giravolt",             // Solo para generadores (opcional)
  metrics: [                             // Array de métricas normalizadas
    {
      name: "emeter_0_power",             // Nombre normalizado de la métrica
      value: 89.61,                       // Valor numérico
      unit: "W",                          // Unidad de medida
      index: 0                            // Índice si aplica (opcional)
    }
  ]
}
```

## Transformaciones por Tipo de Dispositivo

### 1. Dispositivos Shelly (shellies/*)

**Entrada:**
```
Topic: shellies/shellyem/ES0031446450479001ZC0F/emeter/0/power
Payload: "89.61"
```

**Salida:**
```javascript
{
  deviceId: "ES0031446450479001ZC0F",
  deviceType: "SHELLY_SHELLYEM",
  timestamp: "2025-09-05T15:29:38.000Z",
  metrics: [{
    name: "emeter_0_power",
    value: 89.61,
    unit: "W",
    index: 0
  }]
}
```

#### Tipos de Métricas Shelly Soportadas

| Topic Pattern | Métrica Normalizada | Unidad | Descripción |
|---------------|-------------------|--------|-------------|
| `emeter/X/power` | `emeter_X_power` | W | Potencia activa |
| `emeter/X/voltage` | `emeter_X_voltage` | V | Voltaje |
| `emeter/X/total` | `emeter_X_total` | Wh | Energía total |
| `emeter/X/total_returned` | `emeter_X_total_returned` | Wh | Energía devuelta |
| `emeter/X/reactive_power` | `emeter_X_reactive_power` | VAR | Potencia reactiva |
| `emeter/X/pf` | `emeter_X_pf` | ratio | Factor de potencia |
| `relay/X` | `relay_X` | boolean | Estado del relé (on/off → 1/0) |
| `online` | `online` | boolean | Estado online (true/false → 1/0) |

### 2. Datos de Consumo por CUPS (ConsumCups/*)

**Entrada:**
```
Topic: ConsumCups/ES0031446450479001ZC0F
Payload: {"voltatge_circutor":242.2,"intensitat_circutor":1.9,"frequencia_circutor":50,"potencia_circutor":0.452}
```

**Salida:**
```javascript
{
  deviceId: "ES0031446450479001ZC0F",
  deviceType: "CIRCUTOR",
  timestamp: "2025-09-05T15:29:38.000Z",
  metrics: [
    {
      name: "voltatge_circutor",
      value: 242.2,
      unit: "V"
    },
    {
      name: "intensitat_circutor", 
      value: 1.9,
      unit: "A"
    },
    {
      name: "frequencia_circutor",
      value: 50,
      unit: "Hz"
    },
    {
      name: "potencia_circutor",
      value: 452,        // Convertido de kW a W (0.452 * 1000)
      unit: "W"
    }
  ]
}
```

#### Conversiones Automáticas para CUPS

- **Potencia**: Si el valor es < 100, se multiplica por 1000 (kW → W)
- **Voltaje**: Campos con "voltatge" o "voltage" → unidad "V"
- **Corriente**: Campos con "intensitat" o "current" → unidad "A"
- **Frecuencia**: Campos con "frequencia" o "frequency" → unidad "Hz"

### 3. Control ACS (acs/*)

**Entrada:**
```
Topic: acs/ES0031446450479001ZC0F/status/switch:0
Payload: {"id":0,"output":false}
```

**Salida:**
```javascript
{
  deviceId: "ES0031446450479001ZC0F",
  deviceType: "ACS",
  timestamp: "2025-09-05T15:29:38.000Z",
  metrics: [{
    name: "status_switch:0",
    value: {"id":0,"output":false},
    unit: "json"
  }]
}
```

### 4. Generadores de Energía (Dinámicos)

**Entrada:**
```
Topic: Dades-Fotovoltaiques-consum-giravolt32
Payload: {"potenciaFotovoltaica": 3.816}
```

**Salida:**
```javascript
{
  deviceId: "giravolt",
  deviceType: "ENERGY_GENERATOR",
  generatorName: "Giravolt",
  timestamp: "2025-09-05T15:29:38.000Z",
  metrics: [{
    name: "potenciaFotovoltaica",
    value: 3816,        // Convertido de kW a W (3.816 * 1000)
    unit: "W"
  }]
}
```

#### Conversiones para Generadores

- **Potencia**: Si el campo contiene "potencia" y el valor es < 100, se multiplica por 1000 (kW → W)
- **Detección automática**: Procesa todos los campos numéricos del JSON
- **Unidades inteligentes**: Determina la unidad basándose en el nombre del campo

### 5. Mensajes de Announce (shellies/announce)

**Entrada:**
```
Topic: shellies/announce
Payload: {"id":"shellyem/ES0031446450479001ZC0F","model":"SHEM","mac":"48E729688900","ip":"192.168.1.33"}
```

**Salida:**
```javascript
{
  deviceId: "shellyem/ES0031446450479001ZC0F",
  deviceType: "SHELLY_ANNOUNCE",
  timestamp: "2025-09-05T15:29:38.000Z",
  metrics: [{
    name: "device_announce",
    value: "{\"id\":\"shellyem/ES0031446450479001ZC0F\",\"model\":\"SHEM\",...}",
    unit: "json"
  }]
}
```

## Sistema de Detección de Unidades

El normalizador incluye un sistema inteligente de detección de unidades basado en:

### Por Nombre de Campo

| Patrón en el Nombre | Unidad Asignada | Ejemplos |
|-------------------|----------------|----------|
| `power` | W | emeter_0_power, potencia_circutor |
| `voltage`, `voltatge` | V | emeter_0_voltage, voltatge_circutor |
| `current`, `intensitat` | A | intensitat_circutor |
| `frequency`, `frequencia` | Hz | frequencia_circutor |
| `energy`, `total` | Wh | emeter_0_total, energy |
| `reactive` | VAR | reactive_power |
| `pf`, `factor` | ratio | power_factor |
| `temperature`, `temp` | C | temperature |

### Por Tipo de Valor

| Tipo de Valor | Condición | Unidad |
|--------------|-----------|--------|
| Boolean/0/1 | Campos con "online", "relay", "switch" | boolean |
| Object | Cualquier objeto JSON | json |
| String | Texto no numérico | string |
| Number | Valor numérico sin patrón específico | numeric |

## Estadísticas y Monitoreo

El normalizador proporciona estadísticas detalladas:

```javascript
{
  messagesProcessed: 10,      // Total de mensajes procesados
  messagesNormalized: 9,      // Mensajes normalizados exitosamente
  messagesSkipped: 1,         // Mensajes omitidos (sin parser)
  messagesErrored: 0,         // Mensajes con errores
  successRate: "90.00%",      // Tasa de éxito
  totalParsers: 5,            // Parsers activos (estáticos + dinámicos)
  parserStats: {              // Uso por parser
    "bound parseShelly": 6,
    "bound parseConsumCups": 1,
    "bound parseAcs": 1,
    "dynamic_giravolt": 1
  }
}
```

## Manejo de Errores

### Mensajes Malformados
- **JSON inválido**: Se logea como warning y se omite el mensaje
- **Valores no numéricos**: Se mantienen como string si no se pueden convertir
- **Topics no reconocidos**: Se omiten silenciosamente

### Logging
- **Debug**: Mensajes normalizados exitosamente
- **Warn**: Errores de parsing de JSON o valores inesperados
- **Error**: Errores críticos en el proceso de normalización

## Extensibilidad

### Agregar Nuevos Generadores

1. Editar `src/config/energy-generators.yml`:
```yaml
nuevo_generador:
  active: true
  name: "Nuevo Generador"
  mqtt_topic: "nuevo/topic/generador"
```

2. El normalizador recargará automáticamente los parsers dinámicos

### Agregar Nuevos Tipos de Dispositivos

1. Agregar un nuevo parser estático en `setupStaticParsers()`:
```javascript
this.parsers.set(
  /^nuevo_dispositivo\/(.+)$/,
  this.parseNuevoDispositivo.bind(this)
);
```

2. Implementar el método parser correspondiente

## Rendimiento

- **Procesamiento en memoria**: Sin acceso a base de datos
- **Parsers optimizados**: Uso de RegExp compiladas
- **Estadísticas eficientes**: Uso de Map para contadores
- **Logging condicional**: Debug logs solo cuando es necesario

## Casos de Uso Especiales

### Detección de Generación vs Consumo

Para dispositivos Shelly EM:
- `emeter/0/*`: Siempre se considera consumo
- `emeter/1/*` con valor positivo: Consumo en segundo canal
- `emeter/1/*` con valor negativo: Generación (valor se mantiene negativo para identificación posterior)

### Conversión de Unidades

- **kW → W**: Automática para valores < 100 en campos de potencia
- **Boolean**: on/off, true/false → 1/0
- **JSON**: Objetos complejos se mantienen como JSON string

Este normalizador proporciona una base sólida y extensible para procesar cualquier tipo de mensaje MQTT del sistema energético, manteniendo consistencia y flexibilidad para futuras expansiones.
