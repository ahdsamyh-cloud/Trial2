import { describe, expect, it } from 'vitest';
import { sniff, FileRejected, cleanFilename } from './core/documents/filetype';
import { sanitizeEmailHtml } from './core/intake/email-parser';
import { CryptoService } from './common/crypto.service';
import { canonicalize } from './core/audit/audit.service';
import { safeCell } from './core/export/export.service';
import { checkPassword } from './core/auth/passwords';

function zip(entries: string[]): Buffer {
  // Minimal stored ZIP (no compression) with given entry names.
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const name of entries) {
    const n = Buffer.from(name);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(n.length, 26);
    locals.push(lh, n);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(n.length, 28); ch.writeUInt32LE(offset, 42);
    centrals.push(ch, n);
    offset += 30 + n.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

describe('file type allow-list (magic bytes)', () => {
  it('accepts real files and rejects mismatches', () => {
    expect(sniff('a.pdf', Buffer.from('%PDF-1.7\n...')).kind).toBe('pdf');
    expect(() => sniff('a.pdf', Buffer.from('MZ\x90\x00'))).toThrow(FileRejected);
    expect(() => sniff('a.exe', Buffer.from('MZ'))).toThrow(/not allowed/);
    expect(() => sniff('a.docm', Buffer.from('PK'))).toThrow(/not allowed/);
    expect(sniff('a.docx', zip(['[Content_Types].xml', 'word/document.xml'])).kind).toBe('docx');
    expect(() => sniff('a.docx', zip(['[Content_Types].xml', 'xl/workbook.xml']))).toThrow(/does not match/);
  });
  it('rejects OOXML with macros or embedded programs', () => {
    expect(() => sniff('a.docx', zip(['[Content_Types].xml', 'word/document.xml', 'word/vbaProject.bin']))).toThrow(/macros/);
    expect(() => sniff('a.xlsx', zip(['[Content_Types].xml', 'xl/workbook.xml', 'xl/embeddings/run.exe']))).toThrow(/macros/);
  });
  it('rejects binary content in text types and cleans filenames', () => {
    expect(() => sniff('a.txt', Buffer.from([0x41, 0x00, 0x42]))).toThrow(FileRejected);
    expect(cleanFilename('..\\..\\evil"<x>.pdf')).toBe('evil__x_.pdf');
  });
});

describe('email HTML sanitiser', () => {
  it('removes scripts, handlers, remote images, javascript: links and CSS url()', () => {
    const out = sanitizeEmailHtml('<div style="background:url(https://x/y)" onmouseover="x()">Hi<script>alert(1)</script><img src="https://t.example/p.gif" alt="logo"><a href="javascript:alert(1)">l</a><iframe src="https://e"></iframe><form action="/x"><input></form></div>');
    expect(out).not.toMatch(/script|onmouseover|t\.example|javascript:|iframe|<form|<input|url\(/i);
    expect(out).toContain('[image blocked: logo]');
  });
});

describe('field-level encryption and signing', () => {
  const crypto = new CryptoService();
  it('round-trips and detects tampering', () => {
    const e = crypto.encrypt('MVR 1,250,000 settlement')!;
    expect(e.startsWith('v1.k1.')).toBe(true);
    expect(crypto.decrypt(e)).toBe('MVR 1,250,000 settlement');
    const parts = e.split('.');
    parts[4] = Buffer.from('tampered').toString('base64url');
    expect(() => crypto.decrypt(parts.join('.'))).toThrow();
  });
  it('signed tokens expire and resist forgery', () => {
    const t = crypto.sign({ v: 'abc' }, 60);
    expect(crypto.verify<{ v: string }>(t)?.v).toBe('abc');
    expect(crypto.verify(t.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A')))).toBeNull();
    expect(crypto.verify(crypto.sign({ v: 'x' }, -1))).toBeNull();
  });
});

describe('audit canonicalisation and export safety', () => {
  it('sorts keys and masks secrets', () => {
    expect(JSON.stringify(canonicalize({ b: 1, a: { passwordHash: 'x', name: 'n' }, exposureEnc: 'v1...' }))).toBe('{"a":{"name":"n","passwordHash":"[masked]"},"b":1,"exposureEnc":"[masked]"}');
  });
  it('neutralises spreadsheet formulas', () => {
    expect(safeCell('=HYPERLINK("http://x")')).toBe('\'=HYPERLINK("http://x")');
    expect(safeCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(safeCell('Normal')).toBe('Normal');
    expect(safeCell(5)).toBe(5);
  });
});

describe('password policy', () => {
  it('blocks common and breached passwords', () => {
    expect(checkPassword('password1234')).not.toEqual([]);
    expect(checkPassword('Welcome2026!')).not.toEqual([]);
    expect(checkPassword('a long and unusual passphrase')).toEqual([]);
  });
});
