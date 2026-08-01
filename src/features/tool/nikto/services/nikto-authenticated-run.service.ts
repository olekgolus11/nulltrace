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
import { buildNiktoAuthenticationConfig } from "./nikto-authenticated-run.helpers";
import { loadNiktoBaseConfig } from "./nikto-base-config.helpers";
import {
  PrepareAuthenticatedNiktoRunInput,
  PreparedAuthenticatedNiktoRun,
} from "./nikto-authenticated-run.types";
import { quoteNiktoShellValue } from "./nikto-command.helpers";
import { replaceNiktoOutputPath } from "./nikto-output-command.helpers";

export class NiktoAuthenticatedRunService {
  private readonly rootDirectory: string;
  private readonly contextService: AuthenticatedContextLoader;
  private readonly isProceedAllowed: (sessionId: string) => boolean;
  private readonly writeSecretFile: (path: string, content: string) => void;
  private readonly loadBaseConfig: () => string;

  constructor(options: NiktoAuthenticatedRunServiceOptions = {}) {
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
    this.loadBaseConfig = options.loadBaseConfig ?? loadNiktoBaseConfig;
  }

  async prepare({
    sessionId,
    targetUrl,
    command,
    artifactOutputPath,
  }: PrepareAuthenticatedNiktoRunInput): Promise<PreparedAuthenticatedNiktoRun> {
    const contextVersion = this.contextService.getAuthStateVersion(sessionId);
    if (!this.isProceedAllowed(sessionId)) {
      throw new Error(
        "Authenticated Nikto runs require an accepted Auth Check. Run Auth Check again if the context expired or was rejected.",
      );
    }
    const context = await this.contextService.loadProtectedContext(sessionId);
    if (!context) {
      throw new Error("Authenticated Nikto runs require a saved authentication context.");
    }
    if (
      this.contextService.getAuthStateVersion(sessionId) !== contextVersion ||
      !this.isProceedAllowed(sessionId)
    ) {
      throw new Error(
        "Authentication context changed or expired before the authenticated Nikto run.",
      );
    }
    if (normalizeExactOrigin(context.origin) !== normalizeExactOrigin(targetUrl)) {
      throw new Error("Authentication context must match the Nikto target's exact origin.");
    }

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
      const config = buildNiktoAuthenticationConfig(context, this.loadBaseConfig());
      mkdirSync(this.rootDirectory, { recursive: true, mode: 0o700 });
      chmodSync(this.rootDirectory, 0o700);
      runDirectory = mkdtempSync(join(this.rootDirectory, "nikto-"));
      chmodSync(runDirectory, 0o700);
      const secretFilePath = join(runDirectory, "nikto.conf");
      const temporaryOutputPrefix = join(runDirectory, "nikto");
      temporaryOutputPath = `${temporaryOutputPrefix}.json`;
      this.writeSecretFile(secretFilePath, config);
      chmodSync(secretFilePath, 0o600);
      if (
        this.contextService.getAuthStateVersion(sessionId) !== contextVersion ||
        !this.isProceedAllowed(sessionId)
      ) {
        throw new Error(
          "Authentication context changed or expired before the authenticated Nikto run.",
        );
      }
      const commandWithTemporaryOutput = replaceNiktoOutputPath(
        command,
        temporaryOutputPrefix,
      );

      return {
        command: `${commandWithTemporaryOutput} -config ${quoteNiktoShellValue(secretFilePath)}`,
        authenticationOrigin: normalizeExactOrigin(context.origin),
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
        error instanceof Error ? redactOutput(error.message) : "Nikto secret setup failed.";
      throw new Error(message);
    }
  }
}

export const niktoAuthenticatedRunService = new NiktoAuthenticatedRunService();

interface AuthenticatedContextLoader {
  loadProtectedContext: (sessionId: string) => Promise<AuthenticatedRequestContext | null>;
  getAuthStateVersion: (sessionId: string) => number;
}

interface NiktoAuthenticatedRunServiceOptions {
  rootDirectory?: string;
  contextService?: AuthenticatedContextLoader;
  isProceedAllowed?: (sessionId: string) => boolean;
  writeSecretFile?: (path: string, content: string) => void;
  loadBaseConfig?: () => string;
}
