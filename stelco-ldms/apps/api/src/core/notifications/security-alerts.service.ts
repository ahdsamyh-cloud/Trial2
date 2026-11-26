import { Injectable } from '@nestjs/common';
import { hit } from '../../common/rate-limit';
import { logger } from '../../common/logger';
import { NotificationsService } from './notifications.service';

/** Security alerts (PLAN §7.7): repeated denials, lockouts, admin role changes, mass downloads/exports, break-glass. */
@Injectable()
export class SecurityAlerts {
  constructor(private readonly notifications: NotificationsService) {}

  private async alert(roles: string[], title: string, body: string) {
    logger.warn({ securityAlert: title }, 'security alert'); // shipped to SIEM
    const ids = (await Promise.all(roles.map((r) => this.notifications.usersWithRole(r)))).flat();
    await this.notifications.notify(ids, { type: 'security.alert', title, body, link: '/admin/audit', emailAlways: true });
  }

  async onAccessDenied(subject: string) {
    const allowed = await hit(`denied:${subject}`, 20, 600).catch(() => true);
    if (!allowed && (await hit(`denied-alerted:${subject}`, 1, 3600).catch(() => false))) {
      await this.alert(['SUPER_ADMIN', 'HOD'], 'Repeated access-denied events', `More than 20 denied requests in 10 minutes from ${subject}.`);
    }
  }

  async repeatedLockout(username: string, count: number) {
    await this.alert(['SUPER_ADMIN'], 'Repeated account lockouts', `Account "${username}" has been locked ${count} times in 24 hours.`);
  }

  async roleChanged(username: string, roles: string, sensitive: boolean) {
    await this.alert(sensitive ? ['SUPER_ADMIN', 'HOD'] : ['SUPER_ADMIN'], 'Role change', `Roles for "${username}" changed to: ${roles || '(none)'}.`);
  }

  async onDownload(userId: string, username: string) {
    if (!(await hit(`dl:${userId}`, 50, 600).catch(() => true)) && (await hit(`dl-alerted:${userId}`, 1, 3600).catch(() => false))) {
      await this.alert(['HOD'], 'Mass download', `"${username}" downloaded more than 50 documents in 10 minutes.`);
    }
  }

  async onExport(userId: string, username: string, rows: number) {
    if (rows > 1000 || (!(await hit(`exp:${userId}`, 10, 3600).catch(() => true)) && (await hit(`exp-alerted:${userId}`, 1, 3600).catch(() => false)))) {
      await this.alert(['HOD'], 'Large or repeated export', `"${username}" exported ${rows} rows (or more than 10 exports in an hour).`);
    }
  }

  async breakGlass(username: string) {
    await this.alert(['SUPER_ADMIN', 'HOD'], 'Break-glass account used', `The break-glass account "${username}" signed in.`);
  }
}
