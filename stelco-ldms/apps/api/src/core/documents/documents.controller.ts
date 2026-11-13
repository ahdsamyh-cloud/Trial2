import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { z } from 'zod';
import { Authenticated, Can } from '../../common/decorators';
import { badRequest } from '../../common/errors';
import { parse, qs } from '../../common/zod';
import { config } from '../../config';
import { DocumentsService, OwnerType } from './documents.service';

const OWNER_TYPES = ['matter', 'intake', 'hearing', 'law', 'checkItem', 'finding', 'session', 'contract', 'poa', 'library'] as const;
const uploadSchema = z.object({
  ownerType: z.enum(OWNER_TYPES),
  ownerId: z.string().max(40).optional(),
  title: z.string().max(200).optional(),
  docTypeCode: z.string().max(40).optional(),
  documentId: z.string().max(40).optional(),
  stageLabel: z.string().max(40).optional(),
  comment: z.string().max(1000).optional(),
  libraryKind: z.enum(['TEMPLATE', 'MATERIAL', 'REPORT']).optional(),
  sharedToPortal: z.enum(['true', 'false']).optional(),
}).strict();

export const uploadInterceptor = () => FileInterceptor('file', { limits: { fileSize: Number(process.env.MAX_UPLOAD_MB ?? 50) * 1024 * 1024, files: 1, fields: 20 } });

@Controller()
export class DocumentsController {
  constructor(private readonly docs: DocumentsService) {}

  @Post('documents')
  @Authenticated()
  @UseInterceptors(uploadInterceptor())
  upload(@Body() body: unknown, @UploadedFile() file?: Express.Multer.File) {
    if (!file) throw badRequest('Choose a file to upload');
    const b = parse(uploadSchema, body);
    return this.docs.upload({ ...b, sharedToPortal: b.sharedToPortal === 'true', ownerType: b.ownerType as OwnerType, file });
  }

  @Get('documents')
  @Authenticated()
  list(@Query('ownerType') ownerType: unknown, @Query('ownerId') ownerId?: unknown) {
    const t = z.enum(OWNER_TYPES).parse(qs(ownerType, 20));
    return this.docs.listFor(t as OwnerType, qs(ownerId, 40) ?? '');
  }

  @Get('documents/:id')
  @Authenticated()
  get(@Param('id') id: string) {
    return this.docs.get(id);
  }

  @Post('documents/versions/:versionId/link')
  @Authenticated()
  @HttpCode(200)
  link(@Param('versionId') versionId: string) {
    return this.docs.downloadLink(versionId);
  }

  @Get('files/:token')
  @Authenticated()
  async file(@Param('token') token: string, @Res() res: Response) {
    const f = await this.docs.resolveDownload(token);
    res.setHeader('Content-Type', f.mime);
    res.setHeader('Content-Disposition', `attachment; filename="${f.filename.replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(f.filename)}`);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.end(f.body);
  }

  @Post('documents/:id/checkout')
  @Authenticated()
  @HttpCode(200)
  checkout(@Param('id') id: string) {
    return this.docs.checkout(id);
  }

  @Post('documents/:id/checkin')
  @Authenticated()
  @HttpCode(200)
  checkin(@Param('id') id: string) {
    return this.docs.checkin(id);
  }

  @Post('documents/:id/share')
  @Authenticated()
  @HttpCode(200)
  share(@Param('id') id: string, @Body() body: unknown) {
    return this.docs.share(id, parse(z.object({ shared: z.boolean() }).strict(), body).shared);
  }

  @Delete('documents/:id')
  @Can('doc:write')
  remove(@Param('id') id: string, @Query('reason') reasonQ?: unknown) {
    const reason = qs(reasonQ, 500) ?? '';
    if (reason.trim().length < 3) throw badRequest('Give a reason for deleting');
    return this.docs.remove(id, reason);
  }

  @Get('documents/:id/compare')
  @Can('doc:read')
  compare(@Param('id') id: string, @Query('a') a: unknown, @Query('b') b: unknown) {
    return this.docs.compare(id, Number(qs(a, 6)), Number(qs(b, 6)));
  }

  @Post('holds')
  @Can('hold:place', 'hold:release')
  @HttpCode(200)
  hold(@Body() body: unknown) {
    const b = parse(z.object({ scopeType: z.enum(['MATTER', 'DOCUMENT']), scopeId: z.string().max(40), on: z.boolean(), reason: z.string().trim().min(3).max(500) }).strict(), body);
    return this.docs.setHold(b.scopeType, b.scopeId, b.on, b.reason);
  }

  @Get('documents-config/limits')
  @Authenticated()
  limits() {
    return { maxMb: config().MAX_UPLOAD_MB, extensions: ['pdf', 'docx', 'xlsx', 'pptx', 'doc', 'xls', 'ppt', 'msg', 'eml', 'png', 'jpg', 'jpeg', 'txt', 'csv'] };
  }
}
