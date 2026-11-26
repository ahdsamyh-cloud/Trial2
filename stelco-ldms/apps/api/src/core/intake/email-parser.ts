import { simpleParser, AddressObject } from 'mailparser';
import MsgReader from '@kenjiuno/msgreader';
import createDOMPurify from 'dompurify';
import { JSDOM } from 'jsdom';

export interface ParsedEmail {
  internetMessageId: string | null;
  conversationId: string | null;
  fromName: string | null;
  fromAddr: string | null;
  to: string[];
  cc: string[];
  sentAt: Date | null;
  subject: string | null;
  text: string;
  htmlSanitized: string | null;
  attachments: { filename: string; content: Buffer }[];
}

const window = new JSDOM('').window;
const purify = createDOMPurify(window as unknown as Parameters<typeof createDOMPurify>[0]);

purify.addHook('uponSanitizeAttribute', (_node, data) => {
  if (data.attrName === 'style' && /url\s*\(|expression\s*\(|@import|position\s*:\s*fixed/i.test(data.attrValue)) data.keepAttr = false;
});
purify.addHook('afterSanitizeAttributes', (node) => {
  const el = node as Element;
  if (el.tagName === 'IMG') {
    const src = el.getAttribute('src') ?? '';
    if (!/^data:image\/(png|jpeg|gif);base64,/i.test(src)) {
      // Remote images are tracking beacons and data leaks: replace with a placeholder.
      el.removeAttribute('src');
      el.setAttribute('alt', `[image blocked${el.getAttribute('alt') ? `: ${el.getAttribute('alt')}` : ''}]`);
    }
  }
  if (el.tagName === 'A') {
    el.setAttribute('rel', 'noopener noreferrer nofollow');
    el.setAttribute('target', '_blank');
  }
});

/** Untrusted email HTML → safe HTML (rendered later inside a sandboxed iframe with its own CSP). */
export function sanitizeEmailHtml(html: string): string {
  return purify.sanitize(html, {
    WHOLE_DOCUMENT: false,
    FORBID_TAGS: ['style', 'script', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'textarea', 'select', 'base', 'meta', 'link', 'svg', 'math', 'video', 'audio', 'source'],
    FORBID_ATTR: ['srcset', 'background', 'formaction', 'action', 'ping'],
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|data:image\/(?:png|jpeg|gif);base64,)/i,
  }) as string;
}

function addrList(a: AddressObject | AddressObject[] | undefined): string[] {
  if (!a) return [];
  return (Array.isArray(a) ? a : [a]).flatMap((x) => x.value.map((v) => (v.name ? `${v.name} <${v.address}>` : v.address ?? ''))).filter(Boolean).slice(0, 200);
}

export async function parseEml(buf: Buffer): Promise<ParsedEmail> {
  const m = await simpleParser(buf, { skipImageLinks: true, skipTextToHtml: true, maxHtmlLengthToParse: 2_000_000 });
  const from = m.from?.value[0];
  const threadIndex = m.headers.get('thread-index');
  return {
    internetMessageId: m.messageId ?? null,
    conversationId: typeof threadIndex === 'string' ? threadIndex.slice(0, 200) : null,
    fromName: from?.name || null,
    fromAddr: from?.address?.toLowerCase() ?? null,
    to: addrList(m.to),
    cc: addrList(m.cc),
    sentAt: m.date ?? null,
    subject: m.subject ?? null,
    text: (m.text ?? '').slice(0, 200_000),
    htmlSanitized: typeof m.html === 'string' ? sanitizeEmailHtml(m.html) : null,
    attachments: m.attachments.filter((a) => a.contentDisposition !== 'inline' || !!a.filename).slice(0, 50).map((a) => ({ filename: a.filename ?? 'attachment', content: a.content })),
  };
}

export function parseMsg(buf: Buffer): ParsedEmail {
  const reader = new MsgReader(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
  const d = reader.getFileData();
  if ((d as { error?: string }).error) throw new Error('Unreadable Outlook message');
  const headers = d.headers ?? '';
  const header = (name: string) => new RegExp(`^${name}:\\s*(.+)$`, 'im').exec(headers)?.[1]?.trim() ?? null;
  const recips = d.recipients ?? [];
  const fmt = (r: { name?: string; email?: string; smtpAddress?: string }) => (r.name ? `${r.name} <${r.smtpAddress ?? r.email ?? ''}>` : r.smtpAddress ?? r.email ?? '');
  const html = (d as { bodyHtml?: string }).bodyHtml ?? (d.html ? Buffer.from(d.html).toString('utf8') : null);
  const sent = d.clientSubmitTime ?? d.messageDeliveryTime ?? header('Date');
  return {
    internetMessageId: header('Message-ID'),
    conversationId: (d as { conversationIndex?: string }).conversationIndex ?? header('Thread-Index'),
    fromName: d.senderName ?? null,
    fromAddr: (d.senderSmtpAddress ?? d.senderEmail ?? '').toLowerCase() || null,
    to: recips.filter((r) => r.recipType !== 'cc' && r.recipType !== 'bcc').map(fmt).slice(0, 200),
    cc: recips.filter((r) => r.recipType === 'cc').map(fmt).slice(0, 200),
    sentAt: sent ? new Date(sent) : null,
    subject: d.subject ?? null,
    text: (d.body ?? '').slice(0, 200_000),
    htmlSanitized: html ? sanitizeEmailHtml(html) : null,
    attachments: (d.attachments ?? []).filter((a) => !a.innerMsgContent).slice(0, 50).map((a) => {
      const att = reader.getAttachment(a);
      return { filename: att.fileName ?? a.fileName ?? 'attachment', content: Buffer.from(att.content) };
    }),
  };
}
