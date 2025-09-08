/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const up = (pgm) => {
  // First, drop the foreign key constraint
  pgm.dropConstraint('devices', 'devices_user_id_fkey');
  
  // Change user_id column from uuid to text
  pgm.alterColumn('devices', 'user_id', {
    type: 'text',
    notNull: true,
  });
  
  // Add constraint to validate user_id format (either 'not_assigned' or valid UUID)
  pgm.addConstraint('devices', 'devices_user_id_check', {
    check: "user_id = 'not_assigned' OR user_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'"
  });
  
  // Update existing devices that belong to the default system user
  pgm.sql(`
    UPDATE devices 
    SET user_id = 'not_assigned' 
    WHERE user_id = (
      SELECT id::text FROM users WHERE cups = 'SISTEMA_AUTO'
    )
  `);
  
  // Optionally, remove the default system user if it exists and has no other references
  pgm.sql(`
    DELETE FROM users 
    WHERE cups = 'SISTEMA_AUTO' 
    AND NOT EXISTS (
      SELECT 1 FROM devices WHERE user_id = users.id::text
    )
  `);
  
  // Note: We cannot add a partial foreign key constraint in PostgreSQL
  // The constraint will be enforced at the application level
  // Valid user_id values are either 'not_assigned' or a valid UUID that exists in users table
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  // Drop the check constraint
  pgm.dropConstraint('devices', 'devices_user_id_check');
  
  // Create a default system user if it doesn't exist
  pgm.sql(`
    INSERT INTO users (cups, email, name, password_hash)
    SELECT 'SISTEMA_AUTO', 'sistema@energina.local', 'Dispositivos Automáticos', 'system_default_user'
    WHERE NOT EXISTS (SELECT 1 FROM users WHERE cups = 'SISTEMA_AUTO')
  `);
  
  // Update devices with 'not_assigned' to use the system user
  pgm.sql(`
    UPDATE devices 
    SET user_id = (SELECT id::text FROM users WHERE cups = 'SISTEMA_AUTO')
    WHERE user_id = 'not_assigned'
  `);
  
  // Change user_id column back to uuid
  pgm.alterColumn('devices', 'user_id', {
    type: 'uuid',
    notNull: true,
  });
  
  // Restore the original foreign key constraint
  pgm.addConstraint('devices', 'devices_user_id_fkey', {
    foreignKeys: {
      columns: 'user_id',
      references: 'users(id)',
      onDelete: 'CASCADE'
    }
  });
};
