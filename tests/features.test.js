const {
  moistureLabel,
  recalcMoisture,
  computeTrend,
  healthGrade,
  watringPrediction,
  signalQuality,
} = require('../src/utils.js');

// ─── moistureLabel ────────────────────────────────────────────────────────────

describe('moistureLabel', () => {
  test('Bone dry below 15', () => {
    expect(moistureLabel(0)).toBe('Bone dry');
    expect(moistureLabel(14)).toBe('Bone dry');
  });

  test('Thirsty 15–29', () => {
    expect(moistureLabel(15)).toBe('Thirsty');
    expect(moistureLabel(29)).toBe('Thirsty');
  });

  test('Needs water 30–44', () => {
    expect(moistureLabel(30)).toBe('Needs water');
    expect(moistureLabel(44)).toBe('Needs water');

  });

  test('Happy 45–64', () => {
    expect(moistureLabel(45)).toBe('Happy');
    expect(moistureLabel(64)).toBe('Happy');
  });

  test('Lush 65–79', () => {
    expect(moistureLabel(65)).toBe('Lush');
    expect(moistureLabel(79)).toBe('Lush');
  });

  test('Soaked 80+', () => {
    expect(moistureLabel(80)).toBe('Soaked');
    expect(moistureLabel(100)).toBe('Soaked');
  });
});

// ─── recalcMoisture ───────────────────────────────────────────────────────────

describe('recalcMoisture', () => {
  // dry=2800, wet=1200 (firmware defaults)
  const DRY = 2800;
  const WET = 1200;

  test('returns 0 when rawAdc equals dryValue', () => {
    expect(recalcMoisture(DRY, DRY, WET)).toBe(0);
  });

  test('returns 100 when rawAdc equals wetValue', () => {
    expect(recalcMoisture(WET, DRY, WET)).toBe(100);
  });

  test('returns ~50 at midpoint', () => {
    var mid = Math.round((DRY + WET) / 2); // 2000
    expect(recalcMoisture(mid, DRY, WET)).toBe(50);
  });

  test('clamps to 0 when rawAdc above dryValue', () => {
    expect(recalcMoisture(3200, DRY, WET)).toBe(0);
  });

  test('clamps to 100 when rawAdc below wetValue', () => {
    expect(recalcMoisture(800, DRY, WET)).toBe(100);
  });

  test('returns 0 when dry and wet values are equal (avoid divide-by-zero)', () => {
    expect(recalcMoisture(1500, 1500, 1500)).toBe(0);
  });

  test('works with custom calibration values', () => {
    // Custom: dry=3000, wet=1000
    expect(recalcMoisture(3000, 3000, 1000)).toBe(0);
    expect(recalcMoisture(1000, 3000, 1000)).toBe(100);
    expect(recalcMoisture(2000, 3000, 1000)).toBe(50);
  });
});

// ─── computeTrend ─────────────────────────────────────────────────────────────

describe('computeTrend', () => {
  test('drying when moisture drops more than 5 over window', () => {
    expect(computeTrend([60, 57, 54, 51, 48])).toBe('drying'); // -12
  });

  test('wetting when moisture rises more than 5 over window', () => {
    expect(computeTrend([30, 35, 40, 45, 50])).toBe('wetting'); // +20
  });

  test('stable when delta is within ±5', () => {
    expect(computeTrend([50, 51, 49, 50, 50])).toBe('stable'); // 0
    expect(computeTrend([50, 50, 50, 53, 55])).toBe('stable'); // +5 boundary (not > 5)
    expect(computeTrend([50, 50, 50, 47, 45])).toBe('stable'); // -5 boundary (not < -5)
  });

  test('exactly ±5 is stable not drying/wetting', () => {
    expect(computeTrend([55, 52, 53, 52, 50])).toBe('stable'); // -5
    expect(computeTrend([45, 47, 48, 49, 50])).toBe('stable'); // +5
  });

  test('returns stable for single reading', () => {
    expect(computeTrend([50])).toBe('stable');
  });

  test('returns stable for empty array', () => {
    expect(computeTrend([])).toBe('stable');
  });

  test('returns stable for null', () => {
    expect(computeTrend(null)).toBe('stable');
  });
});

// ─── healthGrade ──────────────────────────────────────────────────────────────

describe('healthGrade', () => {
  test('A for okPct >= 90', () => {
    expect(healthGrade(90, 50, true)).toBe('A');
    expect(healthGrade(100, 50, true)).toBe('A');
  });

  test('B for okPct 75–89', () => {
    expect(healthGrade(75, 50, true)).toBe('B');
    expect(healthGrade(89, 50, true)).toBe('B');
  });

  test('C for okPct 50–74', () => {
    expect(healthGrade(50, 50, true)).toBe('C');
    expect(healthGrade(74, 50, true)).toBe('C');
  });

  test('D for okPct 25–49', () => {
    expect(healthGrade(25, 50, true)).toBe('D');
    expect(healthGrade(49, 50, true)).toBe('D');
  });

  test('F for okPct below 25', () => {
    expect(healthGrade(24, 50, true)).toBe('F');
    expect(healthGrade(0, 50, true)).toBe('F');
  });

  test('F when no recent reading regardless of okPct', () => {
    expect(healthGrade(95, 50, false)).toBe('F');
    expect(healthGrade(0, 50, false)).toBe('F');
  });

  test('insufficient when fewer than 10 readings', () => {
    expect(healthGrade(100, 9, true)).toBe('insufficient');
    expect(healthGrade(100, 0, true)).toBe('insufficient');
  });

  test('insufficient takes priority over no recent reading', () => {
    expect(healthGrade(0, 5, false)).toBe('insufficient');
  });
});

// ─── watringPrediction ────────────────────────────────────────────────────────

describe('watringPrediction', () => {
  function makeTimestamps(count, intervalHours = 1) {
    var base = new Date('2026-06-16T00:00:00Z').getTime();
    return Array.from({ length: count }, (_, i) =>
      new Date(base + i * intervalHours * 3600000).toISOString()
    );
  }

  test('insufficient when fewer than 5 readings', () => {
    expect(watringPrediction([60, 58, 56], makeTimestamps(3), 20).kind).toBe('insufficient');
    expect(watringPrediction(null, [], 20).kind).toBe('insufficient');
  });

  test('now when current moisture is at or below dryThreshold', () => {
    var ts = makeTimestamps(5);
    expect(watringPrediction([30, 25, 22, 20, 18], ts, 20).kind).toBe('now');
    expect(watringPrediction([30, 25, 22, 20, 20], ts, 20).kind).toBe('now');
  });

  test('hydrated when moisture is rising', () => {
    var ts = makeTimestamps(5);
    // oldest=30, newest=60 — rising
    expect(watringPrediction([30, 40, 50, 55, 60], ts, 20).kind).toBe('hydrated');
  });

  test('hydrated when moisture is flat', () => {
    var ts = makeTimestamps(5);
    expect(watringPrediction([55, 55, 55, 55, 55], ts, 20).kind).toBe('hydrated');
  });

  test('returns hours with positive value when drying', () => {
    // 5 readings over 4 hours, drop from 60 to 40 → 5%/hr, dry at 20 → 4 more hours
    var ts = makeTimestamps(5);
    var result = watringPrediction([60, 55, 50, 45, 40], ts, 20);
    expect(result.kind).toBe('hours');
    expect(result.hours).toBeGreaterThan(0);
    // (40-20)/5 = 4 hours
    expect(result.hours).toBe(4);
  });
});

// ─── signalQuality ────────────────────────────────────────────────────────────

describe('signalQuality', () => {
  test('Excellent at -55 and above', () => {
    expect(signalQuality(-55)).toBe('Excellent');
    expect(signalQuality(-40)).toBe('Excellent');
    expect(signalQuality(-30)).toBe('Excellent');
  });

  test('Good from -65 to -56', () => {
    expect(signalQuality(-65)).toBe('Good');
    expect(signalQuality(-56)).toBe('Good');
  });

  test('Fair from -75 to -66', () => {
    expect(signalQuality(-75)).toBe('Fair');
    expect(signalQuality(-66)).toBe('Fair');
  });

  test('Weak below -75', () => {
    expect(signalQuality(-76)).toBe('Weak');
    expect(signalQuality(-90)).toBe('Weak');
  });
});
