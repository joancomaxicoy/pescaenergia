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
  // Additional performance indexes for energy_metrics queries
  
  // Composite index for time-range queries by device and metric
  pgm.createIndex('energy_metrics', ['device_id', 'metric_name', 'timestamp'], {
    name: 'idx_energy_metrics_device_metric_time',
    method: 'btree'
  });

  // Index for aggregation queries (last values, etc.)
  pgm.createIndex('energy_metrics', ['metric_name', 'timestamp'], {
    name: 'idx_energy_metrics_metric_time_desc',
    method: 'btree'
  });

  // Index for device-specific time series queries
  pgm.createIndex('energy_metrics', ['device_id', 'timestamp'], {
    name: 'idx_energy_metrics_device_time_desc',
    method: 'btree'
  });

  // Additional indexes for users table
  pgm.createIndex('users', 'created_at', {
    name: 'idx_users_created_at',
    method: 'btree'
  });

  // Additional indexes for devices table
  pgm.createIndex('devices', ['user_id', 'device_type'], {
    name: 'idx_devices_user_type',
    method: 'btree'
  });

  pgm.createIndex('devices', 'created_at', {
    name: 'idx_devices_created_at',
    method: 'btree'
  });

  // Additional indexes for automation_configs table
  pgm.createIndex('automation_configs', ['device_id', 'is_active'], {
    name: 'idx_automation_configs_device_active',
    method: 'btree'
  });
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  // Drop performance indexes
  pgm.dropIndex('energy_metrics', [], { name: 'idx_energy_metrics_device_metric_time' });
  pgm.dropIndex('energy_metrics', [], { name: 'idx_energy_metrics_metric_time_desc' });
  pgm.dropIndex('energy_metrics', [], { name: 'idx_energy_metrics_device_time_desc' });
  pgm.dropIndex('users', [], { name: 'idx_users_created_at' });
  pgm.dropIndex('devices', [], { name: 'idx_devices_user_type' });
  pgm.dropIndex('devices', [], { name: 'idx_devices_created_at' });
  pgm.dropIndex('automation_configs', [], { name: 'idx_automation_configs_device_active' });
};
