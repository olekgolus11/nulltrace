export interface CurlWorkerBodyOperation {
  kind: "data" | "data-raw" | "data-binary";
  value: string;
}

export interface CurlWorkerInput {
  version: 1;
  targetUrl: string;
  exactOrigin: string;
  method: string;
  headers: string[];
  bodyOperations: CurlWorkerBodyOperation[];
  maximumRedirectCount: number;
  maximumResponseBytes: number;
  timeoutSeconds: number;
}
