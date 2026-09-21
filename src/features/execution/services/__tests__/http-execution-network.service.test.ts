import { describe, expect, test } from "bun:test";
import {
  DockerCommandAdapter,
  DockerCommandOptions,
  DockerCommandResult,
  HttpExecutionNetworkPolicy,
} from "../../types/http-execution-network.types";
import { ExecutionLimits } from "../../types/execution-plan.types";
import { HttpExecutionNetworkService } from "../http-execution-network.service";
import { normalizeNetworkAddress } from "../http-execution-policy.helpers";

const image = `sha256:${"a".repeat(64)}`;
const limits: ExecutionLimits = {
  timeoutMs: 5000,
  memoryBytes: 128 * 1024 * 1024,
  cpuMilliCores: 500,
  processCount: 48,
  scratchBytes: 32 * 1024 * 1024,
  fileBytes: 8 * 1024 * 1024,
  outputBytes: 1024 * 1024,
};
const policy: HttpExecutionNetworkPolicy = {
  executionId: "run-1",
  origins: ["http://approved.test:8080"],
  endpoints: [{
    origin: "http://approved.test:8080",
    hostname: "approved.test",
    address: "93.184.216.34",
    family: 4,
    port: 8080,
  }],
};

class RecordingDocker implements DockerCommandAdapter {
  readonly calls: Array<{ args: string[]; input?: string; outputLimitBytes?: number }> = [];
  failVerification = false;
  failWorker = false;

  async run(args: string[], options: DockerCommandOptions = {}): Promise<DockerCommandResult> {
    this.calls.push({
      args: [...args],
      input: options.input ? new TextDecoder().decode(options.input) : undefined,
      outputLimitBytes: options.outputLimitBytes,
    });
    if (args.includes("nft") && args.includes("-j")) {
      if (this.failVerification) return { exitCode: 0, stdout: '{"nftables":[]}', stderr: "" };
      const input = this.calls.findLast((call) => call.args.includes("nft") && call.args.includes("-f"))?.input ?? "";
      const addresses = (input.match(/(?:\d{1,3}\.){3}\d{1,3}|(?:[a-f0-9]{0,4}:){2,}[a-f0-9:]+/gi) ?? [])
        .map(normalizeNetworkAddress);
      const ports = input.match(/dport (\d+)/g)?.map((value) => Number(value.slice(6))) ?? [];
      const accepts = (input.match(/ accept/g) ?? []).map(() => ({ rule: { table: "nulltrace", expr: [{ accept: null }] } }));
      return {
        exitCode: 0,
        stdout: JSON.stringify({ nftables: [
          ...["input", "forward", "output"].map((name) => ({ chain: { table: "nulltrace", name, policy: "drop" } })),
          { rule: { values: [...addresses, ...ports] } },
          ...accepts,
        ] }),
        stderr: "",
      };
    }
    if (args[0] === "exec" && args.includes("cat") && args.includes("/work/access.log")) {
      return { exitCode: 0, stdout: "1.000 172.29.1.10 TCP_MISS/200 GET 93.184.216.34\n", stderr: "" };
    }
    if (args[0] === "exec" && args.includes("HTTP_PROXY=http://" + this.proxyAddress() + ":3128")) {
      if (this.failWorker) throw new Error("worker failed");
      return { exitCode: 0, stdout: "allowed", stderr: "" };
    }
    return { exitCode: 0, stdout: "", stderr: "" };
  }

  private proxyAddress(): string {
    const connect = this.calls.find((call) => call.args[0] === "network" && call.args[1] === "connect");
    return connect?.args[connect.args.indexOf("--ip") + 1] ?? "missing";
  }
}

function service(docker: RecordingDocker) {
  return new HttpExecutionNetworkService(docker, {
    images: { worker: image, proxy: image, initializer: image },
    trustedNonPublicMappings: {},
    commandTimeoutMs: 5000,
    setupTimeoutMs: 5000,
    cleanupTimeoutMs: 5000,
  });
}

describe("HTTP execution network provisioning", () => {
  test("verifies both firewalls before starting proxy or worker command and confirms cleanup", async () => {
    const docker = new RecordingDocker();
    const result = await service(docker).run(policy, limits, "curl", ["http://approved.test:8080/"]);
    expect(result.command).toEqual({ exitCode: 0, stdout: "allowed", stderr: "" });
    expect(result.evidence.cleanupConfirmed).toBe(true);
    expect(result.evidence.proxyDecisions[0]).not.toContain("approved.test");
    const verifyIndexes = docker.calls.flatMap((call, index) => call.args.includes("-j") ? [index] : []);
    const proxyStart = docker.calls.findIndex((call) => call.args.includes("squid") && call.args.includes("-N"));
    const workerStart = docker.calls.findIndex((call) => call.args.some((argument) => argument.startsWith("HTTP_PROXY=")));
    expect(verifyIndexes).toHaveLength(2);
    expect(Math.max(...verifyIndexes)).toBeLessThan(proxyStart);
    expect(proxyStart).toBeLessThan(workerStart);
    expect(docker.calls.some((call) => call.args[0] === "rm" && call.args[1] === "-f")).toBe(true);
    expect(docker.calls.some((call) => call.args[0] === "network" && call.args[1] === "rm")).toBe(true);
    const holders = docker.calls.filter((call) => call.args[0] === "run" && call.args.includes("-d"));
    expect(holders).toHaveLength(2);
    for (const holder of holders) {
      expect(holder.args).toContain("--read-only");
      expect(holder.args).toContain("65532:65532");
      expect(holder.args).toContain("no-new-privileges:true");
      expect(holder.args).toContain("ALL");
      expect(holder.args).toContain("--memory");
      expect(holder.args).toContain("--cpus");
      expect(holder.args).toContain("--pids-limit");
      expect(holder.args).toContain("--ulimit");
    }
    const initializers = docker.calls.filter((call) => call.args[0] === "run" && call.args.includes("NET_ADMIN"));
    expect(initializers).toHaveLength(4);
    expect(initializers.every((call) => !call.args.join(" ").includes("docker.sock"))).toBe(true);
  });

  test("never starts untrusted execution when policy verification fails and still cleans up", async () => {
    const docker = new RecordingDocker();
    docker.failVerification = true;
    await expect(service(docker).run(policy, limits, "curl", ["http://approved.test:8080/"])).rejects.toThrow("Firewall");
    expect(docker.calls.some((call) => call.args.some((argument) => argument.startsWith("HTTP_PROXY=")))).toBe(false);
    expect(docker.calls.filter((call) => call.args[0] === "rm" && call.args[1] === "-f")).toHaveLength(2);
  });

  test("does not forward origins into Docker infrastructure options", async () => {
    const docker = new RecordingDocker();
    await service(docker).run(policy, limits, "curl", ["http://approved.test:8080/"]);
    const infrastructure = docker.calls.filter((call) => call.args[0] !== "exec");
    expect(infrastructure.every((call) => !call.args.join(" ").includes("approved.test"))).toBe(true);
    const worker = docker.calls.find((call) => call.args.some((argument) => argument.startsWith("HTTP_PROXY=")));
    expect(worker?.args.at(-1)).toBe("http://approved.test:8080/");
    expect(worker?.outputLimitBytes).toBe(limits.outputBytes);
  });

  test("cleans the environment when the untrusted command fails", async () => {
    const docker = new RecordingDocker();
    docker.failWorker = true;
    await expect(service(docker).run(policy, limits, "curl", ["http://approved.test:8080/"])).rejects.toThrow("worker failed");
    expect(docker.calls.filter((call) => call.args[0] === "rm" && call.args[1] === "-f")).toHaveLength(2);
    expect(docker.calls.filter((call) => call.args[0] === "network" && call.args[1] === "rm")).toHaveLength(2);
  });
});
