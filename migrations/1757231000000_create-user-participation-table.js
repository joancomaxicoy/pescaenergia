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
  // Crear tabla user_participation
  pgm.createTable('user_participation', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('uuid_generate_v4()'),
    },
    user_id: {
      type: 'uuid',
      notNull: true,
      references: 'users(id)',
      onDelete: 'CASCADE',
    },
    generator_code: {
      type: 'text',
      notNull: true,
      comment: 'Código del generador (giravolt, residencia, etc.)',
    },
    participation_percentage: {
      type: 'decimal(5,2)',
      notNull: true,
      check: 'participation_percentage >= 0 AND participation_percentage <= 100',
      comment: 'Porcentaje de participación del usuario en el generador (0-100)',
    },
    assigned_by: {
      type: 'uuid',
      references: 'users(id)',
      comment: 'ID del administrador que asignó esta participación',
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

  // Crear constraint único para evitar duplicados user-generator
  pgm.addConstraint('user_participation', 'unique_user_generator', {
    unique: ['user_id', 'generator_code']
  });

  // Crear índices para mejorar el rendimiento
  pgm.createIndex('user_participation', 'user_id');
  pgm.createIndex('user_participation', 'generator_code');
  pgm.createIndex('user_participation', ['user_id', 'generator_code']);
  pgm.createIndex('user_participation', 'assigned_by');

  // Añadir comentario a la tabla
  pgm.sql(`
    COMMENT ON TABLE user_participation IS 
    'Tabla que define el porcentaje de participación de cada usuario en los diferentes generadores de energía'
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  // Eliminar tabla user_participation
  pgm.dropTable('user_participation');
};
