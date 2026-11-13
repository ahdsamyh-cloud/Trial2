import { Module } from '@nestjs/common';
import { LitigationController } from './litigation.controller';
import { LitigationService } from './litigation.service';
import { LitigationImportService } from './import.service';

@Module({ controllers: [LitigationController], providers: [LitigationService, LitigationImportService], exports: [LitigationService] })
export class LitigationModule {}
