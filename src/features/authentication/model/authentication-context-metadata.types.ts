export interface AuthenticationContextMetadataRow {
  sessionId: string;
  origin: string;
  cookieCount: number;
  headerNamesJson: string;
  storageMode: string;
  importSource: string;
  updatedAt: string;
  authCheckJson: string;
  localStorageEntryCount: number;
  sessionStorageEntryCount: number;
  contextGeneration: number | null;
}
