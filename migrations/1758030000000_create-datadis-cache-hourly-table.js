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
  // Cache de dades HORÀRIES de Datadis per poder consultar amb agrupació horària
  // respectant la limitació de 24 h de Datadis (es desa quan ja fem la crida diària).
  pgm.createTable('datadis_cache_hourly', {
    id: { type: 'serial', primaryKey: true },
    user_id: { type: 'uuid', notNull: true, references: 'users' },
    cups: { type: 'text', notNull: true },
    timestamp: { type: 'timestamptz', notNull: true },
    consumption_kwh: { type: 'double precision', notNull: false },
    surplus_kwh: { type: 'double precision', notNull: false },
    generation_kwh: { type: 'double precision', notNull: false },
    self_consumption_kwh: { type: 'double precision', notNull: false },
    obtain_method: { type: 'text', notNull: false },
    fetched_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.addConstraint('datadis_cache_hourly', 'datadis_cache_hourly_user_ts_unique', {
    unique: ['user_id', 'timestamp'],
  });

  pgm.createIndex('datadis_cache_hourly', ['user_id', 'cups', 'timestamp']);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.dropTable('datadis_cache_hourly');
};