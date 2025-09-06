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
  // Create automation_configs table
  pgm.createTable('automation_configs', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('uuid_generate_v4()'),
    },
    device_id: {
      type: 'uuid',
      notNull: true,
      references: 'devices(id)',
      onDelete: 'CASCADE',
    },
    config_name: {
      type: 'text',
      notNull: true,
    },
    config_data: {
      type: 'jsonb',
      notNull: true,
    },
    is_active: {
      type: 'boolean',
      default: true,
      notNull: true,
    },
    created_at: {
      type: 'timestamptz',
      default: pgm.func('NOW()'),
      notNull: true,
    },
    updated_at: {
      type: 'timestamptz',
      default: pgm.func('NOW()'),
      notNull: true,
    },
  });

  // Create indexes for performance
  pgm.createIndex('automation_configs', 'device_id');
  pgm.createIndex('automation_configs', 'is_active');
  pgm.createIndex('automation_configs', 'config_data', { method: 'gin' }); // GIN index for JSONB queries
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  // Drop automation_configs table
  pgm.dropTable('automation_configs');
};
