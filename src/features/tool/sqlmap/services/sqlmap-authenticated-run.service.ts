import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AuthenticatedRequestContext } from "../../../authentication/model/authenticated-request-context.types";
import { authCheckService } from "../../../authentication/services/auth-check.service";
import {
  createAuthenticatedRequestContextJsonRedactor,
  createAuthenticatedRequestContextOutputRedactor,
} from "../../../authentication/services/authenticated-request-context-output-redaction.helpers";
import {
  authenticatedRequestContextService,
  normalizeExactOrigin,
} from "../../../authentication/services/authenticated-request-context.service";
import { getAppDataDirectory } from "../../../session/services/session-database";
import {
  buildAuthenticatedSqlmapRawRequest,
  replaceSqlmapRequestWithRawRequest,
} from "./sqlmap-authenticated-request.helpers";
import {
  PrepareAuthenticatedSqlmapRunInput,
  PreparedAuthenticatedSqlmapRun,
} from "./sqlmap-authenticated-run.types";
import { validateTargetedSqlmapCommand } from "./sqlmap-command.helpers";

export class SqlmapAuthenticatedRunService {
  private readonly rootDirectory: string;
  private readonly contextService: AuthenticatedContextLoader;
  private readonly isProceedAllowed: (sessionId: string) => boolean;
  private readonly writeSecretFile: (path: string, content: string) => void;

  constructor(options: SqlmapAuthenticatedRunServiceOptions = {}) {
    this.rootDirectory = options.rootDirectory ?? join(getAppDataDirectory(), "run-secrets");
    this.contextService = options.contextService ?? authenticatedRequestContextService;
    this.isProceedAllowed =
      options.isProceedAllowed ?? ((sessionId) => authCheckService.isProceedAllowed(sessionId));
    this.writeSecretFile =
      options.writeSecretFile ??
      ((path, content) => {
        writeFileSync(path, content, {
          encoding: "utf8",
          flag: "wx",
          mode: 0o600,
        });
      });
  }

  async prepare({
    sessionId,
    command,
  }: PrepareAuthenticatedSqlmapRunInput): Promise<PreparedAuthenticatedSqlmapRun> {
    const validated = validateTargetedSqlmapCommand(command);
    const contextVersion = this.contextService.getAuthStateVersion(sessionId);
    if (!this.isProceedAllowed(sessionId)) {
      throw new Error(
        "Authenticated sqlmap runs require an accepted Auth Check. Run Auth Check again if the context expired or was rejected.",
      );
    }
    const context = await this.contextService.loadProtectedContext(sessionId);
    if (!context) {
      throw new Error("Authenticated sqlmap runs require a saved authentication context.");
    }
    if (
      this.contextService.getAuthStateVersion(sessionId) !== contextVersion ||
      !this.isProceedAllowed(sessionId)
    ) {
      throw new Error(
        "Authentication context changed or expired before the authenticated sqlmap run.",
      );
    }
    if (normalizeExactOrigin(context.origin) !== normalizeExactOrigin(validated.targetUrl)) {
      throw new Error("Authentication context must match the sqlmap target's exact origin.");
    }

    const redactOutput = createAuthenticatedRequestContextOutputRedactor(context);
    const redactArtifact = createAuthenticatedRequestContextJsonRedactor(context);
    const rawRequest = buildAuthenticatedSqlmapRawRequest(command, context);
    let runDirectory: string | null = null;
    const cleanup = () => {
      if (!runDirectory) return;
      rmSync(runDirectory, { recursive: true, force: true });
      runDirectory = null;
    };

    try {
      mkdirSync(this.rootDirectory, { recursive: true, mode: 0o700 });
      chmodSync(this.rootDirectory, 0o700);
      runDirectory = mkdtempSync(join(this.rootDirectory, "sqlmap-"));
      chmodSync(runDirectory, 0o700);
      const secretFilePath = join(runDirectory, "request.txt");
      this.writeSecretFile(secretFilePath, rawRequest);
      chmodSync(secretFilePath, 0o600);
      if (
        this.contextService.getAuthStateVersion(sessionId) !== contextVersion ||
        !this.isProceedAllowed(sessionId)
      ) {
        throw new Error(
          "Authentication context changed or expired before the authenticated sqlmap run.",
        );
      }
      return {
        command: replaceSqlmapRequestWithRawRequest(command, secretFilePath),
        secretFilePath,
        cleanup,
        redactOutput,
        redactArtifact,
      };
    } catch (error) {
      cleanup();
      const message =
        error instanceof Error ? redactOutput(error.message) : "sqlmap secret setup failed.";
      throw new Error(message);
    }
  }
}

export const sqlmapAuthenticatedRunService = new SqlmapAuthenticatedRunService();

interface AuthenticatedContextLoader {
  loadProtectedContext: (sessionId: string) => Promise<AuthenticatedRequestContext | null>;
  getAuthStateVersion: (sessionId: string) => number;
}

interface SqlmapAuthenticatedRunServiceOptions {
  rootDirectory?: string;
  contextService?: AuthenticatedContextLoader;
  isProceedAllowed?: (sessionId: string) => boolean;
  writeSecretFile?: (path: string, content: string) => void;
}
