export class HttpExecutionRunError extends Error {
  constructor(message: string, readonly cleanupConfirmed: boolean) {
    super(message);
    this.name = "HttpExecutionRunError";
  }
}
