const database = require('../utils/database');
const User = require('../models/User');
const logger = require('../utils/logger');

class CupsService {
  /**
   * Asigna un CUPS a un usuario
   * @param {string} cups - El CUPS a asignar
   * @param {string} requestingUserId - ID del usuario que hace la petición
   * @param {string} requestingUserRole - Rol del usuario que hace la petición
   * @param {string|null} targetUserId - ID del usuario objetivo (solo para admins)
   * @returns {Promise<Object>} Resultado de la asignación
   */
  static async assignCups(cups, requestingUserId, requestingUserRole, targetUserId = null) {
    const client = await database.getClient();
    
    try {
      await client.query('BEGIN');

      // Validar formato del CUPS (básico)
      if (!cups || typeof cups !== 'string' || cups.trim().length === 0) {
        throw new Error('CUPS inválido');
      }

      const cleanCups = cups.trim();

      // Determinar el usuario objetivo
      let finalTargetUserId;
      if (requestingUserRole === 'admin' && targetUserId) {
        // Admin puede asignar a cualquier usuario
        finalTargetUserId = targetUserId;
        
        // Verificar que el usuario objetivo existe
        const targetUser = await User.findById(targetUserId);
        if (!targetUser) {
          throw new Error('Usuario objetivo no encontrado');
        }
      } else {
        // Usuario normal solo puede asignarse a sí mismo
        finalTargetUserId = requestingUserId;
      }

      // Verificar si ya existe un device con este CUPS
      const existingDeviceQuery = `
        SELECT id, user_id, device_name 
        FROM devices 
        WHERE shelly_device_id = $1 AND device_type = 'SHELLY_SHELLYEM'
      `;
      const existingDeviceResult = await client.query(existingDeviceQuery, [cleanCups]);

      let deviceId;
      let wasCreated = false;
      let previousUserId = null;

      if (existingDeviceResult.rows.length > 0) {
        // El device ya existe
        const existingDevice = existingDeviceResult.rows[0];
        deviceId = existingDevice.id;
        previousUserId = existingDevice.user_id;

        if (previousUserId !== 'not_assigned') {
          // El device ya está asignado a un usuario
          if (requestingUserRole !== 'admin') {
            throw new Error('Este CUPS ya está asignado a otro usuario. Solo un administrador puede reasignarlo.');
          }
          
          if (previousUserId === finalTargetUserId) {
            throw new Error('Este CUPS ya está asignado a este usuario');
          }

          // Admin puede reasignar: quitar CUPS del usuario anterior
          if (previousUserId !== 'not_assigned') {
            await client.query(
              'UPDATE users SET cups = NULL, updated_at = NOW() WHERE id = $1',
              [previousUserId]
            );
            logger.info('CUPS removido del usuario anterior', { 
              cups: cleanCups, 
              previousUserId,
              newUserId: finalTargetUserId 
            });
          }
        }

        // Asignar el device al nuevo usuario
        await client.query(
          'UPDATE devices SET user_id = $1, updated_at = NOW() WHERE id = $2',
          [finalTargetUserId, deviceId]
        );

      } else {
        // El device no existe, crearlo
        const createDeviceQuery = `
          INSERT INTO devices (user_id, shelly_device_id, device_name, device_type)
          VALUES ($1, $2, $3, 'SHELLY_SHELLYEM')
          RETURNING id
        `;
        const deviceName = `Contador CUPS ${cleanCups}`;
        const createResult = await client.query(createDeviceQuery, [
          finalTargetUserId,
          cleanCups,
          deviceName
        ]);
        
        deviceId = createResult.rows[0].id;
        wasCreated = true;
        logger.info('Nuevo device CUPS creado', { 
          deviceId, 
          cups: cleanCups, 
          userId: finalTargetUserId 
        });
      }

      // Actualizar el campo cups del usuario objetivo
      await client.query(
        'UPDATE users SET cups = $1, updated_at = NOW() WHERE id = $2',
        [cleanCups, finalTargetUserId]
      );

      // Verificar que no hay duplicados (seguridad adicional)
      const duplicateCheck = await client.query(
        'SELECT COUNT(*) as count FROM users WHERE cups = $1',
        [cleanCups]
      );
      
      if (parseInt(duplicateCheck.rows[0].count) > 1) {
        throw new Error('Error de consistencia: CUPS duplicado detectado');
      }

      await client.query('COMMIT');

      // Obtener información completa del resultado
      const deviceInfoQuery = `
        SELECT d.*, u.name as user_name, u.email as user_email
        FROM devices d
        JOIN users u ON d.user_id::uuid = u.id
        WHERE d.id = $1
      `;
      const deviceInfo = await client.query(deviceInfoQuery, [deviceId]);

      const result = {
        success: true,
        device: deviceInfo.rows[0],
        operation: wasCreated ? 'created' : 'assigned',
        previousUserId: previousUserId !== 'not_assigned' ? previousUserId : null,
        message: wasCreated 
          ? `CUPS ${cleanCups} creado y asignado exitosamente`
          : `CUPS ${cleanCups} asignado exitosamente`
      };

      logger.info('CUPS asignado exitosamente', {
        cups: cleanCups,
        targetUserId: finalTargetUserId,
        deviceId,
        operation: result.operation,
        requestingUserId,
        requestingUserRole
      });

      return result;

    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Error asignando CUPS:', {
        error: error.message,
        cups,
        requestingUserId,
        targetUserId
      });
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Obtiene información de un CUPS
   * @param {string} cups - El CUPS a consultar
   * @returns {Promise<Object|null>} Información del CUPS o null si no existe
   */
  static async getCupsInfo(cups) {
    try {
      const query = `
        SELECT 
          d.id,
          d.shelly_device_id,
          d.device_name,
          d.device_type,
          d.user_id,
          d.created_at,
          d.updated_at,
          CASE 
            WHEN d.user_id = 'not_assigned' THEN NULL
            ELSE u.name
          END as user_name,
          CASE 
            WHEN d.user_id = 'not_assigned' THEN NULL
            ELSE u.email
          END as user_email,
          CASE 
            WHEN d.user_id = 'not_assigned' THEN false
            ELSE true
          END as is_assigned
        FROM devices d
        LEFT JOIN users u ON d.user_id != 'not_assigned' AND d.user_id::uuid = u.id
        WHERE d.shelly_device_id = $1 AND d.device_type = 'SHELLY_SHELLYEM'
      `;

      const result = await database.query(query, [cups]);
      
      if (result.rows.length === 0) {
        return null;
      }

      return result.rows[0];
    } catch (error) {
      logger.error('Error obteniendo información de CUPS:', error);
      throw error;
    }
  }

  /**
   * Lista todos los CUPS del sistema (solo para admins)
   * @returns {Promise<Array>} Lista de todos los CUPS
   */
  static async listAllCups() {
    try {
      const query = `
        SELECT 
          d.id,
          d.shelly_device_id as cups,
          d.device_name,
          d.user_id,
          d.created_at,
          CASE 
            WHEN d.user_id = 'not_assigned' THEN NULL
            ELSE u.name
          END as user_name,
          CASE 
            WHEN d.user_id = 'not_assigned' THEN NULL
            ELSE u.email
          END as user_email,
          CASE 
            WHEN d.user_id = 'not_assigned' THEN false
            ELSE true
          END as is_assigned
        FROM devices d
        LEFT JOIN users u ON d.user_id != 'not_assigned' AND d.user_id::uuid = u.id
        WHERE d.device_type = 'SHELLY_SHELLYEM'
        ORDER BY d.created_at DESC
      `;

      const result = await database.query(query);
      return result.rows;
    } catch (error) {
      logger.error('Error listando CUPS:', error);
      throw error;
    }
  }

  /**
   * Desasigna un CUPS de un usuario (solo para admins)
   * @param {string} cups - El CUPS a desasignar
   * @returns {Promise<Object>} Resultado de la operación
   */
  static async unassignCups(cups) {
    const client = await database.getClient();
    
    try {
      await client.query('BEGIN');

      // Verificar que el CUPS existe y está asignado
      const deviceQuery = `
        SELECT id, user_id, device_name 
        FROM devices 
        WHERE shelly_device_id = $1 AND device_type = 'SHELLY_SHELLYEM'
      `;
      const deviceResult = await client.query(deviceQuery, [cups]);

      if (deviceResult.rows.length === 0) {
        throw new Error('CUPS no encontrado');
      }

      const device = deviceResult.rows[0];
      
      if (device.user_id === 'not_assigned') {
        throw new Error('Este CUPS ya está desasignado');
      }

      // Desasignar el device
      await client.query(
        'UPDATE devices SET user_id = $1, updated_at = NOW() WHERE id = $2',
        ['not_assigned', device.id]
      );

      // Quitar el CUPS del usuario
      await client.query(
        'UPDATE users SET cups = NULL, updated_at = NOW() WHERE id = $1',
        [device.user_id]
      );

      await client.query('COMMIT');

      logger.info('CUPS desasignado exitosamente', {
        cups,
        previousUserId: device.user_id,
        deviceId: device.id
      });

      return {
        success: true,
        message: `CUPS ${cups} desasignado exitosamente`,
        previousUserId: device.user_id
      };

    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Error desasignando CUPS:', error);
      throw error;
    } finally {
      client.release();
    }
  }
}

module.exports = CupsService;
