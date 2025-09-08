# Sistema de Autenticación - PescaEnergia Backend

Este documento describe el sistema de autenticación implementado en el backend de PescaEnergia.

## Características Principales

- ✅ Registro de usuarios con verificación de email
- ✅ Login con email/contraseña y Google OAuth
- ✅ JWT tokens con refresh tokens
- ✅ Sistema de roles (admin/user)
- ✅ Reset de contraseñas
- ✅ Plantillas de email responsivas
- ✅ Rate limiting y validaciones robustas
- ✅ Middleware de autenticación y autorización

## Estructura del Sistema

### Modelos
- **User**: Modelo principal de usuario con métodos para autenticación

### Servicios
- **authService**: Lógica principal de autenticación
- **emailService**: Envío de emails con plantillas
- **googleAuthService**: Integración con Google OAuth

### Middleware
- **auth**: Verificación de tokens y autorización
- **validation**: Validación de datos de entrada

### Rutas
- **auth**: Endpoints de autenticación (`/api/auth/*`)

## Endpoints Disponibles

### Registro y Login
- `POST /api/auth/register` - Registrar nuevo usuario
- `POST /api/auth/login` - Login con email/contraseña
- `POST /api/auth/google` - Login con Google

### Verificación de Email
- `POST /api/auth/verify-email` - Verificar email con token
- `POST /api/auth/resend-verification` - Reenviar verificación

### Reset de Contraseña
- `POST /api/auth/forgot-password` - Solicitar reset
- `POST /api/auth/reset-password` - Restablecer contraseña

### Gestión de Tokens
- `POST /api/auth/refresh-token` - Renovar access token

### Perfil de Usuario
- `GET /api/auth/profile` - Obtener perfil (requiere auth)
- `PUT /api/auth/profile` - Actualizar perfil (requiere auth)
- `POST /api/auth/change-password` - Cambiar contraseña (requiere auth)

### Desarrollo
- `POST /api/auth/test-email` - Enviar email de prueba (solo desarrollo)

## Configuración

### Variables de Entorno

```env
# JWT Configuration
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production
JWT_EXPIRES_IN=24h
REFRESH_TOKEN_EXPIRES_IN=7d

# SMTP Configuration
SMTP_SERVER=sandbox.smtp.mailtrap.io
SMTP_PORT=2525
SMTP_USER=your_smtp_user
SMTP_PASSWORD=your_smtp_password

# Google OAuth
GOOGLE_CLIENT_ID=your_google_client_id

# Frontend URL
FRONTEND_URL=http://localhost:3001
```

### Base de Datos

El sistema utiliza PostgreSQL con las siguientes tablas:

#### Tabla `users`
```sql
- id (UUID, PK)
- cups (TEXT, nullable para admins)
- email (TEXT, unique)
- name (TEXT)
- password_hash (TEXT, nullable para usuarios de Google)
- role (ENUM: admin, user)
- google_id (TEXT, unique, nullable)
- email_validated (BOOLEAN)
- email_verification_token (TEXT)
- email_verification_expires (TIMESTAMPTZ)
- password_reset_token (TEXT)
- password_reset_expires (TIMESTAMPTZ)
- created_at (TIMESTAMPTZ)
- updated_at (TIMESTAMPTZ)
```

## Administradores

### Crear Administradores

Los administradores se crean usando el seeder:

```bash
# Crear administradores
npm run seed:admin

# Listar administradores existentes
npm run seed:admin:list

# Eliminar administradores (rollback)
npm run seed:admin:rollback
```

### Administradores por Defecto

El seeder crea estos administradores:

1. **admin@pescaenergia.com** - Administrador Principal
2. **eugeni@pescaenergia.com** - Eugeni Selma
3. **soporte@pescaenergia.com** - Soporte Técnico

**Contraseñas por defecto**: Consultar `src/seeders/adminSeeder.js`

## Flujo de Registro de Usuario

1. Usuario se registra con email, nombre y contraseña
2. Sistema crea usuario con `email_validated = false`
3. Se envía email de verificación
4. Usuario hace clic en el enlace del email
5. Sistema verifica el token y marca `email_validated = true`
6. Se envía email de bienvenida
7. Usuario puede hacer login

## Flujo de Login con Google

1. Frontend obtiene ID token de Google
2. Backend verifica el token con Google API
3. Si el usuario no existe, se crea automáticamente
4. Se marca `email_validated = true` (Google ya verificó)
5. Se generan JWT tokens
6. Se envía email de bienvenida (solo nuevos usuarios)

## Seguridad

### Rate Limiting
- Login/Google: 5 intentos por 15 minutos
- Registro: 3 intentos por hora
- Reset password: 3 intentos por hora

### Validaciones
- Email válido y único
- Contraseña mínimo 8 caracteres con mayúscula, minúscula y número
- CUPS formato español válido (para usuarios normales)
- Sanitización de inputs para prevenir XSS

### JWT Tokens
- Access token: 24 horas de duración
- Refresh token: 7 días de duración
- Firmados con secret configurable
- Incluyen información del usuario y rol

## Plantillas de Email

Las plantillas están en `src/templates/` y usan Handlebars:

- **email-verification.hbs**: Verificación de email
- **password-reset.hbs**: Reset de contraseña
- **welcome.hbs**: Bienvenida tras verificación

### Características de las Plantillas
- Diseño responsivo
- Fuente Poppins
- Colores de la marca PescaEnergia
- Logo incluido como attachment
- Enlaces de fallback para clientes que no soportan botones

## Middleware de Autenticación

### `authenticateToken`
Verifica que el request incluya un JWT válido.

```javascript
// Uso en rutas protegidas
router.get('/protected', authenticateToken, (req, res) => {
  // req.user contiene la información del usuario
});
```

### `requireEmailValidation`
Verifica que el usuario haya validado su email.

### `requireRole(roles)`
Verifica que el usuario tenga uno de los roles especificados.

```javascript
// Solo admins
router.get('/admin-only', authenticateToken, requireRole('admin'), handler);

// Admins o users
router.get('/users', authenticateToken, requireRole(['admin', 'user']), handler);
```

### `requireOwnershipOrAdmin`
Permite acceso si el usuario es admin o está accediendo a sus propios datos.

## Testing

### Test de Email
```bash
curl -X POST http://localhost:3000/api/auth/test-email \
  -H "Content-Type: application/json" \
  -d '{"email": "test@example.com"}'
```

### Test de Registro
```bash
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "usuario@example.com",
    "name": "Usuario Test",
    "password": "Password123"
  }'
```

### Test de Login
```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@pescaenergia.com",
    "password": "Admin123!"
  }'
```

## Documentación API

La documentación completa de la API está disponible en Swagger:
- **URL**: `http://localhost:3000/api-docs`
- **JSON**: `http://localhost:3000/api-docs.json`

## Troubleshooting

### Error: "Email no verificado"
- El usuario debe verificar su email antes de hacer login
- Usar `/api/auth/resend-verification` para reenviar

### Error: "Token inválido"
- Verificar que el JWT_SECRET sea correcto
- Verificar que el token no haya expirado
- Usar `/api/auth/refresh-token` para renovar

### Error: "CUPS inválido"
- Solo para usuarios normales (no admins)
- Formato: ES + 18 dígitos + 2 letras + 2 dígitos + 1 letra

### Error de conexión SMTP
- Verificar configuración en .env
- Para desarrollo, usar Mailtrap o similar
- Para producción, configurar SMTP real

## Próximas Mejoras

- [ ] Autenticación de dos factores (2FA)
- [ ] Sesiones persistentes
- [ ] Audit log de acciones de usuarios
- [ ] Bloqueo de cuentas tras intentos fallidos
- [ ] Integración con más proveedores OAuth
- [ ] Notificaciones push
