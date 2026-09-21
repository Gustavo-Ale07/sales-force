import { Module } from '@nestjs/common';
import { MirrorRepository } from './mirror.repository.js';

/** Read access to the local ERP mirror. Writes belong to the worker sync jobs (STACK-2, SNK-1). */
@Module({ providers: [MirrorRepository], exports: [MirrorRepository] })
export class MirrorModule {}
