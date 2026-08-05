import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, sql } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service.js';
import { PG_EXCLUSION_VIOLATION, isPgError } from '../../database/pg-error.js';
import { crewMembers, crews } from '../../database/schema/index.js';
import type { CrewInput, CrewMemberInput } from './crews.schemas.js';

@Injectable()
export class CrewsService {
  constructor(private readonly db: DatabaseService) {}
  async list() { return this.db.db.select().from(crews).where(eq(crews.isActive, true)).orderBy(asc(crews.name)); }
  async create(input: CrewInput) { const [row] = await this.db.db.insert(crews).values(input).returning(); return row; }
  async addMember(crewId: string, input: CrewMemberInput) { if (new Date(input.validFrom) >= new Date(input.validTo)) throw new ConflictException('Member range is invalid'); try { const [row] = await this.db.db.insert(crewMembers).values({ crewId, userId: input.userId, validRange: `[${input.validFrom},${input.validTo})` }).returning(); return row; } catch (error) { if (isPgError(error, PG_EXCLUSION_VIOLATION)) throw new ConflictException('Operator already belongs to a crew in this window'); throw error; } }
  async remove(crewId: string, userId: string) {
    const [row] = await this.db.db.update(crewMembers)
      .set({ validRange: sql`tstzrange(lower(${crewMembers.validRange}), now(), '[)')` as never })
      .where(and(eq(crewMembers.crewId, crewId), eq(crewMembers.userId, userId), sql`${crewMembers.validRange} @> now()`))
      .returning({ id: crewMembers.id });
    if (!row) throw new NotFoundException('Crew member not found');
    return row;
  }
}
