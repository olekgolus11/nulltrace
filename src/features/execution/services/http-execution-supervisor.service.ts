import { ExecutionRuntimeAdapter } from "../types/execution-broker.types";
import { ExecutionInputSlot, ExecutionPlan } from "../types/execution-plan.types";
import {
  HttpExecutionStopReason,
  HttpExecutionSupervisedNetwork,
  HttpExecutionSupervisedResolver,
  HttpExecutionSupervisedRun,
  HttpExecutionSupervisorOptions,
} from "../types/http-execution-supervisor.types";
import { HttpExecutionRunError } from "./http-execution-run.error";
import { ExecutionEventBufferService } from "./execution-event-buffer.service";

const MAXIMUM_TIMEOUT_MS = 30 * 60_000;

export class HttpExecutionSupervisorService implements ExecutionRuntimeAdapter {
  private readonly runs = new Map<string, SupervisedEntry>();

  constructor(
    private readonly network: HttpExecutionSupervisedNetwork,
    private readonly resolver: HttpExecutionSupervisedResolver,
    private readonly options: HttpExecutionSupervisorOptions,
  ) {
    if (!Number.isSafeInteger(options.leaseMs) || options.leaseMs < 100 || options.leaseMs > 300_000) {
      throw new Error("Invalid execution ownership lease.");
    }
    const maximum = options.maximumRetainedRuns ?? 1_000;
    if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > 10_000) {
      throw new Error("Invalid execution outcome capacity.");
    }
  }

  async putInput(_plan: ExecutionPlan, _slot: ExecutionInputSlot, _bytes: Uint8Array): Promise<void> {
    throw new Error("This public HTTP runtime has no input slots.");
  }

  async start(plan: ExecutionPlan): Promise<void> {
    if (plan.inputs.length || this.runs.has(plan.executionId) || this.hasRunning() ||
      this.runs.size >= (this.options.maximumRetainedRuns ?? 1_000)) {
      throw new Error("Execution runtime is busy or the plan requires unsupported input.");
    }
    if (!Number.isSafeInteger(plan.limits.timeoutMs) || plan.limits.timeoutMs < 1 || plan.limits.timeoutMs > MAXIMUM_TIMEOUT_MS) {
      throw new Error("Invalid execution deadline.");
    }
    const entry: SupervisedEntry = {
      result: {
        executionId: plan.executionId,
        status: "running",
        stopReason: null,
        cleanup: "pending",
        exitCode: null,
      },
      controller: new AbortController(),
      leaseDeadline: Date.now() + this.options.leaseMs,
      absoluteDeadline: Date.now() + plan.limits.timeoutMs,
      leaseTimer: null,
      deadlineTimer: null,
      task: null,
      settlementFailed: false,
      events: new ExecutionEventBufferService(plan.executionId, plan.limits.outputBytes),
    };
    this.runs.set(plan.executionId, entry);
    this.armLease(entry);
    entry.deadlineTimer = setTimeout(() => this.stop(entry, "deadline"), plan.limits.timeoutMs);
    entry.task = this.execute(entry, plan);
  }

  renewOwnership(executionId: string): HttpExecutionSupervisedRun {
    const entry = this.requireRun(executionId);
    if (entry.result.status !== "running" || entry.result.stopReason ||
      Date.now() >= entry.leaseDeadline || Date.now() >= entry.absoluteDeadline) {
      throw new Error("Execution ownership can no longer be renewed.");
    }
    entry.leaseDeadline = Math.min(Date.now() + this.options.leaseMs, entry.absoluteDeadline);
    this.armLease(entry);
    return { ...entry.result };
  }

  cancel(executionId: string): HttpExecutionSupervisedRun {
    const entry = this.requireRun(executionId);
    this.stop(entry, "cancelled");
    return { ...entry.result };
  }

  get(executionId: string): HttpExecutionSupervisedRun {
    return { ...this.requireRun(executionId).result };
  }

  readEvents(executionId: string, afterSequence: number, maximumEvents?: number) {
    return this.requireRun(executionId).events.read(afterSequence, maximumEvents);
  }

  async wait(executionId: string): Promise<HttpExecutionSupervisedRun> {
    const entry = this.requireRun(executionId);
    await entry.task;
    return { ...entry.result };
  }

  async shutdown(): Promise<void> {
    for (const entry of this.runs.values()) this.stop(entry, "cancelled");
    await Promise.all([...this.runs.values()].map((entry) => entry.task));
  }

  async retrySettlement(executionId: string): Promise<HttpExecutionSupervisedRun> {
    const entry = this.requireRun(executionId);
    if (!entry.settlementFailed || entry.result.cleanup !== "confirmed") throw new Error("Execution settlement is not retryable.");
    await this.options.onSettled({ ...entry.result, status: "finished" });
    entry.settlementFailed = false;
    entry.result.status = "finished";
    return { ...entry.result };
  }

  private async execute(entry: SupervisedEntry, plan: ExecutionPlan): Promise<void> {
    try {
      let policy;
      try {
        policy = await this.resolver.resolve(plan.executionId, plan.origins);
      } catch {
        throw new HttpExecutionRunError("Target resolution failed before provisioning.", true);
      }
      if (entry.controller.signal.aborted) throw new HttpExecutionRunError("Execution stopped before provisioning.", true);
      const result = await this.network.run(
        policy,
        plan.limits,
        plan.invocation.executableId,
        plan.invocation.argv,
        entry.controller.signal,
        (stream, chunk) => entry.events.append(stream, chunk),
      );
      entry.result.exitCode = result.command.exitCode;
      entry.result.cleanup = result.evidence.cleanupConfirmed ? "confirmed" : "pending";
      entry.result.status = result.evidence.cleanupConfirmed ? "finished" : "interrupted";
    } catch (error) {
      entry.result.cleanup = error instanceof HttpExecutionRunError && error.cleanupConfirmed ? "confirmed" : "pending";
      entry.result.status = entry.result.cleanup === "confirmed" ? "finished" : "interrupted";
    } finally {
      entry.events.finish();
      if (entry.leaseTimer) clearTimeout(entry.leaseTimer);
      if (entry.deadlineTimer) clearTimeout(entry.deadlineTimer);
      try {
        await this.options.onSettled({ ...entry.result });
      } catch {
        entry.result.status = "interrupted";
        entry.settlementFailed = true;
      }
    }
  }

  private armLease(entry: SupervisedEntry): void {
    if (entry.leaseTimer) clearTimeout(entry.leaseTimer);
    if (entry.leaseDeadline >= entry.absoluteDeadline) {
      entry.leaseTimer = null;
      return;
    }
    entry.leaseTimer = setTimeout(() => this.stop(entry, "lease_expired"), Math.max(1, entry.leaseDeadline - Date.now()));
  }

  private stop(entry: SupervisedEntry, reason: HttpExecutionStopReason): void {
    if (entry.result.status !== "running" || entry.result.stopReason) return;
    entry.result.stopReason = reason;
    entry.controller.abort();
  }

  private hasRunning(): boolean {
    return [...this.runs.values()].some((entry) => entry.result.status === "running" ||
      entry.result.cleanup === "pending" || entry.settlementFailed);
  }

  private requireRun(executionId: string): SupervisedEntry {
    const entry = this.runs.get(executionId);
    if (!entry) throw new Error("Execution was not found.");
    return entry;
  }
}

interface SupervisedEntry {
  result: HttpExecutionSupervisedRun;
  controller: AbortController;
  leaseDeadline: number;
  absoluteDeadline: number;
  leaseTimer: ReturnType<typeof setTimeout> | null;
  deadlineTimer: ReturnType<typeof setTimeout> | null;
  task: Promise<void> | null;
  settlementFailed: boolean;
  events: ExecutionEventBufferService;
}
