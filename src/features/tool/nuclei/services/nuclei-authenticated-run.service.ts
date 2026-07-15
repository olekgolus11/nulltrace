import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { AuthenticatedRequestContext } from "../../../authentication/model/authenticated-request-context.types";
import {
  normalizeExactOrigin,
  authenticatedRequestContextService,
} from "../../../authentication/services/authenticated-request-context.service";
import { splitAuthenticatedHeaderEntries } from "../../../authentication/services/authenticated-request-context-redaction";
import { authCheckService } from "../../../authentication/services/auth-check.service";
import { getAppDataDirectory } from "../../../session/services/session-database";
import { shellQuote } from "./nuclei-shell";

interface AuthenticatedContextLoader {
  loadProtectedContext: (
    sessionId: string,
  ) => Promise<AuthenticatedRequestContext | null>;
}

interface NucleiAuthenticatedRunServiceOptions {
  rootDirectory?: string;
  contextService?: AuthenticatedContextLoader;
  isProceedAllowed?: (sessionId: string) => boolean;
  writeSecretFile?: (path: string, content: string) => void;
}

interface PrepareAuthenticatedNucleiRunInput {
  sessionId: string;
  targetUrl: string;
  command: string;
}

export interface PreparedAuthenticatedNucleiRun {
  command: string;
  secretFilePath: string;
  cleanup: () => void;
}

function quoteYaml(value: string) {
  return JSON.stringify(value);
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseCookieEntries(value: string) {
  return value
    .split(/[;\n\r]+/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const separatorIndex = entry.indexOf("=");
      return {
        key:
          separatorIndex === -1
            ? entry
            : entry.slice(0, separatorIndex).trim(),
        value:
          separatorIndex === -1
            ? ""
            : entry.slice(separatorIndex + 1).trim(),
      };
    })
    .filter((entry) => entry.key);
}

function parseHeaderEntries(value: string) {
  return splitAuthenticatedHeaderEntries(value)
    .map((entry) => {
      const separatorIndex = entry.indexOf(":");
      return {
        key: entry.slice(0, separatorIndex).trim(),
        value: entry.slice(separatorIndex + 1).trim(),
      };
    })
    .filter((entry) => entry.key && entry.value);
}

export function buildNucleiSecretFile(
  context: AuthenticatedRequestContext,
) {
  const exactOrigin = normalizeExactOrigin(context.origin);
  const domain = new URL(exactOrigin).host;
  const exactDomainPattern = `^${escapeRegex(domain)}$`;
  const cookies = parseCookieEntries(context.cookies);
  const headers = parseHeaderEntries(context.headers);
  const secretHeaders = [
    ...(cookies.length > 0
      ? [
          {
            key: "Cookie",
            value: cookies
              .map((cookie) => `${cookie.key}=${cookie.value}`)
              .join("; "),
          },
        ]
      : []),
    ...headers.filter(
      (header) => cookies.length === 0 || header.key.toLowerCase() !== "cookie",
    ),
  ];
  const lines = [
    `# nulltrace-exact-origin: ${quoteYaml(exactOrigin)}`,
    "static:",
  ];

  if (secretHeaders.length > 0) {
    lines.push(
      "  - type: header",
      "    domains-regex:",
      `      - ${quoteYaml(exactDomainPattern)}`,
      "    headers:",
      ...secretHeaders.flatMap((header) => [
        `      - key: ${quoteYaml(header.key)}`,
        `        value: ${quoteYaml(header.value)}`,
      ]),
    );
  }

  return `${lines.join("\n")}\n`;
}

export class NucleiAuthenticatedRunService {
  private readonly rootDirectory: string;
  private readonly contextService: AuthenticatedContextLoader;
  private readonly isProceedAllowed: (sessionId: string) => boolean;
  private readonly writeSecretFile: (path: string, content: string) => void;

  constructor(options: NucleiAuthenticatedRunServiceOptions = {}) {
    this.rootDirectory =
      options.rootDirectory ?? join(getAppDataDirectory(), "run-secrets");
    this.contextService =
      options.contextService ?? authenticatedRequestContextService;
    this.isProceedAllowed =
      options.isProceedAllowed ??
      ((sessionId) =>
        authCheckService.isProceedAllowed(sessionId));
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
  }: PrepareAuthenticatedNucleiRunInput): Promise<PreparedAuthenticatedNucleiRun> {
    if (!this.isProceedAllowed(sessionId)) {
      throw new Error(
        "Authenticated Nuclei runs require an accepted Auth Check.",
      );
    }

    const context = await this.contextService.loadProtectedContext(sessionId);
    if (!context) {
      throw new Error(
        "Authenticated Nuclei runs require a saved authentication context.",
      );
    }

    const targetOrigin = normalizeExactOrigin(targetUrl);
    if (context.origin !== targetOrigin) {
      throw new Error(
        "Authentication context must match the Nuclei target's exact origin.",
      );
    }

    let runDirectory: string | null = null;
    const cleanup = () => {
      if (!runDirectory) {
        return;
      }
      rmSync(runDirectory, { recursive: true, force: true });
      runDirectory = null;
    };

    try {
      mkdirSync(this.rootDirectory, { recursive: true, mode: 0o700 });
      chmodSync(this.rootDirectory, 0o700);
      runDirectory = mkdtempSync(join(this.rootDirectory, "nuclei-"));
      chmodSync(runDirectory, 0o700);
      const secretFilePath = join(runDirectory, "secrets.yaml");
      this.writeSecretFile(secretFilePath, buildNucleiSecretFile(context));
      chmodSync(secretFilePath, 0o600);

      return {
        command: `${command} -exclude-tags default-login -sf ${shellQuote(secretFilePath)}`,
        secretFilePath,
        cleanup,
      };
    } catch (error) {
      cleanup();
      throw error;
    }
  }
}

export const nucleiAuthenticatedRunService =
  new NucleiAuthenticatedRunService();
