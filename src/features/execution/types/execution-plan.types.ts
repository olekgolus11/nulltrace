export interface ExecutionLimits {
  timeoutMs: number;
  memoryBytes: number;
  cpuMilliCores: number;
  processCount: number;
  scratchBytes: number;
  fileBytes: number;
  outputBytes: number;
}

export interface ExecutionInputSlot {
  id: string;
  kind: "data" | "secret";
  maximumBytes: number;
}

export interface ExecutionPlan {
  version: 1;
  executionId: string;
  authorizationId: string;
  profileId: string;
  tool: string;
  mode: string;
  invocation: { executableId: string; argv: string[] };
  origins: string[];
  inputs: ExecutionInputSlot[];
  limits: ExecutionLimits;
}

export interface ExecutionProfile {
  id: string;
  tool: string;
  mode: string;
  executableIds: string[];
  inputs: ExecutionInputSlot[];
  maximumLimits: ExecutionLimits;
}
