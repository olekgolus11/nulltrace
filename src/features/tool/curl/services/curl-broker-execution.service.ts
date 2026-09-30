import { ExecutionBrokerClient } from "../../../execution/services/execution-broker-client.service";
import { ExecutionBrokerError } from "../../../execution/services/execution-broker.error";
import { loadExecutionBrokerClientConfiguration } from "../../../execution/services/execution-broker-client-config.helpers";
import { ExecutionBrokerAdminClientService } from "../../../execution/services/execution-broker-admin-client.service";
import { CurlToolData } from "../types/curl.types";
import { ToolPreparedIsolatedRun } from "../../shared/types/tool-screen.types";
import { validateCurlCommand, validateCurlRequestBodySize } from "./curl-command.helpers";
import { ExecutionBrokerClientConfiguration } from "../../../execution/types/execution-broker-client.types";
import { ExecutionPlan } from "../../../execution/types/execution-plan.types";
import { CurlWorkerInput } from "../types/curl-broker.types";
import { buildCurlWorkerInput, createCurlWorkerPlan } from "./curl-broker.helpers";

interface CurlBrokerExecutionDependencies {
  loadConfiguration: typeof loadExecutionBrokerClientConfiguration;
  createClient: (configuration: ExecutionBrokerClientConfiguration) => Pick<ExecutionBrokerClient, "prepare" | "putInput" | "start" | "readEvents" | "status" | "renewOwnership" | "cancel">;
  issueGrant: (configuration: ExecutionBrokerClientConfiguration, plan: ExecutionPlan) => Promise<void>;
  sleep: (milliseconds: number) => Promise<void>;
}

type CurlExecutionBrokerClient = Pick<ExecutionBrokerClient, "prepare" | "putInput" | "start" | "readEvents" | "status" | "renewOwnership" | "cancel">;

export class CurlBrokerExecutionService {
  constructor(private readonly dependencies: CurlBrokerExecutionDependencies = {
    loadConfiguration: loadExecutionBrokerClientConfiguration,
    createClient: (configuration) => new ExecutionBrokerClient(
      (request) => fetch(request, { unix: `${configuration.directory}/broker.sock` }),
      configuration.clientToken,
    ),
    issueGrant: (configuration, plan) => new ExecutionBrokerAdminClientService(configuration).issueGrant(plan),
    sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  }) {}

  async prepare(command: string, targetUrl: string, toolData: unknown): Promise<ToolPreparedIsolatedRun> {
    const data = toolData as CurlToolData | undefined;
    if (data?.form.useAuthenticatedContext) {
      throw new Error("Authenticated cURL is unavailable with the isolated public worker at this stage.");
    }
    const validated = validateCurlCommand(command, targetUrl);
    const request = buildCurlWorkerInput(validated, targetUrl);
    validateCurlRequestBodySize(request.bodyOperations.map((operation) => operation.value).join("&"));
    const configuration = await this.dependencies.loadConfiguration();
    const client = this.dependencies.createClient(configuration);
    const plan = createCurlWorkerPlan(validated.targetUrl, configuration);
    let executionStarted = false;
    let admissionAttempted = false;
    let cancelRequested = false;
    let cleanupConfirmed = false;
    let executionPromise: Promise<{ exitCode: number; cancelled: boolean }> | null = null;

    const cancel = async () => {
      cancelRequested = true;
      if (cleanupConfirmed) {
        return { cleanup: "confirmed" as const };
      }
      if (!admissionAttempted) {
        const running = executionPromise;
        if (running) {
          try {
            await running;
          } catch {
            // The run settles before we decide whether a reservation exists.
          }
        }
        if (!admissionAttempted) {
          cleanupConfirmed = true;
          return { cleanup: "confirmed" as const };
        }
      }
      try {
        const receipt = await client.cancel(plan.executionId);
        cleanupConfirmed = receipt.cleanup === "confirmed";
        return { cleanup: receipt.cleanup };
      } catch (error) {
        if (error instanceof ExecutionBrokerError && error.code === "NOT_FOUND") {
          const running = executionPromise;
          if (running) {
            try {
              await running;
            } catch {
              // A settled failed request cannot create a later reservation.
            }
          }
          if (!admissionAttempted || cleanupConfirmed) {
            cleanupConfirmed = true;
            return { cleanup: "confirmed" as const };
          }
        }
        return { cleanup: "pending" as const };
      }
    };

    return {
      systemLines: ["[execution: isolated public cURL worker; exact session origin only]"],
      execution: {
        kind: "broker",
        run: async (onStdoutLines, onStderrLines, onSystemLines) => {
          if (executionPromise) throw new Error("Isolated cURL run was already started.");
          if (cancelRequested) {
            cleanupConfirmed = true;
            return 0;
          }
          executionStarted = true;
          executionPromise = this.execute({
            client,
            configuration,
            plan,
            request,
            callbacks: { onStdoutLines, onStderrLines, onSystemLines },
            isCancelled: () => cancelRequested,
            setAdmissionAttempted: (value) => { admissionAttempted = value; },
            setCleanupConfirmed: () => { cleanupConfirmed = true; },
          });
          const result = await executionPromise;
          return result.exitCode;
        },
          cancel: async () => {
          cancelRequested = true;
          if (cleanupConfirmed) {
            return { cleanup: "confirmed" };
          }
          if (!executionStarted) {
            cleanupConfirmed = true;
            return { cleanup: "confirmed" };
          }
          cancelRequested = true;
          const running = executionPromise;
          if (!admissionAttempted && running) {
            try {
              await running;
            } catch {
              // Check the final admission state below.
            }
            if (!admissionAttempted || cleanupConfirmed) {
              cleanupConfirmed = true;
              return { cleanup: "confirmed" };
            }
          }
          const result = await cancel();
          if (!running || result.cleanup === "pending") return result;
          try {
            await running;
          } catch {
            // The explicit broker cleanup receipt remains authoritative.
          }
          return { cleanup: cleanupConfirmed ? "confirmed" : "pending" };
        },
      },
    };
  }

  private async execute(options: {
    client: CurlExecutionBrokerClient;
    configuration: ExecutionBrokerClientConfiguration;
    plan: ExecutionPlan;
    request: CurlWorkerInput;
    callbacks: { onStdoutLines: (lines: string[]) => void; onStderrLines: (lines: string[]) => void; onSystemLines: (lines: string[]) => void };
    isCancelled: () => boolean;
    setAdmissionAttempted: (value: boolean) => void;
    setCleanupConfirmed: () => void;
  }): Promise<{ exitCode: number; cancelled: boolean }> {
    const { client, configuration, plan, request, callbacks, isCancelled, setAdmissionAttempted, setCleanupConfirmed } = options;
    const bytes = Buffer.from(JSON.stringify(request), "utf8");
    let cursor = -1;
    const settlementDeadline = Date.now() + 70_000;
    let hasAdmissionAttempted = false;
    let deadlineExceeded = false;
    try {
      await this.dependencies.issueGrant(configuration, plan);
      if (isCancelled()) {
        setCleanupConfirmed();
        return { exitCode: 0, cancelled: true };
      }
      hasAdmissionAttempted = true;
      setAdmissionAttempted(true);
      await client.prepare(plan);
      if (isCancelled()) {
        const cancelled = await client.cancel(plan.executionId);
        if (cancelled.cleanup !== "confirmed") throw new Error("Isolated cURL cleanup is still pending.");
        setCleanupConfirmed();
        return { exitCode: 0, cancelled: true };
      }
      await client.putInput(plan.executionId, "curl-config", bytes);
      if (isCancelled()) {
        const cancelled = await client.cancel(plan.executionId);
        if (cancelled.cleanup !== "confirmed") throw new Error("Isolated cURL cleanup is still pending.");
        setCleanupConfirmed();
        return { exitCode: 0, cancelled: true };
      }
      await client.start(plan.executionId);
      while (true) {
        const page = await client.readEvents(plan.executionId, cursor);
        for (const event of page.events) {
          cursor = event.sequence;
          const callback = event.stream === "stderr" ? callbacks.onStderrLines :
            event.stream === "system" ? callbacks.onSystemLines : callbacks.onStdoutLines;
          callback([event.line]);
        }
        if (page.hasMore) continue;
        const status = await client.status(plan.executionId);
        if (status.cleanup === "confirmed") {
          setCleanupConfirmed();
          while (true) {
            const finalPage = await client.readEvents(plan.executionId, cursor);
            for (const event of finalPage.events) {
              cursor = event.sequence;
              const callback = event.stream === "stderr" ? callbacks.onStderrLines :
                event.stream === "system" ? callbacks.onSystemLines : callbacks.onStdoutLines;
              callback([event.line]);
            }
            if (!finalPage.hasMore) break;
          }
          if (status.exitCode === null && !isCancelled()) throw new Error("Isolated cURL worker closed without a process exit status.");
          return { exitCode: status.exitCode ?? 0, cancelled: isCancelled() || status.stopReason === "cancelled" };
        }
        if (Date.now() >= settlementDeadline) {
          deadlineExceeded = true;
          throw new Error("Broker cleanup remains unconfirmed.");
        }
        if (isCancelled()) {
          await client.cancel(plan.executionId).catch(() => undefined);
        } else {
          await client.renewOwnership(plan.executionId).catch(() => undefined);
        }
        await this.dependencies.sleep(100);
      }
    } catch (error) {
      if (hasAdmissionAttempted) {
        try {
          const control = await client.cancel(plan.executionId);
          if (control.cleanup === "confirmed") {
            setCleanupConfirmed();
            if (isCancelled()) return { exitCode: control.exitCode ?? 0, cancelled: true };
            if (deadlineExceeded) throw new Error("Isolated cURL request timed out.");
          }
        } catch (cancelError) {
          if (cancelError instanceof ExecutionBrokerError && cancelError.code === "NOT_FOUND") {
            setCleanupConfirmed();
            if (isCancelled()) return { exitCode: 0, cancelled: true };
          }
          /* The broker ledger remains authoritative and blocks another start. */
        }
      }
      if (!isCancelled()) throw new Error("Isolated cURL broker execution failed.");
      throw new Error("Isolated cURL cleanup could not be confirmed.");
    } finally {
      bytes.fill(0);
    }
  }
}

export const curlBrokerExecutionService = new CurlBrokerExecutionService();
