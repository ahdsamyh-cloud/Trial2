import { Injectable } from '@nestjs/common';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import mammoth from 'mammoth';
import { config } from '../../config';
import { logger } from '../../common/logger';
import type { Kind } from './filetype';

const run = promisify(execFile);
const MAX_TEXT = 2_000_000;

/**
 * Text extraction for search. Runs CLI tools with timeouts and no shell. In production
 * this runs in the isolated extractor container (no network, CPU/memory limits).
 */
@Injectable()
export class ExtractService {
  async extract(kind: Kind, buf: Buffer): Promise<{ text: string; ocr: boolean }> {
    try {
      switch (kind) {
        case 'pdf': {
          let text = await this.pdfText(buf);
          let ocr = false;
          if (text.replace(/\s/g, '').length < 50 && config().OCR_ENABLED) {
            text = await this.ocrPdf(buf);
            ocr = true;
          }
          return { text: text.slice(0, MAX_TEXT), ocr };
        }
        case 'docx':
          return { text: (await mammoth.extractRawText({ buffer: buf })).value.slice(0, MAX_TEXT), ocr: false };
        case 'txt': case 'csv': case 'eml':
          return { text: buf.toString('utf8').slice(0, MAX_TEXT), ocr: false };
        default:
          return { text: '', ocr: false };
      }
    } catch (err) {
      logger.warn({ kind, err: String(err).slice(0, 200) }, 'text extraction failed');
      return { text: '', ocr: false };
    }
  }

  private async withTemp<T>(buf: Buffer, fn: (dir: string, file: string) => Promise<T>): Promise<T> {
    const dir = await mkdtemp(join(tmpdir(), 'ldms-x-'));
    const file = join(dir, 'in.pdf');
    await writeFile(file, buf, { mode: 0o600 });
    try { return await fn(dir, file); } finally { await rm(dir, { recursive: true, force: true }); }
  }

  private pdfText(buf: Buffer) {
    return this.withTemp(buf, async (_dir, file) => {
      const { stdout } = await run('pdftotext', ['-enc', 'UTF-8', '-l', '500', file, '-'], { timeout: 60_000, maxBuffer: 20 * 1024 * 1024 });
      return stdout;
    });
  }

  private ocrPdf(buf: Buffer) {
    return this.withTemp(buf, async (dir, file) => {
      const out = join(dir, 'ocr.txt');
      await run('ocrmypdf', ['--skip-text', '--pages', `1-${config().OCR_MAX_PAGES}`, '--sidecar', out, '-q', file, join(dir, 'out.pdf')], { timeout: 600_000 });
      return readFile(out, 'utf8');
    });
  }
}
