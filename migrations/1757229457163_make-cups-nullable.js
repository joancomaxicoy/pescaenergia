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
  // Hacer que la columna cups sea nullable
  // Los administradores no necesitan CUPS
  pgm.alterColumn('users', 'cups', {
    notNull: false,
  });

  // Actualizar el índice único para permitir múltiples valores NULL
  pgm.dropIndex('users', 'cups');
  
  // Crear un índice único parcial que excluya los valores NULL
  pgm.addIndex('users', 'cups', {
    unique: true,
    where: 'cups IS NOT NULL'
  });
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  // Eliminar el índice único parcial
  pgm.dropIndex('users', 'cups');
  
  // Restaurar cups como not null (esto fallará si hay valores NULL)
  pgm.alterColumn('users', 'cups', {
    notNull: true,
  });

  // Recrear el índice único original
  pgm.createIndex('users', 'cups', { unique: true });
};
