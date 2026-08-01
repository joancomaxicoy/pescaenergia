export const shorthands = undefined;

export const up = (pgm) => {
  pgm.createTable('balanc_energetic', {
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
    cups: {
      type: 'text',
      notNull: true,
      comment: 'CUPS de referència de l\'usuari',
    },
    generator_code: {
      type: 'text',
      notNull: true,
      comment: 'Codi del generador (giravolt, residencia, sala-polivalent)',
    },
    participation_pct: {
      type: 'decimal(5,2)',
      notNull: true,
      comment: 'Coeficient de repartiment de l\'usuari en aquest generador',
    },
    generator_total_cumulative_wh: {
      type: 'numeric',
      notNull: true,
      default: 0,
      comment: 'Comptador acumulat del generador (e_total_fotovoltaica_avg)',
    },
    generator_total_wh: {
      type: 'numeric',
      notNull: true,
      default: 0,
      comment: 'Delta d\'energia generada a l\'interval (Wh)',
    },
    allocated_wh: {
      type: 'numeric',
      notNull: true,
      default: 0,
      comment: 'Energia assignada a l\'usuari = generator_total_wh * participation_pct / 100',
    },
    consumption_wh: {
      type: 'numeric',
      notNull: true,
      default: 0,
      comment: 'Consum de l\'usuari a l\'interval (Wh) - extret de consums',
    },
    balance_wh: {
      type: 'numeric',
      notNull: true,
      default: 0,
      comment: 'Balanç = allocated_wh - consumption_wh',
    },
    timestamp: {
      type: 'timestamptz',
      notNull: true,
      comment: 'Timestamp aliniat a quart d\'hora (:00, :15, :30, :45)',
    },
    created_at: {
      type: 'timestamptz',
      default: pgm.func('NOW()'),
      notNull: true,
    },
  });

  pgm.addConstraint('balanc_energetic', 'unique_user_generator_timestamp', {
    unique: ['user_id', 'generator_code', 'timestamp'],
  });

  pgm.createIndex('balanc_energetic', ['user_id', 'timestamp'], {
    name: 'idx_balanc_user_time',
  });
  pgm.createIndex('balanc_energetic', ['generator_code', 'timestamp'], {
    name: 'idx_balanc_generator_time',
  });
  pgm.createIndex('balanc_energetic', ['timestamp'], {
    name: 'idx_balanc_timestamp',
  });

  pgm.sql(`
    COMMENT ON TABLE balanc_energetic IS
    'Registre del balanc energetic per usuari i generador cada quart d hora'
  `);
};

export const down = (pgm) => {
  pgm.dropTable('balanc_energetic');
};
