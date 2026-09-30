import { createHash } from "node:crypto";
import { ExecutionRuntimeAdapter } from "../types/execution-broker.types";
import { ExecutionInputSlot, ExecutionPlan } from "../types/execution-plan.types";
import { HttpExecutionNetworkInput } from "../types/http-execution-network.types";
import {
  HttpExecutionStopReason,
  HttpExecutionSupervisedNetwork,
  HttpExecutionSupervisedResolver,
  HttpExecutionSupervisedRun,
  HttpExecutionSupervisorOptions,
} from "../types/http-execution-supervisor.types";
import { HttpExecutionRunError } from "./http-execution-run.error";
import { ExecutionEventBufferService } from "./execution-event-buffer.service";
import { isBoundedSanitizedOutput } from "./execution-secret-output.helpers";

export class HttpExecutionSupervisorService implements ExecutionRuntimeAdapter {
  private readonly runs = new Map<string, SupervisedEntry>();
  private readonly stagedInputs = new Map<string, StagedExecutionInputs>();

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
    const inputRetention = options.inputRetentionMs ?? 5 * 60_000;
    if (!Number.isSafeInteger(inputRetention) || inputRetention < 100 || inputRetention > 15 * 60_000) {
      throw new Error("Invalid execution input retention.");
    }
  }

  async putInput(plan: ExecutionPlan, slot: ExecutionInputSlot, bytes: Uint8Array): Promise<void> {
    if (!plan.inputs.some((declared) => declared.id === slot.id && declared.kind === slot.kind && declared.maximumBytes === slot.maximumBytes) ||
      bytes.byteLength > slot.maximumBytes || this.runs.has(plan.executionId)) {
      this.clearStage(plan.executionId);
      throw new Error("Execution input slot is unsupported or invalid.");
    }
    const stage = this.stagedInputs.get(plan.executionId) ?? this.createStage(plan);
    if (stage.planFingerprint !== this.planFingerprint(plan) || stage.expiresAt <= Date.now() || stage.inputs.has(slot.id) ||
      stage.totalBytes + bytes.byteLength > 8 * 1024 * 1024) {
      this.clearStage(plan.executionId);
      throw new Error("Execution input staging is expired, duplicate, or over capacity.");
    }
    stage.inputs.set(slot.id, { slot: { ...slot }, bytes: Uint8Array.from(bytes) });
    stage.totalBytes += bytes.byteLength;
  }

  discardInputs(executionId: string): void {
    this.clearStage(executionId);
  }

  async start(plan: ExecutionPlan): Promise<void> {
    const stage = this.stagedInputs.get(plan.executionId);
    if (this.runs.has(plan.executionId) || this.hasRunning() ||
      this.runs.size >= (this.options.maximumRetainedRuns ?? 1_000)) {
      throw new Error("Execution runtime is busy.");
    }
    if (plan.inputs.length && (!stage || stage.planFingerprint !== this.planFingerprint(plan) || stage.expiresAt <= Date.now() || plan.inputs.length !== stage.inputs.size ||
      plan.inputs.some((slot) => {
        const staged = stage.inputs.get(slot.id);
        return !staged || staged.slot.kind !== slot.kind || staged.slot.maximumBytes !== slot.maximumBytes;
      }))) throw new Error("Execution input slots are missing, expired, or unsupported.");
    if (!plan.inputs.length && stage) throw new Error("Unexpected execution input slots.");
    if (!Number.isSafeInteger(plan.limits.timeoutMs) || plan.limits.timeoutMs < 1 || plan.limits.timeoutMs > 30 * 60_000) {
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
    const inputs = stage ? [...stage.inputs.values()] : [];
    if (stage) {
      clearTimeout(stage.timer);
      this.stagedInputs.delete(plan.executionId);
    }
    this.runs.set(plan.executionId, entry);
    this.armLease(entry);
    entry.deadlineTimer = setTimeout(() => this.stop(entry, "deadline"), plan.limits.timeoutMs);
    entry.task = this.execute(entry, plan, inputs);
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

  getControl(executionId: string): HttpExecutionSupervisedRun {
    return this.get(executionId);
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
    for (const executionId of this.stagedInputs.keys()) this.clearStage(executionId);
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

  private async execute(entry: SupervisedEntry, plan: ExecutionPlan, inputs: HttpExecutionNetworkInput[]): Promise<void> {
    const containsSecret = plan.inputs.some((slot) => slot.kind === "secret");
    let secretOutput: ReturnType<NonNullable<HttpExecutionSupervisorOptions["secretOutputSanitizer"]>["create"]> = null;
    let secretOutputFailed = containsSecret;
    try {
      if (containsSecret && this.options.secretOutputSanitizer) {
        try {
          secretOutput = this.options.secretOutputSanitizer.create(plan, inputs);
          secretOutputFailed = !secretOutput;
        } catch {
          secretOutputFailed = true;
        }
      }
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
        (stream, chunk) => {
          if (containsSecret) {
            let retained = false;
            try {
              if (secretOutput && (stream === "stdout" || stream === "stderr")) {
                retained = secretOutput.capture(stream, chunk);
              }
            } catch {
              retained = false;
            } finally {
              chunk.fill(0);
            }
            if (!retained) {
              secretOutputFailed = true;
              try { secretOutput?.destroy(); } catch { /* Never expose sanitizer failures. */ }
              secretOutput = null;
            }
            return;
          }
          if (stream === "stdout" || stream === "stderr") {
            entry.events.append(stream, chunk);
          } else {
            chunk.fill(0);
          }
        },
        inputs,
      );
      entry.result.exitCode = result.command.exitCode;
      entry.result.cleanup = result.evidence.cleanupConfirmed ? "confirmed" : "pending";
      entry.result.status = result.evidence.cleanupConfirmed ? "finished" : "interrupted";
    } catch (error) {
      entry.result.cleanup = error instanceof HttpExecutionRunError && error.cleanupConfirmed ? "confirmed" : "pending";
      entry.result.status = entry.result.cleanup === "confirmed" ? "finished" : "interrupted";
    } finally {
      try {
        if (secretOutput && !secretOutputFailed) {
          const sanitized = secretOutput.sanitize();
          if (sanitized && isBoundedSanitizedOutput(sanitized, plan.limits.outputBytes)) {
            const buffers: Buffer[] = [];
            try {
              buffers.push(Buffer.from(sanitized.stdout, "utf8"));
              buffers.push(Buffer.from(sanitized.stderr, "utf8"));
              if (buffers.reduce((total, buffer) => total + buffer.byteLength, 0) <= Math.min(plan.limits.outputBytes, 1024 * 1024)) {
                for (let index = 0; index < buffers.length; index += 1) {
                  entry.events.append(index === 0 ? "stdout" : "stderr", buffers[index]!);
                }
              }
            } finally {
              buffers.forEach((buffer) => buffer.fill(0));
            }
          }
        }
      } catch {
        // Sanitizer failures never enter the retained event stream.
      } finally {
        try { secretOutput?.destroy(); } catch { /* Never expose sanitizer failures. */ }
        inputs.forEach((input) => input.bytes.fill(0));
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

  private createStage(plan: ExecutionPlan): StagedExecutionInputs {
    const stage: StagedExecutionInputs = {
      inputs: new Map(),
      totalBytes: 0,
      planFingerprint: this.planFingerprint(plan),
      expiresAt: Date.now() + (this.options.inputRetentionMs ?? 5 * 60_000),
      timer: setTimeout(() => this.clearStage(plan.executionId), this.options.inputRetentionMs ?? 5 * 60_000),
    };
    this.stagedInputs.set(plan.executionId, stage);
    return stage;
  }

  private clearStage(executionId: string): void {
    const stage = this.stagedInputs.get(executionId);
    if (!stage) return;
    clearTimeout(stage.timer);
    for (const input of stage.inputs.values()) input.bytes.fill(0);
    this.stagedInputs.delete(executionId);
  }

  private planFingerprint(plan: ExecutionPlan): string {
    return createHash("sha256").update(JSON.stringify(plan)).digest("hex");
  }
}

interface StagedExecutionInputs {
  inputs: Map<string, HttpExecutionNetworkInput>;
  totalBytes: number;
  planFingerprint: string;
  expiresAt: number;
  timer: ReturnType<typeof setTimeout>;
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
