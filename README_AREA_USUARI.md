# Área de Usuario - PescaEnergia

Este documento describe la implementación del área de usuario completa con frontend en Handlebars para la plataforma PescaEnergia.

## 🎯 Funcionalidades Implementadas

### ✅ Sistema de Autenticación
- **Login/Registro tradicional** con email y contraseña
- **Autenticación con Google OAuth** 
- **Verificación de email** obligatoria
- **Reset de contraseña** con enlaces seguros
- **Gestión de sesiones** con JWT y cookies

### ✅ Flujo de Usuario Completo
1. **Acceso a `/area-usuari`** → Redirige según estado del usuario
2. **Login/Registro** → Formularios con validación en tiempo real
3. **Verificación de email** → Página de espera y reenvío
4. **Asignación de CUPS** → Obligatoria para acceder al dashboard
5. **Dashboard** → Área principal (vacía, preparada para futuras funcionalidades)

### ✅ Diseño y UX
- **Guía de estilos PescaEnergia** aplicada consistentemente
- **Responsive design** para móviles y tablets
- **Interfaz en catalán** siguiendo la identidad de marca
- **Animaciones y transiciones** suaves
- **Estados de carga** y feedback visual

## 🏗️ Arquitectura Técnica

### Frontend (Handlebars)
```
src/templates/
├── layouts/
│   └── main.hbs              # Layout principal
├── pages/
│   ├── login.hbs             # Login/Registro
│   ├── cups-assignment.hbs   # Asignación de CUPS
│   ├── dashboard.hbs         # Dashboard principal
│   ├── email-verified.hbs    # Confirmación de email
│   ├── password-reset.hbs    # Reset de contraseña
│   └── 404.hbs              # Página de error
└── partials/
    └── navbar.hbs            # Barra de navegación
```

### Archivos Estáticos
```
src/public/
├── css/
│   └── styles.css           # Estilos siguiendo guía de marca
├── js/
│   ├── auth.js             # Lógica de autenticación
│   └── dashboard.js        # Funcionalidad del dashboard
└── images/
    └── pescaenergia-logo.png
```

### Backend (Express + Handlebars)
```
src/routes/
└── frontend.js              # Rutas para servir páginas

src/app.js                   # Configuración de Handlebars y archivos estáticos
```

## 🎨 Guía de Estilos Aplicada

### Colores
- **Principal**: `#1b4444` (azul petróleo)
- **Fondo**: `#fdf1eb` (beige claro)  
- **Acento**: `#fcbd25` (amarillo sol)
- **Verde**: `#459f49` (elementos de éxito)

### Tipografía
- **Fuente**: Poppins (Google Fonts)
- **Pesos**: Regular, Medium, SemiBold, Bold

### Componentes
- **Botones** con hover effects y estados de carga
- **Formularios** con validación visual
- **Alertas** contextuales (éxito, error, advertencia)
- **Modales** para perfil de usuario

## 🔐 Seguridad Implementada

### Autenticación
- **JWT tokens** con expiración configurable
- **Refresh tokens** para renovación automática
- **Cookies seguras** con SameSite=Strict
- **Rate limiting** en formularios de autenticación

### Validación
- **Frontend**: Validación en tiempo real con JavaScript
- **Backend**: Validación con express-validator
- **Sanitización** de inputs para prevenir XSS

### Headers de Seguridad
- **Content Security Policy** configurada para Google APIs
- **Helmet.js** para headers de seguridad adicionales

## 🚀 Rutas Implementadas

### Área de Usuario
- `GET /area-usuari` → Redirige según estado del usuario
- `GET /area-usuari/login` → Página de login/registro
- `GET /area-usuari/assignar-cups` → Asignación de CUPS
- `GET /area-usuari/dashboard` → Dashboard principal
- `POST /area-usuari/logout` → Cerrar sesión

### Verificación y Reset
- `GET /area-usuari/verificar/:token` → Verificar email
- `GET /area-usuari/reset-password/:token` → Reset de contraseña

## 🔄 Flujo de Usuario Detallado

### 1. Acceso Inicial
```
Usuario accede a /area-usuari
    ↓
¿Está autenticado?
    ├─ NO → Redirige a /login
    └─ SÍ → ¿Email verificado?
        ├─ NO → Página de verificación
        └─ SÍ → ¿Tiene CUPS?
            ├─ NO → /assignar-cups
            └─ SÍ → /dashboard
```

### 2. Proceso de Registro
```
Usuario completa formulario
    ↓
Validación frontend + backend
    ↓
Crear usuario en BD
    ↓
Enviar email de verificación
    ↓
Mostrar página de espera
```

### 3. Asignación de CUPS
```
Usuario introduce CUPS
    ↓
Validación formato CUPS
    ↓
Llamada a API /api/cups/assign
    ↓
Actualizar usuario en BD
    ↓
Redirigir a dashboard
```

## 🛠️ Configuración Requerida

### Variables de Entorno
```bash
# Google OAuth (opcional)
GOOGLE_CLIENT_ID=your_google_client_id

# JWT
JWT_SECRET=
JWT_EXPIRES_IN=24h
REFRESH_TOKEN_EXPIRES_IN=7d

# Email (para verificación)
# ... configuración de email existente
```

### Dependencias Añadidas
```json
{
  "express-handlebars": "^7.x.x",
  "cookie-parser": "^1.x.x"
}
```

## 📱 Responsive Design

### Breakpoints
- **Desktop**: > 768px
- **Tablet**: 481px - 768px  
- **Mobile**: ≤ 480px

### Adaptaciones Móviles
- **Navbar** compacta
- **Formularios** optimizados para touch
- **Botones** con tamaño mínimo de 44px
- **Texto** escalado apropiadamente

## 🔮 Preparado para el Futuro

### Dashboard Extensible
El dashboard actual está preparado para añadir:
- **Gráficos de consumo** energético
- **Datos en tiempo real** de dispositivos
- **Controles de automatización**
- **Históricos** y reportes

### Estructura Modular
- **JavaScript** organizado en clases reutilizables
- **CSS** con variables para fácil personalización
- **Handlebars helpers** para formateo de datos
- **API endpoints** ya integrados

## 🧪 Testing

### Rutas de Prueba
1. **Login**: Crear usuario y probar autenticación
2. **Google OAuth**: Configurar client ID y probar
3. **CUPS**: Usar formato válido (ej: ES0031446450479001ZC0F)
4. **Email**: Verificar envío de emails de verificación

### Casos de Uso
- ✅ Usuario nuevo se registra
- ✅ Usuario existente hace login
- ✅ Usuario sin email verificado
- ✅ Usuario sin CUPS asignado
- ✅ Usuario completo accede al dashboard
- ✅ Reset de contraseña funcional
- ✅ Logout y limpieza de sesión

## 📞 Soporte

Para cualquier duda sobre la implementación del área de usuario, consultar:
- **Código fuente**: `src/routes/frontend.js`
- **Plantillas**: `src/templates/pages/`
- **Estilos**: `src/public/css/styles.css`
- **JavaScript**: `src/public/js/auth.js`
