const mqtt = require('mqtt');
const logger = require('../../utils/logger');
const configLoader = require('../../utils/configLoader');

class MqttService {
  constructor() {
    this.client = null;
    this.isConnected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.reconnectInterval = 1000; // 1 segundo inicial
    this.messageHandlers = [];
    
    // Topics estáticos que siempre se suscriben
    this.staticTopics = [
      'shellies/#',           // TODOS los datos de dispositivos Shelly
      'ConsumCups/+',         // Datos de consumo por CUPS
      'acs/+/status/#',       // Estado de dispositivos ACS
      'acs/+/events/rpc'      // Eventos RPC de dispositivos ACS
    ];
    
    this.dynamicTopics = [];
    this.subscribedTopics = new Set();
    
    // Estadísticas
    this.stats = {
      messagesReceived: 0,
      messagesPerSecond: 0,
      lastMessageTime: null,
      startTime: Date.now()
    };
    
    // Configurar estadísticas cada segundo
    this.setupStatsInterval();
  }

  /**
   * Inicializa el servicio MQTT
   */
  async initialize() {
    try {
      logger.info('Inicializando servicio MQTT...');
      
      // Cargar topics dinámicos
      this.loadDynamicTopics();
      
      // Conectar al broker
      await this.connect();
      
      // Suscribirse a todos los topics
      await this.subscribeToAllTopics();
      
      logger.info('Servicio MQTT inicializado correctamente');
    } catch (error) {
      logger.error('Error inicializando servicio MQTT:', error);
      throw error;
    }
  }

  /**
   * Conecta al broker MQTT
   */
  async connect() {
    return new Promise((resolve, reject) => {
      try {
        const options = {
          host: process.env.MQTT_BROKER_URL,
          port: parseInt(process.env.MQTT_BROKER_PORT) || 1883,
          username: process.env.MQTT_BROKER_USER,
          password: process.env.MQTT_BROKER_PASSWORD,
          clientId: `pescaenergia-backend-${Date.now()}`,
          clean: true,
          connectTimeout: 4000,
          reconnectPeriod: 0, // Manejamos la reconexión manualmente
          qos: 1
        };

        logger.info('Conectando al broker MQTT...', {
          host: options.host,
          port: options.port,
          clientId: options.clientId
        });

        this.client = mqtt.connect(options);

        this.client.on('connect', () => {
          this.isConnected = true;
          this.reconnectAttempts = 0;
          this.reconnectInterval = 1000;
          
          logger.info('Conectado al broker MQTT exitosamente');
          resolve();
        });

        this.client.on('error', (error) => {
          logger.error('Error de conexión MQTT:', error);
          if (!this.isConnected) {
            reject(error);
          }
        });

        this.client.on('close', () => {
          this.isConnected = false;
          logger.warn('Conexión MQTT cerrada');
          this.handleReconnection();
        });

        this.client.on('offline', () => {
          this.isConnected = false;
          logger.warn('Cliente MQTT offline');
        });

        this.client.on('message', (topic, message) => {
          this.handleMessage(topic, message);
        });

      } catch (error) {
        logger.error('Error creando cliente MQTT:', error);
        reject(error);
      }
    });
  }

  /**
   * Maneja la reconexión automática
   */
  async handleReconnection() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      logger.error('Máximo número de intentos de reconexión alcanzado');
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(this.reconnectInterval * Math.pow(2, this.reconnectAttempts - 1), 30000);
    
    logger.info(`Intentando reconexión ${this.reconnectAttempts}/${this.maxReconnectAttempts} en ${delay}ms`);
    
    setTimeout(async () => {
      try {
        await this.connect();
        await this.subscribeToAllTopics();
      } catch (error) {
        logger.error('Error en reconexión:', error);
        this.handleReconnection();
      }
    }, delay);
  }

  /**
   * Carga los topics dinámicos desde la configuración YAML
   */
  loadDynamicTopics() {
    try {
      this.dynamicTopics = configLoader.getActiveGeneratorTopics();
      logger.info('Topics dinámicos cargados', { 
        topics: this.dynamicTopics,
        count: this.dynamicTopics.length 
      });
    } catch (error) {
      logger.error('Error cargando topics dinámicos:', error);
      this.dynamicTopics = [];
    }
  }

  /**
   * Se suscribe a todos los topics (estáticos y dinámicos)
   */
  async subscribeToAllTopics() {
    if (!this.isConnected) {
      throw new Error('Client MQTT no connectat');
    }

    const allTopics = [...this.staticTopics, ...this.dynamicTopics];
    
    for (const topic of allTopics) {
      try {
        await this.subscribeToTopic(topic);
      } catch (error) {
        logger.error(`Error suscribiéndose al topic ${topic}:`, error);
      }
    }
  }

  /**
   * Se suscribe a un topic específico
   */
  async subscribeToTopic(topic) {
    return new Promise((resolve, reject) => {
      if (this.subscribedTopics.has(topic)) {
        resolve();
        return;
      }

      this.client.subscribe(topic, { qos: 1 }, (error) => {
        if (error) {
          logger.error(`Error suscribiéndose al topic ${topic}:`, error);
          reject(error);
        } else {
          this.subscribedTopics.add(topic);
          logger.debug(`Suscrito al topic: ${topic}`);
          resolve();
        }
      });
    });
  }

  /**
   * Se desuscribe de un topic específico
   */
  async unsubscribeFromTopic(topic) {
    return new Promise((resolve, reject) => {
      if (!this.subscribedTopics.has(topic)) {
        resolve();
        return;
      }

      this.client.unsubscribe(topic, (error) => {
        if (error) {
          logger.error(`Error desuscribiéndose del topic ${topic}:`, error);
          reject(error);
        } else {
          this.subscribedTopics.delete(topic);
          logger.debug(`Desuscrito del topic: ${topic}`);
          resolve();
        }
      });
    });
  }

  /**
   * Maneja los mensajes MQTT recibidos
   */
  handleMessage(topic, message) {
    try {
      // Actualizar estadísticas
      this.stats.messagesReceived++;
      this.stats.lastMessageTime = Date.now();

      // Convertir el mensaje a string
      const messageStr = message.toString();
      
      logger.debug('Mensaje MQTT recibido', { 
        topic, 
        message: messageStr,
        size: message.length 
      });

      // Validar que el mensaje no esté vacío
      if (!messageStr.trim()) {
        logger.warn('Mensaje vacío recibido', { topic });
        return;
      }

      // Crear objeto de mensaje normalizado
      const messageData = {
        topic,
        payload: messageStr,
        timestamp: new Date(),
        receivedAt: Date.now()
      };

      // Enviar a todos los handlers registrados
      this.notifyHandlers(messageData);

    } catch (error) {
      logger.error('Error procesando mensaje MQTT:', { topic, error: error.message });
    }
  }

  /**
   * Notifica a todos los handlers registrados
   */
  notifyHandlers(messageData) {
    for (const handler of this.messageHandlers) {
      try {
        handler(messageData);
      } catch (error) {
        logger.error('Error en handler de mensaje:', error);
      }
    }
  }

  /**
   * Registra un handler para procesar mensajes
   */
  addMessageHandler(handler) {
    if (typeof handler !== 'function') {
      throw new Error('El handler ha de ser una funció');
    }
    this.messageHandlers.push(handler);
    logger.debug('Handler de mensaje registrado');
  }

  /**
   * Remueve un handler
   */
  removeMessageHandler(handler) {
    const index = this.messageHandlers.indexOf(handler);
    if (index > -1) {
      this.messageHandlers.splice(index, 1);
      logger.debug('Handler de mensaje removido');
    }
  }

  /**
   * Recarga la configuración dinámica y actualiza suscripciones
   */
  async reloadConfiguration() {
    try {
      logger.info('Recargando configuración MQTT...');
      
      const oldDynamicTopics = [...this.dynamicTopics];
      this.loadDynamicTopics();
      
      // Encontrar topics a desuscribir
      const topicsToUnsubscribe = oldDynamicTopics.filter(
        topic => !this.dynamicTopics.includes(topic)
      );
      
      // Encontrar topics a suscribir
      const topicsToSubscribe = this.dynamicTopics.filter(
        topic => !oldDynamicTopics.includes(topic)
      );
      
      // Actualizar suscripciones
      for (const topic of topicsToUnsubscribe) {
        await this.unsubscribeFromTopic(topic);
      }
      
      for (const topic of topicsToSubscribe) {
        await this.subscribeToTopic(topic);
      }
      
      logger.info('Configuración MQTT recargada', {
        unsubscribed: topicsToUnsubscribe.length,
        subscribed: topicsToSubscribe.length
      });
      
    } catch (error) {
      logger.error('Error recargando configuración MQTT:', error);
    }
  }

  /**
   * Configura el intervalo para calcular estadísticas
   */
  setupStatsInterval() {
    let lastMessageCount = 0;
    
    setInterval(() => {
      const currentMessages = this.stats.messagesReceived;
      this.stats.messagesPerSecond = currentMessages - lastMessageCount;
      lastMessageCount = currentMessages;
      
      if (this.stats.messagesPerSecond > 0) {
        logger.debug('Estadísticas MQTT', {
          messagesPerSecond: this.stats.messagesPerSecond,
          totalMessages: this.stats.messagesReceived,
          uptime: Math.floor((Date.now() - this.stats.startTime) / 1000),
          connected: this.isConnected
        });
      }
    }, 1000);
  }

  /**
   * Obtiene las estadísticas actuales
   */
  getStats() {
    return {
      ...this.stats,
      uptime: Math.floor((Date.now() - this.stats.startTime) / 1000),
      connected: this.isConnected,
      subscribedTopics: Array.from(this.subscribedTopics),
      reconnectAttempts: this.reconnectAttempts
    };
  }

  /**
   * Cierra la conexión MQTT
   */
  async close() {
    try {
      if (this.client && this.isConnected) {
        this.client.end(true);
        logger.info('Conexión MQTT cerrada');
      }
    } catch (error) {
      logger.error('Error cerrando conexión MQTT:', error);
    }
  }
}

module.exports = MqttService;
