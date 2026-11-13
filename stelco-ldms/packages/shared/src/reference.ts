export type ReferencePrefix = 'LIT' | 'CMP' | 'DRF' | 'AWR' | 'INT';

/** `LGL-{UNIT}-{YEAR}-{SEQ}` with SEQ zero-padded to 4 digits (grows beyond 9999 if needed). */
export function formatReference(prefix: ReferencePrefix, year: number, seq: number): string {
  if (!Number.isInteger(seq) || seq < 1) throw new Error('seq must be a positive integer');
  return `LGL-${prefix}-${year}-${String(seq).padStart(4, '0')}`;
}

export const REFERENCE_PATTERN = /\bLGL-(LIT|CMP|DRF|AWR|INT)-(\d{4})-(\d{4,})\b/;

export function parseReference(text: string): { prefix: ReferencePrefix; year: number; seq: number; reference: string } | null {
  const m = REFERENCE_PATTERN.exec(text);
  if (!m) return null;
  return { prefix: m[1] as ReferencePrefix, year: Number(m[2]), seq: Number(m[3]), reference: m[0] };
}

/** Render `{{placeholders}}` in a template. Unknown keys render empty. Values are plain text. */
export function renderTemplate(template: string, values: Record<string, string | number | null | undefined>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_, k: string) => {
    const v = values[k];
    return v === null || v === undefined ? '' : String(v);
  });
}
