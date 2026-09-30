import { createAuthenticatedRequestContextOutputRedactor } from "../../authentication/services/authenticated-request-context-output-redaction.helpers";
import {
  matchesSanitizedAuthenticatedCurlPlan,
  parseSanitizedAuthenticatedContext,
  stripExecutionTerminalControls,
} from "./execution-secret-output.helpers";
import { ExecutionPlan } from "../types/execution-plan.types";
import { HttpExecutionNetworkInput } from "../types/http-execution-network.types";
import {
  HttpExecutionSecretOutputSanitizer,
  HttpExecutionSecretOutputSession,
} from "../types/http-execution-supervisor.types";

const maximumRawOutputBytes = 1024 * 1024;
const maximumOutputChunks = 8_192;

/** Not installed in the daemon yet. This policy is deliberately pinned to one future cURL schema. */
export class ExecutionSecretOutputSanitizerService implements HttpExecutionSecretOutputSanitizer {
  create(plan: ExecutionPlan, inputs: readonly HttpExecutionNetworkInput[]): HttpExecutionSecretOutputSession | null {
    if (!matchesSanitizedAuthenticatedCurlPlan(plan) || inputs.length !== 2 || inputs.some((input, index) => {
      const slot = plan.inputs[index];
      return !slot || input.slot.id !== slot.id || input.slot.kind !== slot.kind ||
        input.slot.maximumBytes !== slot.maximumBytes || input.bytes.byteLength > slot.maximumBytes;
    })) return null;
    const secretInput = inputs.find((input) => input.slot.id === plan.inputs[1]!.id);
    if (!secretInput || secretInput.bytes.byteLength > plan.inputs[1]!.maximumBytes) return null;

    const context = parseSanitizedAuthenticatedContext(secretInput.bytes, plan.origins[0]!);
    if (!context) return null;
    let redact: ((content: string) => string) | null = createAuthenticatedRequestContextOutputRedactor(context, maximumRawOutputBytes);
    const streams: Record<"stdout" | "stderr", Buffer[]> = { stdout: [], stderr: [] };
    let rawBytes = 0;
    let chunkCount = 0;
    let destroyed = false;
    let finalized = false;

    return {
      sanitize: () => {
        if (destroyed || finalized) return null;
        finalized = true;
        try {
          if (rawBytes > maximumRawOutputBytes || chunkCount > maximumOutputChunks) return null;
          const sanitized: Record<"stdout" | "stderr", string> = { stdout: "", stderr: "" };
          let sanitizedBytes = 0;
          for (const stream of ["stdout", "stderr"] as const) {
            const joined = Buffer.concat(streams[stream]);
            try {
              const decoded = new TextDecoder("utf-8", { fatal: true }).decode(joined);
              const normalized = stripExecutionTerminalControls(decoded);
              const redacted = redact!(normalized);
              sanitizedBytes += Buffer.byteLength(redacted);
              if (sanitizedBytes > maximumRawOutputBytes) return null;
              sanitized[stream] = redacted;
            } finally {
              joined.fill(0);
            }
          }
          return sanitized;
        } catch {
          return null;
        } finally {
          destroySession();
        }
      },
      destroy: destroySession,
      capture: (stream: "stdout" | "stderr", chunk: Uint8Array) => {
        if (chunk.byteLength === 0) return !destroyed && !finalized;
        if (destroyed || finalized || rawBytes + chunk.byteLength > maximumRawOutputBytes || chunkCount >= maximumOutputChunks) {
          destroySession();
          return false;
        }
        try {
          const copy = Buffer.from(chunk);
          streams[stream].push(copy);
          rawBytes += copy.byteLength;
          chunkCount += 1;
          return true;
        } catch {
          destroySession();
          return false;
        }
      },
    };

    function destroySession() {
      if (destroyed) return;
      destroyed = true;
      finalized = true;
      for (const chunks of Object.values(streams)) {
        for (const chunk of chunks) chunk.fill(0);
        chunks.length = 0;
      }
      rawBytes = 0;
      chunkCount = 0;
      redact = null;
    }
  }
}
