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
  // Crear el tipo ENUM para roles
  pgm.createType('user_role', ['admin', 'user']);

  // Añadir nuevos campos a la tabla users
  pgm.addColumns('users', {
    role: {
      type: 'user_role',
      notNull: true,
      default: 'user',
    },
    google_id: {
      type: 'text',
      unique: true,
    },
    email_validated: {
      type: 'boolean',
      notNull: true,
      default: false,
    },
    email_verification_token: {
      type: 'text',
    },
    email_verification_expires: {
      type: 'timestamptz',
    },
    password_reset_token: {
      type: 'text',
    },
    password_reset_expires: {
      type: 'timestamptz',
    },
  });

  // Crear índices para optimizar consultas
  pgm.createIndex('users', 'google_id');
  pgm.createIndex('users', 'email_verification_token');
  pgm.createIndex('users', 'password_reset_token');
  pgm.createIndex('users', 'role');

  // Hacer que el password_hash sea nullable (para usuarios de Google que no tienen password)
  pgm.alterColumn('users', 'password_hash', {
    notNull: false,
  });
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  // Eliminar columnas añadidas
  pgm.dropColumns('users', [
    'role',
    'google_id', 
    'email_validated',
    'email_verification_token',
    'email_verification_expires',
    'password_reset_token',
    'password_reset_expires'
  ]);

  // Restaurar password_hash como not null
  pgm.alterColumn('users', 'password_hash', {
    notNull: true,
  });

  // Eliminar el tipo ENUM
  pgm.dropType('user_role');
};
