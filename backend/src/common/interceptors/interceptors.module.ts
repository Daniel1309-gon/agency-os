import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { DatabaseModule } from '../../database/database.module.js';
import { TransactionInterceptor } from './transaction.interceptor.js';

@Global()
@Module({ imports: [DatabaseModule], providers: [{ provide: APP_INTERCEPTOR, useClass: TransactionInterceptor }] })
export class InterceptorsModule {}
