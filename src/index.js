require('dotenv').config();
const logger = require('./utils/logger');
const database = require('./utils/database');
const MqttDataService = require('./services/mqtt/mqttDataService');
const mqttServiceRegistry = require('./services/mqtt/mqttServiceRegistry');
const ExpressApp = require('./app');

class PescaEnergiaBackend {
  constructor() {
    this.mqttDataService = null;
    this.plugsService = null;
    this.expressApp = null;
    this.isShuttingDown = false;
  }

  async initialize() {
    try {
      logger.info('Iniciando PescaEnergia Backend con nuevo sistema de automatización...');

      // Conectar a la base de datos
      await database.connect();

      // Inicializar el servicio completo de datos MQTT
      this.mqttDataService = new MqttDataService();
      await this.mqttDataService.initialize();
      await this.mqttDataService.start();

      // Registrar el servicio MQTT en el registry para acceso global
      mqttServiceRegistry.register(this.mqttDataService);

      // Inicialitzar cache d'estat de la piscina (temps real, sense BBDD)
      const poolStateCache = require('./services/poolStateCache');
      poolStateCache.init();

      // Inicializar el servicio de plugs (que incluye el nuevo AutomationManager)
      const PlugsService = require('./services/plugsService');
      this.plugsService = new PlugsService();

      // Inicializar el servicio de cálculo de horas de la piscina (cron cada 60s)
      const PoolHoursService = require('./services/poolHoursService');
      this.poolHoursService = new PoolHoursService();
      this.poolHoursService.start();

      // Inicializar el servicio de automatización de la piscina (server-side, cron cada 30s)
      const PoolAutomationService = require('./services/poolAutomationService');
      this.poolAutomationService = new PoolAutomationService();
      this.poolAutomationService.start();

      // Inicializar el servicio de registre de consums (cron cada ¼ d'hora)
      const ConsumptionService = require('./services/consumptionService');
      this.consumptionService = new ConsumptionService();
      this.consumptionService.start();

      // Inicializar y iniciar el nuevo AutomationManager
      await this.plugsService.initializeAutomationManager();
      await this.plugsService.startAutomationManager();

      // Inicializar el servidor Express
      this.expressApp = new ExpressApp();
      await this.expressApp.start();

      // Configurar manejo de señales para cierre limpio
      this.setupGracefulShutdown();

      logger.info('PescaEnergia Backend iniciado correctamente');
      logger.info('Servicios activos:');
      logger.info('- Servicio MQTT: Activo');
      logger.info('- Nuevo Sistema de Automatización: Activo');
      logger.info('- Servidor Express: Activo');
      logger.info('- Base de datos: Conectada');
      
      // Mostrar estadísticas cada 30 segundos
      this.setupStatsLogging();

      // Mostrar health check cada 5 minutos
      this.setupHealthCheck();

    } catch (error) {
      logger.error('Error iniciando la aplicación:', error);
      process.exit(1);
    }
  }

  /**
   * Configura el logging de estadísticas
   */
  setupStatsLogging() {
    setInterval(() => {
      if (this.mqttDataService) {
        const stats = this.mqttDataService.getStatsSummary();
        logger.info('Estadísticas del sistema', stats);
      }
    }, 30000); // Cada 30 segundos
  }

  /**
   * Configura el health check periódico
   */
  setupHealthCheck() {
    setInterval(async () => {
      if (this.mqttDataService) {
        try {
          const health = await this.mqttDataService.healthCheck();
          
          if (health.status !== 'healthy') {
            logger.warn('Health check detectó problemas', {
              status: health.status,
              summary: health.summary,
              unhealthyServices: Object.entries(health.services)
                .filter(([, service]) => service.status === 'unhealthy')
                .map(([name]) => name)
            });
          } else {
            logger.info('Health check exitoso', {
              status: health.status,
              healthyServices: health.summary.healthyServices,
              totalServices: health.summary.totalServices
            });
          }
        } catch (error) {
          logger.error('Error en health check:', error);
        }
      }
    }, 300000); // Cada 5 minutos
  }

  /**
   * Configura el cierre limpio de la aplicación
   */
  setupGracefulShutdown() {
    const shutdown = async (signal) => {
      if (this.isShuttingDown) {
        return;
      }
      
      this.isShuttingDown = true;
      logger.info(`Recibida señal ${signal}, cerrando aplicación...`);

      try {
        // Cerrar servidor Express
        if (this.expressApp) {
          await this.expressApp.stop();
        }

        // Cerrar servicio de horas de piscina
        if (this.poolHoursService) {
          this.poolHoursService.stop();
        }

        // Cerrar servicio de automatización de piscina
        if (this.poolAutomationService) {
          this.poolAutomationService.stop();
        }

        // Cerrar servicio de registre de consums
        if (this.consumptionService) {
          this.consumptionService.stop();
        }

        // Cerrar servicio de automatización
        if (this.plugsService) {
          await this.plugsService.closeAutomationManager();
        }

        // Cerrar servicio de datos MQTT
        if (this.mqttDataService) {
          await this.mqttDataService.stop();
        }

        // Cerrar conexión a base de datos
        await database.close();

        logger.info('Aplicación cerrada correctamente');
        process.exit(0);
      } catch (error) {
        logger.error('Error durante el cierre:', error);
        process.exit(1);
      }
    };

    // Manejar diferentes señales de cierre
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGUSR2', () => shutdown('SIGUSR2')); // Para nodemon

    // Manejar errores no capturados
    process.on('uncaughtException', (error) => {
      logger.error('Excepción no capturada:', error);
      shutdown('uncaughtException');
    });

    process.on('unhandledRejection', (reason, promise) => {
      logger.error('Promesa rechazada no manejada:', { reason, promise });
      shutdown('unhandledRejection');
    });
  }

  /**
   * Obtiene estadísticas completas del sistema
   */
  getCompleteStats() {
    if (this.mqttDataService) {
      return this.mqttDataService.getCompleteStats();
    }
    return null;
  }

  /**
   * Ejecuta un ciclo de compactación manual
   */
  async runManualCompaction() {
    if (this.mqttDataService) {
      await this.mqttDataService.runManualCompaction();
    }
  }

  /**
   * Obtiene información del buffer actual
   */
  getBufferInfo() {
    if (this.mqttDataService) {
      return this.mqttDataService.getBufferInfo();
    }
    return null;
  }

  /**
   * Limpia todos los buffers y caches
   */
  clearAllBuffers() {
    if (this.mqttDataService) {
      this.mqttDataService.clearAllBuffers();
    }
  }

  /**
   * Resetea todas las estadísticas
   */
  resetAllStats() {
    if (this.mqttDataService) {
      this.mqttDataService.resetAllStats();
    }
  }
}

// Inicializar la aplicación
const app = new PescaEnergiaBackend();
app.initialize().catch((error) => {
  logger.error('Error fatal iniciando la aplicación:', error);
  process.exit(1);
});

module.exports = PescaEnergiaBackend;
