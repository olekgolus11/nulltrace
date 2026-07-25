import { readPageInspectionAuthenticationSelections } from "./page-inspection-authentication-selection.helpers";

export class PageInspectionAuthenticationSelectionService {
  private readonly selectedAuthStateVersions = new Map<string, number>();

  constructor() {
    Object.entries(readPageInspectionAuthenticationSelections()).forEach(
      ([sessionId, authStateVersion]) => {
        this.selectedAuthStateVersions.set(sessionId, authStateVersion);
      },
    );
  }

  select(sessionId: string, authStateVersion: number) {
    this.selectedAuthStateVersions.set(sessionId, authStateVersion);
  }

  consume(sessionId: string, authStateVersion: number) {
    const selectedAuthStateVersion = this.selectedAuthStateVersions.get(sessionId);
    this.selectedAuthStateVersions.delete(sessionId);
    return selectedAuthStateVersion === authStateVersion;
  }

  clear(sessionId: string) {
    this.selectedAuthStateVersions.delete(sessionId);
  }

  isSelected(sessionId: string, authStateVersion: number) {
    return this.selectedAuthStateVersions.get(sessionId) === authStateVersion;
  }

  listSelectedAuthStateVersions(): Record<string, number> {
    return Object.fromEntries(this.selectedAuthStateVersions);
  }

  clearAll() {
    this.selectedAuthStateVersions.clear();
  }
}

export const pageInspectionAuthenticationSelectionService =
  new PageInspectionAuthenticationSelectionService();
