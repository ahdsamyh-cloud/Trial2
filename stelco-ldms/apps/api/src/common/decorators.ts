import { SetMetadata, createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Permission } from '@ldms/shared';

export const PERMISSION_KEY = 'ldms:perm';
export const PUBLIC_KEY = 'ldms:public';
export const REAUTH_KEY = 'ldms:reauth';
export const PARTIAL_KEY = 'ldms:partial';
export const ADMIN_NET_KEY = 'ldms:adminnet';

/** Required permission for the route (any scope). Record-level scope is enforced in services. */
export const Can = (...perms: Permission[]) => SetMetadata(PERMISSION_KEY, perms);
/** No session required (login, setup link, health, QR check-in page). */
export const Public = () => SetMetadata(PUBLIC_KEY, true);
/** Requires a fresh re-authentication (password + TOTP within REAUTH_WINDOW_MIN). */
export const ReAuth = () => SetMetadata(REAUTH_KEY, true);
/** Allowed for a signed-in session that has not finished MFA or must change password. */
export const AllowPartial = () => SetMetadata(PARTIAL_KEY, true);
/** Route is subject to the optional admin IP allow-list. */
export const AdminNetwork = () => SetMetadata(ADMIN_NET_KEY, true);
/** Any authenticated user (no specific permission). Explicit so the guard-coverage check passes. */
export const Authenticated = () => SetMetadata(PERMISSION_KEY, []);

export const ClientIp = createParamDecorator((_: unknown, c: ExecutionContext) => c.switchToHttp().getRequest().ip as string);
