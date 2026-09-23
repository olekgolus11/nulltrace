import { ExecutionBrokerOwnershipLock } from "./execution-broker-lock.types";

export interface HttpExecutionEndpoint {
  origin: string;
  hostname: string;
  address: string;
  family: 4 | 6;
  port: number;
}

export interface HttpExecutionNetworkPolicy {
  executionId: string;
  origins: string[];
  endpoints: HttpExecutionEndpoint[];
}

export interface HttpExecutionNetworkImages {
  worker: string;
  proxy: string;
  initializer: string;
}

export interface HttpExecutionNetworkOptions {
  images: HttpExecutionNetworkImages;
  installationId: string;
  ownershipLock: ExecutionBrokerOwnershipLock;
  trustedNonPublicMappings: Record<string, string[]>;
  commandTimeoutMs: number;
  setupTimeoutMs: number;
  cleanupTimeoutMs: number;
}

export interface HttpResolvedAddress {
  address: string;
  family: 4 | 6;
}

export interface HttpExecutionResolverOptions {
  trustedNonPublicMappings: Record<string, string[]>;
  timeoutMs?: number;
  lookup?: (hostname: string) => Promise<HttpResolvedAddress[]>;
}

export interface HttpExecutionNetworkEnvironment {
  executionId: string;
  workerContainerId: string;
  proxyContainerId: string;
  frontNetworkId: string;
  backNetworkId: string;
  proxyUrl: string;
}

export interface HttpExecutionNetworkResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface HttpExecutionNetworkEvidence {
  executionId: string;
  workerRulesSha256: string;
  proxyRulesSha256: string;
  proxyDecisions: string[];
  cleanupConfirmed: boolean;
}

export interface HttpExecutionNetworkRunResult {
  command: HttpExecutionNetworkResult;
  evidence: HttpExecutionNetworkEvidence;
}

export interface DockerCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface DockerCommandOptions {
  input?: Uint8Array;
  timeoutMs?: number;
  outputLimitBytes?: number;
  signal?: AbortSignal;
}

export interface DockerCommandAdapter {
  run(args: string[], options?: DockerCommandOptions): Promise<DockerCommandResult>;
}
