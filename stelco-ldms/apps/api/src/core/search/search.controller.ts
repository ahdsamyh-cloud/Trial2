import { Controller, Get, Query } from '@nestjs/common';
import { Can } from '../../common/decorators';
import { qs } from '../../common/zod';
import { SearchService } from './search.service';

@Controller('search')
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Get()
  @Can('search:use', 'portal:use')
  find(@Query('q') q?: unknown, @Query('types') typesQ?: unknown) {
    const types = qs(typesQ, 200);
    return this.search.search(qs(q, 200) ?? '', types ? types.split(',').slice(0, 10) : undefined);
  }
}
