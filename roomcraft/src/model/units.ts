import type { LengthUnit } from './types';

export const UNIT_LABELS: Record<LengthUnit, string> = {
  mm: 'Millimetres (mm)',
  cm: 'Centimetres (cm)',
  m: 'Metres (m)',
  ftin: 'Feet & inches',
};

const MM_PER_INCH = 25.4;

function trimNum(n: number, decimals: number): string {
  const s = n.toFixed(decimals);
  return decimals > 0 ? s.replace(/\.?0+$/, '') : s;
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/** Format a length in millimetres for display. ft-in is rounded to the nearest 1/8". */
export function formatLength(mm: number, unit: LengthUnit, opts: { suffix?: boolean } = {}): string {
  const suffix = opts.suffix ?? true;
  if (!Number.isFinite(mm)) return '–';
  switch (unit) {
    case 'mm':
      return `${Math.round(mm)}${suffix ? ' mm' : ''}`;
    case 'cm':
      return `${trimNum(mm / 10, 1)}${suffix ? ' cm' : ''}`;
    case 'm':
      return `${trimNum(mm / 1000, 3)}${suffix ? ' m' : ''}`;
    case 'ftin': {
      const neg = mm < 0;
      let eighths = Math.round((Math.abs(mm) / MM_PER_INCH) * 8);
      const feet = Math.floor(eighths / 96);
      eighths -= feet * 96;
      const inches = Math.floor(eighths / 8);
      const frac = eighths - inches * 8;
      let fracStr = '';
      if (frac) {
        const g = gcd(frac, 8);
        fracStr = ` ${frac / g}/${8 / g}`;
      }
      const inchStr = inches || !fracStr ? `${inches}${fracStr}` : fracStr.trim();
      const body = feet ? `${feet}' ${inchStr}"` : `${inchStr}"`;
      return (neg ? '-' : '') + body;
    }
  }
}

/** Format an area in mm² as m² or ft². */
export function formatArea(mm2: number, unit: LengthUnit): string {
  if (unit === 'ftin') return `${(mm2 / (304.8 * 304.8)).toFixed(1)} ft²`;
  return `${(mm2 / 1e6).toFixed(2)} m²`;
}

const UNIT_TO_MM: Record<string, number> = {
  mm: 1,
  cm: 10,
  m: 1000,
  in: MM_PER_INCH,
  '"': MM_PER_INCH,
  inch: MM_PER_INCH,
  inches: MM_PER_INCH,
  ft: 304.8,
  "'": 304.8,
  feet: 304.8,
  foot: 304.8,
};

function parseNumberToken(tok: string): number | null {
  // "5", "5.5", "1/2", "5 1/2" (space already split), "5-1/2"
  const t = tok.trim();
  if (/^\d+(\.\d+)?$|^\.\d+$/.test(t)) return parseFloat(t);
  const frac = /^(\d+)\/(\d+)$/.exec(t);
  if (frac) {
    const d = parseInt(frac[2], 10);
    return d ? parseInt(frac[1], 10) / d : null;
  }
  const mixed = /^(\d+)[-\s](\d+)\/(\d+)$/.exec(t);
  if (mixed) {
    const d = parseInt(mixed[3], 10);
    return d ? parseInt(mixed[1], 10) + parseInt(mixed[2], 10) / d : null;
  }
  return null;
}

/**
 * Parse a user-typed length into millimetres. Accepts e.g.
 * "2400", "2400mm", "240 cm", "2.4m", "8'", "8' 6\"", "8ft 6in", "8'6", "5 1/2\"", "102in".
 * A bare number is interpreted in `defaultUnit` (inches for ft-in when it has no feet mark).
 * Returns null when the text cannot be parsed.
 */
export function parseLength(input: string, defaultUnit: LengthUnit = 'mm'): number | null {
  let s = input.trim().toLowerCase().replace(/[′’]/g, "'").replace(/[″”]/g, '"').replace(/,/g, '.');
  if (!s) return null;
  let sign = 1;
  if (s.startsWith('-')) {
    sign = -1;
    s = s.slice(1).trim();
  }

  // Feet-and-inches forms: 8' 6", 8ft 6in, 8'6, 8' 6 1/2"
  const ftIn = /^(\d+(?:\.\d+)?)\s*(?:'|ft|feet|foot)\s*(?:(\d+(?:\.\d+)?(?:[\s-]+\d+\/\d+)?|\d+\/\d+)\s*(?:"|in|inch|inches)?)?$/.exec(s);
  if (ftIn) {
    const feet = parseFloat(ftIn[1]);
    const inches = ftIn[2] ? parseNumberToken(ftIn[2].replace(/\s+/g, ' ')) : 0;
    if (inches === null) return null;
    return sign * (feet * 304.8 + inches * MM_PER_INCH);
  }

  // Number with optional unit: 2400, 2.4m, 240 cm, 5 1/2", 102in
  const numUnit = /^(\d+(?:\.\d+)?(?:[\s-]+\d+\/\d+)?|\d+\/\d+|\.\d+)\s*(mm|cm|m|in|inch|inches|"|ft|feet|foot|')?$/.exec(s);
  if (numUnit) {
    const n = parseNumberToken(numUnit[1].replace(/\s+/g, ' '));
    if (n === null) return null;
    const u = numUnit[2];
    let factor: number;
    if (u) factor = UNIT_TO_MM[u];
    else if (defaultUnit === 'ftin') factor = MM_PER_INCH;
    else factor = UNIT_TO_MM[defaultUnit];
    return sign * n * factor;
  }
  return null;
}
