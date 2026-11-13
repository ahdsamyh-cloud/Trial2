import { Injectable } from '@nestjs/common';
import { Socket } from 'node:net';
import { config } from '../../config';
import { logger } from '../../common/logger';

export interface ScanResult { status: 'CLEAN' | 'INFECTED' | 'ERROR'; detail?: string }

/** ClamAV clamd INSTREAM client (TCP, internal network only). */
@Injectable()
export class AvService {
  async scan(buf: Buffer): Promise<ScanResult> {
    const c = config();
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
