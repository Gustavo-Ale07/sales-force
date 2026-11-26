import { Module } from '@nestjs/common';
import { CustomersModule } from '../customers/customers.module.js';
import { TasksController } from './tasks.controller.js';
import { TasksRepository } from './tasks.repository.js';
import { TasksService } from './tasks.service.js';

/** Tasks (RF-ACT-1..3). API process only; reminders are produced by the notification sweep in the worker. */
@Module({
  imports: [CustomersModule],
  controllers: [TasksController],
  providers: [TasksRepository, TasksService],
})
export class TasksModule {}
