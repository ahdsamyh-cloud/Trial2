import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ExtractService } from './core/documents/extract.service';

const hasTools = (() => { try { execFileSync('tesseract', ['--version'], { stdio: 'ignore' }); execFileSync('pdftoppm', ['-v'], { stdio: 'ignore' }); return true; } catch { return false; } })();
const fixture = process.env.OCR_FIXTURE ?? join(__dirname, '..', 'test', 'fixtures', 'scanned-sample.pdf');

describe.skipIf(!hasTools || !existsSync(fixture))('OCR of scanned PDFs', () => {
  it('extracts text from an image-only PDF', async () => {
    process.env.OCR_ENABLED = 'true';
    const { resetConfigForTests } = await import('./config');
    resetConfigForTests();
    const r = await new ExtractService().extract('pdf', readFileSync(fixture));
    expect(r.ocr).toBe(true);
    expect(r.text.toLowerCase()).toContain('settlement');
  });
});
