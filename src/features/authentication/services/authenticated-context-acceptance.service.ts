export class AuthenticatedContextAcceptanceService {
  private readonly acceptedSessions = new Set<string>();

  setProceedAllowed(sessionId: string, isProceedAllowed: boolean) {
    if (isProceedAllowed) {
      this.acceptedSessions.add(sessionId);
      return;
    }
    this.acceptedSessions.delete(sessionId);
  }

  isProceedAllowed(sessionId: string) {
    return this.acceptedSessions.has(sessionId);
  }

  clear(sessionId: string) {
    this.acceptedSessions.delete(sessionId);
  }
}

export const authenticatedContextAcceptanceService =
  new AuthenticatedContextAcceptanceService();
