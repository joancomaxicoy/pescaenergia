# Implementación de Histéresis en Automatización por Potencia

## 🎯 Objetivo

Prevenir el efecto de "flapping" (oscilaciones rápidas de encendido/apagado) en los enchufes controlados por automatización basada en exceso de potencia.

## ❌ Problema Original

Con un único umbral, el enchufe podía entrar en un ciclo infinito:

```
Umbral: 5 kW
Exceso actual: 5.1 kW → Enchufe ON
Enchufe consume 2 kW
Exceso nuevo: 3.1 kW → Enchufe OFF (< 5 kW)
Exceso vuelve a 5.1 kW → Enchufe ON
... ciclo infinito
```

## ✅ Solución: Histéresis con Dos Umbrales

### Concepto

Implementar dos umbrales separados:
- **`powerOnThreshold`**: Umbral de encendido (más alto)
- **`powerOffThreshold`**: Umbral de apagado (más bajo)

### Lógica

```javascript
if (dispositivo está OFF) {
  encender SOLO si exceso >= powerOnThreshold
} else if (dispositivo está ON) {
  apagar SOLO si exceso < powerOffThreshold
}
```

### Ejemplo Práctico

```
powerOnThreshold: 5 kW
powerOffThreshold: 2 kW

Exceso: 5.5 kW → Enchufe ON ✅
Enchufe consume 2 kW
Exceso: 3.5 kW → Enchufe sigue ON ✅ (3.5 > 2)
Exceso: 1.8 kW → Enchufe OFF ✅ (1.8 < 2)
Exceso: 3.0 kW → Enchufe sigue OFF ✅ (3.0 < 5)
Exceso: 5.2 kW → Enchufe ON ✅ (5.2 >= 5)
```

## 📋 Cambios Implementados

### 1. Backend - `PowerEvaluator.js`

**Método `evaluate()`:**
- Acepta parámetro adicional `currentDeviceState`
- Usa `powerOnThreshold` y `powerOffThreshold` en lugar de `power`
- Implementa lógica de histéresis
- Valor por defecto `powerOffThreshold = 40% de powerOnThreshold`

**Método `evaluateMultiple()`:**
- Obtiene estado actual del dispositivo desde cache
- Pasa el estado actual a `evaluate()`
- Incluye ambos umbrales en los resultados

**Validaciones:**
- `powerOnThreshold > 0`
- `powerOffThreshold >= 0`
- `powerOffThreshold < powerOnThreshold`

### 2. Frontend - `plug-card.js`

**Propiedades:**
```javascript
this.powerOnThreshold = 5;  // kW
this.powerOffThreshold = 2; // kW
```

**UI Mejorada:**
```html
<!-- Umbral de encendido -->
Encendre quan l'excedent sigui superior a: [5 kW ▼]

<!-- Umbral de apagado -->
Apagar quan l'excedent baixi de: [2 kW ▼]

<!-- Mensaje de ayuda -->
ℹ️ La diferència entre els dos valors evita que l'endoll 
   s'encengui i s'apagui constantment.
```

**Validaciones Frontend:**
- Alerta si `powerOnThreshold <= powerOffThreshold`
- Revierte cambios inválidos automáticamente

**Opciones de configuración:**
- **Encendido**: 1-10 kW (por defecto 5 kW)
- **Apagado**: 0.5-5 kW (por defecto 2 kW)

### 3. Estructura de Datos

**Configuración guardada:**
```json
{
  "type": "power",
  "powerOnThreshold": 5,
  "powerOffThreshold": 2,
  "power": 5  // Retrocompatibilidad
}
```

**Retrocompatibilidad:**
- Si solo existe `power`, se usa como `powerOnThreshold`
- Se calcula automáticamente `powerOffThreshold = power * 0.4`

## 📊 Valores Recomendados

### Ratio Óptimo
- `powerOffThreshold = 40-60% de powerOnThreshold`

### Ejemplos por Tipo de Dispositivo

| Dispositivo | Consumo | ON Threshold | OFF Threshold | Ratio |
|------------|---------|--------------|---------------|-------|
| Termo ACS | 2 kW | 5 kW | 2 kW | 40% |
| Bomba calor | 3 kW | 7 kW | 3 kW | 43% |
| Cargador VE | 7 kW | 10 kW | 5 kW | 50% |

## 🧪 Testing

### Casos de Prueba

1. **Encendido normal:**
   - Estado: OFF
   - Exceso: 6 kW
   - Umbral ON: 5 kW
   - Resultado: ✅ Encender

2. **Mantener encendido:**
   - Estado: ON
   - Exceso: 3 kW
   - Umbral OFF: 2 kW
   - Resultado: ✅ Mantener ON

3. **Apagado normal:**
   - Estado: ON
   - Exceso: 1.5 kW
   - Umbral OFF: 2 kW
   - Resultado: ✅ Apagar

4. **Mantener apagado:**
   - Estado: OFF
   - Exceso: 4 kW
   - Umbral ON: 5 kW
   - Resultado: ✅ Mantener OFF

5. **Validación inválida:**
   - ON: 3 kW, OFF: 4 kW
   - Resultado: ❌ Error (OFF debe ser < ON)

## 🔍 Logging y Debug

El sistema registra todas las evaluaciones:

```javascript
logger.debug('Evaluación power (dispositivo ON)', {
  deviceId: 123,
  deviceName: 'Termo ACS',
  currentState: 'ON',
  differenceW: 3500,
  offThresholdW: 2000,
  decision: 'MANTENER ON'
});
```

## 📈 Beneficios

1. **Estabilidad:** Elimina oscilaciones constantes
2. **Vida útil:** Reduce ciclos ON/OFF del dispositivo
3. **Eficiencia:** Mejor aprovechamiento del exceso
4. **Red eléctrica:** Menos picos de demanda
5. **UX:** Comportamiento más predecible

## 🔄 Migración de Configuraciones Antiguas

Las configuraciones existentes con solo `power` se migran automáticamente:

```javascript
// Configuración antigua
{ type: 'power', power: 5 }

// Se convierte automáticamente a:
{
  type: 'power',
  powerOnThreshold: 5,
  powerOffThreshold: 2,  // 40% de 5
  power: 5  // Mantenido por retrocompatibilidad
}
```

## 📝 Notas Técnicas

- Los umbrales se almacenan en **kW** en el frontend
- Se convierten a **Watts** en el backend para comparación
- El factor por defecto de 0.4 (40%) puede ajustarse según necesidad
- La validación ocurre tanto en frontend como backend
- El estado del dispositivo se obtiene del cache en memoria (MemoryCache)

## 🚀 Mejoras Futuras

1. **Ajuste automático:** ML para optimizar umbrales según patrones
2. **Temporizador:** Delay mínimo antes de cambiar estado
3. **Curvas de histéresis:** Configuración avanzada por tipo de carga
4. **Dashboard:** Visualización gráfica del comportamiento
5. **Alertas:** Notificación si se detecta flapping residual