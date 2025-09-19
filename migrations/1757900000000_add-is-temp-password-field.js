/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
exports.up = (pgm) => {
  // Añadir campo is_temp_password a la tabla users
  pgm.addColumn('users', {
    is_temp_password: {
      type: 'boolean',
      notNull: true,
      default: false,
      comment: 'Indica si el usuario tiene una contraseña temporal que debe cambiar'
    }
  });

  // Actualizar usuarios existentes que tengan password_hash que empiece con 'tmp-'
  // Nota: Como los passwords temporales se hashean, necesitamos identificarlos de otra manera
  // Por ahora, marcamos como false todos los existentes ya que no podemos detectar los temporales hasheados
  pgm.sql(`
    UPDATE users 
    SET is_temp_password = false 
    WHERE password_hash IS NOT NULL
  `);

  // Crear índice para mejorar performance en consultas
  pgm.createIndex('users', 'is_temp_password');
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
exports.down = (pgm) => {
  // Eliminar índice
  pgm.dropIndex('users', 'is_temp_password');
  
  // Eliminar columna
  pgm.dropColumn('users', 'is_temp_password');
};
