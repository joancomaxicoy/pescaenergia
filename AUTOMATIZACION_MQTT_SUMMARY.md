# Resumen del Sistema de Automatización MQTT en Energina-Torello

## Concepto General

El sistema de automatización en el proyecto **energina-torello** está diseñado para optimizar el **autoconsumo solar** en instalaciones fotovoltaicas compartidas. El objetivo principal es maximizar el uso de la energía generada por paneles solares (excedentes) en lugar de consumir de la red eléctrica pública, reduciendo costos y promoviendo la sostenibilidad.

### Funcionamiento Principal:
- **Monitorización en tiempo real**: Se rastrea la generación solar (de Giravolt32), el consumo total de la casa (por CUPS) y el balance energético (excedentes = generación - consumo).
- **Control inteligente de dispositivos**: Dispositivos específicos como el ACS (Agua Caliente Sanitaria) están conectados a relays inteligentes (ej: Shelly Plus Plug-S) que se controlan vía MQTT.
- **Decisión de fuente de energía**: Cuando hay excedentes solares por encima de un umbral configurable (ej: 500W), el sistema activa el dispositivo para que "coga" energía del generador solar. Si no hay excedentes, lo desactiva para evitar consumir de la red pública.
- **Modos de operación**: 
  - **Automático**: Basado en excedentes, horarios, tiempos mínimo/máximo.
  - **Manual**: Control directo desde la interfaz web.
  - **Stop**: Desactivado.
- **Integración**: Usa MQTT para comunicación con dispositivos físicos, WebSocket para UI en tiempo real, y CouchDB para persistencia de configuraciones.
- **Beneficios**: Ahorro en factura eléctrica, optimización de energía renovable, escalable a múltiples dispositivos (ACS, lavadoras, etc.).

El sistema no controla toda la casa, sino solo dispositivos enchufados en relays MQTT. La lógica se implementa en `mqtt_subscriber.js`, `app.js` y `clientAutomatitzacio.js`.

## Eventos MQTT Técnicos

### Configuración del Broker MQTT
- **Host**: definit amb `MQTT_BROKER_URL` i `MQTT_BROKER_PORT`
- **Credencials**: definides amb `MQTT_BROKER_USER` i `MQTT_BROKER_PASSWORD`; no s'han de documentar ni versionar
- **Client ID**: Único (ej: `giravolt32_subscriber` + random)

### Eventos a Enviar (Control - Publicar)
Estos eventos se envían para **controlar dispositivos** (activar/desactivar relays). Se publican desde el servidor Node.js usando la función `canviarEstatACS(cupsId, nouEstat)` en `mqtt_subscriber.js`.

1. **Activar dispositivo (ON - Usar energía solar)**:
   - **Topic**: `acs/{cupsId}/rpc` (ej: `acs/3232323232/rpc`)
   - **Payload (JSON)**:
     ```
     {
       "id": 1,
       "src": "mqtt",
       "method": "Switch.Set",
       "params": {
         "id": 0,
         "on": true
       }
     }
     ```
   - **Opciones**: QoS=1, retain=false
   - **Cuándo enviar**: Excedentes > `AccedentSolarOn` (ej: 500W) y modo automático/manual ON.
   - **Efecto**: El relay se enciende; el dispositivo consume energía solar (si hay excedentes).

2. **Desactivar dispositivo (OFF - Parar consumo)**:
   - **Topic**: Igual que arriba.
   - **Payload (JSON)**:
     ```
     {
       "id": 1,
       "src": "mqtt",
       "method": "Switch.Set",
       "params": {
         "id": 0,
         "on": false
       }
     }
     ```
   - **Opciones**: QoS=1, retain=false
   - **Cuándo enviar**: Excedentes < `AccedentSolarOff` (ej: 200W), tiempo máximo alcanzado, o modo STOP.
   - **Efecto**: El relay se apaga; el dispositivo deja de consumir (vuelve al consumo normal de la red si es necesario).

**Notas técnicas**:
- `{cupsId}` es el ID único del usuario (ej: número CUPS como "3232323232").
- Se envía desde el backend vía `client.publish(topic, payload, options)`.
- Después de enviar, se actualiza el estado local y se emite WebSocket para UI.

### Eventos a Escuchar (Estado - Suscribir)
El subscriber (`mqtt_subscriber.js`) se suscribe a estos topics para **monitorear estados** y tomar decisiones automáticas. Actualiza variables globales como `giravolt32_generacio`, `dadesConsumCups` y `dadesACS`.

1. **Generación solar (Giravolt32)**:
   - **Topic**: `Dades-Fotovoltaiques-consum-giravolt32`
   - **Payload esperado (JSON)**: 
     ```
     {
       "timestamp": "2025-09-09T16:20:00Z",
       "voltatge": 230.5,
       "intensitat": 10.2,
       "frequencia": 50.0,
       "potenciaFotovoltaica": 450.0,
       "e_total_fotovoltaica": 1234.5
     }
     ```
   - **Acción**: Actualiza `giravolt32_generacio`. Si `potenciaFotovoltaica > 6000W`, ignora (fuera de rango).
   - **Frecuencia**: Tiempo real (cada pocos segundos).

2. **Consumo por CUPS**:
   - **Topic**: `ConsumCups/#` (wildcard para todos los subtopics, ej: `ConsumCups/3232323232`)
   - **Payload esperado (JSON)**:
     ```
     {
       "timestamp": "2025-09-09T16:20:00Z",
       "potencia_circutor": 150.0
     }
     ```
   - **Acción**: Actualiza `dadesConsumCups` (Map por CUPS). Calcula balance: excedentes = generación - consumo.
   - **Frecuencia**: Tiempo real.

3. **Estado de dispositivo ACS**:
   - **Topic**: `acs/{cupsId}/status/switch:0` (ej: `acs/3232323232/status/switch:0`)
   - **Payload esperado (JSON)**:
     ```
     {
       "output": true,
       "apower": 2.5,
       "aenergy": { "total": 123.45 },
       "timestamp": "2025-09-09T16:20:00Z"
     }
     ```
   - **Acción**: Actualiza `dadesACS[cupsId]`. Emite WebSocket `acs-update{cupsId}` para UI. Guarda en persistencia.
   - **Frecuencia**: Tiempo real (actualizaciones del dispositivo).

**Notas técnicas**:
- Suscripción: `client.subscribe(TOPIC, { qos: 1 })` donde `TOPIC = ['Dades-Fotovoltaiques-consum-giravolt32', 'ConsumCups/#', 'acs/#']`.
- Procesamiento: En `client.on('message', ...)` se parsea JSON y valida rangos.
- Integración: Los datos escuchados triggeran lógica automática (ej: si excedentes > umbral, enviar evento de control).
- Errores: Logs en consola; desconexión controlada en `SIGINT`.

## Implementación y Extensión
- **Archivos clave**: `mqtt_subscriber.js` (suscriptor/control), `app.js` (endpoints API), `clientAutomatitzacio.js` (UI/WebSocket).
- **Configuración**: Umbrales y modos en CouchDB (base `automatitzacio`, doc `{cupsId}:ACS`).
- **Extensión**: Para nuevos dispositivos, agregar topics como `device/{cupsId}/rpc` y suscribirse a `device/{cupsId}/status`.

Este sistema permite una automatización completa para priorizar energía solar sobre la red pública en dispositivos específicos.
