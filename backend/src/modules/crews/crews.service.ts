import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { AccessTokenClaims } from '../../common/auth/crypto.js';
import { AuditService } from '../../common/audit/audit.service.js';
import { DatabaseService } from '../../database/database.service.js';
import { PG_EXCLUSION_VIOLATION, isPgError } from '../../database/pg-error.js';
import { crewMembers, crews, roles, users } from '../../database/schema/index.js';
import type { CrewInput, CrewMemberInput } from './crews.schemas.js';

type ScopeActor = Pick<AccessTokenClaims, 'sub' | 'role'>;
const isGlobal = (actor: ScopeActor) => actor.role === 'ADMIN' || actor.role === 'DIRECTOR_OPERATIVO';

@Injectable()
export class CrewsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  async list(actor: ScopeActor) {
    const scope = isGlobal(actor)
      ? eq(crews.isActive, true)
      : actor.role === 'COORDINADOR'
        ? and(eq(crews.isActive, true), eq(crews.coordinatorId, actor.sub))
        : and(eq(crews.isActive, true), sql`exists (
            select 1 from crew_members member
            where member.crew_id = ${crews.id}
              and member.user_id = ${actor.sub}
              and member.valid_range @> now()
          )`);
    return this.db.db.select().from(crews).where(scope).orderBy(asc(crews.name));
  }

  async create(input: CrewInput, actor: ScopeActor) {
    if (!isGlobal(actor) && actor.role !== 'COORDINADOR') throw new ForbiddenException('Crew management is outside the actor scope');
    if (actor.role === 'COORDINADOR' && input.coordinatorId && input.coordinatorId !== actor.sub) {
      throw new ForbiddenException('Coordinator cannot create a crew for another coordinator');
    }
    if (input.coordinatorId && actor.role !== 'COORDINADOR') {
      const [coordinator] = await this.db.db.select({ id: users.id }).from(users).innerJoin(roles, eq(roles.id, users.roleId)).where(and(eq(users.id, input.coordinatorId), eq(users.status, 'ACTIVE'), eq(roles.code, 'COORDINADOR'))).limit(1);
      if (!coordinator) throw new ConflictException('Crew coordinator must be an active coordinator');
    }
    const [row] = await this.db.db.insert(crews).values({ ...input, coordinatorId: actor.role === 'COORDINADOR' ? actor.sub : input.coordinatorId, createdBy: actor.sub, updatedBy: actor.sub }).returning();
    await this.audit.record({ actorType: 'USER', actorUserId: actor.sub, action: 'crew.created', entityType: 'crew', entityId: row.id, result: 'SUCCESS', metadata: { crewId: row.id } });
    return row;
  }

  async addMember(crewId: string, input: CrewMemberInput, actor: ScopeActor) {
    if (new Date(input.validFrom) >= new Date(input.validTo)) throw new ConflictException('Member range is invalid');
    await this.assertManagedCrew(crewId, actor);
    const [operator] = await this.db.db.select({ id: users.id }).from(users).innerJoin(roles, eq(roles.id, users.roleId)).where(and(eq(users.id, input.userId), eq(users.status, 'ACTIVE'), eq(roles.code, 'OPERADOR'))).limit(1);
    if (!operator) throw new ConflictException('Crew member must be an active operator');
    try {
      const [row] = await this.db.db.insert(crewMembers).values({ crewId, userId: input.userId, validRange: `[${input.validFrom},${input.validTo})` }).returning();
      await this.audit.record({ actorType: 'USER', actorUserId: actor.sub, action: 'crew.member_added', entityType: 'crew_member', entityId: row.id, result: 'SUCCESS', metadata: { crewId, operatorId: input.userId } });
      return row;
    } catch (error) {
      if (isPgError(error, PG_EXCLUSION_VIOLATION)) throw new ConflictException('Operator already belongs to a crew in this window');
      throw error;
    }
  }

  async remove(crewId: string, userId: string, actor: ScopeActor) {
    await this.assertManagedCrew(crewId, actor);
    const [row] = await this.db.db.update(crewMembers)
      .set({ validRange: sql`tstzrange(lower(${crewMembers.validRange}), now(), '[)')` as never })
      .where(and(eq(crewMembers.crewId, crewId), eq(crewMembers.userId, userId), sql`${crewMembers.validRange} @> now()`))
      .returning({ id: crewMembers.id });
    if (!row) throw new NotFoundException('Crew member not found');
    await this.audit.record({ actorType: 'USER', actorUserId: actor.sub, action: 'crew.member_removed', entityType: 'crew_member', entityId: row.id, result: 'SUCCESS', metadata: { crewId, operatorId: userId } });
    return row;
  }

  private async assertManagedCrew(crewId: string, actor: ScopeActor): Promise<void> {
    const scope = isGlobal(actor)
      ? eq(crews.id, crewId)
      : and(eq(crews.id, crewId), eq(crews.coordinatorId, actor.sub));
    const [row] = await this.db.db.select({ id: crews.id }).from(crews).where(and(scope, eq(crews.isActive, true))).limit(1);
    if (!row) throw new ForbiddenException('Crew management is outside the actor scope');
  }
}
