import { Injectable } from '@nestjs/common';
import { Socket } from 'node:net';
import { config } from '../../config';
import { logger } from '../../common/logger';

/** The standard, harmless antivirus test string (eicar.org). */
// Built from two halves so this source/bundle is never itself mistaken for the test file by an antivirus.
const EICAR = Buffer.from('X5O!P%@AP[4\\PZX54(P^)7CC)7}$' + 'EICAR-STANDARD-ANTIVIRUS-TEST-FILE!H+H*');

export interface ScanResult { status: 'CLEAN' | 'INFECTED' | 'ERROR'; detail?: string }

/** ClamAV clamd INSTREAM client (TCP, internal network only). */
@Injectable()
export class AvService {
  async scan(buf: Buffer): Promise<ScanResult> {
    const c = config();
    if (c.AV_MODE === 'eicar') {
      // Local edition without ClamAV: recognises ONLY the standard EICAR test file, so the
      // "infected upload is blocked" path can be tried. This is not a virus scanner.
      logger.warn('AV_MODE=eicar: only the EICAR test signature is detected (local edition only)');
      return buf.includes(EICAR) ? { status: 'INFECTED', detail: 'Eicar-Test-Signature' } : { status: 'CLEAN', detail: 'eicar-only' };
    }
    if (c.AV_MODE === 'off') {
      logger.warn('AV_MODE=off: upload marked clean without scanning (development only)');
      return { status: 'CLEAN', detail: 'scan-disabled' };
    }
    return new Promise<ScanResult>((resolve) => {
      const sock = new Socket();
      let reply = '';
      const done = (r: ScanResult) => { sock.destroy(); resolve(r); };
      sock.setTimeout(120_000, () => done({ status: 'ERROR', detail: 'timeout' }));
      sock.on('error', (e) => done({ status: 'ERROR', detail: e.message }));
      sock.on('data', (d) => { reply += d.toString('utf8'); });
      sock.on('end', () => {
        const text = reply.replace(/\0/g, '').trim();
        if (/: OK$/.test(text)) done({ status: 'CLEAN' });
        else if (/FOUND$/.test(text)) done({ status: 'INFECTED', detail: text.replace(/^stream: /, '').replace(/ FOUND$/, '') });
        else done({ status: 'ERROR', detail: text.slice(0, 200) });
      });
      sock.connect(c.CLAMD_PORT, c.CLAMD_HOST, () => {
        sock.write('zINSTREAM\0');
        const chunk = 64 * 1024;
        for (let i = 0; i < buf.length; i += chunk) {
          const part = buf.subarray(i, i + chunk);
          const len = Buffer.alloc(4);
          len.writeUInt32BE(part.length);
          sock.write(len);
          sock.write(part);
        }
        sock.write(Buffer.alloc(4));
      });
    });
  }
}
