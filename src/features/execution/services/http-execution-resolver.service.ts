import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import {
  HttpExecutionEndpoint,
  HttpExecutionNetworkPolicy,
  HttpExecutionResolverOptions,
  HttpResolvedAddress,
} from "../types/http-execution-network.types";
import { createHttpExecutionNetworkPolicy } from "./http-execution-policy.helpers";
import { requireExecutionId } from "./execution-validation.helpers";

export class HttpExecutionResolverService {
  private readonly lookup: (hostname: string) => Promise<HttpResolvedAddress[]>;
  private readonly timeoutMs: number;

  constructor(private readonly options: HttpExecutionResolverOptions) {
    this.timeoutMs = options.timeoutMs ?? 5_000;
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 100 || this.timeoutMs > 30_000) {
      throw new Error("Invalid target resolution timeout.");
    }
    this.lookup = options.lookup ?? (async (hostname) => {
      const addresses = await lookup(hostname, { all: true, verbatim: true });
      return addresses.map(({ address, family }) => {
        if (family !== 4 && family !== 6) throw new Error("Target resolver returned an unsupported family.");
        return { address, family };
      });
    });
  }

  async resolve(executionId: string, origins: readonly string[]): Promise<HttpExecutionNetworkPolicy> {
    requireExecutionId(executionId);
    const parsedOrigins = origins.map(parseOrigin);
    if (!parsedOrigins.length || parsedOrigins.length > 32 ||
      new Set(parsedOrigins.map(({ origin }) => origin)).size !== parsedOrigins.length) {
      throw new Error("Invalid HTTP origin set.");
    }
    const endpoints: HttpExecutionEndpoint[] = [];
    for (const { origin, hostname, port } of parsedOrigins) {
      const literalFamily = isIP(hostname);
      const resolved = literalFamily
        ? [{ address: hostname, family: literalFamily as 4 | 6 }]
        : await this.lookupBounded(hostname);
      if (!resolved.length || resolved.length > 16) throw new Error("Target resolution returned an invalid address count.");
      for (const candidate of resolved) {
        if (candidate.family !== isIP(candidate.address)) throw new Error("Target resolver returned an invalid address.");
        endpoints.push({ origin, hostname, address: candidate.address, family: candidate.family, port });
      }
    }
    return createHttpExecutionNetworkPolicy(executionId, origins, endpoints, this.options.trustedNonPublicMappings);
  }

  private async lookupBounded(hostname: string): Promise<HttpResolvedAddress[]> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        this.lookup(hostname),
        new Promise<HttpResolvedAddress[]>((_, reject) => {
          timeout = setTimeout(() => reject(new Error("Target resolution timed out.")), this.timeoutMs);
        }),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }
}

function parseOrigin(value: string): { origin: string; hostname: string; port: number } {
  if (typeof value !== "string" || value.length > 2048) throw new Error("Invalid HTTP origin.");
  const url = new URL(value);
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.origin !== value || url.username || url.password) {
    throw new Error("HTTP origins must be normalized.");
  }
  return {
    origin: url.origin,
    hostname: normalizeHostname(url.hostname),
    port: Number(url.port || (url.protocol === "https:" ? 443 : 80)),
  };
}

function normalizeHostname(value: string): string {
  return (value.startsWith("[") && value.endsWith("]") ? value.slice(1, -1) : value).toLowerCase();
}
