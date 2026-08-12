export interface CurlExecutionInput {
  tokens: string[];
  method: string;
  targetUrl: string;
  exactOrigin: string;
  authenticationConfigPath: string | null;
  maximumRedirectCount: number;
  maximumResponseBytes: number;
  timeoutSeconds: number;
}

