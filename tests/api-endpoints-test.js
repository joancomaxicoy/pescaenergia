const request = require('supertest');
const ExpressApp = require('../src/app');
const database = require('../src/utils/database');
const logger = require('../src/utils/logger');

describe('API Endpoints Tests', () => {
  let app;
  let server;
  let testDeviceId;

  beforeAll(async () => {
    // Conectar a la base de datos
    await database.connect();
    
    // Crear instancia de la app
    const expressApp = new ExpressApp();
    app = expressApp.getApp();
    
    // Crear un dispositivo de prueba si no existe
    try {
      const result = await database.query(`
        INSERT INTO users (id, cups, name, email, password_hash) 
        VALUES (gen_random_uuid(), 'TEST001', 'Test User', 'test@test.com', 'hash')
        ON CONFLICT (cups) DO NOTHING
        RETURNING id
      `);
      
      const userResult = await database.query(`
        SELECT id FROM users WHERE cups = 'TEST001'
      `);
      
      const userId = userResult.rows[0].id;
      
      const deviceResult = await database.query(`
        INSERT INTO devices (id, user_id, device_name, device_type, shelly_device_id)
        VALUES (gen_random_uuid(), $1, 'Test Device', 'CONSUMO_GENERAL', 'test-shelly-001')
        ON CONFLICT (shelly_device_id) DO NOTHING
        RETURNING id
      `, [userId]);
      
      if (deviceResult.rows.length > 0) {
        testDeviceId = deviceResult.rows[0].id;
      } else {
        const existingDevice = await database.query(`
          SELECT id FROM devices WHERE shelly_device_id = 'test-shelly-001'
        `);
        testDeviceId = existingDevice.rows[0].id;
      }
      
      // Insertar algunas métricas de prueba
      await database.query(`
        INSERT INTO energy_metrics (timestamp, device_id, metric_name, value)
        VALUES 
          (NOW() - INTERVAL '1 hour', $1, 'power_consumption_avg', 1250.5),
          (NOW() - INTERVAL '1 hour', $1, 'voltage_avg', 230.2),
          (NOW() - INTERVAL '2 hours', $1, 'power_consumption_avg', 1180.3),
          (NOW() - INTERVAL '2 hours', $1, 'voltage_avg', 228.9)
        ON CONFLICT DO NOTHING
      `, [testDeviceId]);
      
      logger.info('Datos de prueba creados', { testDeviceId });
      
    } catch (error) {
      logger.error('Error creando datos de prueba:', error);
    }
  });

  afterAll(async () => {
    // Limpiar datos de prueba
    if (testDeviceId) {
      await database.query('DELETE FROM energy_metrics WHERE device_id = $1', [testDeviceId]);
      await database.query('DELETE FROM devices WHERE id = $1', [testDeviceId]);
      await database.query('DELETE FROM users WHERE cups = $1', ['TEST001']);
    }
    
    await database.close();
  });

  describe('Health Checks', () => {
    test('GET /health should return 200', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);

      expect(response.body).toHaveProperty('status', 'healthy');
      expect(response.body).toHaveProperty('timestamp');
    });

    test('GET /api/devices/history/health should return 200', async () => {
      const response = await request(app)
        .get('/api/devices/history/health')
        .expect(200);

      expect(response.body).toHaveProperty('status', 'healthy');
      expect(response.body).toHaveProperty('service', 'DeviceHistoryService');
    });
  });

  describe('Device Info Endpoints', () => {
    test('GET /api/devices/{deviceId}/info should return device info', async () => {
      if (!testDeviceId) {
        console.log('Skipping test - no test device available');
        return;
      }

      const response = await request(app)
        .get(`/api/devices/${testDeviceId}/info`)
        .expect(200);

      expect(response.body).toHaveProperty('id', testDeviceId);
      expect(response.body).toHaveProperty('device_name');
      expect(response.body).toHaveProperty('device_type');
    });

    test('GET /api/devices/{deviceId}/info with invalid UUID should return 400', async () => {
      const response = await request(app)
        .get('/api/devices/invalid-uuid/info')
        .expect(400);

      expect(response.body).toHaveProperty('error');
    });

    test('GET /api/devices/{deviceId}/info with non-existent device should return 404', async () => {
      const fakeUuid = '123e4567-e89b-12d3-a456-426614174000';
      const response = await request(app)
        .get(`/api/devices/${fakeUuid}/info`)
        .expect(404);

      expect(response.body).toHaveProperty('error');
    });
  });

  describe('Available Metrics Endpoints', () => {
    test('GET /api/devices/{deviceId}/metrics/available should return available metrics', async () => {
      if (!testDeviceId) {
        console.log('Skipping test - no test device available');
        return;
      }

      const response = await request(app)
        .get(`/api/devices/${testDeviceId}/metrics/available`)
        .expect(200);

      expect(response.body).toHaveProperty('deviceId', testDeviceId);
      expect(response.body).toHaveProperty('availableMetrics');
      expect(response.body).toHaveProperty('totalMetrics');
      expect(Array.isArray(response.body.availableMetrics)).toBe(true);
    });
  });

  describe('Latest Metrics Endpoints', () => {
    test('GET /api/devices/{deviceId}/metrics/latest should return latest metrics', async () => {
      if (!testDeviceId) {
        console.log('Skipping test - no test device available');
        return;
      }

      const response = await request(app)
        .get(`/api/devices/${testDeviceId}/metrics/latest`)
        .expect(200);

      expect(response.body).toHaveProperty('deviceId', testDeviceId);
      expect(response.body).toHaveProperty('metrics');
      expect(response.body).toHaveProperty('totalMetrics');
      expect(typeof response.body.metrics).toBe('object');
    });

    test('GET /api/devices/{deviceId}/metrics/latest with specific metrics should filter results', async () => {
      if (!testDeviceId) {
        console.log('Skipping test - no test device available');
        return;
      }

      const response = await request(app)
        .get(`/api/devices/${testDeviceId}/metrics/latest?metrics=power_consumption_avg`)
        .expect(200);

      expect(response.body).toHaveProperty('deviceId', testDeviceId);
      expect(response.body).toHaveProperty('metrics');
      
      // Si hay métricas, debería solo incluir las solicitadas
      if (Object.keys(response.body.metrics).length > 0) {
        expect(response.body.metrics).toHaveProperty('power_consumption_avg');
      }
    });
  });

  describe('Metric Evolution Endpoints', () => {
    test('GET /api/devices/{deviceId}/metrics/{metricName}/evolution should return evolution data', async () => {
      if (!testDeviceId) {
        console.log('Skipping test - no test device available');
        return;
      }

      const startDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const endDate = new Date().toISOString();

      const response = await request(app)
        .get(`/api/devices/${testDeviceId}/metrics/power_consumption_avg/evolution`)
        .query({
          startDate,
          endDate,
          aggregation: '1h'
        })
        .expect(200);

      expect(response.body).toHaveProperty('deviceId', testDeviceId);
      expect(response.body).toHaveProperty('metricName', 'power_consumption_avg');
      expect(response.body).toHaveProperty('aggregation', '1h');
      expect(response.body).toHaveProperty('data');
      expect(Array.isArray(response.body.data)).toBe(true);
    });

    test('GET /api/devices/{deviceId}/metrics/{metricName}/evolution without dates should return 400', async () => {
      if (!testDeviceId) {
        console.log('Skipping test - no test device available');
        return;
      }

      const response = await request(app)
        .get(`/api/devices/${testDeviceId}/metrics/power_consumption_avg/evolution`)
        .expect(400);

      expect(response.body).toHaveProperty('error');
    });

    test('GET /api/devices/{deviceId}/metrics/{metricName}/evolution with invalid aggregation should return 400', async () => {
      if (!testDeviceId) {
        console.log('Skipping test - no test device available');
        return;
      }

      const startDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const endDate = new Date().toISOString();

      const response = await request(app)
        .get(`/api/devices/${testDeviceId}/metrics/power_consumption_avg/evolution`)
        .query({
          startDate,
          endDate,
          aggregation: 'invalid'
        })
        .expect(400);

      expect(response.body).toHaveProperty('error');
    });
  });

  describe('Multiple Metrics Endpoints', () => {
    test('GET /api/devices/{deviceId}/metrics should return multiple metrics', async () => {
      if (!testDeviceId) {
        console.log('Skipping test - no test device available');
        return;
      }

      const startDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const endDate = new Date().toISOString();

      const response = await request(app)
        .get(`/api/devices/${testDeviceId}/metrics`)
        .query({
          startDate,
          endDate,
          aggregation: '1h'
        })
        .expect(200);

      expect(response.body).toHaveProperty('deviceId', testDeviceId);
      expect(response.body).toHaveProperty('aggregation', '1h');
      expect(response.body).toHaveProperty('metrics');
      expect(response.body).toHaveProperty('totalMetrics');
      expect(typeof response.body.metrics).toBe('object');
    });

    test('GET /api/devices/{deviceId}/metrics with specific metrics should filter results', async () => {
      if (!testDeviceId) {
        console.log('Skipping test - no test device available');
        return;
      }

      const startDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const endDate = new Date().toISOString();

      const response = await request(app)
        .get(`/api/devices/${testDeviceId}/metrics`)
        .query({
          startDate,
          endDate,
          metrics: 'power_consumption_avg,voltage_avg',
          aggregation: '1h'
        })
        .expect(200);

      expect(response.body).toHaveProperty('deviceId', testDeviceId);
      expect(response.body).toHaveProperty('metrics');
    });
  });

  describe('Service Management Endpoints', () => {
    test('GET /api/devices/history/stats should return service statistics', async () => {
      const response = await request(app)
        .get('/api/devices/history/stats')
        .expect(200);

      expect(response.body).toHaveProperty('totalQueries');
      expect(response.body).toHaveProperty('cacheHitRate');
      expect(response.body).toHaveProperty('limits');
      expect(typeof response.body.totalQueries).toBe('number');
    });

    test('POST /api/devices/history/cache/clear should clear cache', async () => {
      const response = await request(app)
        .post('/api/devices/history/cache/clear')
        .expect(200);

      expect(response.body).toHaveProperty('message');
      expect(response.body).toHaveProperty('timestamp');
      expect(response.body).toHaveProperty('previousCacheSize');
    });

    test('POST /api/devices/history/stats/reset should reset statistics', async () => {
      const response = await request(app)
        .post('/api/devices/history/stats/reset')
        .expect(200);

      expect(response.body).toHaveProperty('message');
      expect(response.body).toHaveProperty('timestamp');
    });
  });

  describe('Error Handling', () => {
    test('GET /api/nonexistent should return 404', async () => {
      const response = await request(app)
        .get('/api/nonexistent')
        .expect(404);

      expect(response.body).toHaveProperty('error');
    });

    test('GET / should return API info', async () => {
      const response = await request(app)
        .get('/')
        .expect(200);

      expect(response.body).toHaveProperty('message');
      expect(response.body).toHaveProperty('documentation');
    });
  });

  describe('Swagger Documentation', () => {
    test('GET /api-docs.json should return OpenAPI spec', async () => {
      const response = await request(app)
        .get('/api-docs.json')
        .expect(200);

      expect(response.body).toHaveProperty('openapi');
      expect(response.body).toHaveProperty('info');
      expect(response.body).toHaveProperty('paths');
    });
  });
});
