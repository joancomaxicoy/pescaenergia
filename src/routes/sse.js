const express = require('express');
const logger = require('../utils/logger');
const authService = require('../services/authService');
const mqttServiceRegistry = require('../services/mqtt/mqttServiceRegistry');
const PlugsService = require('../services/plugsService');

const router = express.Router();

// Middleware SOLO autentica. NO toca cabeceras SSE.
const authenticateSSE = (req, res, next) => {
  try {
    const token = req.query.token;
    if (!token) return res.status(401).send('Token de acceso requerido');

    const decoded = authService.verifyJWT(token);
    req.user = {
      userId: decoded.userId,
      email: decoded.email,
      role: decoded.role,
      emailValidated: decoded.emailValidated
    };

    if (!req.user.emailValidated) {
      return res.status(403).send('Debes verificar tu email para acceder a este recurso');
    }

    next();
  } catch (error) {
    logger.error('Error en autenticación SSE:', error);
    return res.status(401).send('Token inválido o expirado');
  }
};

router.get('/time', authenticateSSE, (req, res) => {
  logger.info('SSE: usuario autenticado', { email: req.user.email });

  // Cabeceras del stream (una sola vez)
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform'); // importante con Cloudflare
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*'); // ajusta si usas credenciales
  res.setHeader('X-Accel-Buffering', 'no'); // útil si hay Nginx por medio
  res.flushHeaders?.();

  // Política de reintento del EventSource
  res.write(`retry: 5000\n`);

  // Heartbeat para que el proxy no cierre por inactividad
  const heartbeat = setInterval(() => {
    res.write(`: ping\n\n`);
  }, 15000);

  // Emitir hora cada segundo
  const tick = setInterval(() => {
    const now = new Date().toISOString();
    // opcional: id para reanudación con Last-Event-ID
    // res.write(`id: ${Date.now()}\n`);
    // res.write(`event: time\n`);
    res.write(`data: ${JSON.stringify({ now })}\n\n`);
  }, 1000);

  const cleanup = () => {
    clearInterval(heartbeat);
    clearInterval(tick);
    res.end();
  };

  req.on('close', cleanup);
  req.on('error', (e) => { logger.error('SSE req error', e); cleanup(); });
  res.on('close', () => { logger.info('SSE cerrado', { userId: req.user.userId }); });
});

// Endpoint de test SIN auth (mismas cabeceras/heartbeats)
router.get('/test', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  res.write(`retry: 5000\n`);

  const heartbeat = setInterval(() => res.write(`: ping\n\n`), 15000);
  const tick = setInterval(() => {
    res.write(`data: ${JSON.stringify({ test: new Date().toISOString() })}\n\n`);
  }, 1000);

  const cleanup = () => { clearInterval(heartbeat); clearInterval(tick); res.end(); };
  req.on('close', cleanup);
  req.on('error', cleanup);
});

// Endpoint para streaming de mensajes MQTT filtrados por dispositivos PLUG del usuario
router.get('/plugs', authenticateSSE, async (req, res) => {
  logger.info('SSE Plugs: usuario autenticado', { email: req.user.email });

  try {
    // Verificar que el servicio MQTT esté disponible
    const mqttDataService = mqttServiceRegistry.getMqttDataService();
    if (!mqttDataService || !mqttDataService.mqttService) {
      logger.error('SSE Plugs: Servicio MQTT no disponible');
      return res.status(503).send('Servicio MQTT no disponible');
    }

    // Obtener los dispositivos PLUG del usuario
    const plugsService = new PlugsService();
    const userPlugs = await plugsService.getUserPlugs(req.user.userId);
    
    if (userPlugs.length === 0) {
      logger.info('SSE Plugs: Usuario no tiene dispositivos PLUG', {
        userId: req.user.userId,
        email: req.user.email
      });
      return res.status(404).send('No tienes dispositivos PLUG asignados');
    }

    // Crear conjunto de shelly_device_ids del usuario para filtrado rápido
    const userShellyDeviceIds = new Set(userPlugs.map(plug => plug.shelly_device_id));
    
    logger.info('SSE Plugs: Dispositivos PLUG del usuario obtenidos', {
      userId: req.user.userId,
      email: req.user.email,
      plugsCount: userPlugs.length,
      shellyDeviceIds: Array.from(userShellyDeviceIds)
    });

    // Cabeceras del stream SSE
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    // Política de reintento del EventSource
    res.write(`retry: 5000\n`);

    // Heartbeat para mantener la conexión activa
    const heartbeat = setInterval(() => {
      res.write(`: ping\n\n`);
    }, 15000);

    // Handler para procesar mensajes MQTT con filtrado
    const mqttMessageHandler = (messageData) => {
      try {
        // Filtrar solo mensajes que empiecen con los shelly_device_id del usuario
        const isUserDevice = Array.from(userShellyDeviceIds).some(shellyId => 
          messageData.topic.startsWith(shellyId)
        );

        if (!isUserDevice) {
          // No es un dispositivo del usuario, omitir silenciosamente
          return;
        }

        // Enviar el mensaje MQTT filtrado al cliente SSE
        const sseData = {
          topic: messageData.topic,
          payload: messageData.payload,
          timestamp: messageData.timestamp,
          receivedAt: messageData.receivedAt
        };

        res.write(`data: ${JSON.stringify(sseData)}\n\n`);
        
        logger.debug('Mensaje MQTT filtrado enviado via SSE', {
          topic: messageData.topic,
          userId: req.user.userId,
          payloadSize: messageData.payload.length,
          matchedDevice: Array.from(userShellyDeviceIds).find(shellyId => 
            messageData.topic.startsWith(shellyId)
          )
        });
      } catch (error) {
        logger.error('Error enviando mensaje MQTT filtrado via SSE:', {
          error: error.message,
          topic: messageData.topic,
          userId: req.user.userId
        });
      }
    };

    // Registrar el handler en el servicio MQTT
    mqttDataService.mqttService.addMessageHandler(mqttMessageHandler);
    
    logger.info('SSE Plugs: Handler MQTT filtrado registrado', {
      userId: req.user.userId,
      email: req.user.email,
      filterDevices: Array.from(userShellyDeviceIds)
    });

    // Función de limpieza
    const cleanup = () => {
      // Remover el handler del servicio MQTT
      if (mqttDataService && mqttDataService.mqttService) {
        mqttDataService.mqttService.removeMessageHandler(mqttMessageHandler);
        logger.info('SSE Plugs: Handler MQTT filtrado removido', {
          userId: req.user.userId
        });
      }
      
      // Limpiar intervalos
      clearInterval(heartbeat);
      
      // Cerrar la respuesta
      res.end();
    };

    // Configurar eventos de limpieza
    req.on('close', cleanup);
    req.on('error', (error) => {
      logger.error('SSE Plugs: Error en request', {
        error: error.message,
        userId: req.user.userId
      });
      cleanup();
    });
    
    res.on('close', () => {
      logger.info('SSE Plugs: Conexión cerrada', {
        userId: req.user.userId
      });
    });

    // Enviar mensaje inicial de confirmación con información de dispositivos
    res.write(`data: ${JSON.stringify({
      type: 'connection_established',
      message: 'Conectado al stream de mensajes MQTT filtrado por tus dispositivos PLUG',
      timestamp: new Date().toISOString(),
      userId: req.user.userId,
      userPlugs: userPlugs.map(plug => ({
        id: plug.id,
        name: plug.device_name,
        shellyDeviceId: plug.shelly_device_id
      })),
      filterCount: userPlugs.length
    })}\n\n`);

  } catch (error) {
    logger.error('SSE Plugs: Error inicializando endpoint', {
      error: error.message,
      userId: req.user.userId,
      email: req.user.email
    });
    return res.status(500).send(`Error inicializando stream: ${error.message}`);
  }
});

// Endpoint per a streaming de dades de la piscina en temps real
router.get('/pool', authenticateSSE, async (req, res) => {
  logger.info('SSE Pool: usuari autenticat', { email: req.user.email });

  try {
    const PoolService = require('../services/poolService');
    const poolService = new PoolService();

    // Obtener dispositiu de piscina de l'usuari
    const device = await poolService.findUserPoolDevice(req.user.userId);
    if (!device) {
      return res.status(404).send('No tens cap dispositiu de piscina assignat');
    }

    const poolDeviceId = device.shelly_device_id;
    const mqttDataService = mqttServiceRegistry.getMqttDataService();
    if (!mqttDataService || !mqttDataService.mqttService) {
      logger.error('SSE Pool: Servei MQTT no disponible');
      return res.status(503).send('Servei MQTT no disponible');
    }

    logger.info('SSE Pool: Dispositiu de piscina trobat', {
      userId: req.user.userId,
      poolDeviceId
    });

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    res.write(`retry: 5000\n`);

    const heartbeat = setInterval(() => {
      res.write(`: ping\n\n`);
    }, 15000);

        // Extreure el CUPS del shelly_device_id per filtrar topics MQTT
        const cups = poolDeviceId.split('/')[1] || '';

        const mqttMessageHandler = (messageData) => {
            try {
                // Filtrar topics de la bomba depuradora
                if (!messageData.topic.includes('BombaDepuradora')) {
                    return;
                }
                if (!messageData.topic.includes(cups.trim())) {
                    return;
                }

        const sseData = {
          topic: messageData.topic,
          payload: messageData.payload,
          timestamp: messageData.timestamp,
          receivedAt: messageData.receivedAt
        };

        res.write(`data: ${JSON.stringify(sseData)}\n\n`);

        logger.debug('Missatge MQTT de piscina enviat via SSE', {
          topic: messageData.topic,
          userId: req.user.userId
        });
      } catch (error) {
        logger.error('Error enviant missatge MQTT de piscina via SSE:', {
          error: error.message,
          topic: messageData.topic
        });
      }
    };

    mqttDataService.mqttService.addMessageHandler(mqttMessageHandler);

    logger.info('SSE Pool: Handler MQTT filtrat registrat', {
      userId: req.user.userId,
      poolDeviceId,
      cups
    });

    const cleanup = () => {
      if (mqttDataService && mqttDataService.mqttService) {
        mqttDataService.mqttService.removeMessageHandler(mqttMessageHandler);
        logger.info('SSE Pool: Handler MQTT filtrat remogut', {
          userId: req.user.userId
        });
      }
      clearInterval(heartbeat);
      res.end();
    };

    req.on('close', cleanup);
    req.on('error', (error) => {
      logger.error('SSE Pool: Error en request', {
        error: error.message,
        userId: req.user.userId
      });
      cleanup();
    });

    res.on('close', () => {
      logger.info('SSE Pool: Connexió tancada', {
        userId: req.user.userId
      });
    });

    res.write(`data: ${JSON.stringify({
      type: 'connection_established',
      message: 'Connectat al stream de dades de la piscina',
      timestamp: new Date().toISOString(),
      userId: req.user.userId,
      poolDeviceId
    })}\n\n`);

  } catch (error) {
    logger.error('SSE Pool: Error inicialitzant endpoint', {
      error: error.message,
      userId: req.user.userId,
      email: req.user.email
    });
    return res.status(500).send(`Error inicialitzant stream: ${error.message}`);
  }
});

module.exports = router;
