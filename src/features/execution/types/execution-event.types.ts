export type ExecutionOutputStream = "stdout" | "stderr";

export interface ExecutionOutputEvent {
  executionId: string;
  sequence: number;
  stream: ExecutionOutputStream | "system";
  line: string;
}

export interface ExecutionEventPage {
  executionId: string;
  events: ExecutionOutputEvent[];
  nextSequence: number;
  hasMore: boolean;
}
