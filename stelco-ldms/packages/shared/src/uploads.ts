/**
 * Upload allow-list shared by the browser (early, friendly rejection) and the API.
 * The API remains the authority: it re-checks the extension AND the file's magic bytes,
 * then quarantines and virus-scans every file (apps/api/src/core/documents/filetype.ts).
 * A unit test keeps this list identical to the server's map.
 */
export const UPLOAD_EXTENSIONS = ['pdf', 'docx', 'xlsx', 'pptx', 'doc', 'xls', 'ppt', 'msg', 'eml', 'png', 'jpg', 'jpeg', 'txt', 'csv'] as const;
export const UPLOAD_ACCEPT = UPLOAD_EXTENSIONS.map((e) => `.${e}`).join(',');
/** Matches the API default MAX_UPLOAD_MB; the API enforces the configured value. */
export const UPLOAD_MAX_MB = 50;

/** Returns a user-facing problem with the file, or null if it may be sent. */
export function uploadProblem(name: string, size: number, maxMb = UPLOAD_MAX_MB): string | null {
  const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
  if (!(UPLOAD_EXTENSIONS as readonly string[]).includes(ext)) return `"${name}" is not an allowed file type`;
  if (size <= 0) return `"${name}" is empty`;
  if (size > maxMb * 1024 * 1024) return `"${name}" is larger than ${maxMb} MB`;
  return null;
}
