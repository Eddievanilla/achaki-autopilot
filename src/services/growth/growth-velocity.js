/**
 * ACHAki Autopilot — GrowthVelocity
 *
 * Módulo de cálculo de velocidade e aceleração de crescimento para métricas
 * reais da ACHAki (seguidores, alcance, visualizações, engajamento, cliques, etc.).
 *
 * Janelas calculadas:
 *  - Total acumulado
 *  - Hoje (00:00 até agora America/Sao_Paulo)
 *  - Últimas 6 horas
 *  - Últimas 24 horas
 *  - Últimos 7 dias
 *
 * Tendências:
 *  - ↑ ACELERANDO (taxa recente significativamente superior à média)
 *  - → ESTÁVEL (taxa recente compatível com o ritmo histórico)
 *  - ↓ DESACELERANDO (taxa recente abaixo do ritmo anterior)
 *
 * ZERO MOCK: Sem dados suficientes, retorna ESTÁVEL com baseline zerada.
 */

export class GrowthVelocity {
  /**
   * Calcula a velocidade de crescimento para uma métrica a partir de uma série temporal de amostras reais.
   *
   * @param {Array<{ value: number, timestamp: string|Date }>} history - Registros reais ordenados
   * @param {number} currentValue - Valor total atual observado
   * @returns {{
   *   total: number,
   *   today: number,
   *   last6h: number,
   *   last24h: number,
   *   last7d: number,
   *   trend: 'ACELERANDO' | 'ESTAVEL' | 'DESACELERANDO',
   *   trendLabel: string,
   *   velocityPerDay: number,
   *   hasHistory: boolean
   * }}
   */
  static calculate(history = [], currentValue = 0) {
    const total = Number(currentValue) || 0;
    if (!Array.isArray(history) || history.length === 0) {
      return {
        total,
        today: 0,
        last6h: 0,
        last24h: 0,
        last7d: 0,
        trend: 'ESTAVEL',
        trendLabel: '→ ESTÁVEL',
        velocityPerDay: 0,
        hasHistory: false,
      };
    }

    const now = Date.now();
    const sixHoursAgo = now - 6 * 3600 * 1000;
    const twentyFourHoursAgo = now - 24 * 3600 * 1000;
    const sevenDaysAgo = now - 7 * 24 * 3600 * 1000;

    // Início de hoje no fuso America/Sao_Paulo
    const spTodayStr = new Date(now).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
    const todayStart = new Date(`${spTodayStr}T00:00:00-03:00`).getTime();

    // Filtra pontos em cada janela
    const findBaselineAt = (targetMs) => {
      // Pega o registro mais próximo antes ou igual a targetMs
      const sorted = [...history].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
      let baseline = null;
      for (const item of sorted) {
        const itemMs = new Date(item.timestamp).getTime();
        if (itemMs <= targetMs) {
          baseline = Number(item.value);
        } else {
          break;
        }
      }
      return baseline != null ? baseline : (sorted[0] ? Number(sorted[0].value) : total);
    };

    const baselineToday = findBaselineAt(todayStart);
    const baseline6h = findBaselineAt(sixHoursAgo);
    const baseline24h = findBaselineAt(twentyFourHoursAgo);
    const baseline7d = findBaselineAt(sevenDaysAgo);

    const deltaToday = Math.max(0, total - baselineToday);
    const delta6h = Math.max(0, total - baseline6h);
    const delta24h = Math.max(0, total - baseline24h);
    const delta7d = Math.max(0, total - baseline7d);

    // Velocidade diária média nos últimos 7 dias vs últimas 24h
    const avgDaily7d = delta7d / 7;
    const dailyRate24h = delta24h;

    let trend = 'ESTAVEL';
    let trendLabel = '→ ESTÁVEL';

    if (delta7d > 0 || delta24h > 0) {
      if (dailyRate24h > avgDaily7d * 1.35 && delta6h > 0) {
        trend = 'ACELERANDO';
        trendLabel = '↑ ACELERANDO';
      } else if (dailyRate24h < avgDaily7d * 0.65 && avgDaily7d > 0) {
        trend = 'DESACELERANDO';
        trendLabel = '↓ DESACELERANDO';
      }
    }

    return {
      total,
      today: deltaToday,
      last6h: delta6h,
      last24h: delta24h,
      last7d: delta7d,
      trend,
      trendLabel,
      velocityPerDay: Number(dailyRate24h.toFixed(1)),
      hasHistory: true,
    };
  }
}

export default GrowthVelocity;
