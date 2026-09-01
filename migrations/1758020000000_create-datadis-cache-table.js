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
  // Cache de dades diàries de Datadis per evitar superar la limitació de 24 h
  // que imposa Datadis a l'hora de re-consultar el mateix CUPS/període.
  pgm.createTable('datadis_cache', {
    id: { type: 'serial', primaryKey: true },
    user_id: { type: 'uuid', notNull: true, references: 'users' },
    cups: { type: 'text', notNull: true },
    date: { type: 'date', notNull: true },
    consumption_kwh: { type: 'double precision', notNull: false },
    surplus_kwh: { type: 'double precision', notNull: false },
    generation_kwh: { type: 'double precision', notNull: false },
    self_consumption_kwh: { type: 'double precision', notNull: false },
    obtain_method: { type: 'text', notNull: false },
    fetched_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.addConstraint('datadis_cache', 'datadis_cache_user_date_unique', {
    unique: ['user_id', 'date'],
  });

  pgm.createIndex('datadis_cache', ['user_id', 'cups', 'date']);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.dropTable('datadis_cache');
};