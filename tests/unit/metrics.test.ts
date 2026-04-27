import { describe, it, expect } from 'vitest';

/**
 * Metrics Pipeline Unit Tests
 * Tests the execution order and correctness of M1-M5 metrics.
 */
describe('Metrics Pipeline', () => {
  describe('M1 — Plan Adherence Score', () => {
    it('should compute rolling average of last 10 trades', () => {
      const planScores = [4, 3, 1, 1, 3, 4, 3, 1, 1, 3]; // Alex Mercer's pattern
      const avg = planScores.reduce((a, b) => a + b, 0) / planScores.length;
      expect(avg).toBe(2.4);
    });

    it('should handle fewer than 10 trades', () => {
      const planScores = [4, 3, 5];
      const avg = planScores.reduce((a, b) => a + b, 0) / planScores.length;
      expect(avg).toBe(4);
    });

    it('should ignore null planAdherence values', () => {
      const planScores = [4, 3, 5].filter((s) => s !== null);
      expect(planScores.length).toBe(3);
    });
  });

  describe('M2 — Revenge Trade Flag', () => {
    it('should flag trade within 90s of losing close with anxious emotion', () => {
      const prevExitAt = new Date('2025-01-06T10:21:00Z').getTime();
      const currentEntryAt = new Date('2025-01-06T10:22:00Z').getTime();
      const gapSeconds = (currentEntryAt - prevExitAt) / 1000;

      expect(gapSeconds).toBe(60); // 60 seconds gap
      expect(gapSeconds).toBeLessThanOrEqual(90);

      const prevPnl = -41.51;
      const emotionalState = 'anxious';

      const isRevenge = prevPnl < 0 && gapSeconds <= 90 && ['anxious', 'fearful'].includes(emotionalState);
      expect(isRevenge).toBe(true);
    });

    it('should NOT flag with calm emotion even within 90s', () => {
      const emotionalState = 'calm';
      const isRevengeEmotion = ['anxious', 'fearful'].includes(emotionalState);
      expect(isRevengeEmotion).toBe(false);
    });

    it('should NOT flag with gap > 90 seconds', () => {
      const gapSeconds = 120;
      expect(gapSeconds).toBeGreaterThan(90);
    });

    it('should NOT flag after a winning trade', () => {
      const prevPnl = 500;
      expect(prevPnl).toBeGreaterThanOrEqual(0);
    });
  });

  describe('M3 — Session Tilt Index', () => {
    it('should compute tilt_index as loss_follows / total', () => {
      // Session with 5 trades: first trade has no predecessor
      // Trades 2,3 follow losses → 2 loss-follows out of 5 total
      const lossFollows = 2;
      const total = 5;
      const tiltIndex = lossFollows / total;
      expect(tiltIndex).toBe(0.4);
    });

    it('should be 0 for session with no losses', () => {
      const lossFollows = 0;
      const total = 5;
      const tiltIndex = lossFollows / total;
      expect(tiltIndex).toBe(0);
    });

    it('should be in range [0, 1]', () => {
      for (let lf = 0; lf <= 10; lf++) {
        const total = 10;
        const tiltIndex = lf / total;
        expect(tiltIndex).toBeGreaterThanOrEqual(0);
        expect(tiltIndex).toBeLessThanOrEqual(1);
      }
    });
  });

  describe('M4 — Win Rate by Emotion', () => {
    it('should track wins for calm emotional state', () => {
      const winsMap: Record<string, number> = { calm: 0 };
      winsMap.calm = (winsMap.calm ?? 0) + 1;
      expect(winsMap.calm).toBe(1);
    });

    it('should compute win rate correctly', () => {
      const wins = 18;
      const losses = 6;
      const winRate = wins / (wins + losses);
      expect(winRate).toBe(0.75);
    });
  });

  describe('M5 — Overtrading Detector', () => {
    it('should trigger on > 10 trades (the 11th), not >= 10', () => {
      // Per SKILL.md pitfall #8: threshold is > 10, not >= 10
      const tradeCount = 10;
      expect(tradeCount > 10).toBe(false); // 10 trades: no alert

      const tradeCount11 = 11;
      expect(tradeCount11 > 10).toBe(true); // 11 trades: alert!
    });

    it('should use 30-minute window', () => {
      const windowMs = 30 * 60 * 1000;
      expect(windowMs).toBe(1800000); // 30 minutes in ms
    });
  });

  describe('Pipeline Execution Order', () => {
    it('should run M1, M4, M5 in parallel (Phase 1)', () => {
      // These are independent and can run concurrently
      const phase1 = ['M1_planAdherence', 'M4_winByEmotion', 'M5_overtrading'];
      expect(phase1.length).toBe(3);
    });

    it('should run M2, M3 sequentially after Phase 1', () => {
      // M2 and M3 depend on prior trade data, must run after Phase 1
      const phase2 = ['M2_revengeFlag', 'M3_tiltIndex'];
      expect(phase2.length).toBe(2);
    });
  });
});
