import { Injectable } from '@nestjs/common';
import { formatReference, ReferencePrefix } from '@ldms/shared';
import { Tx } from '../../common/prisma.service';

/** Gap-free, race-free reference numbers: row-locked counter per prefix and year. */
@Injectable()
export class ReferenceService {
  async next(tx: Tx, prefix: ReferencePrefix, at = new Date()): Promise<string> {
    const year = Number(new Date(at.getTime() + 5 * 3600_000).toISOString().slice(0, 4));
    const rows = await tx.$queryRaw<{ last: number }[]>`
      INSERT INTO "ReferenceSequence" ("prefix", "year", "last") VALUES (${prefix}, ${year}, 1)
      ON CONFLICT ("prefix", "year") DO UPDATE SET "last" = "ReferenceSequence"."last" + 1
      RETURNING "last"`;
    return formatReference(prefix, year, rows[0]!.last);
  }
}
