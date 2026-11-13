import { Global, Module } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { CryptoService } from '../common/crypto.service';
import { AuditService } from './audit/audit.service';
import { AuditController } from './audit/audit.controller';
import { AuthController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import { SessionService } from './auth/session.service';
import { AuthGuard } from './auth/auth.guard';
import { CalendarController } from './calendar/calendar.controller';
import { CalendarService } from './calendar/calendar.service';
import { ConfigController } from './config/config.controller';
import { SettingsService } from './config/settings.service';
import { AvService } from './documents/av.service';
import { DocumentsController } from './documents/documents.controller';
import { DocumentsService } from './documents/documents.service';
import { ExtractService } from './documents/extract.service';
import { StorageService } from './documents/storage.service';
import { ExportService } from './export/export.service';
import { HealthController } from './health.controller';
import { IntakeController, PortalController } from './intake/intake.controller';
import { IntakeService } from './intake/intake.service';
import { JobsService } from './jobs/jobs.service';
import { MattersController, MyWorkController } from './matters/matters.controller';
import { MattersService } from './matters/matters.service';
import { ReferenceService } from './matters/reference.service';
import { NotificationsController } from './notifications/notifications.controller';
import { NotificationsService } from './notifications/notifications.service';
import { SecurityAlerts } from './notifications/security-alerts.service';
import { PolicyService } from './policy/policy.service';
import { SlaService } from './sla/sla.service';
import { UsersController } from './users/users.controller';
import { UsersService } from './users/users.service';

const providers = [
  PrismaService, CryptoService, AuditService, AuthService, SessionService, AuthGuard, CalendarService, SettingsService, AvService,
  DocumentsService, ExtractService, StorageService, ExportService, IntakeService, JobsService, MattersService, ReferenceService,
  NotificationsService, SecurityAlerts, PolicyService, SlaService, UsersService,
];

@Global()
@Module({
  controllers: [
    HealthController, AuthController, UsersController, AuditController, ConfigController, NotificationsController, DocumentsController,
    CalendarController, IntakeController, PortalController, MattersController, MyWorkController,
  ],
  providers,
  exports: providers,
})
export class CoreModule {}
