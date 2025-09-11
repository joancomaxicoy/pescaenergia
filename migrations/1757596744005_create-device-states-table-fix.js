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
    // Create device_states table for storing current device states
    pgm.createTable('device_states', {
        id: 'id',
        device_id: {
            type: 'uuid',
            notNull: true,
            references: 'devices(id)',
            onDelete: 'CASCADE'
        },
        state_name: {
            type: 'text',
            notNull: true
        },
        state_value_boolean: {
            type: 'boolean',
            notNull: false
        },
        state_value_numeric: {
            type: 'double precision',
            notNull: false
        },
        state_value_string: {
            type: 'text',
            notNull: false
        },
        state_value_json: {
            type: 'jsonb',
            notNull: false
        },
        last_updated: {
            type: 'timestamptz',
            notNull: true,
            default: pgm.func('NOW()')
        },
        created_at: {
            type: 'timestamptz',
            notNull: true,
            default: pgm.func('NOW()')
        }
    });

    // Create unique constraint to prevent duplicate state entries for the same device
    pgm.createConstraint('device_states', 'device_states_device_id_state_name_unique', {
        unique: ['device_id', 'state_name']
    });

    // Create indexes for better performance
    pgm.createIndex('device_states', 'device_id');
    pgm.createIndex('device_states', 'state_name');
    pgm.createIndex('device_states', 'last_updated');
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
exports.down = (pgm) => {
    pgm.dropTable('device_states');
};
