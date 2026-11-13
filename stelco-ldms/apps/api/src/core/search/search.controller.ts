import { Controller, Get, Query } from '@nestjs/common';
import { Can } from '../../common/decorators';
import { SearchService } from './search.service';

@Controller('search')
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Get()
  @Can('search:use', 'portal:use')
  find(@Query('q') q = '', @Query('types') types?: string) {
    return this.search.search(q, types ? types.split(',').slice(0, 10) : undefined);
  }
}
