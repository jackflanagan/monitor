const { colorFor, urlBase64ToUint8Array } = require('../src/utils.js');

describe('colorFor', () => {
  test('returns amber for dry soil (< 30)', () => {
    expect(colorFor(0)).toBe('#ffb830');
    expect(colorFor(1)).toBe('#ffb830');
    expect(colorFor(29)).toBe('#ffb830');
  });

  test('returns green for ok soil (30–69)', () => {
    expect(colorFor(30)).toBe('#5aff7e');
    expect(colorFor(50)).toBe('#5aff7e');
    expect(colorFor(69)).toBe('#5aff7e');
  });

  test('returns blue for wet soil (>= 70)', () => {
    expect(colorFor(70)).toBe('#4aadff');
    expect(colorFor(85)).toBe('#4aadff');
    expect(colorFor(100)).toBe('#4aadff');
  });

  test('boundary at exactly 30 is green not amber', () => {
    expect(colorFor(30)).toBe('#5aff7e');
    expect(colorFor(29)).toBe('#ffb830');
  });

  test('boundary at exactly 70 is blue not green', () => {
    expect(colorFor(70)).toBe('#4aadff');
    expect(colorFor(69)).toBe('#5aff7e');
  });
});

describe('urlBase64ToUint8Array', () => {
  test('decodes VAPID public key to 65-byte uncompressed P-256 point', () => {
    const key = 'BLWgidrw22eOEGx4fX1TbdsqL3pv5rJEipk-vKEhucChzgIHEta4yy6hjeyi7ge4Djjv2_WVPDttGz5ytCaMvzE';
    const result = urlBase64ToUint8Array(key);
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.length).toBe(65);
    expect(result[0]).toBe(0x04); // uncompressed EC point prefix
  });

  test('converts URL-safe - and _ to + and /', () => {
    // base64url "AA-_" = base64 "AA+/" = bytes [0, 15, 255] with padding "AA-_" → decodes correctly
    const result = urlBase64ToUint8Array('AA-_');
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.length).toBe(3);
  });

  test('handles strings that need padding', () => {
    // "AQID" (no padding needed) = bytes [1, 2, 3]
    expect(Array.from(urlBase64ToUint8Array('AQID'))).toEqual([1, 2, 3]);
    // "AQI" (needs 1 pad char) = bytes [1, 2]
    expect(Array.from(urlBase64ToUint8Array('AQI'))).toEqual([1, 2]);
    // "AQ" (needs 2 pad chars) = bytes [1]
    expect(Array.from(urlBase64ToUint8Array('AQ'))).toEqual([1]);
  });
});
