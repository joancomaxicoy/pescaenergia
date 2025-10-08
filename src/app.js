const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');
const { engine } = require('express-handlebars');
const cookieParser = require('cookie-parser');
const path = require('path');
const logger = require('./utils/logger');

// Importar rutas
const deviceHistoryRoutes = require('./routes/deviceHistory');
const authRoutes = require('./routes/auth');
const cupsRoutes = require('./routes/cupsAssignment');
const frontendRoutes = require('./routes/frontend');
const generatorRoutes = require('./routes/generators');
const userParticipationRoutes = require('./routes/userParticipation');
const dashboardRoutes = require('./routes/dashboard');
const adminRoutes = require('./routes/admin');
const plugsRoutes = require('./routes/plugs');
const sseRoutes = require('./routes/sse');

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
    // Configurar Handlebars como motor de plantillas
    this.app.engine('hbs', engine({
      extname: '.hbs',
      defaultLayout: 'main',
      layoutsDir: path.join(__dirname, 'templates/layouts'),
      partialsDir: path.join(__dirname, 'templates/partials'),
      helpers: {
        formatDate: (date) => {
          if (!date) return '';
          return new Date(date).toLocaleDateString('ca-ES', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
          });
        }
      }
    }));

    this.app.set('trust proxy', 1);
    this.app.set('view engine', 'hbs');
    this.app.set('views', path.join(__dirname, 'templates'));

    // Servir archivos estáticos
    this.app.use(express.static(path.join(__dirname, 'public')));

    // Cookie parser
    this.app.use(cookieParser());

    // Seguridad (configurar CSP para permitir Google APIs)
    this.app.use(helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://accounts.google.com"],
          fontSrc: ["'self'", "https://fonts.gstatic.com"],
          scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-hashes'", "https://accounts.google.com", "https://apis.google.com", "https://cdn.jsdelivr.net", "https://unpkg.com"],
          connectSrc: ["'self'", "https://accounts.google.com", "https://www.googleapis.com"],
          frameSrc: ["https://accounts.google.com"],
          imgSrc: ["'self'", "data:", "https:", "https://lh3.googleusercontent.com"]
        }
      }
    }));
    
    // CORS - Configuración para Google Sign-In
    this.app.use(cors({
      origin: [
        process.env.FRONTEND_URL || 'http://localhost:3000',
        'http://localhost:3000',
        'http://localhost:3001',
        'https://accounts.google.com',
        'https://www.googleapis.com',
        'https://gestio.pescaenergia.cat'
      ],
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
      optionsSuccessStatus: 200 // Para navegadores legacy
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
          securitySchemes: {
            bearerAuth: {
              type: 'http',
              scheme: 'bearer',
              bearerFormat: 'JWT',
              description: 'Introduce el token JWT en el formato: Bearer <token>'
            }
          },
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

    // Ruta de health check para automatización (solo para desarrollo/debug)
    this.app.get('/health/automation', async (req, res) => {
      try {
        // Esta ruta solo debería estar disponible en desarrollo
        if (process.env.NODE_ENV === 'production') {
          return res.status(404).json({ error: 'Endpoint no disponible en producción' });
        }

        // Acceder al servicio de automatización desde el backend principal
        // Nota: Esto requeriría una referencia al backend principal
        res.json({
          status: 'automation-health-check-placeholder',
          message: 'Endpoint de desarrollo para verificar estado de automatización',
          timestamp: new Date().toISOString(),
          intervalMinutes: parseInt(process.env.AUTOMATION_TIMMER_INTERVAL) || 5,
          userTimezone: process.env.USERS_TIMEZONE || 'Europe/Madrid'
        });
      } catch (error) {
        res.status(500).json({
          status: 'error',
          error: error.message,
          timestamp: new Date().toISOString()
        });
      }
    });

    // Rutas de la API
    this.app.use('/api/auth', authRoutes);
    this.app.use('/api/devices', deviceHistoryRoutes);
    this.app.use('/api/cups', cupsRoutes);
    this.app.use('/api/generators', generatorRoutes);
    this.app.use('/api/user-participation', userParticipationRoutes);
    this.app.use('/api/dashboard', dashboardRoutes);
    this.app.use('/api/admin', adminRoutes);
    this.app.use('/api/plugs', plugsRoutes);
    this.app.use('/api/sse', sseRoutes);

    // Rutas del frontend (área de usuario)
    this.app.use('/area-usuari', frontendRoutes);

    // Rutas de redirección globales para compatibilidad con la home
    this.app.get('/register', (req, res) => {
      res.redirect('/area-usuari/login');
    });

    this.app.get('/login', (req, res) => {
      res.redirect('/area-usuari/login');
    });

    this.app.get('/signin', (req, res) => {
      res.redirect('/area-usuari/login');
    });

    this.app.get('/signup', (req, res) => {
      res.redirect('/area-usuari/login');
    });

    // Ruta por defecto
    this.app.get('/', (req, res) => {
      res.json({
        message: 'PescaEnergia Backend API v2.0',
        documentation: '/api-docs',
        health: '/health',
        userArea: '/area-usuari'
      });
    });

    // 404 handler
    this.app.use((req, res) => {
      // Si es una ruta de API, devolver JSON
      if (req.originalUrl.startsWith('/api/')) {
        return res.status(404).json({
          error: 'Endpoint no encontrado',
          path: req.originalUrl,
          timestamp: new Date().toISOString()
        });
      }
      
      // Para otras rutas, mostrar página 404
      res.status(404).render('pages/404', {
        title: 'Pàgina no trobada',
        layout: 'main',
        showNavbar: false,
        showFooter: true,
        path: req.originalUrl
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
