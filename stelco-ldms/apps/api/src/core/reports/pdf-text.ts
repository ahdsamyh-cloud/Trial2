import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, PDFFont, PDFPage, RGB, StandardFonts } from 'pdf-lib';

/**
 * Text for PDF reports that may contain Dhivehi (Thaana) next to English.
 *
 * pdf-lib's standard fonts (Helvetica) only cover Latin, and pdf-lib draws text without OpenType
 * positioning, so Thaana vowel signs (fili) would land in the wrong place. Thaana runs are therefore laid
 * out with fontkit (right-to-left, with the font's mark positioning) and drawn glyph by glyph at the
 * positions fontkit computes. Latin runs use Helvetica. Paragraph direction follows the first strong
 * letter (like the browser's dir="auto"): a line that starts in Dhivehi runs right to left.
 *
 * Font: Noto Sans Thaana (SIL Open Font License 1.1, data/fonts/OFL.txt), subset into each PDF.
 */

const THAANA = /[ހ-޿]/;
const LATIN_LETTER = /[A-Za-zÀ-ɏ]/;
/** Characters Helvetica (WinAnsi) can encode; anything else is shown as "?". */
const WIN_ANSI = /[^\x20-\x7E\xA0-\xFF–—‘’‚“”„†‡•…‰‹›€™]/g;

let fontBytes: Buffer | undefined;
function thaanaBytes(): Buffer {
  // Works from src/ (tests) and dist/ (compiled): data/ sits next to both and ships with the API.
  fontBytes ??= readFileSync(join(__dirname, '..', '..', '..', 'data', 'fonts', 'NotoSansThaana-Regular.ttf'));
  return fontBytes;
}

interface FkGlyph { codePoints: number[] }
interface FkPos { xAdvance: number; xOffset: number; yOffset: number }
interface FkFont { unitsPerEm: number; layout(s: string, features?: unknown, script?: string, lang?: string, dir?: string): { glyphs: FkGlyph[]; positions: FkPos[] } }

export interface PdfFonts { regular: PDFFont; bold: PDFFont; thaana: PDFFont; fk: FkFont }

export async function embedReportFonts(doc: PDFDocument): Promise<PdfFonts> {
  doc.registerFontkit(fontkit);
  const bytes = thaanaBytes();
  return {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    thaana: await doc.embedFont(bytes, { subset: true }),
    fk: fontkit.create(bytes) as unknown as FkFont,
  };
}

type Run = { thaana: boolean; text: string };

/** Splits into Thaana / other runs; spaces and punctuation between two Thaana words stay in the Thaana run. */
export function runs(s: string): Run[] {
  const out: Run[] = [];
  for (const ch of s) {
    const th = THAANA.test(ch);
    const last = out[out.length - 1];
    if (last && last.thaana === th) last.text += ch;
    else out.push({ thaana: th, text: ch });
  }
  // Merge "Thaana · neutral · Thaana" (neutral = no Latin letters or digits) into one Thaana run.
  for (let i = 1; i < out.length - 1; i++) {
    if (!out[i]!.thaana && out[i - 1]!.thaana && out[i + 1]!.thaana && !/[A-Za-z0-9]/.test(out[i]!.text)) {
      out[i - 1]!.text += out[i]!.text + out[i + 1]!.text;
      out.splice(i, 2);
      i--;
    }
  }
  return out;
}

export function isRtl(s: string): boolean {
  for (const ch of s) {
    if (THAANA.test(ch)) return true;
    if (LATIN_LETTER.test(ch)) return false;
  }
  return false;
}

export const latinSafe = (s: string) => s.replace(WIN_ANSI, '?');

interface Placed { width: number; draw: (page: PDFPage, x: number, y: number, color: RGB) => void }

function place(run: Run, size: number, latin: PDFFont, f: PdfFonts): Placed {
  if (!run.thaana) {
    const text = latinSafe(run.text);
    return { width: latin.widthOfTextAtSize(text, size), draw: (p, x, y, color) => { if (text) p.drawText(text, { x, y, size, font: latin, color }); } };
  }
  const scale = size / f.fk.unitsPerEm;
  const lay = f.fk.layout(run.text, [], 'thaa', undefined, 'rtl'); // glyphs come back in visual (left-to-right) order
  const width = lay.positions.reduce((n, p) => n + p.xAdvance * scale, 0);
  return {
    width,
    draw: (p, x, y, color) => {
      let pen = x;
      lay.glyphs.forEach((g, i) => {
        const pos = lay.positions[i]!;
        const ch = String.fromCodePoint(...g.codePoints);
        if (ch.trim()) p.drawText(ch, { x: pen + pos.xOffset * scale, y: y + pos.yOffset * scale, size, font: f.thaana, color });
        pen += pos.xAdvance * scale;
      });
    },
  };
}

function swapEdgeSpaces(t: string) {
  // String trims instead of /\s*$/ (which backtracks badly on long runs of spaces).
  const core = t.trim();
  if (!core) return t;
  const leadLen = t.length - t.trimStart().length;
  const trailLen = t.length - t.trimEnd().length;
  return t.slice(t.length - trailLen) + core + t.slice(0, leadLen);
}

/** Width of a line of mixed text. */
export function widthOf(s: string, size: number, latin: PDFFont, f: PdfFonts): number {
  return runs(s).reduce((n, r) => n + place(r, size, latin, f).width, 0);
}

/**
 * Draws one line. `align: 'right'` treats x as the right edge. Returns the width drawn.
 * Right-to-left lines put their runs in reverse order, so an English word inside Dhivehi text keeps its place.
 */
export function drawLine(page: PDFPage, s: string, o: { x: number; y: number; size: number; font: PDFFont; fonts: PdfFonts; color: RGB; align?: 'left' | 'right' }): number {
  const rtl = isRtl(s);
  // In a right-to-left line an English run is drawn left of the Dhivehi before it, so its edge spaces swap sides.
  const parts = runs(s).map((r) => (rtl && !r.thaana ? { ...r, text: swapEdgeSpaces(r.text) } : r));
  const placed = parts.map((r) => place(r, o.size, o.font, o.fonts));
  if (rtl) placed.reverse();
  const width = placed.reduce((n, p) => n + p.width, 0);
  let x = o.align === 'right' ? o.x - width : o.x;
  for (const p of placed) { p.draw(page, x, o.y, o.color); x += p.width; }
  return width;
}
