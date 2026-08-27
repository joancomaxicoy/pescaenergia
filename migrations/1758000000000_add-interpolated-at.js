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
  // Marca els registres corregits per interpolació (idempotència):
  // null = valor real del sensor, notNull = valor interpolat/derivat.
  pgm.addColumns('consums', {
    interpolated_at: {
      type: 'timestamptz',
      notNull: false,
      comment: 'Timestamp quan el registre va ser corregit per interpolació (NULL = valor real)',
    },
  });

  pgm.addColumns('balanc_energetic', {
    interpolated_at: {
      type: 'timestamptz',
      notNull: false,
      comment: 'Timestamp quan el registre va ser corregit per interpolació (NULL = valor real)',
    },
  });

  pgm.createIndex('consums', ['interpolated_at']);
  pgm.createIndex('balanc_energetic', ['interpolated_at']);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.dropIndex('balanc_energetic', ['interpolated_at']);
  pgm.dropIndex('consums', ['interpolated_at']);
  pgm.dropColumns('balanc_energetic', ['interpolated_at']);
  pgm.dropColumns('consums', ['interpolated_at']);
};
