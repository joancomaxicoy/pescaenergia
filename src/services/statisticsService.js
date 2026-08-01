const database = require('../utils/database');
const logger = require('../utils/logger');

class StatisticsService {

  async getConsumptionData(from, to, deviceTypes) {
    // TODO: implementar consulta real
    // SELECT timestamp, device_id, SUM(energia_wh) as total_wh
    // FROM consums
    // WHERE timestamp BETWEEN $1 AND $2
    //   AND device_type = ANY($3)
    // GROUP BY date_trunc('hour', timestamp), device_id
    // ORDER BY timestamp
    logger.debug('getConsumptionData cridat', { from, to, deviceTypes });
    return [];
  }

  async getSolarData(from, to) {
    // TODO: implementar consulta real
    // SELECT timestamp, device_id, value as cumulative_wh
    // FROM energy_metrics
    // WHERE device_id LIKE 'gen-%'
    //   AND metric_name = 'e_total_fotovoltaica_avg'
    //   AND timestamp BETWEEN $1 AND $2
    // ORDER BY timestamp
    logger.debug('getSolarData cridat', { from, to });
    return [];
  }

  async getDeviceBreakdown(from, to, cups) {
    // TODO: implementar consulta real
    // JOIN consums amb devices per obtenir desglossament per aparell
    logger.debug('getDeviceBreakdown cridat', { from, to, cups });
    return [];
  }

  calculateIntervals(consumptionData, solarData) {
    // TODO: calcular intervals de 15 min
    // Per cada interval:
    //   - consumption: suma energia_wh dels dispositius
    //   - solar: delta e_total_fotovoltaica
    //   - grid: max(0, consumption - solar)
    //   - devices: desglossament per aparell
    return [];
  }

  calculateSummary(intervals) {
    const totalConsumption = intervals.reduce((s, d) => s + d.consumption, 0);
    const totalSolar = intervals.reduce((s, d) => s + d.solar, 0);
    const totalGrid = intervals.reduce((s, d) => s + d.grid, 0);
    const selfConsumption = totalConsumption > 0 ? (totalSolar / totalConsumption) * 100 : 0;
    const days = new Set(intervals.map(d => d.timestamp.slice(0, 10))).size;

    return {
      totalConsumption: Math.round(totalConsumption * 100) / 100,
      totalSolar: Math.round(totalSolar * 100) / 100,
      totalGrid: Math.round(totalGrid * 100) / 100,
      selfConsumptionPct: Math.round(selfConsumption * 10) / 10,
      co2Saved: Math.round(totalSolar * 0.253),
      economicSaving: Math.round(totalSolar * 0.126 * 100) / 100,
      daysAnalyzed: days,
      avgDaily: days > 0 ? Math.round((totalConsumption / days) * 10) / 10 : 0
    };
  }
}

module.exports = StatisticsService;
