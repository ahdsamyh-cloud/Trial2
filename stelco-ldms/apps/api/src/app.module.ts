import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ContextMiddleware } from './common/context.middleware';
import { AllExceptionsFilter } from './common/errors';
import { RateLimitMiddleware } from './common/rate-limit';
import { CoreModule } from './core/core.module';
import { AuthGuard } from './core/auth/auth.guard';
import { UNIT_MODULES } from './units';

@Module({
  imports: [CoreModule, ...UNIT_MODULES],
  providers: [
    { provide: APP_GUARD, useExisting: AuthGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(ContextMiddleware, RateLimitMiddleware).forRoutes('*');
  }
}
