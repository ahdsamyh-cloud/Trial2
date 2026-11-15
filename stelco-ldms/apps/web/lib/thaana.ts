/**
 * Dhivehi (Thaana) phonetic keyboard: with the switch on, Latin keys type Thaana letters, using the
 * phonetic layout most Maldivian sites and the Windows "Divehi Phonetic" keyboard use
 * (h = ހ, s = ސ, a = ަ ...). Nothing needs installing on the computer.
 */
export const THAANA_PHONETIC: Record<string, string> = {
  q: 'ް', w: 'އ', e: 'ެ', r: 'ރ', t: 'ތ', y: 'ޔ', u: 'ު', i: 'ި', o: 'ޮ', p: 'ޕ',
  a: 'ަ', s: 'ސ', d: 'ދ', f: 'ފ', g: 'ގ', h: 'ހ', j: 'ޖ', k: 'ކ', l: 'ލ',
  z: 'ޒ', x: '×', c: 'ޗ', v: 'ވ', b: 'ބ', n: 'ނ', m: 'މ',
  Q: 'ޤ', W: 'ޢ', E: 'ޭ', R: 'ޜ', T: 'ޓ', Y: 'ޠ', U: 'ޫ', I: 'ީ', O: 'ޯ', P: '÷',
  A: 'ާ', S: 'ށ', D: 'ޑ', F: 'ﷲ', G: 'ޣ', H: 'ޙ', J: 'ޛ', K: 'ޚ', L: 'ޅ',
  Z: 'ޡ', X: 'ޘ', C: 'ޝ', V: 'ޥ', B: 'ޞ', N: 'ޏ', M: 'ޟ',
  ',': '،', ';': '؛', '?': '؟', '<': '>', '>': '<', '[': ']', ']': '[', '(': ')', ')': '(', '{': '}', '}': '{',
};

const TEXT_INPUTS = new Set(['text', 'search', '']);

/** Insert the Thaana letter for a key press into the focused text field; true if handled. */
export function handleThaanaKey(e: KeyboardEvent): boolean {
  if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing || e.key.length !== 1) return false;
  const ch = THAANA_PHONETIC[e.key];
  if (!ch) return false;
  const el = e.target as HTMLElement | null;
  if (!el) return false;
  const isArea = el instanceof HTMLTextAreaElement;
  const isText = el instanceof HTMLInputElement && TEXT_INPUTS.has(el.type.toLowerCase());
  if (!(isArea || isText) || (el as HTMLInputElement).readOnly || (el as HTMLInputElement).disabled) return false;
  const field = el as HTMLInputElement | HTMLTextAreaElement;
  if (field.maxLength > 0 && field.value.length >= field.maxLength && field.selectionStart === field.selectionEnd) return false;
  e.preventDefault();
  field.setRangeText(ch, field.selectionStart ?? field.value.length, field.selectionEnd ?? field.value.length, 'end');
  // Tell React the value changed (it listens for "input" events).
  field.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
}
