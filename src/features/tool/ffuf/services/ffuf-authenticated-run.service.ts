import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
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
  buildAuthenticatedFfufRawRequest,
  replaceFfufOutputPath,
  replaceFfufRequestWithRawRequest,
} from "./ffuf-authenticated-request.helpers";
import {
  PrepareAuthenticatedFfufRunInput,
  PreparedAuthenticatedFfufRun,
} from "./ffuf-authenticated-run.types";

export class FfufAuthenticatedRunService {
  private readonly rootDirectory: string;
  private readonly contextService: AuthenticatedContextLoader;
  private readonly isProceedAllowed: (sessionId: string) => boolean;
  private readonly writeSecretFile: (path: string, content: string) => void;

  constructor(options: FfufAuthenticatedRunServiceOptions = {}) {
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
    targetUrl,
    command,
    toolData,
    artifactOutputPath,
  }: PrepareAuthenticatedFfufRunInput): Promise<PreparedAuthenticatedFfufRun> {
    const contextVersion = this.contextService.getAuthStateVersion(sessionId);
    if (!this.isProceedAllowed(sessionId)) {
      throw new Error(
        "Authenticated FFUF runs require an accepted Auth Check. Run Auth Check again if the context expired or was rejected.",
      );
    }
    const context = await this.contextService.loadProtectedContext(sessionId);
    if (!context) {
      throw new Error("Authenticated FFUF runs require a saved authentication context.");
    }
    if (
      this.contextService.getAuthStateVersion(sessionId) !== contextVersion ||
      !this.isProceedAllowed(sessionId)
    ) {
      throw new Error(
        "Authentication context changed or expired before the authenticated FFUF run.",
      );
    }
    const targetOrigin = normalizeExactOrigin(targetUrl);
    if (normalizeExactOrigin(context.origin) !== targetOrigin) {
      throw new Error("Authentication context must match the FFUF target's exact origin.");
    }
    const target = new URL(targetUrl);
    const rawRequest = buildAuthenticatedFfufRawRequest(target.toString(), toolData, context);
    const redactOutput = createAuthenticatedRequestContextOutputRedactor(context);
    const redactArtifact = createAuthenticatedRequestContextJsonRedactor(context);
    let runDirectory: string | null = null;
    let temporaryOutputPath: string | null = null;
    const cleanup = () => {
      if (!runDirectory) return;
      rmSync(runDirectory, { recursive: true, force: true });
      runDirectory = null;
    };

    try {
      mkdirSync(this.rootDirectory, { recursive: true, mode: 0o700 });
      chmodSync(this.rootDirectory, 0o700);
      runDirectory = mkdtempSync(join(this.rootDirectory, "ffuf-"));
      chmodSync(runDirectory, 0o700);
      const secretFilePath = join(runDirectory, "request.txt");
      temporaryOutputPath = join(runDirectory, "ffuf.json");
      this.writeSecretFile(secretFilePath, rawRequest);
      chmodSync(secretFilePath, 0o600);
      if (
        this.contextService.getAuthStateVersion(sessionId) !== contextVersion ||
        !this.isProceedAllowed(sessionId)
      ) {
        throw new Error(
          "Authentication context changed or expired before the authenticated FFUF run.",
        );
      }
      const commandWithTemporaryOutput = replaceFfufOutputPath(
        command,
        temporaryOutputPath,
      );
      return {
        command: replaceFfufRequestWithRawRequest(
          commandWithTemporaryOutput,
          secretFilePath,
          target.protocol.slice(0, -1),
        ),
        secretFilePath,
        cleanup,
        prepareArtifacts: () => {
          if (!temporaryOutputPath || !existsSync(temporaryOutputPath)) return;
          const redacted = redactArtifact(readFileSync(temporaryOutputPath, "utf8"));
          mkdirSync(dirname(artifactOutputPath), { recursive: true });
          writeFileSync(artifactOutputPath, redacted, {
            encoding: "utf8",
            mode: 0o600,
          });
          chmodSync(artifactOutputPath, 0o600);
        },
        redactOutput,
        redactArtifact,
      };
    } catch (error) {
      cleanup();
      const message =
        error instanceof Error ? redactOutput(error.message) : "FFUF secret setup failed.";
      throw new Error(message);
    }
  }
}

export const ffufAuthenticatedRunService = new FfufAuthenticatedRunService();

interface AuthenticatedContextLoader {
  loadProtectedContext: (sessionId: string) => Promise<AuthenticatedRequestContext | null>;
  getAuthStateVersion: (sessionId: string) => number;
}

interface FfufAuthenticatedRunServiceOptions {
  rootDirectory?: string;
  contextService?: AuthenticatedContextLoader;
  isProceedAllowed?: (sessionId: string) => boolean;
  writeSecretFile?: (path: string, content: string) => void;
}
