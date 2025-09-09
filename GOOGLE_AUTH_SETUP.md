# Configuración de Google OAuth para PescaEnergia

## Problema Actual

El error de CORS que estás viendo:
```
The fetch of the id assertion endpoint resulted in a network error: ERR_FAILED
Server did not send the correct CORS headers.
```

Indica que el dominio desde el que se ejecuta la aplicación no está autorizado en Google Console.

## Solución: Configurar Google Console

### 1. Acceder a Google Cloud Console

1. Ve a [Google Cloud Console](https://console.cloud.google.com/)
2. Selecciona tu proyecto o crea uno nuevo
3. Ve a "APIs y servicios" > "Credenciales"

### 2. Configurar el Cliente OAuth 2.0

1. Busca tu Client ID: `236277629490-hn55rjojlnbsmr2se7nk8do7dsi561e7.apps.googleusercontent.com`
2. Haz clic en el icono de editar (lápiz)
3. En la sección "Orígenes de JavaScript autorizados", añade:

**Para desarrollo local:**
```
http://localhost:3000
http://127.0.0.1:3000
```

**Para producción (cuando tengas el dominio):**
```
https://tu-dominio.com
https://www.tu-dominio.com
```

### 3. Configurar URIs de Redirección

En "URIs de redirección autorizados", añade:

**Para desarrollo:**
```
http://localhost:3000/area-usuari/login
http://localhost:3000/api/auth/google/callback
```

**Para producción:**
```
https://tu-dominio.com/area-usuari/login
https://tu-dominio.com/api/auth/google/callback
```

### 4. Verificar la Configuración

1. Guarda los cambios
2. Espera unos minutos para que se propaguen los cambios
3. Recarga la página de login
4. Prueba el botón "Continuar amb Google"

## Configuración Actual del Código

El código ya está correctamente configurado:

✅ **CSP actualizado** - Permite todos los dominios de Google necesarios
✅ **Client ID configurado** - Se lee correctamente del .env
✅ **Timing solucionado** - Espera a que Google Auth se cargue
✅ **Manejo de errores mejorado** - Logging detallado y mensajes claros
✅ **Validación simplificada** - No requiere emailVerified estricto
✅ **Flujo de autenticación robusto** - Maneja todos los casos edge

## Verificación Post-Configuración

Una vez configurado Google Console, deberías ver en la consola:

```
Esperando Google Sign-In library... intento 1/20
Google Sign-In library cargada correctamente
Google Client ID encontrado: 236277629490-hn55rjo...
Google Auth inicializado correctamente
```

Y al hacer clic en "Continuar amb Google":
- Se abre el popup de Google
- El usuario se autentica
- Se cierra el popup
- El usuario es redirigido según tenga o no CUPS asignado

## Dominios Recomendados para Añadir

**Desarrollo:**
- `http://localhost:3000`
- `http://127.0.0.1:3000`
- `http://localhost:8080` (si usas otro puerto)

**Producción:**
- Tu dominio principal
- Subdominios si los usas (www, app, etc.)

## Notas Importantes

1. **Los cambios en Google Console pueden tardar hasta 5 minutos** en propagarse
2. **Usa HTTPS en producción** - Google requiere HTTPS para dominios públicos
3. **Verifica que el Client ID sea correcto** en el .env
4. **Los dominios deben coincidir exactamente** - incluyendo protocolo y puerto

## Troubleshooting

Si sigues teniendo problemas:

1. **Verifica la consola del navegador** para errores específicos
2. **Comprueba que el dominio esté exactamente como aparece en la barra de direcciones**
3. **Prueba en modo incógnito** para evitar problemas de caché
4. **Verifica que el proyecto de Google Cloud esté activo**

Una vez configurado correctamente, el login con Google debería funcionar perfectamente.
