import { parseAuthCheckWorkerConfiguration } from "../../../../infrastructure/isolation/auth-check-worker-protocol.helpers";
import { HttpExecutionNetworkInput } from "../types/http-execution-network.types";
import { ExecutionCredentialBinding } from "../types/execution-broker.types";
import { ExecutionPlan } from "../types/execution-plan.types";
import { HttpExecutionSecretOutputSanitizer, HttpExecutionSecretOutputSession } from "../types/http-execution-supervisor.types";
import { isSupportedAuthCheckExecutionPlan, parseAuthCheckExecutionResultFrame } from "./auth-check-execution-profile.helpers";

export class ExecutionAuthCheckOutputSanitizerService implements HttpExecutionSecretOutputSanitizer {
  create(
    plan: ExecutionPlan,
    inputs: readonly HttpExecutionNetworkInput[],
    credentialBinding?: ExecutionCredentialBinding | null,
  ): HttpExecutionSecretOutputSession | null {
    if (!isSupportedAuthCheckExecutionPlan(plan) || inputs.length !== 1 || !credentialBinding) return null;
    const input = inputs[0]!;
    const slot = plan.inputs[0]!;
    if (input.slot.id !== slot.id || input.slot.kind !== slot.kind || input.slot.maximumBytes !== slot.maximumBytes ||
      input.bytes.byteLength > slot.maximumBytes) return null;
    let configuration;
    try {
      configuration = parseAuthCheckWorkerConfiguration(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(input.bytes)));
    } catch { return null; }
    if (configuration.targetOrigin !== plan.origins[0] || configuration.contextVersion !== credentialBinding.generation ||
      configuration.totalDeadlineMs > plan.limits.timeoutMs) return null;

    const chunks: Buffer[] = [];
    let bytes = 0;
    let chunkCount = 0;
    let destroyed = false;
    let finalized = false;
    return {
      capture(stream, chunk) {
        if (destroyed || finalized || stream !== "stdout" || bytes + chunk.byteLength > maximumResultBytes ||
          chunkCount >= maximumChunks) {
          destroy();
          return false;
        }
        try {
          const copy = Buffer.from(chunk);
          chunks.push(copy);
          bytes += copy.byteLength;
          chunkCount += 1;
          return true;
        } catch {
          destroy();
          return false;
        }
      },
      sanitize() {
        if (destroyed || finalized) return null;
        finalized = true;
        try {
          if (bytes === 0) return null;
          const raw = Buffer.concat(chunks);
          try {
            const frame = new TextDecoder("utf-8", { fatal: true }).decode(raw);
            const parsed = parseAuthCheckExecutionResultFrame(frame);
            const canonical = `${JSON.stringify(parsed)}\n`;
            if (Buffer.byteLength(canonical) > 4_096) return null;
            return { stdout: canonical, stderr: "" };
          } finally {
            raw.fill(0);
          }
        } catch { return null; }
        finally { destroy(); }
      },
      destroy,
    };

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      finalized = true;
      for (const chunk of chunks) chunk.fill(0);
      chunks.length = 0;
      bytes = 0;
      chunkCount = 0;
    }
  }
}

const maximumResultBytes = 4_096;
const maximumChunks = 32;
