const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');
const logger = require('./utils/logger');

// Importar rutas
const deviceHistoryRoutes = require('./routes/deviceHistory');

class ExpressApp {
  constructor() {
    this.app = express();
    this.port = process.env.PORT || 3000;
    this.setupMiddleware();
    this.setupSwagger();
    this.setupRoutes();
    this.setupErrorHandling();
  }

  setupMiddleware() {
    // Seguridad
    this.app.use(helmet());
    
    // CORS
    this.app.use(cors({
      origin: process.env.FRONTEND_URL || 'http://localhost:3001',
      credentials: true
    }));

    // Compresión
    this.app.use(compression());

    // Rate limiting
    const limiter = rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutos
      max: 1000, // límite de 1000 requests por ventana por IP
      message: 'Demasiadas peticiones desde esta IP, intenta de nuevo más tarde.',
      standardHeaders: true,
      legacyHeaders: false,
    });
    this.app.use('/api/', limiter);

    // Parsing de JSON
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));

    // Logging de requests
    this.app.use((req, res, next) => {
      logger.info('HTTP Request', {
        method: req.method,
        url: req.url,
        ip: req.ip,
        userAgent: req.get('User-Agent')
      });
      next();
    });
  }

  setupSwagger() {
    const options = {
      definition: {
        openapi: '3.0.0',
        info: {
          title: 'PescaEnergia API',
          version: '2.0.0',
          description: 'API para la gestión de datos energéticos - Plataforma Energina Torello v2.0',
          contact: {
            name: 'Equipo de Desarrollo',
            email: 'dev@pescaenergia.com'
          }
        },
        servers: [
          {
            url: process.env.API_BASE_URL || 'http://localhost:3000',
            description: 'Servidor de desarrollo'
          }
        ],
        components: {
          schemas: {
            Error: {
              type: 'object',
              properties: {
                error: {
                  type: 'string',
                  description: 'Mensaje de error'
                },
                details: {
                  type: 'string',
                  description: 'Detalles adicionales del error'
                },
                timestamp: {
                  type: 'string',
                  format: 'date-time',
                  description: 'Timestamp del error'
                }
              }
            },
            DeviceMetrics: {
              type: 'object',
              properties: {
                deviceId: {
                  type: 'string',
                  description: 'ID del dispositivo (UUID o shelly_device_id)'
                },
                timestamp: {
                  type: 'string',
                  format: 'date-time',
                  description: 'Timestamp de las métricas'
                },
                metrics: {
                  type: 'object',
                  additionalProperties: {
                    type: 'number'
                  },
                  description: 'Objeto con las métricas del dispositivo'
                },
                totalMetrics: {
                  type: 'integer',
                  description: 'Número total de métricas'
                }
              }
            },
            MetricEvolution: {
              type: 'object',
              properties: {
                deviceId: {
                  type: 'string',
                  description: 'ID del dispositivo (UUID o shelly_device_id)'
                },
                metricName: {
                  type: 'string'
                },
                aggregation: {
                  type: 'string',
                  enum: ['1m', '5m', '15m', '30m', '1h', '2h', '6h', '12h', '1d', '1w', '1M']
                },
                period: {
                  type: 'object',
                  properties: {
                    start: {
                      type: 'string',
                      format: 'date-time'
                    },
                    end: {
                      type: 'string',
                      format: 'date-time'
                    }
                  }
                },
                data: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      timestamp: {
                        type: 'string',
                        format: 'date-time'
                      },
                      value: {
                        type: 'number'
                      },
                      min: {
                        type: 'number'
                      },
                      max: {
                        type: 'number'
                      },
                      dataPoints: {
                        type: 'integer'
                      }
                    }
                  }
                },
                totalPoints: {
                  type: 'integer'
                },
                queryTime: {
                  type: 'integer',
                  description: 'Tiempo de consulta en milisegundos'
                }
              }
            },
            DeviceInfo: {
              type: 'object',
              properties: {
                id: {
                  type: 'string',
                  description: 'ID único del dispositivo'
                },
                device_name: {
                  type: 'string'
                },
                device_type: {
                  type: 'string'
                },
                shelly_device_id: {
                  type: 'string'
                },
                created_at: {
                  type: 'string',
                  format: 'date-time'
                },
                user_cups: {
                  type: 'string'
                },
                user_name: {
                  type: 'string'
                }
              }
            }
          }
        }
      },
      apis: ['./src/routes/*.js'], // Rutas donde están las definiciones de Swagger
    };

    const specs = swaggerJsdoc(options);
    this.app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(specs, {
      explorer: true,
      customCss: '.swagger-ui .topbar { display: none }',
      customSiteTitle: 'PescaEnergia API Documentation'
    }));

    // Endpoint para obtener el JSON de Swagger
    this.app.get('/api-docs.json', (req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.send(specs);
    });
  }

  setupRoutes() {
    // Ruta de health check
    this.app.get('/health', (req, res) => {
      res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        version: process.env.npm_package_version || '1.0.0'
      });
    });

    // Rutas de la API
    this.app.use('/api/devices', deviceHistoryRoutes);

    // Ruta por defecto
    this.app.get('/', (req, res) => {
      res.json({
        message: 'PescaEnergia Backend API v2.0',
        documentation: '/api-docs',
        health: '/health'
      });
    });

    // 404 handler
    this.app.use((req, res) => {
      res.status(404).json({
        error: 'Endpoint no encontrado',
        path: req.originalUrl,
        timestamp: new Date().toISOString()
      });
    });
  }

  setupErrorHandling() {
    // Error handler global
    this.app.use((error, req, res, next) => {
      logger.error('Error no manejado en Express:', {
        error: error.message,
        stack: error.stack,
        url: req.url,
        method: req.method,
        ip: req.ip
      });

      // No enviar stack trace en producción
      const isDevelopment = process.env.NODE_ENV !== 'production';

      res.status(error.status || 500).json({
        error: error.message || 'Error interno del servidor',
        details: isDevelopment ? error.stack : undefined,
        timestamp: new Date().toISOString()
      });
    });
  }

  start() {
    return new Promise((resolve, reject) => {
      try {
        this.server = this.app.listen(this.port, () => {
          logger.info(`Servidor Express iniciado en puerto ${this.port}`);
          logger.info(`Documentación Swagger disponible en: http://localhost:${this.port}/api-docs`);
          resolve(this.server);
        });

        this.server.on('error', (error) => {
          logger.error('Error iniciando servidor Express:', error);
          reject(error);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  stop() {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          logger.info('Servidor Express cerrado');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  getApp() {
    return this.app;
  }
}

module.exports = ExpressApp;
