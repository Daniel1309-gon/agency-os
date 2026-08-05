import { Body, Controller, Delete, Get, Param, Post, UsePipes } from '@nestjs/common';
import { RequirePermissions } from '../../common/auth/decorators.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { CrewsService } from './crews.service.js';
import { crewMemberSchema, crewSchema, type CrewInput, type CrewMemberInput } from './crews.schemas.js';

@Controller('crews')
@RequirePermissions('crews.read')
export class CrewsController {
  constructor(private readonly crews: CrewsService) {}
  @Get() list() { return this.crews.list(); }
  @Post() @RequirePermissions('crews.manage') @UsePipes(new ZodValidationPipe(crewSchema)) create(@Body() body: CrewInput) { return this.crews.create(body); }
  @Post(':id/members') @RequirePermissions('crews.manage') @UsePipes(new ZodValidationPipe(crewMemberSchema)) add(@Param('id') id: string, @Body() body: CrewMemberInput) { return this.crews.addMember(id, body); }
  @Delete(':id/members/:userId') @RequirePermissions('crews.manage') remove(@Param('id') id: string, @Param('userId') userId: string) { return this.crews.remove(id, userId); }
}
