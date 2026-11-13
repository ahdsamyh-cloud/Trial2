import { z, ZodTypeAny } from 'zod';
import { badRequest } from './errors';

/** A single query-string value. Repeated keys (?a=1&a=2) arrive as arrays and are refused. */
export function qs(v: unknown, max = 200): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'string') throw badRequest('Invalid query parameter');
  return v.slice(0, max);
}

/** All values of a query object as single strings. */
export function qrec(q: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries((q ?? {}) as Record<string, unknown>)) out[k] = qs(v, 500) ?? '';
  return out;
}

/** Parse untrusted input with a strict schema (unknown keys rejected → no mass assignment). */
export function parse<T extends ZodTypeAny>(schema: T, input: unknown): z.infer<T> {
  return schema.parse(input);
}

export const id = z.string().min(1).max(40).regex(/^[a-zA-Z0-9_-]+$/);
export const optId = id.nullish();
export const text = (max = 500) => z.string().trim().max(max);
export const reqText = (max = 500) => z.string().trim().min(1).max(max);
export const dateish = z.coerce.date();
export const money = z.union([z.number(), z.string().regex(/^-?\d+(\.\d{1,2})?$/)]).transform((v) => String(v));
export const pageQuery = z.object({
  page: z.coerce.number().int().min(1).max(10000).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  q: z.string().trim().max(200).optional(),
  sort: z.string().max(40).optional(),
  dir: z.enum(['asc', 'desc']).default('desc'),
  format: z.enum(['json', 'xlsx']).default('json'),
}).passthrough();
export type PageQuery = z.infer<typeof pageQuery>;
