export interface CurlWorkerConfiguration {
  version: 1;
  targetUrl: string;
  exactOrigin: string;
  method: string;
  headers: string[];
  bodyOperations: { kind: "data" | "data-raw" | "data-binary"; value: string }[];
  maximumRedirectCount: number;
  maximumResponseBytes: number;
  timeoutSeconds: number;
}
