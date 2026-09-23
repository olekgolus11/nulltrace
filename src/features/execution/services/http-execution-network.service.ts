import { createHash, randomBytes } from "node:crypto";
import {
  DockerCommandAdapter,
  HttpExecutionNetworkEnvironment,
  HttpExecutionNetworkOptions,
  HttpExecutionNetworkPolicy,
  HttpExecutionNetworkResult,
  HttpExecutionNetworkRunResult,
} from "../types/http-execution-network.types";
import { ExecutionLimits } from "../types/execution-plan.types";
import { requireExecutionId } from "./execution-validation.helpers";
import { HttpExecutionRunError } from "./http-execution-run.error";
import {
  assertVerifiedFirewall,
  compileProxyFirewall,
  compileSquidConfiguration,
  compileWorkerFirewall,
  createHttpExecutionNetworkPolicy,
  normalizeNetworkAddress,
} from "./http-execution-policy.helpers";

export class HttpExecutionNetworkService {
  private readonly active = new Set<string>();
  private reconciliation: Promise<void> | null = null;
  private recoveryRequired = false;
  private reconciling = false;

  constructor(private readonly docker: DockerCommandAdapter, private readonly options: HttpExecutionNetworkOptions) {
    requireExecutionId(options.installationId);
    for (const image of Object.values(options.images)) {
      if (!/^sha256:[a-f0-9]{64}$/.test(image)) throw new Error("Isolation images must use immutable local IDs.");
    }
    for (const timeout of [options.commandTimeoutMs, options.setupTimeoutMs, options.cleanupTimeoutMs]) {
      if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 30 * 60_000) throw new Error("Invalid isolation timeout.");
    }
  }

  async run(
    policy: HttpExecutionNetworkPolicy,
    limits: ExecutionLimits,
    executable: string,
    argv: string[],
    signal?: AbortSignal,
  ): Promise<HttpExecutionNetworkRunResult> {
    this.options.ownershipLock.assertHeld();
    await this.ensureReconciled();
    if (this.reconciling) throw new Error("Execution recovery is in progress.");
    if (this.recoveryRequired) throw new Error("Execution cleanup requires reconciliation.");
    policy = createHttpExecutionNetworkPolicy(
      policy.executionId,
      policy.origins,
      policy.endpoints,
      this.options.trustedNonPublicMappings,
    );
    if (this.active.size) throw new Error("Execution environment is busy.");
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/.test(executable) || argv.length > 256 || argv.some((value) => value.includes("\0"))) {
      throw new Error("Invalid isolated command.");
    }
    this.validateLimits(limits);
    this.requireActive(signal);
    this.active.add(policy.executionId);
    const names = this.names(policy.executionId);
    let environment: HttpExecutionNetworkEnvironment | null = null;
    let workerRulesHash = "";
    let proxyRulesHash = "";
    let command: HttpExecutionNetworkResult | null = null;
    let proxyDecisions: string[] = [];
    let failure: unknown;
    try {
      this.requireActive(signal);
      environment = await this.provision(policy, limits, names, signal);
      this.requireActive(signal);
      const workerRules = compileWorkerFirewall(names.proxyIpv4, names.proxyIpv6);
      const proxyRules = compileProxyFirewall(names.workerIpv4, names.workerIpv6, policy.endpoints);
      workerRulesHash = this.hash(workerRules);
      proxyRulesHash = this.hash(proxyRules);
      await this.installAndVerifyFirewall(environment.workerContainerId, workerRules, {
        addresses: [names.proxyIpv4, normalizeNetworkAddress(names.proxyIpv6)],
        ports: [3128],
        minimumAcceptRules: 5,
      }, names, signal);
      this.requireActive(signal);
      await this.installAndVerifyFirewall(environment.proxyContainerId, proxyRules, {
        addresses: [names.workerIpv4, normalizeNetworkAddress(names.workerIpv6), ...policy.endpoints.map((endpoint) => endpoint.address)],
        ports: [3128, ...policy.endpoints.map((endpoint) => endpoint.port)],
        minimumAcceptRules: 5 + policy.endpoints.length,
      }, names, signal);
      this.requireActive(signal);
      await this.startProxy(environment.proxyContainerId, policy, signal);
      this.requireActive(signal);
      command = await this.executeWorker(environment, limits, executable, argv, signal);
      this.requireActive(signal);
      proxyDecisions = await this.readProxyDecisions(environment.proxyContainerId);
      this.requireActive(signal);
    } catch (error) {
      failure = error;
    }
    let cleanupConfirmed = false;
    try {
      cleanupConfirmed = await this.cleanup(names);
    } finally {
      this.active.delete(policy.executionId);
    }
    if (!cleanupConfirmed) {
      this.recoveryRequired = true;
      throw new HttpExecutionRunError("Execution environment cleanup could not be confirmed.", false);
    }
    if (failure) throw new HttpExecutionRunError(failure instanceof Error ? failure.message : "Isolated execution failed.", true);
    if (!command || !environment) throw new Error("Execution environment did not produce a result.");
    return {
      command,
      evidence: {
        executionId: policy.executionId,
        workerRulesSha256: workerRulesHash,
        proxyRulesSha256: proxyRulesHash,
        proxyDecisions,
        cleanupConfirmed,
      },
    };
  }

  async reconcileOwnedResources(): Promise<void> {
    this.options.ownershipLock.assertHeld();
    if (this.active.size || this.reconciling) throw new Error("Cannot reconcile while executions or recovery are active.");
    this.reconciling = true;
    try {
      const filter = `label=nulltrace.installation=${this.options.installationId}`;
      const containers = await this.docker.run(["ps", "-aq", "--filter", filter], {
        timeoutMs: this.options.cleanupTimeoutMs,
      });
      if (containers.exitCode !== 0) throw new Error("Execution container inventory is unavailable.");
      const containerIds = this.requireResourceIds(containers.stdout);
      if (containerIds.length) {
        const removed = await this.docker.run(["rm", "-f", ...containerIds], {
          timeoutMs: this.options.cleanupTimeoutMs,
        });
        if (removed.exitCode !== 0) throw new Error("Execution containers could not be removed.");
      }
      const networks = await this.docker.run(["network", "ls", "-q", "--filter", filter], {
        timeoutMs: this.options.cleanupTimeoutMs,
      });
      if (networks.exitCode !== 0) throw new Error("Execution network inventory is unavailable.");
      for (const id of this.requireResourceIds(networks.stdout)) {
        const removed = await this.docker.run(["network", "rm", id], {
          timeoutMs: this.options.cleanupTimeoutMs,
        });
        if (removed.exitCode !== 0) throw new Error("Execution network could not be removed.");
      }
      const remainingContainers = await this.docker.run(["ps", "-aq", "--filter", filter], {
        timeoutMs: this.options.cleanupTimeoutMs,
      });
      const remainingNetworks = await this.docker.run(["network", "ls", "-q", "--filter", filter], {
        timeoutMs: this.options.cleanupTimeoutMs,
      });
      if (remainingContainers.exitCode !== 0 || remainingNetworks.exitCode !== 0 ||
        remainingContainers.stdout.trim() || remainingNetworks.stdout.trim()) {
        throw new Error("Execution cleanup could not be confirmed.");
      }
      this.recoveryRequired = false;
    } finally {
      this.reconciling = false;
    }
  }

  async retryReconciliation(): Promise<void> {
    if (this.active.size) throw new Error("Cannot reconcile while executions are active.");
    this.reconciliation = this.reconcileOwnedResources();
    await this.reconciliation;
  }

  private async ensureReconciled(): Promise<void> {
    this.reconciliation ??= this.reconcileOwnedResources();
    await this.reconciliation;
  }

  private async provision(
    policy: HttpExecutionNetworkPolicy,
    limits: ExecutionLimits,
    names: EnvironmentNames,
    signal?: AbortSignal,
  ): Promise<HttpExecutionNetworkEnvironment> {
    await this.requireSuccess([
      "network", "create", "--internal", "--ipv6", "--subnet", `${names.frontIpv4}.0/24`, "--subnet", `${names.frontIpv6}::/64`,
      "--label", `nulltrace.execution=${names.label}`, "--label", `nulltrace.installation=${this.options.installationId}`, names.frontNetwork,
    ], this.options.setupTimeoutMs, undefined, signal);
    await this.requireSuccess([
      "network", "create", "--ipv6", "--subnet", `${names.backIpv4}.0/24`, "--subnet", `${names.backIpv6}::/64`,
      "--label", `nulltrace.execution=${names.label}`, "--label", `nulltrace.installation=${this.options.installationId}`, names.backNetwork,
    ], this.options.setupTimeoutMs, undefined, signal);
    await this.createContainer(names.proxyContainer, this.options.images.proxy, names.backNetwork, names.proxyBackIpv4, names.proxyBackIpv6, limits, names, signal);
    await this.requireSuccess([
      "network", "connect", "--ip", names.proxyIpv4, "--ip6", names.proxyIpv6, names.frontNetwork, names.proxyContainer,
    ], this.options.setupTimeoutMs, undefined, signal);
    await this.createContainer(names.workerContainer, this.options.images.worker, names.frontNetwork, names.workerIpv4, names.workerIpv6, limits, names, signal);
    return {
      executionId: policy.executionId,
      workerContainerId: names.workerContainer,
      proxyContainerId: names.proxyContainer,
      frontNetworkId: names.frontNetwork,
      backNetworkId: names.backNetwork,
      proxyUrl: `http://${names.proxyIpv4}:3128`,
    };
  }

  private async createContainer(
    name: string,
    image: string,
    network: string,
    ipv4: string,
    ipv6: string,
    limits: ExecutionLimits,
    names: EnvironmentNames,
    signal?: AbortSignal,
  ): Promise<void> {
    const cpu = Math.max(0.001, limits.cpuMilliCores / 1000).toFixed(3);
    await this.requireSuccess([
      "run", "-d", "--name", name, "--hostname", "runtime", "--label", `nulltrace.execution=${names.label}`,
      "--label", `nulltrace.installation=${this.options.installationId}`,
      "--network", network, "--ip", ipv4, "--ip6", ipv6,
      "--read-only", "--user", "65532:65532", "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true",
      "--memory", String(limits.memoryBytes), "--memory-swap", String(limits.memoryBytes), "--cpus", cpu,
      "--pids-limit", String(limits.processCount), "--ulimit", `fsize=${limits.fileBytes}:${limits.fileBytes}`,
      "--tmpfs", `/work:rw,noexec,nosuid,nodev,size=${limits.scratchBytes},uid=65532,gid=65532,mode=700`,
      "--tmpfs", "/tmp:rw,noexec,nosuid,nodev,size=33554432,mode=1777",
      "--entrypoint", "sleep", image, "infinity",
    ], this.options.setupTimeoutMs, undefined, signal);
  }

  private async installAndVerifyFirewall(
    container: string,
    rules: string,
    requirements: { addresses: string[]; ports: number[]; minimumAcceptRules: number },
    names: EnvironmentNames,
    signal?: AbortSignal,
  ): Promise<void> {
    const common = [
      "run", "--rm", "-i", "--network", `container:${container}`, "--label", `nulltrace.execution=${names.label}`,
      "--label", `nulltrace.installation=${this.options.installationId}`,
      "--read-only", "--user", "0:0", "--cap-drop", "ALL", "--cap-add", "NET_ADMIN",
      "--security-opt", "no-new-privileges:true", "--memory", "67108864", "--memory-swap", "67108864",
      "--cpus", "0.25", "--pids-limit", "16", "--tmpfs", "/tmp:rw,noexec,nosuid,nodev,size=8388608,mode=1777",
      this.options.images.initializer,
    ];
    await this.requireSuccess([...common, "nft", "-f", "-"], this.options.setupTimeoutMs, new TextEncoder().encode(rules), signal);
    const result = await this.requireSuccess([...common, "nft", "-j", "list", "ruleset"], this.options.setupTimeoutMs, undefined, signal);
    let parsed: unknown;
    try {
      parsed = JSON.parse(result.stdout);
    } catch {
      throw new Error("Firewall verification returned invalid data.");
    }
    assertVerifiedFirewall(parsed, requirements);
  }

  private async startProxy(container: string, policy: HttpExecutionNetworkPolicy, signal?: AbortSignal): Promise<void> {
    const { configuration, hosts } = compileSquidConfiguration(policy);
    await this.writePrivateFile(container, "/work/squid.conf", configuration, signal);
    await this.writePrivateFile(container, "/work/hosts", hosts, signal);
    await this.requireSuccess(["exec", container, "squid", "-k", "parse", "-f", "/work/squid.conf"], this.options.setupTimeoutMs, undefined, signal);
    await this.requireSuccess(["exec", "-d", container, "squid", "-N", "-f", "/work/squid.conf"], this.options.setupTimeoutMs, undefined, signal);
    for (let attempt = 0; attempt < 50; attempt++) {
      this.requireActive(signal);
      const result = await this.docker.run(["exec", container, "test", "-s", "/work/squid.pid"], { timeoutMs: 1_000, signal });
      if (result.exitCode === 0) return;
      await Bun.sleep(100);
    }
    throw new Error("Execution proxy did not become ready.");
  }

  private async executeWorker(
    environment: HttpExecutionNetworkEnvironment,
    limits: ExecutionLimits,
    executable: string,
    argv: string[],
    signal?: AbortSignal,
  ): Promise<HttpExecutionNetworkResult> {
    const result = await this.docker.run([
      "exec", "-e", `HTTP_PROXY=${environment.proxyUrl}`, "-e", `HTTPS_PROXY=${environment.proxyUrl}`,
      "-e", `ALL_PROXY=${environment.proxyUrl}`, "-e", "NO_PROXY=", environment.workerContainerId, executable, ...argv,
    ], {
      timeoutMs: Math.min(limits.timeoutMs, this.options.commandTimeoutMs),
      outputLimitBytes: limits.outputBytes,
      signal,
    });
    return result;
  }

  private async writePrivateFile(container: string, path: string, value: string, signal?: AbortSignal): Promise<void> {
    const input = new TextEncoder().encode(value);
    try {
      await this.requireSuccess([
        "exec", "-i", container, "sh", "-c", `umask 077; cat > ${path}`,
      ], this.options.setupTimeoutMs, input, signal);
    } finally {
      input.fill(0);
    }
  }

  private async readProxyDecisions(container: string): Promise<string[]> {
    const result = await this.docker.run(["exec", container, "tail", "-n", "200", "/work/access.log"], {
      timeoutMs: this.options.setupTimeoutMs,
    });
    if (result.exitCode !== 0) return [];
    return result.stdout.split("\n").filter(Boolean).slice(-200).map((line) => line.slice(0, 512));
  }

  private async cleanup(names: EnvironmentNames): Promise<boolean> {
    for (const container of [names.workerContainer, names.proxyContainer]) {
      await this.docker.run(["rm", "-f", container], { timeoutMs: this.options.cleanupTimeoutMs }).catch(() => null);
    }
    const discovered = await this.docker.run([
      "ps", "-aq", "--filter", `label=nulltrace.execution=${names.label}`,
    ], { timeoutMs: this.options.cleanupTimeoutMs }).catch(() => null);
    const containerIds = this.resourceIds(discovered?.stdout ?? "");
    if (discovered?.exitCode === 0 && containerIds.length) {
      await this.docker.run(["rm", "-f", ...containerIds], { timeoutMs: this.options.cleanupTimeoutMs }).catch(() => null);
    }
    for (const network of [names.frontNetwork, names.backNetwork]) {
      await this.docker.run(["network", "rm", network], { timeoutMs: this.options.cleanupTimeoutMs }).catch(() => null);
    }
    const result = await this.docker.run([
      "ps", "-aq", "--filter", `label=nulltrace.execution=${names.label}`,
    ], { timeoutMs: this.options.cleanupTimeoutMs }).catch(() => null);
    const networks = await this.docker.run([
      "network", "ls", "-q", "--filter", `label=nulltrace.execution=${names.label}`,
    ], { timeoutMs: this.options.cleanupTimeoutMs }).catch(() => null);
    return Boolean(result && networks && result.exitCode === 0 && networks.exitCode === 0 && !result.stdout.trim() && !networks.stdout.trim());
  }

  private resourceIds(value: string): string[] {
    const ids = value.split("\n").map((id) => id.trim()).filter(Boolean);
    return ids.every((id) => /^[a-f0-9]{12,64}$/.test(id)) ? ids : [];
  }

  private requireResourceIds(value: string): string[] {
    const ids = this.resourceIds(value);
    if (value.trim() && !ids.length) throw new Error("Execution resource inventory is malformed.");
    return ids;
  }

  private async requireSuccess(
    args: string[],
    timeoutMs: number,
    input?: Uint8Array,
    signal?: AbortSignal,
  ): Promise<HttpExecutionNetworkResult> {
    this.requireActive(signal);
    const result = await this.docker.run(args, { input, timeoutMs, signal });
    if (result.exitCode !== 0) throw new Error(`Isolation infrastructure command failed: ${args[0]} ${args[1] ?? ""}`);
    return result;
  }

  private validateLimits(limits: ExecutionLimits): void {
    for (const value of Object.values(limits)) {
      if (!Number.isSafeInteger(value) || value < 1) throw new Error("Isolation limits must be finite positive integers.");
    }
    if (limits.fileBytes > limits.scratchBytes) throw new Error("File limit exceeds scratch capacity.");
  }

  private requireActive(signal?: AbortSignal): void {
    if (signal?.aborted) throw new Error("Isolated execution cancelled.");
  }

  private names(executionId: string): EnvironmentNames {
    const digest = createHash("sha256").update(executionId).digest("hex").slice(0, 12);
    const random = randomBytes(3).toString("hex");
    const prefix = `nt-${digest}-${random}`;
    const subnet = 20 + (randomBytes(1)[0]! % 180);
    const ula = `fd71:${randomBytes(2).toString("hex")}:${randomBytes(2).toString("hex")}`;
    return {
      label: `${digest}-${random}`,
      frontNetwork: `${prefix}-front`,
      backNetwork: `${prefix}-back`,
      workerContainer: `${prefix}-worker`,
      proxyContainer: `${prefix}-proxy`,
      frontIpv4: `172.29.${subnet}`,
      backIpv4: `172.29.${subnet + 1}`,
      frontIpv6: `${ula}:1`,
      backIpv6: `${ula}:2`,
      workerIpv4: `172.29.${subnet}.10`,
      workerIpv6: `${ula}:1::10`,
      proxyIpv4: `172.29.${subnet}.20`,
      proxyIpv6: `${ula}:1::20`,
      proxyBackIpv4: `172.29.${subnet + 1}.20`,
      proxyBackIpv6: `${ula}:2::20`,
    };
  }

  private hash(value: string): string {
    return createHash("sha256").update(value).digest("hex");
  }
}

interface EnvironmentNames {
  label: string;
  frontNetwork: string;
  backNetwork: string;
  workerContainer: string;
  proxyContainer: string;
  frontIpv4: string;
  backIpv4: string;
  frontIpv6: string;
  backIpv6: string;
  workerIpv4: string;
  workerIpv6: string;
  proxyIpv4: string;
  proxyIpv6: string;
  proxyBackIpv4: string;
  proxyBackIpv6: string;
}
