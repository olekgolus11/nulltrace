export interface ExecutionBrokerInstallationOptions {
  directory: string;
  installationId: string;
}

export interface ExecutionBrokerInstallation {
  directory: string;
  installationId: string;
  journalPath: string;
  hmacKey: Uint8Array;
  clientToken: string;
}
