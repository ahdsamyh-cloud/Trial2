import { z, ZodTypeAny } from 'zod';

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
