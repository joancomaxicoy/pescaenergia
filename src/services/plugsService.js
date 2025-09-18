const logger = require('../utils/logger');
const database = require('../utils/database');
const MqttService = require('./mqtt/mqttService');
const DeviceHistoryService = require('./deviceHistoryService');
const AutomationManager = require('./automation/AutomationManager');

class PlugsService {
  constructor() {
    this.logger = logger;
    this.mqttService = null;
    this.automationManager = null; // Se inicializará después de que mqttService esté listo
    this.initializeMqtt();

    // Inicializar health check después de un breve delay para permitir inicialización
    setTimeout(() => {
      this.startMqttHealthCheck();
    }, 5000); // 5 segundos de delay
  }

  /**
   * Inicializa el servicio MQTT obteniendo la instancia singleton compartida
   */
  async initializeMqtt() {
    try {
      // Obtener la instancia singleton compartida
      this.mqttService = new MqttService();

      // Verificar que esté conectado (ya que es singleton, puede que ya esté inicializado)
      if (!this.mqttService.isConnected) {
        this.logger.info('🔄 Instancia MQTT singleton obtenida pero no conectada, intentando conectar...');
        await this.mqttService.connect();
      }

      this.logger.info('✅ Servicio MQTT singleton para control de plugs inicializado y conectado');
    } catch (error) {
      this.logger.error('❌ Error obteniendo instancia MQTT singleton:', {
        error: error.message
      });
      this.mqttService = null;
    }
  }

  /**
   * Asegura que la conexión MQTT esté disponible antes de enviar comandos
   */
  async ensureMqttConnection() {
    // Si no hay servicio o no está conectado, intentar reconectar
    if (!this.mqttService || !this.mqttService.isConnected) {
      this.logger.info('🔄 MQTT no disponible, reintentando conexión...');
      await this.initializeMqtt();
    }
    
    // Verificar que realmente esté conectado
    if (!this.mqttService || !this.mqttService.isConnected) {
      throw new Error('No se pudo establecer conexión MQTT después de varios intentos');
    }
    
    this.logger.debug('✅ Conexión MQTT verificada y disponible');
  }

  /**
   * Inicia el health check periódico para MQTT
   */
  startMqttHealthCheck() {
    // Health check cada 2 minutos
    setInterval(async () => {
      try {
        if (!this.mqttService || !this.mqttService.isConnected) {
          this.logger.warn('🔍 Health check: MQTT desconectado, reintentando conexión...');
          await this.initializeMqtt();
          
          if (this.mqttService && this.mqttService.isConnected) {
            this.logger.info('✅ Health check: MQTT reconectado exitosamente');
            
            // Reinicializar AutomationManager si MQTT se reconectó
            if (!this.automationManager) {
              await this.initializeAutomationManager();
            }
          }
        } else {
          this.logger.debug('✅ Health check: MQTT conectado correctamente');
        }
      } catch (error) {
        this.logger.error('❌ Error en health check MQTT:', {
          error: error.message
        });
      }
    }, 120000); // Cada 2 minutos
    
    this.logger.info('🔍 Health check MQTT iniciado (cada 2 minutos)');
  }

  /**
   * Inicializa el AutomationManager con los servicios necesarios (usando singleton)
   */
  async initializeAutomationManager() {
    try {
      this.logger.info('Obteniendo instancia singleton de AutomationManager...');

      // Obtener la instancia singleton del AutomationManager
      this.automationManager = AutomationManager.getInstance(this, this.mqttService);

      // Si es la primera vez que se inicializa, llamar a initialize()
      if (!this.automationManager.memoryCache.isInitialized) {
        this.logger.info('Inicializando AutomationManager singleton por primera vez...');
        await this.automationManager.initialize();
      } else {
        this.logger.info('AutomationManager singleton ya estaba inicializado, actualizando servicios...');
        this.automationManager.updateServices(this, this.mqttService);
      }

      this.logger.info('✅ AutomationManager singleton configurado exitosamente');

    } catch (error) {
      this.logger.error('❌ Error configurando AutomationManager singleton:', {
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Inicia el AutomationManager
   */
  async startAutomationManager() {
    try {
      if (!this.automationManager) {
        await this.initializeAutomationManager();
      }

      if (!this.automationManager.isRunning) {
        this.automationManager.start();
        this.logger.info('✅ AutomationManager iniciado');
      } else {
        this.logger.warn('AutomationManager ya está ejecutándose');
      }

    } catch (error) {
      this.logger.error('❌ Error iniciando AutomationManager:', {
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Detiene el AutomationManager
   */
  async stopAutomationManager() {
    try {
      if (this.automationManager && this.automationManager.isRunning) {
        this.automationManager.stop();
        this.logger.info('✅ AutomationManager detenido');
      }

    } catch (error) {
      this.logger.error('❌ Error deteniendo AutomationManager:', {
        error: error.message
      });
    }
  }

  /**
   * Cierra el AutomationManager completamente
   */
  async closeAutomationManager() {
    try {
      if (this.automationManager) {
        await this.automationManager.close();
        this.automationManager = null;
        this.logger.info('✅ AutomationManager cerrado');
      }

    } catch (error) {
      this.logger.error('❌ Error cerrando AutomationManager:', {
        error: error.message
      });
    }
  }

  /**
   * Descubre y asigna enchufes al usuario basándose en el patrón shelly_device_id
   * Busca devices cuyo shelly_device_id termine con /{cups} del usuario
   * @param {string} userId - ID del usuario autenticado
   * @returns {Object} - Resultado del autodescubrimiento
   */
  async discover(userId) {
    try {
      this.logger.info('Iniciando autodescubrimiento de enchufes', { userId });

      // 1. Obtener CUPS del usuario
      const userQuery = `
        SELECT cups, name, email 
        FROM users 
        WHERE id = $1::uuid
      `;
      const userResult = await database.query(userQuery, [userId]);

      if (userResult.rows.length === 0) {
        throw new Error('Usuario no encontrado');
      }

      const user = userResult.rows[0];
      if (!user.cups) {
        throw new Error('El usuario no tiene CUPS asignado');
      }

      this.logger.info('Usuario encontrado para autodescubrimiento', {
        userId,
        cups: user.cups,
        userName: user.name
      });

      // 2. Buscar devices con patrón xxx/{cups}
      const searchPattern = `%/${user.cups}`;
      const searchQuery = `
        SELECT 
          id,
          shelly_device_id,
          device_name,
          device_type,
          user_id,
          created_at
        FROM devices 
        WHERE shelly_device_id LIKE $1
        AND (user_id IS NULL OR user_id != $2)
        AND device_type = 'PLUG'
        ORDER BY shelly_device_id
      `;

      const searchResult = await database.query(searchQuery, [searchPattern, userId]);
      const foundDevices = searchResult.rows;

      this.logger.info('Devices encontrados en búsqueda', {
        userId,
        cups: user.cups,
        foundCount: foundDevices.length,
        devices: foundDevices.map(d => ({
          id: d.id,
          shelly_device_id: d.shelly_device_id,
          current_user_id: d.user_id
        }))
      });

      if (foundDevices.length === 0) {
        return {
          success: true,
          discovered: 0,
          message: `No se encontraron enchufes para el CUPS ${user.cups}`,
          plugs: []
        };
      }

      // 3. Asignar devices al usuario y actualizar información
      const assignedPlugs = [];
      
      for (const device of foundDevices) {
        try {
          // Extraer nombre del enchufe del shelly_device_id
          const deviceIdParts = device.shelly_device_id.split('/');
          const extractedName = deviceIdParts.length > 1 ? deviceIdParts[0] : device.shelly_device_id;
          
          // Determinar el nombre final del device
          let finalDeviceName = device.device_name;
          if (!finalDeviceName || finalDeviceName.trim() === '') {
            finalDeviceName = extractedName;
          }

          // Actualizar el device
          const updateQuery = `
            UPDATE devices 
            SET 
              user_id = $1,
              device_name = $2,
              device_type = CASE 
                WHEN device_type IS NULL OR device_type = '' THEN 'PLUG'
                ELSE device_type
              END,
              updated_at = NOW()
            WHERE id = $3
            RETURNING *
          `;

          const updateResult = await database.query(updateQuery, [
            userId,
            finalDeviceName,
            device.id
          ]);

          if (updateResult.rows.length > 0) {
            const updatedDevice = updateResult.rows[0];
            assignedPlugs.push({
              id: updatedDevice.id,
              device_name: updatedDevice.device_name,
              shelly_device_id: updatedDevice.shelly_device_id,
              device_type: updatedDevice.device_type,
              assigned_at: updatedDevice.updated_at,
              extracted_name: extractedName
            });

            this.logger.info('Device asignado exitosamente', {
              deviceId: device.id,
              shellyDeviceId: device.shelly_device_id,
              extractedName,
              finalDeviceName,
              userId
            });
          }

        } catch (deviceError) {
          this.logger.error('Error asignando device individual', {
            deviceId: device.id,
            shellyDeviceId: device.shelly_device_id,
            error: deviceError.message,
            userId
          });
        }
      }

      const result = {
        success: true,
        discovered: assignedPlugs.length,
        message: `Se descubrieron y asignaron ${assignedPlugs.length} enchufes para el CUPS ${user.cups}`,
        user: {
          id: userId,
          name: user.name,
          cups: user.cups
        },
        plugs: assignedPlugs
      };

      this.logger.info('Autodescubrimiento completado exitosamente', {
        userId,
        cups: user.cups,
        totalFound: foundDevices.length,
        totalAssigned: assignedPlugs.length
      });

      return result;

    } catch (error) {
      this.logger.error('Error en autodescubrimiento de enchufes', {
        userId,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Obtiene todos los enchufes asignados a un usuario
   * @param {string} userId - ID del usuario
   * @returns {Array} - Lista de enchufes del usuario
   */
  async getUserPlugs(userId) {
    try {
      const query = `
        SELECT 
          d.id,
          d.shelly_device_id,
          d.device_name,
          d.device_type,
          d.created_at,
          d.updated_at,
          u.cups as user_cups,
          u.name as user_name
        FROM devices d
        JOIN users u ON d.user_id = u.id::text
        WHERE d.user_id = $1
        AND (d.device_type = 'PLUG' OR d.shelly_device_id LIKE '%/' || u.cups)
        ORDER BY d.device_name ASC, d.created_at ASC
      `;

      const result = await database.query(query, [userId]);

      this.logger.info('Enchufes del usuario obtenidos', {
        userId,
        plugsCount: result.rows.length
      });

      return result.rows;

    } catch (error) {
      this.logger.error('Error obteniendo enchufes del usuario', {
        userId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Obtiene información detallada de un enchufe específico
   * @param {string} plugId - ID del enchufe
   * @param {string} userId - ID del usuario (para verificar permisos)
   * @returns {Object} - Información del enchufe
   */
  async getPlugById(plugId, userId) {
    try {
      const query = `
        SELECT 
          d.id,
          d.shelly_device_id,
          d.device_name,
          d.device_type,
          d.created_at,
          d.updated_at,
          u.cups as user_cups,
          u.name as user_name
        FROM devices d
        JOIN users u ON d.user_id = u.id::text
        WHERE d.id = $1::uuid
        AND d.user_id = $2
      `;

      const result = await database.query(query, [plugId, userId]);

      if (result.rows.length === 0) {
        throw new Error('Enchufe no encontrado o no tienes permisos para acceder a él');
      }

      return result.rows[0];

    } catch (error) {
      this.logger.error('Error obteniendo información del enchufe', {
        plugId,
        userId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Publica un comando MQTT al dispositivo
   * @param {string} topic - Topic MQTT
   * @param {string} command - Comando a enviar
   * @returns {Promise} - Promesa de publicación
   */
  async publishMqttCommand(topic, command) {
    return new Promise((resolve, reject) => {
      try {
        // Verificar que el servicio MQTT esté disponible
        if (!this.mqttService || !this.mqttService.client) {
          throw new Error('Servicio MQTT no disponible');
        }

        // Verificar que el cliente esté conectado
        if (!this.mqttService.isConnected) {
          throw new Error('Cliente MQTT no conectado');
        }

        this.logger.info('Enviando comando MQTT', {
          topic,
          command
        });

        // Publicar el comando
        this.mqttService.client.publish(topic, command, { qos: 1 }, (error) => {
          if (error) {
            this.logger.error('Error publicando comando MQTT', {
              topic,
              command,
              error: error.message
            });
            reject(error);
          } else {
            this.logger.info('Comando MQTT enviado exitosamente', {
              topic,
              command
            });
            resolve();
          }
        });

      } catch (error) {
        this.logger.error('Error en publishMqttCommand', {
          topic,
          command,
          error: error.message
        });
        reject(error);
      }
    });
  }

  /**
   * Publica un comando MQTT con timeout
   * @param {string} topic - Topic MQTT
   * @param {string} command - Comando a enviar
   * @param {number} timeout - Timeout en milisegundos (por defecto 10 segundos)
   * @returns {Promise} - Promesa de publicación con timeout
   */
  async publishMqttCommandWithTimeout(topic, command, timeout = 10000) {
    return Promise.race([
      this.publishMqttCommand(topic, command),
      new Promise((_, reject) => 
        setTimeout(() => {
          reject(new Error(`Timeout enviando comando MQTT después de ${timeout}ms`));
        }, timeout)
      )
    ]);
  }

  /**
   * Controla un enchufe (ON/OFF) via MQTT
   * @param {string} plugId - ID del enchufe
   * @param {string} userId - ID del usuario
   * @param {string} action - Acción a realizar ('on', 'off', 'toggle')
   * @returns {Object} - Resultado del control
   */
  async controlPlug(plugId, userId, action) {
    try {
      // Verificar que el enchufe pertenece al usuario
      const plug = await this.getPlugById(plugId, userId);

      // Validar acción
      const validActions = ['on', 'off', 'toggle'];
      if (!validActions.includes(action)) {
        throw new Error(`Acción no válida. Acciones permitidas: ${validActions.join(', ')}`);
      }

      // Asegurar conexión MQTT antes de enviar comando
      await this.ensureMqttConnection();

      // Construir el topic MQTT según la documentación de Shelly Plus Plug S
      const topic = `${plug.shelly_device_id}/command/switch:0`;

      this.logger.info('Iniciando control de enchufe via MQTT', {
        plugId,
        userId,
        action,
        shellyDeviceId: plug.shelly_device_id,
        deviceName: plug.device_name,
        topic
      });

      try {
        // Enviar comando MQTT con timeout
        await this.publishMqttCommandWithTimeout(topic, action, 10000);

        // Retornar resultado exitoso
        const result = {
          success: true,
          plugId: plug.id,
          shellyDeviceId: plug.shelly_device_id,
          deviceName: plug.device_name,
          action: action,
          timestamp: new Date().toISOString(),
          message: `Comando ${action} enviado exitosamente al enchufe ${plug.device_name}`,
          topic: topic,
          mqttImplemented: true
        };

        this.logger.info('Control de enchufe ejecutado exitosamente', {
          plugId,
          userId,
          action,
          shellyDeviceId: plug.shelly_device_id,
          deviceName: plug.device_name,
          topic
        });

        return result;

      } catch (mqttError) {
        // Si falla el MQTT, retornar error específico
        this.logger.error('Error enviando comando MQTT', {
          plugId,
          userId,
          action,
          shellyDeviceId: plug.shelly_device_id,
          topic,
          error: mqttError.message
        });

        throw new Error(`Error enviando comando MQTT: ${mqttError.message}`);
      }

    } catch (error) {
      this.logger.error('Error controlando enchufe', {
        plugId,
        userId,
        action,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Obtiene el estado actual de un enchufe
   * @param {string} plugId - ID del enchufe
   * @param {string} userId - ID del usuario
   * @returns {Object} - Estado del enchufe
   */
  async getPlugStatus(plugId, userId) {
    try {
      // Verificar que el enchufe pertenece al usuario
      const plug = await this.getPlugById(plugId, userId);

      // Obtener estado real desde la tabla device_states
      const stateQuery = `
        SELECT 
          state_name,
          state_value_boolean,
          state_value_numeric,
          state_value_string,
          state_value_json,
          last_updated
        FROM device_states 
        WHERE device_id = $1
        AND state_name IN ('status_wifi_sta_ip', 'status_switch:0_output', 'status_wifi_ssid')
        ORDER BY last_updated DESC
      `;

      const stateResult = await database.query(stateQuery, [plug.id]);
      const deviceStates = stateResult.rows;

      // Procesar los estados obtenidos
      let wifiIp = null;
      let switchOutput = null;
      let wifiSsid = null;
      let lastUpdate = null;

      deviceStates.forEach(state => {
        // Determinar el valor basándose en el tipo de columna que tenga datos
        let stateValue = state.state_value_string || 
                        state.state_value_boolean || 
                        state.state_value_numeric || 
                        state.state_value_json;

        switch (state.state_name) {
          case 'status_wifi_sta_ip':
            wifiIp = stateValue;
            break;
          case 'status_switch:0_output':
            switchOutput = stateValue;
            break;
          case 'status_wifi_ssid':
            wifiSsid = stateValue;
            break;
        }
        // Usar la fecha más reciente como lastUpdate
        if (!lastUpdate || new Date(state.last_updated) > new Date(lastUpdate)) {
          lastUpdate = state.last_updated;
        }
      });

      // Obtener métricas usando DeviceHistoryService
      const deviceHistoryService = new DeviceHistoryService();
      let power = 0;
      let temperature = 25;
      let metricsTimestamp = null;

      try {
        const metricsResult = await deviceHistoryService.getLatestMetrics(
          plug.id, 
          ['status_switch:0_apower_avg', 'status_switch:0_temperature_tC_avg']
        );

        if (metricsResult && metricsResult.metrics) {
          power = parseFloat(metricsResult.metrics['status_switch:0_apower_avg']) || 0;
          temperature = parseFloat(metricsResult.metrics['status_switch:0_temperature_tC_avg']) || 25;
          metricsTimestamp = metricsResult.timestamp;
        }

      } catch (metricsError) {
        this.logger.warn('Error obteniendo métricas del dispositivo', {
          plugId,
          error: metricsError.message
        });
      }

      // Determinar estado on/off basado en switch output
      const isOn = switchOutput === 'true' || switchOutput === true;

      // Usar el timestamp más reciente entre device_states y metrics
      const finalLastUpdate = metricsTimestamp && (!lastUpdate || new Date(metricsTimestamp) > new Date(lastUpdate)) 
        ? metricsTimestamp 
        : lastUpdate || new Date().toISOString();

      // Calcular isOnline basándose en finalLastUpdate (< 15 minutos)
      let isOnline = false;
      if (finalLastUpdate) {
        const now = new Date();
        const fifteenMinutesAgo = new Date(now.getTime() - 15 * 60 * 1000);
        isOnline = new Date(finalLastUpdate) > fifteenMinutesAgo;
      }

      // Construir respuesta con datos reales
      const status = {
        plugId: plug.id,
        shellyDeviceId: plug.shelly_device_id,
        deviceName: plug.device_name,
        deviceType: plug.device_type,
        isOnline: isOnline,
        isOn: isOn,
        power: power,
        temperature: temperature,
        wifiIp: wifiIp,
        wifiSsid: wifiSsid,
        switchOutput: switchOutput,
        voltage: 230, // Valor por defecto
        lastUpdate: finalLastUpdate,
        simulated: false // Ahora son datos reales
      };

      this.logger.info('Estado de enchufe obtenido desde device_states + métricas', {
        plugId,
        userId,
        shellyDeviceId: plug.shelly_device_id,
        isOnline,
        isOn,
        power,
        temperature,
        wifiIp,
        wifiSsid,
        statesFound: deviceStates.length,
        metricsTimestamp,
        simulated: false
      });

      return status;

    } catch (error) {
      this.logger.error('Error obteniendo estado del enchufe', {
        plugId,
        userId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Solicita actualización de estado del enchufe via MQTT
   * @param {string} plugId - ID del enchufe
   * @param {string} userId - ID del usuario
   * @returns {Object} - Resultado de la solicitud
   */
  async requestStatusUpdate(plugId, userId) {
    try {
      // Verificar que el enchufe pertenece al usuario
      const plug = await this.getPlugById(plugId, userId);

      // Asegurar conexión MQTT antes de enviar comando
      await this.ensureMqttConnection();

      // Construir el topic MQTT para status_update
      const topic = `${plug.shelly_device_id}/command`;

      this.logger.info('Solicitando actualización de estado via MQTT', {
        plugId,
        userId,
        shellyDeviceId: plug.shelly_device_id,
        deviceName: plug.device_name,
        topic
      });

      try {
        // Enviar comando MQTT status_update con timeout
        await this.publishMqttCommandWithTimeout(topic, 'status_update', 10000);

        // Retornar resultado exitoso
        const result = {
          success: true,
          plugId: plug.id,
          shellyDeviceId: plug.shelly_device_id,
          deviceName: plug.device_name,
          command: 'status_update',
          topic: topic,
          timestamp: new Date().toISOString(),
          message: `Comando status_update enviado exitosamente al enchufe ${plug.device_name}`
        };

        this.logger.info('Solicitud de actualización de estado ejecutada exitosamente', {
          plugId,
          userId,
          shellyDeviceId: plug.shelly_device_id,
          deviceName: plug.device_name,
          topic
        });

        return result;

      } catch (mqttError) {
        // Si falla el MQTT, retornar error específico
        this.logger.error('Error enviando comando status_update MQTT', {
          plugId,
          userId,
          shellyDeviceId: plug.shelly_device_id,
          topic,
          error: mqttError.message
        });

        throw new Error(`Error enviando comando status_update MQTT: ${mqttError.message}`);
      }

    } catch (error) {
      this.logger.error('Error solicitando actualización de estado del enchufe', {
        plugId,
        userId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Obtiene la configuración de automatización de un enchufe
   * @param {string} plugId - ID del enchufe
   * @param {string} userId - ID del usuario
   * @returns {Object} - Configuración de automatización
   */
  async getPlugAutomation(plugId, userId) {
    try {
      // Verificar que el enchufe pertenece al usuario
      const plug = await this.getPlugById(plugId, userId);

      // Buscar configuración de automatización
      const query = `
        SELECT 
          id,
          config_name,
          config_data,
          is_active,
          created_at,
          updated_at
        FROM automation_configs 
        WHERE device_id = $1::uuid
        AND config_name = 'automation_config'
        ORDER BY updated_at DESC
        LIMIT 1
      `;

      const result = await database.query(query, [plug.id]);

      let automationConfig = {
        type: 'manual',
        power: 10,
        schedule: []
      };

      if (result.rows.length > 0) {
        const config = result.rows[0];
        automationConfig = config.config_data;
        
        this.logger.info('Configuración de automatización encontrada', {
          plugId,
          userId,
          configId: config.id,
          isActive: config.is_active
        });
      } else {
        this.logger.info('No se encontró configuración de automatización, usando valores por defecto', {
          plugId,
          userId
        });
      }

      return {
        plugId: plug.id,
        plugName: plug.device_name,
        shellyDeviceId: plug.shelly_device_id,
        automation: automationConfig
      };

    } catch (error) {
      this.logger.error('Error obteniendo configuración de automatización', {
        plugId,
        userId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Guarda la configuración de automatización de un enchufe
   * @param {string} plugId - ID del enchufe
   * @param {string} userId - ID del usuario
   * @param {Object} automationConfig - Configuración de automatización
   * @returns {Object} - Resultado de la operación
   */
  async savePlugAutomation(plugId, userId, automationConfig) {
    try {
      // Verificar que el enchufe pertenece al usuario
      const plug = await this.getPlugById(plugId, userId);

      // Validar la configuración
      this.validateAutomationConfig(automationConfig);

      // Verificar si ya existe una configuración
      const existingQuery = `
        SELECT id 
        FROM automation_configs 
        WHERE device_id = $1::uuid 
        AND config_name = 'automation_config'
      `;

      const existingResult = await database.query(existingQuery, [plug.id]);

      let query;
      let params;
      let operation;

      if (existingResult.rows.length > 0) {
        // Actualizar configuración existente
        operation = 'updated';
        query = `
          UPDATE automation_configs 
          SET 
            config_data = $1,
            is_active = true,
            updated_at = NOW()
          WHERE device_id = $2::uuid 
          AND config_name = 'automation_config'
          RETURNING id, updated_at
        `;
        params = [JSON.stringify(automationConfig), plug.id];
      } else {
        // Crear nueva configuración
        operation = 'created';
        query = `
          INSERT INTO automation_configs (device_id, config_name, config_data, is_active)
          VALUES ($1::uuid, 'automation_config', $2, true)
          RETURNING id, created_at as updated_at
        `;
        params = [plug.id, JSON.stringify(automationConfig)];
      }

      const result = await database.query(query, params);
      const configRecord = result.rows[0];

      this.logger.info(`Configuración de automatización ${operation}`, {
        plugId,
        userId,
        configId: configRecord.id,
        shellyDeviceId: plug.shelly_device_id,
        deviceName: plug.device_name,
        automationType: automationConfig.type,
        scheduleSlots: automationConfig.schedule?.length || 0
      });

      // Notificar al AutomationManager sobre el cambio de configuración
      if (this.automationManager) {
        try {
          this.logger.info('Notificando cambio de configuración al AutomationManager', {
            plugId,
            deviceName: plug.device_name,
            automationType: automationConfig.type,
            scheduleSlots: automationConfig.schedule?.length || 0,
            automationManagerStatus: 'available'
          });

          // Actualizar configuración en el cache del AutomationManager
          await this.automationManager.updateDeviceConfig(plug.id);

          this.logger.info('AutomationManager notificado exitosamente', {
            plugId,
            deviceName: plug.device_name
          });

        } catch (validationError) {
          // Loggear el error pero no fallar la operación de guardado
          this.logger.error('Error notificando al AutomationManager', {
            plugId,
            deviceName: plug.device_name,
            error: validationError.message,
            stack: validationError.stack
          });

          // No lanzamos el error para no interrumpir el guardado exitoso
        }
      } else {
        this.logger.warn('AutomationManager no disponible para notificar cambio de configuración', {
          plugId,
          deviceName: plug.device_name,
          automationManagerStatus: 'null',
          mqttServiceStatus: this.mqttService ? 'available' : 'null',
          suggestion: 'La configuración se guardó correctamente y se aplicará en la próxima recarga del cache (máximo 5 minutos)'
        });

        // Intentar inicializar el AutomationManager si no está disponible
        try {
          this.logger.info('Intentando inicializar AutomationManager...', {
            plugId,
            deviceName: plug.device_name
          });

          await this.initializeAutomationManager();
          await this.startAutomationManager();

          // Si se inicializó correctamente, intentar notificar
          if (this.automationManager) {
            this.logger.info('AutomationManager inicializado exitosamente, notificando cambio...', {
              plugId,
              deviceName: plug.device_name
            });

            await this.automationManager.updateDeviceConfig(plug.id);

            this.logger.info('AutomationManager notificado exitosamente después de inicialización', {
              plugId,
              deviceName: plug.device_name
            });
          }

        } catch (initError) {
          this.logger.error('Error inicializando AutomationManager', {
            plugId,
            deviceName: plug.device_name,
            error: initError.message,
            stack: initError.stack,
            fallback: 'La configuración se guardó y se aplicará en la próxima recarga automática del cache'
          });
        }
      }

      return {
        success: true,
        operation: operation,
        plugId: plug.id,
        plugName: plug.device_name,
        shellyDeviceId: plug.shelly_device_id,
        configId: configRecord.id,
        automation: automationConfig,
        timestamp: configRecord.updated_at
      };

    } catch (error) {
      this.logger.error('Error guardando configuración de automatización', {
        plugId,
        userId,
        error: error.message,
        automationConfig
      });
      throw error;
    }
  }

  /**
   * Valida la configuración de automatización
   * @param {Object} config - Configuración a validar
   * @throws {Error} - Si la configuración no es válida
   */
  validateAutomationConfig(config) {
    if (!config || typeof config !== 'object') {
      throw new Error('La configuración de automatización debe ser un objeto');
    }

    // Validar tipo
    const validTypes = ['manual', 'power', 'schedule'];
    if (!config.type || !validTypes.includes(config.type)) {
      throw new Error(`El tipo de automatización debe ser uno de: ${validTypes.join(', ')}`);
    }

    // Validar power (si está presente)
    if (config.power !== undefined) {
      if (typeof config.power !== 'number' || config.power < 1 || config.power > 100) {
        throw new Error('El umbral de potencia debe ser un número entre 1 y 100');
      }
    }

    // Validar schedule (si está presente)
    if (config.schedule !== undefined) {
      if (!Array.isArray(config.schedule)) {
        throw new Error('El horario debe ser un array');
      }

      config.schedule.forEach((slot, index) => {
        this.validateScheduleSlot(slot, index);
      });
    }
  }

  /**
   * Valida un slot de horario individual
   * @param {Object} slot - Slot a validar
   * @param {number} index - Índice del slot para mensajes de error
   * @throws {Error} - Si el slot no es válido
   */
  validateScheduleSlot(slot, index) {
    if (!slot || typeof slot !== 'object') {
      throw new Error(`El slot de horario ${index + 1} debe ser un objeto`);
    }

    // Validar ID
    if (slot.id === undefined || typeof slot.id !== 'number') {
      throw new Error(`El slot de horario ${index + 1} debe tener un ID numérico`);
    }

    // Validar días
    if (!Array.isArray(slot.days)) {
      throw new Error(`El slot de horario ${index + 1} debe tener un array de días`);
    }

    if (slot.days.length === 0) {
      throw new Error(`El slot de horario ${index + 1} debe tener al menos un día seleccionado`);
    }

    slot.days.forEach(day => {
      if (typeof day !== 'number' || day < 0 || day > 6) {
        throw new Error(`Los días en el slot ${index + 1} deben ser números entre 0 y 6`);
      }
    });

    // Validar horarios
    const timeRegex = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;
    
    if (!slot.startTime || !timeRegex.test(slot.startTime)) {
      throw new Error(`El slot de horario ${index + 1} debe tener una hora de inicio válida (HH:MM)`);
    }

    if (!slot.endTime || !timeRegex.test(slot.endTime)) {
      throw new Error(`El slot de horario ${index + 1} debe tener una hora de fin válida (HH:MM)`);
    }

    // Validar que la hora de fin sea posterior a la de inicio
    if (slot.startTime >= slot.endTime) {
      throw new Error(`En el slot ${index + 1}, la hora de fin debe ser posterior a la hora de inicio`);
    }

    // Validar enabled
    if (slot.enabled !== undefined && typeof slot.enabled !== 'boolean') {
      throw new Error(`El campo 'enabled' del slot ${index + 1} debe ser un booleano`);
    }
  }

  /**
   * Obtiene datos históricos combinados para el gráfico de plugs
   * @param {string} userId - ID del usuario
   * @param {string} period - Período ('24h', '7d', '30d')
   * @returns {Object} - Datos formateados para Chart.js
   */
  async getPlugsHistoricalChartData(userId, period = '24h') {
    try {
      // Reutilizar la lógica del DashboardService
      const DashboardService = require('./dashboardService');
      const dashboardService = new DashboardService();
      
      // Obtener datos históricos del dashboard (incluye consumo y generación)
      const dashboardData = await dashboardService.getHistoricalChartData(userId, period);
      
      // Obtener todos los plugs del usuario
      const userPlugs = await this.getUserPlugs(userId);
      
      if (userPlugs.length === 0) {
        // Si no hay plugs, retornar solo datos de generación y consumo total
        return {
          ...dashboardData,
          datasets: dashboardData.datasets.filter(d => d.type !== 'difference')
        };
      }

      // Calcular fechas según el período
      const { startDate, endDate, aggregation } = this.calculatePeriodParams(period);
      
      // Obtener datos históricos para cada plug individual
      const deviceHistoryService = new DeviceHistoryService();
      const plugDataPromises = userPlugs.map(async (plug) => {
        try {
          const result = await deviceHistoryService.getMetricEvolution(
            plug.id,
            'status_switch:0_apower_avg',
            startDate,
            endDate,
            aggregation
          );
          
          return {
            plugId: plug.id,
            plugName: plug.device_name,
            data: result.data || []
          };
        } catch (error) {
          this.logger.warn('Error obteniendo datos históricos del plug', {
            plugId: plug.id,
            plugName: plug.device_name,
            error: error.message
          });
          return {
            plugId: plug.id,
            plugName: plug.device_name,
            data: []
          };
        }
      });

      const plugsData = await Promise.all(plugDataPromises);
      
      // Crear conjunto unificado de timestamps (usar los del dashboard)
      const sortedTimestamps = dashboardData.labels.map((label, index) => {
        // Convertir label de vuelta a timestamp ISO
        const now = new Date();
        let timestamp;
        
        if (period === '24h') {
          // Para 24h, los labels son "HH:MM"
          const [hours, minutes] = label.split(':');
          timestamp = new Date(now);
          timestamp.setHours(parseInt(hours), parseInt(minutes), 0, 0);
          // Ajustar al día correcto basándose en el índice
          const hoursFromNow = index * (24 / dashboardData.labels.length);
          timestamp = new Date(now.getTime() - (24 * 60 * 60 * 1000) + (hoursFromNow * 60 * 60 * 1000));
        } else {
          // Para otros períodos, usar aproximación
          const totalPeriodMs = period === '7d' ? 7 * 24 * 60 * 60 * 1000 : 30 * 24 * 60 * 60 * 1000;
          const intervalMs = totalPeriodMs / dashboardData.labels.length;
          timestamp = new Date(now.getTime() - totalPeriodMs + (index * intervalMs));
        }
        
        return timestamp.toISOString();
      });

      // Preparar datasets
      const datasets = [];
      
      // 1. Datasets de generación (del dashboard)
      const generationDatasets = dashboardData.datasets.filter(d => d.type === 'generation');
      generationDatasets.forEach(dataset => {
        datasets.push({
          ...dataset,
          backgroundColor: '#459f49',
          borderColor: '#459f49'
        });
      });

      // 2. Datasets individuales para cada plug (stack)
      const plugColors = [
        '#1e40af', '#7c3aed', '#dc2626', '#ea580c', '#ca8a04',
        '#16a34a', '#0891b2', '#c2410c', '#9333ea', '#be123c'
      ];
      
      plugsData.forEach((plugData, index) => {
        const plugMap = new Map();
        
        // Mapear los datos del plug por timestamp
        plugData.data.forEach(point => {
          if (point && point.timestamp && point.value !== undefined) {
            // Normalizar el timestamp para que coincida con los del dashboard
            const timestamp = new Date(point.timestamp).toISOString();
            plugMap.set(timestamp, parseFloat(point.value) || 0);
          }
        });

        const color = plugColors[index % plugColors.length];
        
        // Mapear los datos a los timestamps del dashboard
        const mappedData = sortedTimestamps.map(timestamp => {
          // Buscar el valor más cercano en tiempo
          let closestValue = null;
          let minTimeDiff = Infinity;
          
          for (const [plugTimestamp, value] of plugMap.entries()) {
            const timeDiff = Math.abs(new Date(timestamp).getTime() - new Date(plugTimestamp).getTime());
            if (timeDiff < minTimeDiff && timeDiff < 30 * 60 * 1000) { // Máximo 30 minutos de diferencia
              minTimeDiff = timeDiff;
              closestValue = value;
            }
          }
          
          return closestValue;
        });
        
        datasets.push({
          label: plugData.plugName,
          data: mappedData,
          backgroundColor: color,
          borderColor: color,
          type: 'plug_consumption',
          stack: 'consumption'
        });
        
        // Log para debug
        this.logger.debug('Datos del plug mapeados', {
          plugName: plugData.plugName,
          originalDataPoints: plugData.data.length,
          mappedDataPoints: mappedData.filter(v => v !== null).length,
          sampleValues: mappedData.slice(0, 5)
        });
      });

      // 3. Calcular resto de consumo (consumo total - suma de plugs)
      const restConsumptionData = sortedTimestamps.map(timestamp => {
        const index = sortedTimestamps.indexOf(timestamp);
        
        // Sumar todo el consumo total en este timestamp
        const totalConsumption = dashboardData.datasets
          .filter(d => d.type === 'consumption')
          .reduce((sum, dataset) => {
            const value = dataset.data[index];
            return sum + (value || 0);
          }, 0);

        // Sumar todos los plugs en este timestamp
        const totalPlugs = datasets
          .filter(d => d.type === 'plug_consumption')
          .reduce((sum, dataset) => {
            const value = dataset.data[index];
            return sum + (value || 0);
          }, 0);

        // Calcular resto
        const rest = totalConsumption - totalPlugs;
        
        // Solo retornar valor si hay datos de consumo
        return totalConsumption > 0 ? Math.max(0, rest) : null;
      });

      // Añadir dataset de resto de consumo
      datasets.push({
        label: 'Resta consum',
        data: restConsumptionData,
        backgroundColor: '#6b7280',
        borderColor: '#6b7280',
        type: 'other_consumption',
        stack: 'consumption'
      });

      this.logger.info('Datos históricos de plugs obtenidos exitosamente', {
        userId,
        period,
        totalPlugs: userPlugs.length,
        totalDatasets: datasets.length,
        totalDataPoints: sortedTimestamps.length
      });

      return {
        period,
        labels: dashboardData.labels,
        datasets,
        totalDataPoints: sortedTimestamps.length,
        dateRange: dashboardData.dateRange
      };

    } catch (error) {
      this.logger.error('Error obteniendo datos históricos de plugs:', {
        userId,
        period,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Calcula parámetros de fecha y agregación según el período
   * @param {string} period - Período solicitado
   * @returns {Object} - Parámetros calculados
   */
  calculatePeriodParams(period) {
    const endDate = new Date();
    const startDate = new Date();
    let aggregation;

    switch (period) {
      case '24h':
        startDate.setHours(startDate.getHours() - 24);
        aggregation = '30m';
        break;
      case '7d':
        startDate.setDate(startDate.getDate() - 7);
        aggregation = '30m';
        break;
      case '30d':
        startDate.setDate(startDate.getDate() - 30);
        aggregation = '30m';
        break;
      default:
        throw new Error('Període no vàlid');
    }

    return { startDate, endDate, aggregation };
  }

  /**
   * Obtiene el estado actual del servicio MQTT
   * @returns {Object} - Estado del servicio MQTT
   */
  getMqttStatus() {
    const status = {
      available: !!this.mqttService,
      connected: this.mqttService ? this.mqttService.isConnected : false,
      timestamp: new Date().toISOString()
    };

    if (this.mqttService) {
      // Obtener estadísticas del servicio MQTT si está disponible
      try {
        const stats = this.mqttService.getStats();
        status.stats = stats;
      } catch (error) {
        this.logger.warn('Error obteniendo estadísticas MQTT:', error);
      }
    }

    return status;
  }

  /**
   * Verifica la salud del servicio de enchufes
   * @returns {Object} - Estado de salud
   */
  async healthCheck() {
    try {
      // Verificar conexión a base de datos
      const testQuery = 'SELECT COUNT(*) as total FROM devices WHERE device_type = $1';
      const result = await database.query(testQuery, ['PLUG']);

      // Obtener estado MQTT
      const mqttStatus = this.getMqttStatus();

      return {
        status: 'healthy',
        database: 'connected',
        totalPlugs: parseInt(result.rows[0].total),
        mqtt: mqttStatus,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      this.logger.error('Health check del servicio de enchufes falló', {
        error: error.message
      });

      return {
        status: 'unhealthy',
        database: 'error',
        mqtt: this.getMqttStatus(),
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Obtiene estadísticas del nuevo sistema de automatización
   * @returns {Object} - Estadísticas del AutomationManager
   */
  getAutomationStats() {
    try {
      if (!this.automationManager) {
        return {
          available: false,
          reason: 'AutomationManager no inicializado',
          timestamp: new Date().toISOString()
        };
      }

      const stats = this.automationManager.getStats();
      
      return {
        available: true,
        system: 'new_automation_manager',
        ...stats,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      this.logger.error('Error obteniendo estadísticas de automatización', { 
        error: error.message 
      });

      return {
        available: false,
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Obtiene información de debug del sistema de automatización
   * @returns {Object} - Información de debug detallada
   */
  getAutomationDebugInfo() {
    try {
      if (!this.automationManager) {
        return {
          available: false,
          reason: 'AutomationManager no inicializado',
          timestamp: new Date().toISOString()
        };
      }

      const debugInfo = this.automationManager.getDebugInfo();
      
      return {
        available: true,
        system: 'new_automation_manager',
        ...debugInfo,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      this.logger.error('Error obteniendo debug info de automatización', { 
        error: error.message 
      });

      return {
        available: false,
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }
}

module.exports = PlugsService;
