# Sistema de Registro por Administrador

Este documento describe la implementación del nuevo sistema de registro de usuarios por parte de administradores en la plataforma PescaEnergía.

## 📋 Resumen de Funcionalidades

### Nuevo Endpoint de Registro
- **Ruta**: `POST /api/admin/register`
- **Permisos**: Solo administradores autenticados
- **Función**: Crear usuarios con CUPS pre-asignado y password temporal

### Flujo de Activación Secuencial
1. **Verificación de Email**: El usuario recibe un email de activación
2. **Validación de Password**: Si tiene password temporal, debe establecer una nueva
3. **Validación de CUPS**: Si no tiene CUPS, debe asignarlo (ya resuelto para usuarios creados por admin)
4. **Login Normal**: Una vez completadas las validaciones, puede hacer login

## 🔧 Implementación Técnica

### 1. Endpoint de Registro por Admin

**Archivo**: `src/routes/admin.js`

```javascript
POST /api/admin/register
```

**Campos requeridos**:
- `name`: Nombre del usuario
- `email`: Email del usuario
- `cups`: CUPS a asignar

**Funcionalidades**:
- Validación de permisos de admin
- Verificación de email único
- Verificación de CUPS disponible
- Creación de usuario con password temporal (`tmp-` + hash)
- Creación automática del device asociado al CUPS
- Envío de email de activación

### 2. Modificaciones en AuthService

**Archivo**: `src/services/authService.js`

#### Método `verifyEmail()` actualizado:
- Determina el siguiente paso en el flujo (`SET_PASSWORD`, `ASSIGN_CUPS`, `LOGIN_READY`)
- Retorna `nextStep` en la respuesta

#### Método `login()` actualizado:
- Detecta passwords temporales (que empiezan por `tmp-`)
- Valida que el usuario tenga CUPS asignado (solo para usuarios normales, no admins)
- Retorna códigos de error específicos:
  - `PASSWORD_NOT_SET`: Necesita establecer password
  - `CUPS_NOT_ASSIGNED`: Necesita asignar CUPS (solo usuarios normales)

#### Nuevo método `setInitialPassword()`:
- Permite establecer password inicial usando token de verificación
- Valida que el usuario tenga password temporal
- Genera tokens de acceso para login automático

### 3. Nuevo Endpoint de Password Inicial

**Archivo**: `src/routes/auth.js`

```javascript
POST /api/auth/set-initial-password
```

**Campos requeridos**:
- `token`: Token de verificación de email
- `password`: Nueva password (mínimo 8 caracteres)

**Funcionalidades**:
- Validación del token de verificación
- Verificación de que el usuario tenga password temporal
- Establecimiento de nueva password
- Login automático tras establecer password

### 4. Códigos de Error Actualizados

**En el endpoint de login**:
- `EMAIL_NOT_VERIFIED`: Email no verificado
- `PASSWORD_NOT_SET`: Password temporal, necesita establecer password
- `CUPS_NOT_ASSIGNED`: No tiene CUPS asignado
- `INVALID_CREDENTIALS`: Credenciales incorrectas

## 🔄 Flujo Completo

### Para Administradores

1. **Crear Usuario**:
   ```bash
   POST /api/admin/register
   {
     "name": "Juan Pérez",
     "email": "juan@example.com", 
     "cups": "ES0031446450479001ZC0F"
   }
   ```

2. **Sistema automáticamente**:
   - Crea usuario con `email_validated: false`
   - Asigna password temporal (`tmp-` + hash)
   - Asigna CUPS proporcionado
   - Crea device asociado al CUPS
   - Envía email de activación

### Para Usuarios Creados por Admin

1. **Activación de Email**:
   - Usuario hace clic en link del email
   - `POST /api/auth/verify-email` con token
   - Respuesta incluye `nextStep: "SET_PASSWORD"`

2. **Establecer Password**:
   - Usuario accede a formulario de password
   - `POST /api/auth/set-initial-password` con token y password
   - Sistema genera tokens de acceso automáticamente

3. **Login Normal**:
   - Usuario puede hacer login con email y password
   - Todas las validaciones están completas

## 🧪 Pruebas

### Script de Prueba
**Archivo**: `test_admin_register_flow.js`

Ejecutar con:
```bash
node test_admin_register_flow.js
```

El script prueba:
- Login de admin
- Creación de usuario por admin
- Simulación del flujo de verificación
- Validaciones de login

### Pruebas Manuales

1. **Crear usuario como admin**:
   ```bash
   curl -X POST http://localhost:3000/api/admin/register \
     -H "Authorization: Bearer <admin-token>" \
     -H "Content-Type: application/json" \
     -d '{
       "name": "Test User",
       "email": "test@example.com",
       "cups": "ES0031446450479001ZC0F"
     }'
   ```

2. **Verificar email** (necesita token real de BD):
   ```bash
   curl -X POST http://localhost:3000/api/auth/verify-email \
     -H "Content-Type: application/json" \
     -d '{"token": "<verification-token>"}'
   ```

3. **Establecer password inicial**:
   ```bash
   curl -X POST http://localhost:3000/api/auth/set-initial-password \
     -H "Content-Type: application/json" \
     -d '{
       "token": "<verification-token>",
       "password": "newpassword123"
     }'
   ```

## 📊 Base de Datos

### Cambios en la Tabla `users`
- Campo `password_hash` puede contener passwords temporales con prefijo `tmp-`
- Campo `cups` se asigna directamente durante la creación por admin

### Tabla `devices`
- Se crea automáticamente un device tipo `SHELLY_SHELLYEM` para cada CUPS asignado
- El device se asocia directamente al usuario creado

## 🔒 Seguridad

### Validaciones Implementadas
- **Permisos de Admin**: Solo usuarios con rol `admin` pueden crear usuarios
- **Email Único**: Verificación de que el email no exista
- **CUPS Único**: Verificación de que el CUPS no esté asignado
- **Password Temporal**: Sistema de passwords temporales seguras
- **Tokens de Verificación**: Uso de tokens criptográficos para verificación

### Rate Limiting
- Endpoint de registro usa los mismos límites que otros endpoints de admin
- Endpoint de password inicial sin rate limiting específico (usa token único)

## 📝 Documentación API

### Swagger/OpenAPI
Toda la documentación está incluida en los comentarios JSDoc de los endpoints:
- `/api/admin/register`
- `/api/auth/set-initial-password`
- Códigos de error actualizados en `/api/auth/login`

## 🚀 Próximos Pasos

### Frontend
El frontend necesitará manejar:
1. **Formulario de registro por admin** (panel de administración)
2. **Página de establecer password inicial** (para usuarios nuevos)
3. **Manejo de códigos de error** en login:
   - Redirección a verificación de email
   - Redirección a establecer password
   - Redirección a asignar CUPS

### Mejoras Futuras
1. **Notificaciones**: Sistema de notificaciones para admins sobre usuarios creados
2. **Bulk Import**: Importación masiva de usuarios desde CSV
3. **Templates de Email**: Templates personalizados para usuarios creados por admin
4. **Auditoría**: Log detallado de acciones de administradores

## 🐛 Troubleshooting

### Errores Comunes

1. **"Ya existe un usuario con este email"**
   - Verificar que el email no esté registrado
   - Usar endpoint `/api/admin/users` para verificar usuarios existentes

2. **"Este CUPS ya está asignado"**
   - Verificar disponibilidad del CUPS
   - Usar endpoint `/api/admin/devices` para ver asignaciones

3. **"Token inválido o expirado"**
   - Los tokens de verificación expiran en 24 horas
   - Generar nuevo token si es necesario

4. **"Password temporal no detectada"**
   - Verificar que el password_hash empiece por `tmp-`
   - Revisar logs del servidor para detalles

### Logs Importantes
- Creación de usuarios por admin
- Verificación de emails
- Establecimiento de passwords iniciales
- Errores de validación en login

## 📞 Soporte

Para problemas con la implementación:
1. Revisar logs del servidor
2. Ejecutar script de prueba
3. Verificar configuración de base de datos
4. Comprobar permisos de usuario admin
