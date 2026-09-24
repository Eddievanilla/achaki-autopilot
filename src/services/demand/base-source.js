/**
 * Base Demand Source Interface (ES Module)
 * All demand intelligence sources must implement this contract.
 */
export default class BaseDemandSource {
  constructor(name) {
    this.name = name;
  }

  /**
   * Fetches demand signals from this source.
   * @param {Object} options 
   * @returns {Promise<Array<{
   *   keyword: string,
   *   source: string,
   *   raw_score: number,
   *   trend_direction: 'ALTA'|'CRESCENDO'|'ESTÁVEL'|'BAIXA'|'UNKNOWN',
   *   detected_at: string,
   *   metadata: Object
   * }>>}
   */
  async fetchSignals(options = {}) {
    throw new Error(`fetchSignals() must be implemented by ${this.constructor.name}`);
  }
}
