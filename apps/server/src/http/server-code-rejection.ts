/** Raised by the server-code guard: answered with a status and NO body, so the refusal reveals nothing about why. */
export class ServerCodeRejection extends Error {
  constructor(readonly status: 401 | 429) {
    super('server code refused');
    this.name = 'ServerCodeRejection';
  }
}
