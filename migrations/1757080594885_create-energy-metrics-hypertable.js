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
  // Create energy_metrics table for time-series data
  pgm.createTable('energy_metrics', {
    timestamp: {
      type: 'timestamptz',
      notNull: true,
    },
    device_id: {
      type: 'uuid',
      notNull: true,
      references: 'devices(id)',
      onDelete: 'CASCADE',
    },
    metric_name: {
      type: 'text',
      notNull: true,
    },
    value: {
      type: 'double precision',
      notNull: true,
    },
  });

  // Convert to hypertable for time-series optimization
  // This uses raw SQL because node-pg-migrate doesn't have native TimescaleDB support
  pgm.sql("SELECT create_hypertable('energy_metrics', 'timestamp');");

  // Create basic indexes for performance
  pgm.createIndex('energy_metrics', ['device_id', 'timestamp'], { method: 'btree' });
  pgm.createIndex('energy_metrics', 'metric_name');
  pgm.createIndex('energy_metrics', 'timestamp', { method: 'btree' });
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  // Drop energy_metrics hypertable
  pgm.dropTable('energy_metrics');
};
