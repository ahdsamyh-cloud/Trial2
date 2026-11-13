import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import { logger } from './logger';
import { ctx } from './context';

export class DomainError extends HttpException {
  constructor(status: number, message: string, readonly details?: unknown) {
    super({ message, details }, status);
  }
}
export const notFound = (what = 'Record') => new DomainError(404, `${what} not found`);
export const forbidden = (msg = 'You do not have permission to do that') => new DomainError(403, msg);
export const conflict = (msg: string, details?: unknown) => new DomainError(409, msg, details);
export const badRequest = (msg: string, details?: unknown) => new DomainError(400, msg, details);

/** Generic errors with a correlation id; details only for validation problems. Never stack traces. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse();
    const requestId = ctx().requestId;
    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let body: Record<string, unknown> = { message: 'Something went wrong. Quote this reference to IT.', requestId };

    if (exception instanceof ZodError) {
      status = 400;
      body = { message: 'Some fields are invalid', requestId, details: exception.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) };
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const r = exception.getResponse();
      const message = typeof r === 'string' ? r : (r as { message?: unknown }).message;
      body = { message: Array.isArray(message) ? message.join('; ') : message ?? exception.message, requestId };
      const details = typeof r === 'object' ? (r as { details?: unknown }).details : undefined;
      if (details !== undefined) body.details = details;
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') { status = 409; body = { message: 'A record with these details already exists', requestId }; }
      else if (exception.code === 'P2025') { status = 404; body = { message: 'Record not found', requestId }; }
      else if (exception.code === 'P2003') { status = 409; body = { message: 'This record is still in use', requestId }; }
    }
    if (status >= 500) logger.error({ requestId, err: exception instanceof Error ? { name: exception.name, message: exception.message, stack: exception.stack } : String(exception) }, 'unhandled error');
    res.status(status).json(body);
  }
}
