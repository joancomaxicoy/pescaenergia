# Implementación de Soporte para Generadores de Energía

## Descripción del Problema

Los **generadores de energía** (como "giravolt" y "residencia") son dispositivos especiales que:

1. **NO deben estar en la tabla `devices`** (que es para dispositivos físicos de usuarios)
2. **SÍ están configurados en el YAML** (`src/config/energy-generators.yml`)
3. **Se dan de alta manualmente** por administradores
4. **Deben guardarse automáticamente** sin necesidad de registro en BD

El problema era que el `CompactorService` intentaba resolver **todos** los deviceId contra la tabla `devices`, causando que los generadores fueran omitidos con el mensaje "Dispositivo no encontrado, omitiendo métricas".

## Solución Implementada

### 1. **Modificación del CompactorService**

Se modificó `src/services/mqtt/compactorService.js` para manejar **dos tipos de dispositivos**:

#### **Dispositivos Físicos** (Shelly, CUPS, ACS)
- Se resuelven contra la tabla `devices`
- Si no existen → "Dispositivo físico no encontrado en BD, omitiendo métricas"
- Usan UUIDs reales de la base de datos

#### **Generadores de Energía**
- Se identifican por `deviceType: 'ENERGY_GENERATOR'`
- **NO se resuelven contra `devices`**
- Usan **UUIDs sintéticos**: `gen-{generatorId}` (ej: `gen-giravolt`)
- Se procesan automáticamente

### 2. **Lógica de Separación**

```javascript
// En runCompactionCycle()
const physicalDevices = [];
const generators = [];

for (const [deviceId, metrics] of bufferSnapshot) {
  // Verificar si es un generador basándose en el deviceType
  const isGenerator = metrics.some(metric => metric.deviceType === 'ENERGY_GENERATOR');
  
  if (isGenerator) {
    generators.push([deviceId, metrics]);
  } else {
    physicalDevices.push(deviceId);
  }
}
```

### 3. **Procesamiento Diferenciado**

```javascript
// Procesar dispositivos físicos (con resolución de BD)
for (const [deviceId, metrics] of physicalDevices) {
  const deviceUuid = deviceIdMap.get(deviceId);
  if (!deviceUuid) {
    logger.warn('Dispositivo físico no encontrado en BD...');
    continue;
  }
  // Procesar con UUID real
}

// Procesar generadores (con UUID sintético)
for (const [generatorId, metrics] of generators) {
  const generatorUuid = `gen-${generatorId}`;
  logger.debug('Procesando generador de energía', {
    generatorId,
    generatorUuid,
    generatorName: metrics[0]?.generatorName
  });
  // Procesar con UUID sintético
}
```

## 4. **Modificación de la Base de Datos**

### Nueva Migración: `1757080700000_modify-energy-metrics-for-generators.js`

```sql
-- Eliminar foreign key constraint
ALTER TABLE energy_metrics DROP CONSTRAINT IF EXISTS energy_metrics_device_id_fkey;

-- Cambiar device_id de UUID a TEXT
ALTER TABLE energy_metrics ALTER COLUMN device_id TYPE TEXT;

-- Crear índice para rendimiento
CREATE INDEX ON energy_metrics (device_id);

-- Comentario explicativo
COMMENT ON COLUMN energy_metrics.device_id IS 
'Device identifier: UUID for physical devices from devices table, or synthetic ID (gen-*) for energy generators';
```

### Estructura Final de `energy_metrics`

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `timestamp` | TIMESTAMPTZ | Timestamp de la métrica |
| `device_id` | **TEXT** | UUID real o sintético (`gen-*`) |
| `metric_name` | TEXT | Nombre de la métrica agregada |
| `value` | DOUBLE PRECISION | Valor de la métrica |

### Ejemplos de `device_id`

- **Dispositivos físicos**: `550e8400-e29b-41d4-a716-446655440000` (UUID real)
- **Generadores**: `gen-giravolt`, `gen-residencia` (UUID sintético)

## 5. **Flujo Completo para Generadores**

### Ejemplo con "giravolt"

1. **Configuración YAML**:
   ```yaml
   giravolt:
     active: true
     name: Giravolt
     mqtt_topic: Dades-Fotovoltaiques-consum-giravolt32
   ```

2. **Mensaje MQTT recibido**:
   ```
   Topic: Dades-Fotovoltaiques-consum-giravolt32
   Payload: {"potenciaFotovoltaica": 2.909, "voltatge": 242.2, ...}
   ```

3. **Normalización**:
   ```javascript
   {
     deviceId: "giravolt",
     deviceType: "ENERGY_GENERATOR",
     generatorName: "Giravolt",
     metrics: [
       { name: "potenciaFotovoltaica", value: 2909, unit: "W" },
       { name: "voltatge", value: 242.2, unit: "V" }
     ]
   }
   ```

4. **Compactación**:
   - Detectado como generador por `deviceType: 'ENERGY_GENERATOR'`
   - UUID sintético: `gen-giravolt`
   - Agregados calculados: avg, min, max, sum, count

5. **Persistencia**:
   ```sql
   INSERT INTO energy_metrics VALUES
   ('2025-01-09T15:30:00.000Z', 'gen-giravolt', 'potenciaFotovoltaica_avg', 2909),
   ('2025-01-09T15:30:00.000Z', 'gen-giravolt', 'potenciaFotovoltaica_max', 2909),
   ('2025-01-09T15:30:00.000Z', 'gen-giravolt', 'voltatge_avg', 242.2),
   -- ... más agregados
   ```

## 6. **Consultas de Datos**

### Consultar Datos de Generadores

```sql
-- Datos de un generador específico
SELECT * FROM energy_metrics 
WHERE device_id = 'gen-giravolt' 
  AND timestamp >= NOW() - INTERVAL '1 hour';

-- Todos los generadores
SELECT * FROM energy_metrics 
WHERE device_id LIKE 'gen-%' 
  AND timestamp >= NOW() - INTERVAL '1 day';

-- Potencia promedio de generadores
SELECT 
  device_id,
  AVG(value) as potencia_promedio
FROM energy_metrics 
WHERE device_id LIKE 'gen-%' 
  AND metric_name LIKE '%potencia%_avg'
  AND timestamp >= NOW() - INTERVAL '1 day'
GROUP BY device_id;
```

### Consultar Datos Mixtos

```sql
-- Resumen por tipo de dispositivo
SELECT 
  CASE 
    WHEN device_id LIKE 'gen-%' THEN 'Generador'
    ELSE 'Dispositivo Físico'
  END as tipo,
  COUNT(*) as total_registros
FROM energy_metrics 
WHERE timestamp >= NOW() - INTERVAL '1 day'
GROUP BY CASE WHEN device_id LIKE 'gen-%' THEN 'Generador' ELSE 'Dispositivo Físico' END;
```

## 7. **Testing Actualizado**

### Test Modificado (`tests/compactor-test.js`)

```javascript
class CompactorTest {
  constructor() {
    this.testPhysicalDevices = [
      'ES0031446450479001ZC0F',
      'ES0031446450479001ZC0G'
    ];
    this.testGenerators = [
      'giravolt',
      'residencia'
    ];
  }

  async ensureTestDevices() {
    // Solo crear dispositivos físicos en BD
    for (const deviceId of this.testPhysicalDevices) {
      // Crear en tabla devices si no existe
    }
    
    // Los generadores NO se crean en BD
    logger.info('Generadores configurados:', {
      generators: this.testGenerators,
      note: 'Se procesan automáticamente sin registro en BD'
    });
  }
}
```

### Verificación de Datos

El test ahora verifica tanto dispositivos físicos como generadores:

```javascript
// Dispositivos físicos (con JOIN a devices)
SELECT em.*, d.device_name 
FROM energy_metrics em
JOIN devices d ON em.device_id = d.id;

// Generadores (sin JOIN)
SELECT * FROM energy_metrics 
WHERE device_id LIKE 'gen-%';
```

## 8. **Beneficios de la Implementación**

### ✅ **Separación Clara**
- Dispositivos físicos → Tabla `devices` + UUIDs reales
- Generadores → Configuración YAML + UUIDs sintéticos

### ✅ **Flexibilidad**
- Agregar nuevos generadores solo requiere editar el YAML
- No necesidad de registros manuales en BD

### ✅ **Consistencia**
- Misma estructura de datos para ambos tipos
- Mismo proceso de agregación y persistencia

### ✅ **Escalabilidad**
- Soporte ilimitado de generadores
- Rendimiento optimizado con índices

### ✅ **Mantenibilidad**
- Código claro y bien documentado
- Logging específico para cada tipo

## 9. **Logging Mejorado**

### Mensajes Informativos

```
[INFO] Procesando generador de energía {
  generatorId: "giravolt",
  generatorUuid: "gen-giravolt", 
  metricsCount: 6,
  generatorName: "Giravolt"
}

[INFO] Ciclo de compactación completado {
  physicalDevices: 2,
  generators: 2,
  metricsProcessed: 120,
  aggregatedMetrics: 600
}
```

### Diferenciación de Errores

```
[WARN] Dispositivo físico no encontrado en BD, omitiendo métricas {
  deviceId: "ES0031446450479001ZC0X",
  deviceType: "SHELLY_SHELLYEM"
}
```

## 10. **Migración y Compatibilidad**

### Migración Segura

- **UP**: Convierte UUIDs existentes a TEXT automáticamente
- **DOWN**: Elimina generadores y restaura foreign key

### Compatibilidad

- **Datos existentes**: Se mantienen intactos
- **Consultas existentes**: Siguen funcionando
- **Nuevos generadores**: Se procesan automáticamente

Esta implementación resuelve completamente el problema de los generadores de energía, permitiendo que se procesen automáticamente sin necesidad de registros manuales en la base de datos, manteniendo la integridad y eficiencia del sistema.
