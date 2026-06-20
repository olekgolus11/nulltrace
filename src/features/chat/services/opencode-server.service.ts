import { ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { createServer } from "node:net";
import { createOpencodeClient, OpencodeClient } from "@opencode-ai/sdk";
import {
  getOpenCodeExecutable,
  getOpenCodeRuntimeEnvironment,
  getOpenCodeRuntimeRoot,
  getSessionChatWorkspace,
} from "./opencode-runtime.config";

interface RunningOpenCodeServer {
  process: ChildProcessWithoutNullStreams;
  url: string;
}

type RetryPolicy = "never" | "once-after-crash";

function readStartupTimeout() {
  const rawValue = process.env.OPENCODE_TIMEOUT_MS;
  const parsedValue = rawValue ? Number(rawValue) : 10_000;
  return Number.isFinite(parsedValue) ? parsedValue : 10_000;
}

function isConnectionFailure(error: unknown): boolean {
  if (error instanceof TypeError) {
    return true;
  }

  if (!(error instanceof Error)) {
    return false;
  }

  if (/ECONN|fetch failed|connection|socket/i.test(error.message)) {
    return true;
  }

  return isConnectionFailure(error.cause);
}

function reserveSystemPort() {
  return new Promise<number>((resolve, reject) => {
    const reservation = createServer();
    reservation.once("error", reject);
    reservation.listen(0, "127.0.0.1", () => {
      const address = reservation.address();
      if (!address || typeof address === "string") {
        reservation.close();
        reject(new Error("Could not reserve a localhost port for OpenCode."));
        return;
      }

      reservation.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(address.port);
      });
    });
  });
}

function stopProcess(child: ChildProcessWithoutNullStreams) {
  if (child.exitCode !== null) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve) => {
    const forceKillTimeout = setTimeout(() => {
      if (child.exitCode === null) {
        child.kill("SIGKILL");
      }
    }, 2_000);

    child.once("exit", () => {
      clearTimeout(forceKillTimeout);
      resolve();
    });
    child.kill("SIGTERM");
  });
}

export class OpenCodeServerService {
  private server: RunningOpenCodeServer | null = null;
  private startingServer: Promise<RunningOpenCodeServer> | null = null;
  private startingProcess: ChildProcessWithoutNullStreams | null = null;

  async run<T>(
    sessionId: string,
    retryPolicy: RetryPolicy,
    operation: (client: OpencodeClient) => Promise<T>,
  ): Promise<T> {
    const server = await this.ensureServer();

    try {
      return await operation(this.createClient(server.url, sessionId));
    } catch (error) {
      const hasCrashed = server.process.exitCode !== null;
      if (
        retryPolicy === "never" ||
        (!hasCrashed && !isConnectionFailure(error))
      ) {
        throw error;
      }

      await this.restartServer(server);
      const restartedServer = await this.ensureServer();
      return operation(this.createClient(restartedServer.url, sessionId));
    }
  }

  async close() {
    const server = this.server;
    const startingProcess = this.startingProcess;
    this.server = null;
    this.startingServer = null;
    this.startingProcess = null;

    if (startingProcess && startingProcess.exitCode === null) {
      await stopProcess(startingProcess);
    }

    if (!server || server.process.exitCode !== null) {
      return;
    }

    await stopProcess(server.process);
  }

  private createClient(url: string, sessionId: string) {
    return createOpencodeClient({
      baseUrl: url,
      directory: getSessionChatWorkspace(sessionId),
      throwOnError: true,
    });
  }

  private ensureServer() {
    if (this.server && this.server.process.exitCode === null) {
      return Promise.resolve(this.server);
    }

    if (!this.startingServer) {
      this.startingServer = this.startServer().finally(() => {
        this.startingServer = null;
      });
    }

    return this.startingServer;
  }

  private async startServer(): Promise<RunningOpenCodeServer> {
    const port = await reserveSystemPort();
    const child = spawn(
      getOpenCodeExecutable(),
      [
        "serve",
        "--hostname=127.0.0.1",
        `--port=${port}`,
        "--pure",
      ],
      {
        cwd: getOpenCodeRuntimeRoot(),
        env: getOpenCodeRuntimeEnvironment(),
      },
    );
    this.startingProcess = child;

    let url: string;
    try {
      url = await this.waitForServerUrl(child);
    } finally {
      if (this.startingProcess === child) {
        this.startingProcess = null;
      }
    }
    const server = { process: child, url };
    this.server = server;

    child.once("exit", () => {
      if (this.server?.process === child) {
        this.server = null;
      }
    });

    return server;
  }

  private waitForServerUrl(child: ChildProcessWithoutNullStreams) {
    return new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => {
        child.kill("SIGTERM");
        reject(
          new Error(
            `OpenCode did not start within ${readStartupTimeout()}ms.`,
          ),
        );
      }, readStartupTimeout());
      let output = "";
      let stderr = "";

      const rejectStartup = (error: Error) => {
        clearTimeout(timeout);
        reject(error);
      };

      child.stdout.on("data", (chunk: Buffer) => {
        output += chunk.toString();
        const match = output.match(
          /opencode server listening[^\n]*on\s+(https?:\/\/[^\s]+)/,
        );
        if (!match) {
          return;
        }

        clearTimeout(timeout);
        resolve(match[1]);
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      child.once("error", (error) => {
        rejectStartup(
          new Error(
            `Could not start OpenCode executable "${getOpenCodeExecutable()}": ${error.message}`,
          ),
        );
      });
      child.once("exit", (code, signal) => {
        rejectStartup(
          new Error(
            `OpenCode exited before startup (code ${code ?? "none"}, signal ${signal ?? "none"})${stderr.trim() ? `: ${stderr.trim()}` : "."}`,
          ),
        );
      });
    });
  }

  private async restartServer(failedServer: RunningOpenCodeServer) {
    if (this.server?.process !== failedServer.process) {
      return;
    }

    this.server = null;
    if (failedServer.process.exitCode === null) {
      await stopProcess(failedServer.process);
    }
  }
}

export const openCodeServerService = new OpenCodeServerService();
