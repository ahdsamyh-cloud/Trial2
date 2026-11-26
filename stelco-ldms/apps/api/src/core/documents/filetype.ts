/**
 * File-type allow-list checked by real signature (magic bytes), not just the extension.
 * OOXML (docx/xlsx/pptx) archives are inspected for macros and zip-bomb characteristics.
 */
export type Kind = 'pdf' | 'docx' | 'xlsx' | 'pptx' | 'doc' | 'xls' | 'ppt' | 'msg' | 'eml' | 'png' | 'jpeg' | 'txt' | 'csv';

export const ALLOWED: Record<string, { kind: Kind; mime: string }> = {
  pdf: { kind: 'pdf', mime: 'application/pdf' },
  docx: { kind: 'docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  xlsx: { kind: 'xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  pptx: { kind: 'pptx', mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' },
  doc: { kind: 'doc', mime: 'application/msword' },
  xls: { kind: 'xls', mime: 'application/vnd.ms-excel' },
  ppt: { kind: 'ppt', mime: 'application/vnd.ms-powerpoint' },
  msg: { kind: 'msg', mime: 'application/vnd.ms-outlook' },
  eml: { kind: 'eml', mime: 'message/rfc822' },
  png: { kind: 'png', mime: 'image/png' },
  jpg: { kind: 'jpeg', mime: 'image/jpeg' },
  jpeg: { kind: 'jpeg', mime: 'image/jpeg' },
  txt: { kind: 'txt', mime: 'text/plain' },
  csv: { kind: 'csv', mime: 'text/csv' },
};

export class FileRejected extends Error {}

const OLE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

interface ZipEntry { name: string; compressed: number; uncompressed: number }

/** Read the ZIP central directory (no decompression). */
export function zipEntries(buf: Buffer): ZipEntry[] {
  const min = Math.max(0, buf.length - 65557);
  let eocd = -1;
  for (let i = buf.length - 22; i >= min; i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new FileRejected('Damaged archive');
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const entries: ZipEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (off + 46 > buf.length || buf.readUInt32LE(off) !== 0x02014b50) throw new FileRejected('Damaged archive');
    const compressed = buf.readUInt32LE(off + 20);
    const uncompressed = buf.readUInt32LE(off + 24);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    entries.push({ name: buf.subarray(off + 46, off + 46 + nameLen).toString('utf8'), compressed, uncompressed });
    off += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function checkOoxml(buf: Buffer, kind: 'docx' | 'xlsx' | 'pptx') {
  const entries = zipEntries(buf);
  if (entries.length > 5000) throw new FileRejected('Archive has too many entries');
  const total = entries.reduce((n, e) => n + e.uncompressed, 0);
  if (total > 500 * 1024 * 1024) throw new FileRejected('Archive expands too much');
  for (const e of entries) {
    if (e.uncompressed > 1024 * 1024 && e.compressed > 0 && e.uncompressed / e.compressed > 200) throw new FileRejected('Suspicious compression ratio');
    const n = e.name.toLowerCase();
    if (n.endsWith('vbaproject.bin') || n.includes('/activex/') || /\.(exe|dll|js|vbs|bat|cmd|ps1|scr|jar)$/.test(n)) throw new FileRejected('Files with macros or embedded programs are not allowed');
  }
  const names = new Set(entries.map((e) => e.name));
  const prefix = { docx: 'word/', xlsx: 'xl/', pptx: 'ppt/' }[kind];
  if (!names.has('[Content_Types].xml') || !entries.some((e) => e.name.startsWith(prefix))) throw new FileRejected('File content does not match its extension');
}

function isText(buf: Buffer) {
  if (buf.includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buf.subarray(0, 64 * 1024));
    return true;
  } catch {
    return false;
  }
}

export function sniff(filename: string, buf: Buffer): { kind: Kind; mime: string; ext: string } {
  const ext = (filename.split('.').pop() ?? '').toLowerCase();
  const allowed = ALLOWED[ext];
  if (!allowed || !filename.includes('.')) throw new FileRejected(`File type .${ext || '?'} is not allowed`);
  if (buf.length === 0) throw new FileRejected('File is empty');
  const head = buf.subarray(0, 8);
  const { kind } = allowed;
  const fail = () => { throw new FileRejected('File content does not match its extension'); };
  switch (kind) {
    case 'pdf':
      if (buf.subarray(0, 1024).indexOf('%PDF-') < 0) fail();
      break;
    case 'docx': case 'xlsx': case 'pptx':
      if (buf.readUInt32LE(0) !== 0x04034b50) fail();
      checkOoxml(buf, kind);
      break;
    case 'doc': case 'xls': case 'ppt': case 'msg':
      if (!head.equals(OLE)) fail();
      if (kind !== 'msg' && (buf.includes(Buffer.from('_VBA_PROJECT', 'utf16le')) || buf.includes(Buffer.from('Macros', 'utf16le')))) {
        throw new FileRejected('Files with macros are not allowed');
      }
      break;
    case 'png':
      if (!head.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) fail();
      break;
    case 'jpeg':
      if (!(buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff)) fail();
      break;
    case 'eml':
      if (!isText(buf) || !/^(?:[A-Za-z][A-Za-z0-9-]*:[^\r\n]*\r?\n(?:[ \t][^\r\n]*\r?\n)*)+/.test(buf.subarray(0, 8192).toString('utf8'))) fail();
      break;
    case 'txt': case 'csv':
      if (!isText(buf)) fail();
      break;
  }
  return { kind, mime: allowed.mime, ext };
}

/** Safe display filename: strip paths and control characters. */
export function cleanFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'file';
  return base.replace(/[\u0000-\u001f\u007f"<>|*?:]/g, '_').slice(0, 180) || 'file';
}
