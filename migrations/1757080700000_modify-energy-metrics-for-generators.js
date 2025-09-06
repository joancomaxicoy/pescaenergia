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
  // Primero, eliminar la foreign key constraint
  pgm.sql('ALTER TABLE energy_metrics DROP CONSTRAINT IF EXISTS energy_metrics_device_id_fkey;');
  
  // Cambiar el tipo de device_id de UUID a TEXT para permitir UUIDs sintéticos de generadores
  pgm.sql('ALTER TABLE energy_metrics ALTER COLUMN device_id TYPE TEXT;');
  
  // Crear un índice en device_id para mantener el rendimiento
  pgm.createIndex('energy_metrics', 'device_id', { method: 'btree' });
  
  // Agregar comentario explicativo
  pgm.sql(`
    COMMENT ON COLUMN energy_metrics.device_id IS 
    'Device identifier: UUID for physical devices from devices table, or synthetic ID (gen-*) for energy generators'
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  // Eliminar el índice creado
  pgm.dropIndex('energy_metrics', 'device_id');
  
  // Eliminar registros con device_id sintético (gen-*) ya que no son compatibles con UUID
  pgm.sql("DELETE FROM energy_metrics WHERE device_id LIKE 'gen-%';");
  
  // Cambiar de vuelta a UUID
  pgm.sql('ALTER TABLE energy_metrics ALTER COLUMN device_id TYPE UUID USING device_id::UUID;');
  
  // Restaurar la foreign key constraint
  pgm.sql('ALTER TABLE energy_metrics ADD CONSTRAINT energy_metrics_device_id_fkey FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE;');
  
  // Eliminar comentario
  pgm.sql('COMMENT ON COLUMN energy_metrics.device_id IS NULL;');
};
