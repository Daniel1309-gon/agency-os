import { Module } from '@nestjs/common';
import { TableauController } from './tableau.controller.js';
import { TableauService } from './tableau.service.js';
import { TableauClient } from './tableau.client.js';
import { TableauWorker } from './tableau.worker.js';

@Module({ controllers: [TableauController], providers: [TableauService, TableauClient, TableauWorker], exports: [TableauService] })
export class TableauModule {}
