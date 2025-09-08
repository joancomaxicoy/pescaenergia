# **Endpoint de Asignación de CUPS - PescaEnergia Backend v2.0**

## **Descripción General**

El endpoint de asignación de CUPS permite gestionar la relación entre usuarios y sus contadores eléctricos (CUPS). Este sistema implementa un control de acceso diferenciado según el rol del usuario y garantiza que cada CUPS esté asignado únicamente a un usuario.

## **Características Principales**

- ✅ **Control de acceso por roles**: Usuarios normales vs Administradores
- ✅ **Prevención de duplicados**: Un CUPS solo puede estar asignado a un usuario
- ✅ **Creación automática**: Si el device CUPS no existe, se crea automáticamente
- ✅ **Reasignación controlada**: Solo administradores pueden reasignar CUPS
- ✅ **Transacciones seguras**: Operaciones atómicas en base de datos
- ✅ **Documentación Swagger**: Completamente documentado con OpenAPI

## **Endpoints Disponibles**

### **1. Asignar CUPS**
```
POST /api/cups/assign
```

**Funcionalidad por rol:**

#### **Usuario Normal:**
- Solo puede asignarse CUPS a sí mismo
- No puede modificar asignaciones preexistentes
- Si el CUPS existe y está asignado → ERROR
- Si el CUPS existe sin asignar → se asigna
- Si el CUPS no existe → se crea y asigna

#### **Administrador:**
- Puede asignar CUPS a cualquier usuario (parámetro `user_id`)
- Puede reasignar CUPS ya asignados
- Quita automáticamente el CUPS del usuario anterior

**Request Body:**
```json
{
  "cups": "ES0031446450479001ZC0F",
  "user_id": "123e4567-e89b-12d3-a456-426614174000"  // Solo para admins
}
```

**Response:**
```json
{
  "success": true,
  "device": {
    "id": "device-uuid",
    "shelly_device_id": "ES0031446450479001ZC0F",
    "device_name": "Contador CUPS ES0031446450479001ZC0F",
    "device_type": "SHELLY_SHELLYEM",
    "user_id": "user-uuid",
    "user_name": "Nombre Usuario",
    "user_email": "usuario@email.com"
  },
  "operation": "created", // o "assigned"
  "previousUserId": null, // o UUID del usuario anterior
  "message": "CUPS ES0031446450479001ZC0F creado y asignado exitosamente"
}
```

### **2. Consultar Información de CUPS**
```
GET /api/cups/{cups}/info
```

**Restricciones:**
- Usuarios normales: Solo pueden ver sus propios CUPS
- Administradores: Pueden ver cualquier CUPS

**Response:**
```json
{
  "id": "device-uuid",
  "shelly_device_id": "ES0031446450479001ZC0F",
  "device_name": "Contador CUPS ES0031446450479001ZC0F",
  "device_type": "SHELLY_SHELLYEM",
  "user_id": "user-uuid",
  "user_name": "Nombre Usuario",
  "user_email": "usuario@email.com",
  "is_assigned": true,
  "created_at": "2025-01-09T18:30:00Z",
  "updated_at": "2025-01-09T18:30:00Z"
}
```

### **3. Listar Todos los CUPS (Solo Administradores)**
```
GET /api/cups/list
```

**Response:**
```json
{
  "cups": [
    {
      "id": "device-uuid",
      "cups": "ES0031446450479001ZC0F",
      "device_name": "Contador CUPS ES0031446450479001ZC0F",
      "user_id": "user-uuid",
      "user_name": "Nombre Usuario",
      "user_email": "usuario@email.com",
      "is_assigned": true,
      "created_at": "2025-01-09T18:30:00Z"
    }
  ],
  "total": 10,
  "assigned": 8,
  "unassigned": 2
}
```

### **4. Desasignar CUPS (Solo Administradores)**
```
POST /api/cups/{cups}/unassign
```

**Response:**
```json
{
  "success": true,
  "message": "CUPS ES0031446450479001ZC0F desasignado exitosamente",
  "previousUserId": "user-uuid"
}
```

## **Reglas de Negocio**

### **Consistencia de Datos**
1. **Un CUPS = Un Usuario**: Cada CUPS puede estar asignado únicamente a un usuario
2. **Verificación de Duplicados**: Se verifica que no existan CUPS duplicados
3. **Transacciones Atómicas**: Todas las operaciones usan transacciones de base de datos

### **Estructura del Device CUPS**
- **device_type**: `'SHELLY_SHELLYEM'`
- **shelly_device_id**: El CUPS proporcionado
- **device_name**: `"Contador CUPS {cups}"`
- **user_id**: UUID del usuario o `'not_assigned'`

### **Estados del Device**
- **not_assigned**: Device existe pero no está asignado a ningún usuario
- **assigned**: Device asignado a un usuario específico

## **Casos de Uso Cubiertos**

### **Escenario 1: Usuario Normal - Primera Asignación**
```bash
# Usuario se asigna su primer CUPS
curl -X POST "http://localhost:3000/api/cups/assign" \
  -H "Authorization: Bearer USER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"cups": "ES0031446450479001ZC0F"}'
```

### **Escenario 2: Usuario Normal - CUPS Ya Ocupado**
```bash
# Usuario intenta asignar CUPS ya ocupado (ERROR)
curl -X POST "http://localhost:3000/api/cups/assign" \
  -H "Authorization: Bearer USER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"cups": "ES0031446450479001ZC0F"}'

# Response: 400 Bad Request
# "Este CUPS ya está asignado a otro usuario. Solo un administrador puede reasignarlo."
```

### **Escenario 3: Admin - Asignación a Usuario Específico**
```bash
# Admin asigna CUPS a usuario específico
curl -X POST "http://localhost:3000/api/cups/assign" \
  -H "Authorization: Bearer ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "cups": "ES0031446450479001ZC0F",
    "user_id": "123e4567-e89b-12d3-a456-426614174000"
  }'
```

### **Escenario 4: Admin - Reasignación**
```bash
# Admin reasigna CUPS de un usuario a otro
curl -X POST "http://localhost:3000/api/cups/assign" \
  -H "Authorization: Bearer ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "cups": "ES0031446450479001ZC0F",
    "user_id": "456e7890-e89b-12d3-a456-426614174001"
  }'
```

## **Validaciones y Errores**

### **Validaciones de Entrada**
- **CUPS**: Requerido, string, 1-50 caracteres
- **user_id**: Opcional, debe ser UUID válido (solo para admins)

### **Códigos de Error**

| Código | Descripción | Escenario |
|--------|-------------|-----------|
| 400 | CUPS inválido | CUPS vacío o formato incorrecto |
| 400 | CUPS ya asignado | Usuario normal intenta asignar CUPS ocupado |
| 400 | Usuario ya tiene este CUPS | Intento de asignar el mismo CUPS al mismo usuario |
| 401 | No autorizado | Token JWT inválido o ausente |
| 403 | Email no verificado | Usuario no ha verificado su email |
| 403 | Permisos insuficientes | Usuario normal intenta usar funciones de admin |
| 404 | Usuario objetivo no encontrado | Admin especifica user_id inexistente |
| 404 | CUPS no encontrado | Consulta de CUPS inexistente |
| 500 | Error interno | Error de base de datos o sistema |

## **Seguridad**

### **Autenticación**
- **JWT Bearer Token**: Requerido en header `Authorization`
- **Email Verificado**: Usuario debe tener email verificado

### **Autorización**
- **Control por Roles**: Diferentes permisos según rol (user/admin)
- **Ownership**: Usuarios solo pueden ver sus propios datos
- **Admin Override**: Administradores tienen acceso completo

### **Validación de Datos**
- **Express Validator**: Validación de entrada robusta
- **SQL Injection**: Protección mediante queries parametrizadas
- **XSS**: Headers de seguridad con Helmet.js

## **Base de Datos**

### **Tablas Involucradas**

#### **users**
```sql
- id (UUID, PK)
- cups (TEXT, nullable) -- Se actualiza con el CUPS asignado
- email (TEXT, unique)
- name (TEXT)
- role (TEXT) -- 'user' o 'admin'
- ...
```

#### **devices**
```sql
- id (UUID, PK)
- user_id (TEXT) -- UUID del usuario o 'not_assigned'
- shelly_device_id (TEXT, unique) -- El CUPS
- device_name (TEXT)
- device_type (TEXT) -- 'SHELLY_SHELLYEM'
- ...
```

### **Operaciones de Base de Datos**
1. **Verificar device existente** por CUPS
2. **Crear device** si no existe
3. **Actualizar user_id** del device
4. **Actualizar cups** del usuario
5. **Verificar duplicados** como medida de seguridad

## **Testing**

### **Script de Pruebas**
```bash
# Ejecutar todas las pruebas
node test_cups_assignment.js
```

### **Pruebas Incluidas**
1. ✅ Usuario normal se asigna CUPS
2. ✅ Usuario normal intenta asignar CUPS ya ocupado (ERROR)
3. ✅ Admin reasigna CUPS a otro usuario
4. ✅ Consultar información de CUPS
5. ✅ Usuario normal intenta ver CUPS de otro usuario (ERROR)
6. ✅ Admin lista todos los CUPS
7. ✅ Usuario normal intenta listar CUPS (ERROR)
8. ✅ Admin desasigna CUPS

## **Documentación Swagger**

La documentación completa está disponible en:
```
http://localhost:3000/api-docs
```

**Secciones relevantes:**
- **CUPS Management**: Todos los endpoints de gestión de CUPS
- **Schemas**: Definiciones de request/response
- **Examples**: Ejemplos de uso para cada endpoint

## **Integración con el Sistema**

### **Servicios Relacionados**
- **AuthService**: Autenticación y autorización
- **User Model**: Gestión de usuarios
- **Database Utils**: Conexión y transacciones

### **MQTT Integration**
Los devices CUPS creados automáticamente estarán disponibles para:
- Recibir datos de consumo/generación vía MQTT
- Aparecer en dashboards de usuario
- Generar reportes energéticos

## **Monitoreo y Logs**

### **Eventos Loggeados**
- Asignación exitosa de CUPS
- Reasignación de CUPS (con usuario anterior)
- Creación de nuevos devices
- Errores de validación y autorización

### **Métricas**
- Número de CUPS asignados/desasignados
- Operaciones por usuario/admin
- Errores por tipo

## **Próximas Mejoras**

### **Funcionalidades Futuras**
- **Historial de asignaciones**: Tracking de cambios
- **Validación de formato CUPS**: Validación específica española
- **Notificaciones**: Email al asignar/reasignar CUPS
- **Bulk operations**: Asignación masiva de CUPS

### **Optimizaciones**
- **Cache de metadatos**: Cache de información de devices
- **Índices de base de datos**: Optimización de consultas
- **Rate limiting específico**: Límites por operación

## **Soporte**

Para soporte técnico:
- **Logs**: Revisar logs del servidor para debugging
- **Health Check**: `/health` para verificar estado del sistema
- **Swagger**: `/api-docs` para documentación interactiva
- **Tests**: Ejecutar `test_cups_assignment.js` para verificar funcionalidad
