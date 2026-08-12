import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AuthenticatedRequestContext } from "../../../authentication/model/authenticated-request-context.types";
import { authCheckService } from "../../../authentication/services/auth-check.service";
import { createAuthenticatedRequestContextOutputRedactor } from "../../../authentication/services/authenticated-request-context-output-redaction.helpers";
import {
  authenticatedRequestContextService,
  normalizeExactOrigin,
} from "../../../authentication/services/authenticated-request-context.service";
import { getAppDataDirectory } from "../../../session/services/session-database";
import { buildAuthenticatedCurlConfig } from "./curl-authenticated-config.helpers";
import {
  PrepareAuthenticatedCurlRunInput,
  PreparedAuthenticatedCurlRun,
} from "./curl-authenticated-run.types";
import { quoteCurlShellValue } from "./curl-command.helpers";

export class CurlAuthenticatedRunService {
  private readonly rootDirectory: string;
  private readonly contextService: AuthenticatedContextLoader;
  private readonly isProceedAllowed: (sessionId: string) => boolean;

  constructor(options: CurlAuthenticatedRunServiceOptions = {}) {
    this.rootDirectory = options.rootDirectory ?? join(getAppDataDirectory(), "run-secrets");
    this.contextService = options.contextService ?? authenticatedRequestContextService;
    this.isProceedAllowed =
      options.isProceedAllowed ?? ((sessionId) => authCheckService.isProceedAllowed(sessionId));
  }

  async prepare({
    sessionId,
    targetUrl,
    command,
  }: PrepareAuthenticatedCurlRunInput): Promise<PreparedAuthenticatedCurlRun> {
    const contextVersion = this.contextService.getAuthStateVersion(sessionId);
    if (!this.isProceedAllowed(sessionId)) {
      throw new Error(
        "Authenticated cURL runs require an accepted Auth Check. Run Auth Check again if the context expired or was rejected.",
      );
    }
    const context = await this.contextService.loadProtectedContext(sessionId);
    if (!context) {
      throw new Error("Authenticated cURL runs require a saved authentication context.");
    }
    const redactOutput = createAuthenticatedRequestContextOutputRedactor(context);
    let runDirectory: string | null = null;
    const cleanup = () => {
      if (!runDirectory) return;
      rmSync(runDirectory, { recursive: true, force: true });
      runDirectory = null;
    };

    try {
      if (
        this.contextService.getAuthStateVersion(sessionId) !== contextVersion ||
        !this.isProceedAllowed(sessionId)
      ) {
        throw new Error("Authentication context changed before the authenticated cURL run.");
      }
      if (normalizeExactOrigin(context.origin) !== normalizeExactOrigin(targetUrl)) {
        throw new Error("Authentication context must match the cURL target's exact origin.");
      }
      mkdirSync(this.rootDirectory, { recursive: true, mode: 0o700 });
      chmodSync(this.rootDirectory, 0o700);
      runDirectory = mkdtempSync(join(this.rootDirectory, "curl-"));
      chmodSync(runDirectory, 0o700);
      const configPath = join(runDirectory, "authentication.conf");
      writeFileSync(configPath, buildAuthenticatedCurlConfig(context), {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
      chmodSync(configPath, 0o600);
      if (
        this.contextService.getAuthStateVersion(sessionId) !== contextVersion ||
        !this.isProceedAllowed(sessionId)
      ) {
        throw new Error("Authentication context changed before the authenticated cURL run.");
      }
      return {
        command: `${command} --config ${quoteCurlShellValue(configPath)}`,
        configPath,
        authenticationOrigin: normalizeExactOrigin(context.origin),
        cleanup,
        redactOutput,
      };
    } catch (error) {
      cleanup();
      const message = error instanceof Error ? redactOutput(error.message) : "cURL secret setup failed.";
      throw new Error(message);
    }
  }
}

export const curlAuthenticatedRunService = new CurlAuthenticatedRunService();

interface AuthenticatedContextLoader {
  loadProtectedContext: (sessionId: string) => Promise<AuthenticatedRequestContext | null>;
  getAuthStateVersion: (sessionId: string) => number;
}

interface CurlAuthenticatedRunServiceOptions {
  rootDirectory?: string;
  contextService?: AuthenticatedContextLoader;
  isProceedAllowed?: (sessionId: string) => boolean;
}
