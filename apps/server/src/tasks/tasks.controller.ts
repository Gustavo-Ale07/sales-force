import { Controller, Inject, Res } from '@nestjs/common';
import { API_BASE_PATH, routes, type Task, type TasksResponse } from '@salesforce/contracts';
import type { FastifyReply } from 'fastify';
import { ApiRoute, Contract, type RequestContract } from '../http/route.js';
import { CurrentUserParam, type CurrentUser } from '../iam/current-user.js';
import { TasksService } from './tasks.service.js';

@Controller(API_BASE_PATH)
export class TasksController {
  constructor(@Inject(TasksService) private readonly tasks: TasksService) {}

  @ApiRoute(routes.listTasks)
  list(
    @CurrentUserParam() user: CurrentUser,
    @Contract() contract: RequestContract<typeof routes.listTasks>,
  ): Promise<TasksResponse> {
    return this.tasks.list(user, contract.query);
  }

  @ApiRoute(routes.createTask)
  async create(
    @CurrentUserParam() user: CurrentUser,
    @Contract() contract: RequestContract<typeof routes.createTask>,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Task> {
    const { task, replayed } = await this.tasks.create(user, contract.body);
    if (replayed) void reply.status(200);
    return task;
  }

  @ApiRoute(routes.completeTask)
  complete(
    @CurrentUserParam() user: CurrentUser,
    @Contract() contract: RequestContract<typeof routes.completeTask>,
  ): Promise<Task> {
    return this.tasks.complete(user, contract.params.id, contract.body);
  }

  @ApiRoute(routes.cancelTask)
  cancel(
    @CurrentUserParam() user: CurrentUser,
    @Contract() contract: RequestContract<typeof routes.cancelTask>,
  ): Promise<Task> {
    return this.tasks.cancel(user, contract.params.id);
  }
}
