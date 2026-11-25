import { Module } from '@nestjs/common';
import { EventsController } from './events.controller.js';
import { EventsHub } from './events.hub.js';

/** RT-1: change pings over Server-Sent Events. API process only (the worker only NOTIFYs). */
@Module({
  controllers: [EventsController],
  providers: [EventsHub],
})
export class EventsModule {}
