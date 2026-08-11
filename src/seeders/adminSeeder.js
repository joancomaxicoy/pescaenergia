require('dotenv').config();
const User = require('../models/User');
const database = require('../utils/database');
const logger = require('../utils/logger');

class AdminSeeder {
  constructor() {
    this.admins = null;
  }

  loadAdminsFromEnvironment() {
    const serializedAdmins = process.env.ADMIN_SEEDER_USERS_JSON;

    if (!serializedAdmins) {
      throw new Error(
        'ADMIN_SEEDER_USERS_JSON és obligatòria per crear o eliminar administradors'
      );
    }

    try {
      const admins = JSON.parse(serializedAdmins);

      if (!Array.isArray(admins) || admins.length === 0) {
        throw new Error('cal indicar com a mínim un administrador');
      }

      return admins.map(admin => ({ ...admin, role: 'admin' }));
    } catch (error) {
      throw new Error(`ADMIN_SEEDER_USERS_JSON no és un JSON vàlid: ${error.message}`);
    }
  }

  async seed() {
    try {
      await this.validateAdminData();
      logger.info('Iniciando seeding de administradores...');

      // Verificar conexión a la base de datos
      await database.connect();

      let createdCount = 0;
      let skippedCount = 0;

      for (const adminData of this.admins) {
        try {
          // Verificar si el admin ya existe
          const existingUser = await User.findByEmail(adminData.email);
          
          if (existingUser) {
            logger.info(`Admin ya existe: ${adminData.email}`);
            skippedCount++;
            continue;
          }

          // Crear el admin (sin CUPS)
          const admin = await User.create({
            email: adminData.email,
            name: adminData.name,
            password: adminData.password,
            cups: null, // Los admins no necesitan CUPS
            role: adminData.role,
            email_validated: true // Los admins tienen email validado por defecto
          });

          logger.info(`Admin creado exitosamente: ${admin.email}`);
          createdCount++;

        } catch (error) {
          logger.error(`Error creando admin ${adminData.email}:`, error);
          
          // Si es error de duplicado, continuar
          if (error.message.includes('Ya existe un usuario')) {
            skippedCount++;
            continue;
          }
          
          throw error;
        }
      }

      logger.info(`Seeding completado. Creados: ${createdCount}, Omitidos: ${skippedCount}`);
      
      return {
        success: true,
        created: createdCount,
        skipped: skippedCount,
        total: this.admins.length
      };

    } catch (error) {
      logger.error('Error en seeding de administradores:', error);
      throw error;
    }
  }

  async rollback() {
    try {
      await this.validateAdminData();
      logger.info('Iniciando rollback de administradores...');

      // Verificar conexión a la base de datos
      await database.connect();

      let deletedCount = 0;

      for (const adminData of this.admins) {
        try {
          const query = 'DELETE FROM users WHERE email = $1 AND role = $2';
          const result = await database.query(query, [adminData.email, 'admin']);
          
          if (result.rowCount > 0) {
            logger.info(`Admin eliminado: ${adminData.email}`);
            deletedCount++;
          } else {
            logger.info(`Admin no encontrado: ${adminData.email}`);
          }

        } catch (error) {
          logger.error(`Error eliminando admin ${adminData.email}:`, error);
          throw error;
        }
      }

      logger.info(`Rollback completado. Eliminados: ${deletedCount}`);
      
      return {
        success: true,
        deleted: deletedCount,
        total: this.admins.length
      };

    } catch (error) {
      logger.error('Error en rollback de administradores:', error);
      throw error;
    }
  }

  async listAdmins() {
    try {
      const query = `
        SELECT id, email, name, cups, role, email_validated, created_at, updated_at
        FROM users 
        WHERE role = 'admin'
        ORDER BY created_at ASC
      `;
      
      const result = await database.query(query);
      
      logger.info(`Administradores encontrados: ${result.rows.length}`);
      
      return result.rows;

    } catch (error) {
      logger.error('Error listando administradores:', error);
      throw error;
    }
  }

  async updateAdminPassword(email, newPassword) {
    try {
      const user = await User.findByEmail(email);
      
      if (!user) {
        throw new Error('Administrador no encontrado');
      }

      if (user.role !== 'admin') {
        throw new Error('El usuario no es administrador');
      }

      await user.updatePassword(newPassword);
      
      logger.info(`Contraseña actualizada para admin: ${email}`);
      
      return {
        success: true,
        message: 'Contraseña actualizada exitosamente'
      };

    } catch (error) {
      logger.error(`Error actualizando contraseña de admin ${email}:`, error);
      throw error;
    }
  }

  async validateAdminData() {
    if (!this.admins) {
      this.admins = this.loadAdminsFromEnvironment();
    }

    const errors = [];

    for (const admin of this.admins) {
      // Validar email
      if (!admin.email || !admin.email.includes('@')) {
        errors.push(`Email inválido para admin: ${admin.name}`);
      }

      // Validar nombre
      if (!admin.name || admin.name.length < 2) {
        errors.push(`Nombre inválido para admin: ${admin.email}`);
      }

      // Validar password
      if (!admin.password || admin.password.length < 12) {
        errors.push(`Contraseña demasiado corta para admin: ${admin.email}`);
      }
    }

    if (errors.length > 0) {
      throw new Error(`Errores de validación: ${errors.join(', ')}`);
    }

    return true;
  }
}

// Función para ejecutar el seeder desde línea de comandos
async function runSeeder() {
  const seeder = new AdminSeeder();
  
  try {
    // Ejecutar seeding
    const result = await seeder.seed();
    
    console.log('✅ Seeding completado exitosamente:');
    console.log(`   - Administradores creados: ${result.created}`);
    console.log(`   - Administradores omitidos: ${result.skipped}`);
    console.log(`   - Total procesados: ${result.total}`);
    
    // Listar administradores
    console.log('\n📋 Administradores en la base de datos:');
    const admins = await seeder.listAdmins();
    admins.forEach((admin, index) => {
      console.log(`   ${index + 1}. ${admin.name} (${admin.email}) - ${admin.role}`);
    });
    
    process.exit(0);
    
  } catch (error) {
    console.error('❌ Error ejecutando seeder:', error.message);
    process.exit(1);
  }
}

// Función para ejecutar rollback desde línea de comandos
async function runRollback() {
  const seeder = new AdminSeeder();
  
  try {
    const result = await seeder.rollback();
    
    console.log('✅ Rollback completado exitosamente:');
    console.log(`   - Administradores eliminados: ${result.deleted}`);
    console.log(`   - Total procesados: ${result.total}`);
    
    process.exit(0);
    
  } catch (error) {
    console.error('❌ Error ejecutando rollback:', error.message);
    process.exit(1);
  }
}

// Ejecutar según argumentos de línea de comandos
if (require.main === module) {
  const command = process.argv[2];
  
  switch (command) {
    case 'seed':
      runSeeder();
      break;
    case 'rollback':
      runRollback();
      break;
    case 'list':
      (async () => {
        try {
          const seeder = new AdminSeeder();
          await database.connect();
          const admins = await seeder.listAdmins();
          
          console.log('📋 Administradores en la base de datos:');
          if (admins.length === 0) {
            console.log('   No hay administradores registrados.');
          } else {
            admins.forEach((admin, index) => {
              console.log(`   ${index + 1}. ${admin.name} (${admin.email}) - ${admin.role}`);
              console.log(`      CUPS: ${admin.cups || 'N/A (Admin)'}`);
              console.log(`      Email validado: ${admin.email_validated ? 'Sí' : 'No'}`);
              console.log(`      Creado: ${new Date(admin.created_at).toLocaleString()}`);
              console.log('');
            });
          }
          
          process.exit(0);
        } catch (error) {
          console.error('❌ Error listando administradores:', error.message);
          process.exit(1);
        }
      })();
      break;
    default:
      console.log('Uso: node src/seeders/adminSeeder.js [seed|rollback|list]');
      console.log('');
      console.log('Comandos disponibles:');
      console.log('  seed     - Crear administradores en la base de datos');
      console.log('  rollback - Eliminar administradores de la base de datos');
      console.log('  list     - Listar administradores existentes');
      process.exit(1);
  }
}

module.exports = AdminSeeder;
