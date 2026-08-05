import { Module } from '@nestjs/common';
import { TableauController } from './tableau.controller.js';
import { TableauService } from './tableau.service.js';

@Module({ controllers: [TableauController], providers: [TableauService], exports: [TableauService] })
export class TableauModule {}
