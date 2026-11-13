/** NIST 800-63B style password policy: length only, no composition rules. */
export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 128;

export function passwordPolicyErrors(pw: string, context: { username?: string; displayName?: string } = {}): string[] {
  const errors: string[] = [];
  const len = [...pw].length;
  if (len < PASSWORD_MIN) errors.push(`Password must be at least ${PASSWORD_MIN} characters`);
  if (len > PASSWORD_MAX) errors.push(`Password must be at most ${PASSWORD_MAX} characters`);
  const lower = pw.toLowerCase();
  if (context.username && context.username.length >= 3 && lower.includes(context.username.toLowerCase())) errors.push('Password must not contain your username');
  if (/^(.)\1+$/.test(pw)) errors.push('Password must not be a single repeated character');
  if (/stelco/i.test(pw) && len < 20) errors.push('Passwords containing "stelco" must be at least 20 characters');
  return errors;
}
