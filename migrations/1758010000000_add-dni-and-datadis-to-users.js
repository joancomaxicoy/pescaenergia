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
  // DNI/NIE del soci i clau d'accés a l'API de Datadis.
  // clau_datadis es guarda ENCRIPTADA (AES-256-GCM), mai en clar.
  pgm.addColumns('users', {
    dni: {
      type: 'text',
      notNull: false,
      comment: 'DNI/NIE del soci',
    },
    clau_datadis: {
      type: 'text',
      notNull: false,
      comment: "Clau d'accés a l'API de Datadis (encriptada)",
    },
  });

  pgm.createIndex('users', 'dni');
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.dropIndex('users', 'dni');
  pgm.dropColumns('users', ['dni', 'clau_datadis']);
};