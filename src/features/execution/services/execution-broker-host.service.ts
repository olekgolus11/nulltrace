import { Database } from "bun:sqlite";
import { chmod, lstat, open, realpath, unlink } from "node:fs/promises";
import { join } from "node:path";
import { ExecutionBrokerHostOptions } from "../types/execution-broker-host.types";
import { DockerCommandService } from "./docker-command.service";
import { ExecutionBrokerHttpService } from "./execution-broker-http.service";
import { ExecutionBrokerLockService } from "./execution-broker-lock.service";
import { assertExecutionBrokerJournal } from "./execution-broker-journal.helpers";
import { ExecutionBrokerService } from "./execution-broker.service";
import { ExecutionReceiptRepository } from "./execution-receipt.repository";
import { ExecutionRecoveryService } from "./execution-recovery.service";
import { toExecutionOutcome } from "./execution-outcome.helpers";
import { HttpExecutionNetworkService } from "./http-execution-network.service";
import { HttpExecutionResolverService } from "./http-execution-resolver.service";
import { HttpExecutionSupervisorService } from "./http-execution-supervisor.service";

export class ExecutionBrokerHostService {
  private server: ReturnType<typeof Bun.serve> | null = null;
  private database: Database | null = null;
  private lock: ExecutionBrokerLockService | null = null;
  private supervisor: HttpExecutionSupervisorService | null = null;
  private recovery: ExecutionRecoveryService | null = null;
  private handler: ExecutionBrokerHttpService | null = null;

  constructor(private readonly options: ExecutionBrokerHostOptions) {}

  async start(): Promise<string> {
    if (this.server || this.lock) throw new Error("Execution broker is already starting or running.");
    await this.requirePrivateFile(this.options.directory, "directory", 0o700);
    const directory = await realpath(this.options.directory);
    const journalPath = join(directory, "receipts.sqlite");
    await this.requirePrivateFile(journalPath, "file", 0o600);
    const socketPath = join(directory, "broker.sock");
    if (Buffer.byteLength(socketPath) > 100) throw new Error("Execution broker socket path is too long.");
    if (this.options.hmacKey.byteLength !== 32) throw new Error("Invalid execution broker key.");
    try {
      const lockPath = join(directory, "broker-lock.sqlite");
      try {
        const file = await open(lockPath, "wx", 0o600);
        await file.close();
      } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
        await this.requirePrivateFile(lockPath, "file", 0o600);
      }
      this.lock = new ExecutionBrokerLockService(lockPath);
      this.database = new Database(journalPath, { readwrite: true, create: false });
      assertExecutionBrokerJournal(this.database, this.options.installationId, this.options.hmacKey);
      const receipts = new ExecutionReceiptRepository(this.database, this.options.hmacKey);
      const network = new HttpExecutionNetworkService(this.options.docker ?? new DockerCommandService(), {
        images: this.options.images,
        installationId: this.options.installationId,
        ownershipLock: this.lock,
        trustedNonPublicMappings: this.options.trustedNonPublicMappings,
        commandTimeoutMs: 30 * 60_000,
        setupTimeoutMs: 30_000,
        cleanupTimeoutMs: 30_000,
      });
      this.supervisor = new HttpExecutionSupervisorService(network, new HttpExecutionResolverService({
        trustedNonPublicMappings: this.options.trustedNonPublicMappings,
        ...(this.options.lookup ? { lookup: this.options.lookup } : {}),
      }), {
        leaseMs: this.options.leaseMs ?? 30_000,
        onSettled(run) { receipts.recordOutcome(toExecutionOutcome(run)); },
      });
      const broker = new ExecutionBrokerService(receipts, {
        profiles: this.options.profiles,
        readAuthorization: this.options.readAuthorization,
        runtime: this.supervisor,
      });
      this.recovery = new ExecutionRecoveryService(receipts, network);
      await this.recovery.reconcile();
      await this.removeStaleSocket(socketPath);
      const handler = new ExecutionBrokerHttpService(broker, this.options.identities);
      this.handler = handler;
      const previousMask = process.umask(0o077);
      try {
        this.server = Bun.serve({ unix: socketPath, fetch: (request) => handler.handle(request) });
      } finally {
        process.umask(previousMask);
      }
      await chmod(socketPath, 0o600);
      return socketPath;
    } catch (error) {
      await this.close().catch(() => undefined);
      throw error;
    }
  }

  async close(): Promise<void> {
    if (!this.lock) return;
    this.handler?.beginShutdown();
    const server = this.server;
    this.server = null;
    server?.stop(true);
    await this.handler?.waitForIdle();
    this.handler = null;
    const supervisor = this.supervisor;
    this.supervisor = null;
    const recovery = this.recovery;
    this.recovery = null;
    try {
      await supervisor?.shutdown();
      await recovery?.reconcile();
    } finally {
      this.database?.close();
      this.database = null;
      try {
        const socketPath = join(await realpath(this.options.directory), "broker.sock");
        await this.removeStaleSocket(socketPath);
      } finally {
        this.lock.release();
        this.lock = null;
      }
    }
  }

  private async requirePrivateFile(path: string, kind: "directory" | "file", mode: number): Promise<void> {
    const stat = await lstat(path);
    if ((kind === "directory" ? !stat.isDirectory() : !stat.isFile() || stat.nlink !== 1) || stat.isSymbolicLink() ||
      (stat.mode & 0o777) !== mode || stat.uid !== process.getuid?.()) {
      throw new Error(`Execution broker ${kind} is not private and owner-controlled.`);
    }
  }

  private async removeStaleSocket(path: string): Promise<void> {
    let stat;
    try { stat = await lstat(path); }
    catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
      throw error;
    }
    if (!stat.isSocket() || stat.uid !== process.getuid?.()) throw new Error("Broker socket path is not an owned socket.");
    await unlink(path);
  }
}
