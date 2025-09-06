const yaml = require('yaml');
const fs = require('fs');
const path = require('path');
const logger = require('./logger');

class ConfigLoader {
  constructor() {
    this.energyGeneratorsPath = path.join(__dirname, '../config/energy-generators.yml');
    this.lastModified = null;
    this.cachedConfig = null;
  }

  /**
   * Carga la configuración de generadores de energía desde el archivo YAML
   * @returns {Object} Configuración de generadores
   */
  loadEnergyGenerators() {
    try {
      const stats = fs.statSync(this.energyGeneratorsPath);
      
      // Si el archivo no ha cambiado, devolver la configuración cacheada
      if (this.lastModified && stats.mtime <= this.lastModified && this.cachedConfig) {
        return this.cachedConfig;
      }

      const fileContent = fs.readFileSync(this.energyGeneratorsPath, 'utf8');
      const config = yaml.parse(fileContent);
      
      // Actualizar cache
      this.lastModified = stats.mtime;
      this.cachedConfig = config;
      
      logger.info('Configuración de generadores de energía cargada', { 
        generators: Object.keys(config).length,
        path: this.energyGeneratorsPath 
      });
      
      return config;
    } catch (error) {
      logger.error('Error cargando configuración de generadores:', error);
      throw error;
    }
  }

  /**
   * Extrae los topics MQTT de los generadores activos
   * @returns {Array<string>} Array de topics MQTT
   */
  getActiveGeneratorTopics() {
    try {
      const config = this.loadEnergyGenerators();
      
      const activeTopics = Object.entries(config)
        .filter(([key, value]) => value.active === true)
        .map(([key, value]) => value.mqtt_topic)
        .filter(topic => topic); // Filtrar topics undefined o null
      
      logger.debug('Topics de generadores activos extraídos', { 
        topics: activeTopics,
        count: activeTopics.length 
      });
      
      return activeTopics;
    } catch (error) {
      logger.error('Error extrayendo topics de generadores activos:', error);
      return [];
    }
  }

  /**
   * Obtiene información detallada de todos los generadores activos
   * @returns {Array<Object>} Array de objetos con información de generadores
   */
  getActiveGenerators() {
    try {
      const config = this.loadEnergyGenerators();
      
      const activeGenerators = Object.entries(config)
        .filter(([key, value]) => value.active === true)
        .map(([key, value]) => ({
          id: key,
          name: value.name,
          topic: value.mqtt_topic,
          active: value.active
        }));
      
      logger.debug('Generadores activos obtenidos', { 
        generators: activeGenerators.length 
      });
      
      return activeGenerators;
    } catch (error) {
      logger.error('Error obteniendo generadores activos:', error);
      return [];
    }
  }

  /**
   * Verifica si el archivo de configuración ha cambiado
   * @returns {boolean} True si ha cambiado
   */
  hasConfigChanged() {
    try {
      const stats = fs.statSync(this.energyGeneratorsPath);
      return !this.lastModified || stats.mtime > this.lastModified;
    } catch (error) {
      logger.error('Error verificando cambios en configuración:', error);
      return false;
    }
  }

  /**
   * Fuerza la recarga de la configuración
   */
  forceReload() {
    this.lastModified = null;
    this.cachedConfig = null;
    logger.info('Forzando recarga de configuración de generadores');
  }
}

// Singleton instance
const configLoader = new ConfigLoader();

module.exports = configLoader;
