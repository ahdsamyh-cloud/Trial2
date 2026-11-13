import { Module } from '@nestjs/common';
import { DraftingController } from './drafting.controller';
import { DraftingService } from './drafting.service';
import { RegistersService } from './registers.service';

@Module({ controllers: [DraftingController], providers: [DraftingService, RegistersService] })
export class DraftingModule {}
