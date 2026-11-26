import { formatArea, formatLength, parseLength } from './units';

describe('formatLength', () => {
  it('formats metric units', () => {
    expect(formatLength(2400, 'mm')).toBe('2400 mm');
    expect(formatLength(2405, 'cm')).toBe('240.5 cm');
    expect(formatLength(2400, 'cm')).toBe('240 cm');
    expect(formatLength(2450, 'm')).toBe('2.45 m');
    expect(formatLength(2400, 'mm', { suffix: false })).toBe('2400');
  });
  it('formats feet and inches to the nearest 1/8"', () => {
    expect(formatLength(304.8, 'ftin')).toBe(`1' 0"`);
    expect(formatLength(2590.8, 'ftin')).toBe(`8' 6"`);
    expect(formatLength(12.7, 'ftin')).toBe(`1/2"`);
    expect(formatLength(25.4 * 5.375, 'ftin')).toBe(`5 3/8"`);
    expect(formatLength(3000, 'ftin')).toBe(`9' 10 1/8"`);
  });
  it('formats areas', () => {
    expect(formatArea(12e6, 'm')).toBe('12.00 m²');
    expect(formatArea(304.8 * 304.8 * 100, 'ftin')).toBe('100.0 ft²');
  });
});

describe('parseLength', () => {
  it('parses bare numbers in the default unit', () => {
    expect(parseLength('2400', 'mm')).toBe(2400);
    expect(parseLength('240', 'cm')).toBe(2400);
    expect(parseLength('2.4', 'm')).toBe(2400);
    expect(parseLength('12', 'ftin')).toBeCloseTo(304.8);
  });
  it('parses explicit metric units', () => {
    expect(parseLength('2400mm')).toBe(2400);
    expect(parseLength('240 cm')).toBe(2400);
    expect(parseLength('2.4m')).toBe(2400);
    expect(parseLength('2,4 m')).toBe(2400);
  });
  it('parses imperial forms', () => {
    expect(parseLength(`8'`)).toBeCloseTo(2438.4);
    expect(parseLength(`8' 6"`)).toBeCloseTo(2590.8);
    expect(parseLength(`8'6`)).toBeCloseTo(2590.8);
    expect(parseLength('8ft 6in')).toBeCloseTo(2590.8);
    expect(parseLength(`5 1/2"`)).toBeCloseTo(139.7);
    expect(parseLength(`2' 3 1/2"`)).toBeCloseTo(698.5);
    expect(parseLength('102in')).toBeCloseTo(2590.8);
  });
  it('rejects garbage', () => {
    expect(parseLength('')).toBeNull();
    expect(parseLength('abc')).toBeNull();
    expect(parseLength('12 parsecs')).toBeNull();
  });
  it('round-trips through formatLength', () => {
    for (const unit of ['mm', 'cm', 'm', 'ftin'] as const) {
      const mm = 3657.6; // 12'
      const back = parseLength(formatLength(mm, unit), unit)!;
      expect(Math.abs(back - mm)).toBeLessThan(unit === 'mm' ? 1 : 3.2);
    }
  });
});
