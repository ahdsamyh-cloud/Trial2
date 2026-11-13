import pino from 'pino';

/** Structured JSON logs. Redaction keeps secrets, tokens and content out of logs. */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'test' ? 'silent' : 'info'),
  base: { service: 'ldms-api' },
  redact: {
    paths: [
      'req.headers.cookie', 'req.headers.authorization', 'req.headers["x-csrf-token"]', 'res.headers["set-cookie"]',
      '*.password', '*.newPassword', '*.currentPassword', '*.code', '*.token', '*.secret', '*.bodyText', '*.bodyHtml', '*.extractedText',
    ],
    censor: '[redacted]',
  },
});
