// THROWAWAY infrastructure experiment. Never run with real target credentials.
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const prefix = `nt-isolation-${crypto.randomUUID().slice(0, 8)}`;
const image = "nulltrace-http-isolation-experiment:local";
const directory = await mkdtemp(join(tmpdir(), `${prefix}-`));
const containers: string[] = [];
const networks: string[] = [];
const results: { name: string; passed: boolean; detail: string }[] = [];
const hostMode = Bun.argv.includes("--host-fixture");
const hostEvents: { host: string | null; path: string }[] = [];
const hostServers: { stop: (force?: boolean) => void }[] = [];
const bounds = ["--cap-drop", "ALL", "--security-opt", "no-new-privileges:true", "--read-only", "--user", "65532:65532", "--memory", "128m", "--memory-swap", "128m", "--cpus", "0.5", "--pids-limit", "48", "--ulimit", "fsize=16777216:16777216", "--tmpfs", "/tmp:rw,noexec,nosuid,nodev,size=32m,mode=1777"];
let cleaning: Promise<void> | undefined;

async function docker(args: string[], input = "", required = true) {
  const process = Bun.spawn(["docker", ...args], { stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  process.stdin.write(input);
  process.stdin.end();
  const [stdout, stderr, code] = await Promise.all([new Response(process.stdout).text(), new Response(process.stderr).text(), process.exited]);
  if (required && code !== 0) throw new Error(`docker ${args.slice(0, 4).join(" ")}: ${stderr || stdout}`);
  return { stdout, stderr, code };
}

async function save(name: string, data: unknown) {
  await Bun.write(join(directory, name), typeof data === "string" ? data : JSON.stringify(data, null, 2));
}

async function check(name: string, operation: () => Promise<string>) {
  try {
    const detail = await operation();
    results.push({ name, passed: true, detail });
    console.log(`PASS ${name}: ${detail}`);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    results.push({ name, passed: false, detail });
    console.log(`FAIL ${name}: ${detail}`);
  }
  await save("results.json", results);
}

function expect(value: boolean, message: string) {
  if (!value) throw new Error(message);
}

async function run(name: string, options: string[], command: string[]) {
  const full = `${prefix}-${name}`;
  containers.push(full);
  await docker(["run", "-d", "--name", full, "--label", `nulltrace.experiment=${prefix}`, ...bounds, ...options, image, ...command]);
  return full;
}

async function exec(container: string, command: string[], required = true) {
  return docker(["exec", container, ...command], "", required);
}

async function firewall(container: string, rules: string) {
  const name = `${prefix}-init-${crypto.randomUUID().slice(0, 6)}`;
  containers.push(name);
  const result = await docker(["run", "--rm", "-i", "--name", name, "--label", `nulltrace.experiment=${prefix}`, ...bounds, "--user", "0:0", "--cap-add", "NET_ADMIN", "--network", `container:${container}`, image, "nft", "-f", "-"], `${rules}\n`);
  return result.stdout;
}

async function ruleset(container: string) {
  const name = `${prefix}-inspect-${crypto.randomUUID().slice(0, 6)}`;
  containers.push(name);
  return (await docker(["run", "--rm", "--name", name, "--label", `nulltrace.experiment=${prefix}`, ...bounds, "--user", "0:0", "--cap-add", "NET_ADMIN", "--network", `container:${container}`, image, "nft", "list", "ruleset"])).stdout;
}

async function waitReady(container: string, path = "/tmp/ready") {
  for (let attempt = 0; attempt < 60; attempt++) {
    if ((await exec(container, ["test", "-e", path], false)).code === 0) return;
    await Bun.sleep(100);
  }
  throw new Error(`Fixture not ready: ${container}`);
}

async function cleanup() {
  if (cleaning) return cleaning;
  cleaning = (async () => {
    for (const name of [...containers].reverse()) await docker(["rm", "-f", name], "", false);
    for (const name of [...networks].reverse()) await docker(["network", "rm", name], "", false);
    for (const server of hostServers) server.stop(true);
    const remaining = (await docker(["ps", "-aq", "--filter", `label=nulltrace.experiment=${prefix}`])).stdout.trim();
    const remainingNetworks = (await docker(["network", "ls", "-q", "--filter", `label=nulltrace.experiment=${prefix}`])).stdout.trim();
    await save("cleanup.json", { remaining, remainingNetworks });
    console.log(`Cleanup: ${remaining || remainingNetworks ? "INCOMPLETE" : "no experiment containers/networks remain"}`);
  })();
  return cleaning;
}

for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => { void cleanup().then(() => process.exit(130)); });
console.log(`Evidence directory: ${directory}`);

try {
  await save("docker-version.json", (await docker(["version", "--format", "{{json .}}"])).stdout);
  await save("docker-info.json", (await docker(["info", "--format", "{{json .}}"])).stdout);
  await docker(["build", "--tag", image, import.meta.dir]);
  await save("image.json", (await docker(["image", "inspect", image])).stdout);
  let hostHttpPort = 0;
  let hostTlsPort = 0;
  let hostAddress = "";
  if (hostMode) {
    const cert = (await docker(["run", "--rm", "--network", "none", ...bounds, image, "cat", "/experiment/cert.pem"])).stdout;
    const key = (await docker(["run", "--rm", "--network", "none", ...bounds, image, "cat", "/experiment/key.pem"])).stdout;
    const fetch = (request: Request) => {
      hostEvents.push({ host: request.headers.get("host"), path: new URL(request.url).pathname });
      return new Response("fixture-ok\n");
    };
    const http = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch });
    const https = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch, tls: { cert, key } });
    hostServers.push(http, https);
    hostHttpPort = http.port!;
    hostTlsPort = https.port!;
    const resolution = (await docker(["run", "--rm", ...bounds, image, "getent", "ahostsv4", "host.docker.internal"])).stdout;
    hostAddress = resolution.trim().split(/\s+/)[0]!;
    expect(/^\d+\.\d+\.\d+\.\d+$/.test(hostAddress), "Invalid infrastructure host mapping");
    await save("mac-fixture.json", { hostAddress, hostHttpPort, hostTlsPort, binding: "127.0.0.1" });
  }
  const existing = JSON.parse((await docker(["network", "inspect", ...(await docker(["network", "ls", "-q"])).stdout.trim().split(/\s+/)])).stdout);
  await save("preexisting-networks.json", existing);
  const serialized = JSON.stringify(existing);
  let subnet = 170;
  while (serialized.includes(`172.30.${subnet}.`) || serialized.includes(`172.30.${subnet + 1}.`)) subnet += 2;
  expect(subnet < 250, "No free experiment subnet found");
  const v4front = `172.30.${subnet}`;
  const v4back = `172.30.${subnet + 1}`;
  const v6base = `fd79:${crypto.randomUUID().slice(0, 4)}:${crypto.randomUUID().slice(0, 4)}`;
  const v6front = `${v6base}:1`;
  const v6back = `${v6base}:2`;
  const front = `${prefix}-front`;
  const back = `${prefix}-back`;
  for (const [name, v4, v6] of [[front, v4front, v6front], [back, v4back, v6back]]) {
    networks.push(name!);
    await docker(["network", "create", ...(hostMode && name === back ? [] : ["--internal"]), "--ipv6", "--subnet", `${v4}.0/24`, "--subnet", `${v6}::/64`, "--label", `nulltrace.experiment=${prefix}`, name!]);
  }
  const allowed = await run("allowed", ["--network", back, "--ip", `${v4back}.30`, "--ip6", `${v6back}::30`], ["python3", "/experiment/fixture.py"]);
  const denied = await run("denied", ["--network", back, "--ip", `${v4back}.40`, "--ip6", `${v6back}::40`], ["python3", "/experiment/fixture.py"]);
  await docker(["network", "connect", "--ip", `${v4front}.30`, "--ip6", `${v6front}::30`, front, denied]);
  await waitReady(allowed);
  await waitReady(denied);
  const holder = await run("worker-net", ["--network", front, "--ip", `${v4front}.10`, "--ip6", `${v6front}::10`, "--dns", `${v4front}.30`], ["sleep", "infinity"]);
  const proxyHolder = await run("proxy-net", ["--network", front, "--ip", `${v4front}.20`, "--ip6", `${v6front}::20`], ["sleep", "infinity"]);
  await docker(["network", "connect", "--ip", `${v4back}.20`, "--ip6", `${v6back}::20`, back, proxyHolder]);
  await save("topology.json", { prefix, front, back, v4front, v4back, v6front, v6back });
  const curl = ["curl", "--silent", "--show-error", "--connect-timeout", "1", "--max-time", "3", "--noproxy", "", "--fail"];
  await check("Fixture reachability before enforcement", async () => {
    expect((await exec(holder, [...curl, `http://${v4front}.30:8080/baseline`])).stdout.includes("fixture-ok"), "Denied fixture not reachable in baseline");
    expect((await exec(holder, [...curl, `http://[${v6front}::30]:8080/baseline-v6`])).stdout.includes("fixture-ok"), "Denied IPv6 fixture not reachable in baseline");
    expect((await exec(proxyHolder, [...curl, `http://${v4back}.40:8080/baseline`])).stdout.includes("fixture-ok"), "Proxy baseline failed");
    expect((await exec(holder, ["dig", `@${v4front}.30`, "baseline.test", "+time=1", "+tries=1"])).stdout.includes("NXDOMAIN"), "DNS fixture baseline failed");
    expect((await exec(holder, ["dig", "@127.0.0.11", "embedded-baseline.test", "+time=1", "+tries=1"])).stdout.includes("NXDOMAIN"), "Embedded DNS baseline failed");
    return "Same networks reach HTTP IPv4/IPv6 and custom/embedded DNS before rules";
  });
  await exec(denied, ["python3", "-c", "open('/tmp/events.jsonl','w').close()"]);
  await firewall(denied, `table inet evidence {
    counter received {}
    chain input { type filter hook input priority 0; policy accept; meta l4proto { tcp, udp } counter name received; }
  }`);
  const workerRules = `table inet containment {
    chain input { type filter hook input priority 0; policy drop; ct state established,related accept; counter; }
    chain forward { type filter hook forward priority 0; policy drop; counter; }
    chain output { type filter hook output priority 0; policy drop; ct state established,related accept; ip daddr ${v4front}.20 tcp dport 3128 accept; counter; }
  }`;
  const proxyRules = `table inet containment {
    chain input { type filter hook input priority 0; policy drop; ct state established,related accept; ip saddr ${v4front}.10 tcp dport 3128 accept; ip6 saddr ${v6back}::30 ip6 hoplimit 255 icmpv6 type { nd-neighbor-solicit, nd-neighbor-advert } accept; counter; }
    chain forward { type filter hook forward priority 0; policy drop; counter; }
    chain output { type filter hook output priority 0; policy drop; ct state established,related accept; ip daddr ${v4back}.30 tcp dport { 8080, 8443 } accept; ${hostMode ? `ip daddr ${hostAddress} tcp dport { ${hostHttpPort}, ${hostTlsPort} } accept;` : ""} ip6 daddr ${v6back}::30 tcp dport { 8080, 8443 } accept; ip6 daddr ff02::1:ff00:30 ip6 hoplimit 255 icmpv6 type nd-neighbor-solicit accept; ip6 daddr ${v6back}::30 ip6 hoplimit 255 icmpv6 type nd-neighbor-advert accept; counter; }
  }`;
  await firewall(holder, workerRules);
  await firewall(proxyHolder, proxyRules);
  const workerInstalled = await ruleset(holder);
  const proxyInstalled = await ruleset(proxyHolder);
  await save("worker-rules-before.txt", workerInstalled);
  await save("proxy-rules-before.txt", proxyInstalled);
  expect(workerInstalled.includes("table inet containment") && proxyInstalled.includes("table inet containment"), "No containment table after initializer exit; refuse to start workers");
  const proxyConfig = `http_port 3128
visible_hostname isolation-experiment
pid_filename /tmp/squid.pid
cache_log /tmp/cache.log
cache_store_log none
cache deny all
cache_mem 8 MB
pinger_enable off
hosts_file /tmp/hosts
acl approved dstdomain approved.test approved-v6.test
acl plain_port port 8080
acl tls_port port 8443
acl tunnel method CONNECT
${hostMode ? `acl mac_host dstdomain localhost
acl mac_http port ${hostHttpPort}
acl mac_tls port ${hostTlsPort}
http_access allow mac_host tunnel mac_tls
http_access allow mac_host !tunnel mac_http` : ""}
http_access allow approved tunnel tls_port
http_access allow approved !tunnel plain_port
http_access deny all
logformat decisions %ts.%03tu %Ss/%03>Hs
access_log stdio:/tmp/access.log decisions
shutdown_lifetime 0 seconds
`;
  const hosts = `${v4back}.30 approved.test\n${v6back}::30 approved-v6.test\n${v4back}.40 forbidden.test\n${hostMode ? `${hostAddress} localhost\n` : ""}`;
  const proxy = await run("proxy", ["--network", `container:${proxyHolder}`], ["python3", "-c", "import sys,os;open('/tmp/squid.conf','w').write(sys.argv[1]);open('/tmp/hosts','w').write(sys.argv[2]);os.execv('/usr/sbin/squid',['squid','-N','-f','/tmp/squid.conf'])", proxyConfig, hosts]);
  const worker = await run("worker", ["--network", `container:${holder}`], ["sleep", "infinity"]);
  const proxied = [...curl, "--proxy", `http://${v4front}.20:3128`];
  for (let attempt = 0; attempt < 50; attempt++) {
    if ((await exec(worker, [...proxied, "http://approved.test:8080/readiness"], false)).code === 0) break;
    await Bun.sleep(100);
  }
  await save("worker-inspect.json", (await docker(["inspect", worker, proxy, holder, proxyHolder])).stdout);
  await save("effective-worker.txt", (await exec(worker, ["sh", "-c", "id; cat /proc/self/status; cat /sys/fs/cgroup/memory.max /sys/fs/cgroup/memory.swap.max /sys/fs/cgroup/pids.max /sys/fs/cgroup/cpu.max"])).stdout);
  await save("package-versions.txt", (await exec(worker, ["dpkg-query", "-W"])).stdout);
  for (const [name, url] of [["Allowed HTTP IPv4", "http://approved.test:8080/allowed"], ["Allowed HTTP IPv6 upstream", "http://approved-v6.test:8080/allowed-v6"], ["Allowed HTTPS IPv4", "https://approved.test:8443/allowed-tls"], ["Allowed HTTPS IPv6 upstream", "https://approved-v6.test:8443/allowed-tls-v6"]]) {
    await check(name!, async () => {
      const result = await exec(worker, [...proxied, "--cacert", "/experiment/cert.pem", url!]);
      expect(result.stdout.includes("fixture-ok"), result.stdout);
      return "Controlled approved fixture responded (TLS verification retained)";
    });
  }
  if (hostMode) {
    await check("Mac loopback HTTP and HTTPS retain exact origin", async () => {
      for (const url of [`http://localhost:${hostHttpPort}/mac-http`, `https://localhost:${hostTlsPort}/mac-tls`]) {
        const result = await exec(worker, [...proxied, "--cacert", "/experiment/cert.pem", url]);
        expect(result.stdout.includes("fixture-ok"), "Mac fixture did not respond");
      }
      expect(hostEvents.some((event) => event.host === `localhost:${hostHttpPort}` && event.path === "/mac-http"), "HTTP Host changed");
      expect(hostEvents.some((event) => event.host === `localhost:${hostTlsPort}` && event.path === "/mac-tls"), "HTTPS Host changed");
      await save("mac-server-events.json", hostEvents);
      return "127.0.0.1-only Mac fixtures received original Host; HTTPS certificate verified for localhost";
    });
    await check("Worker cannot directly reach approved Mac service", async () => {
      const before = hostEvents.length;
      expect((await exec(worker, [...curl, `http://${hostAddress}:${hostHttpPort}/mac-bypass`], false)).code !== 0, "Direct host access succeeded");
      expect(hostEvents.length === before, "Host observed direct bypass request");
      return "Approved Mac service remains accessible only through assigned proxy";
    });
  }
  const forbidden: [string, string[]][] = [
    ["Cross-origin redirect", [...proxied, "--location", "http://approved.test:8080/redirect"]],
    ["Direct forbidden IPv4", [...curl, `http://${v4front}.30:8080/direct-v4`]],
    ["Direct forbidden IPv6", [...curl, `http://[${v6front}::30]:8080/direct-v6`]],
    ["NO_PROXY bypass", [...proxied, "--noproxy", "*", `http://${v4front}.30:8080/no-proxy`]],
    ["Forbidden proxy destination", [...proxied, "http://forbidden.test:8080/outside"]],
    ["Forbidden CONNECT", [...proxied, "https://forbidden.test:8443/outside"]],
    ["Approved host wrong port", [...proxied, "http://approved.test:9000/outside"]],
    ["Approved host wrong protocol port", [...proxied, "https://approved.test:8080/outside"]],
    ["Direct proxy wrong port", [...curl, `http://${v4front}.20:9000/outside`]],
    ["Direct Docker gateway", [...curl, `http://${v4front}.1:8080/outside`]],
    ["Direct metadata address", [...curl, "http://169.254.169.254/latest/meta-data/"]],
    ["Direct DoH endpoint", [...curl, `https://${v4front}.30:8443/dns-query`]],
    ["DNS UDP direct", ["dig", `@${v4front}.30`, "forbidden.test", "+time=1", "+tries=1"]],
    ["DNS TCP direct", ["dig", `@${v4front}.30`, "forbidden.test", "+tcp", "+time=1", "+tries=1"]],
    ["Docker embedded DNS", ["dig", "@127.0.0.11", "forbidden.test", "+time=1", "+tries=1"]],
  ];
  for (const [name, command] of forbidden) await check(name, async () => {
    const result = await exec(worker, command, false);
    await save(`attempt-${name.replaceAll(/[^a-z0-9]/gi, "-")}.json`, result);
    expect(result.code !== 0, "Forbidden attempt succeeded");
    return `Rejected/timeout, exit ${result.code}; fixture evidence checked separately`;
  });
  await check("Proxy upstream firewall independent of Squid ACL", async () => {
    for (const url of [`http://${v4back}.40:8080/proxy-bypass`, `http://[${v6back}::40]:8080/proxy-bypass-v6`, `http://${v4back}.30:9000/wrong-port`]) {
      expect((await exec(proxy, [...curl, url], false)).code !== 0, `Proxy reached forbidden upstream: ${url}`);
    }
    return "Direct proxy-namespace clients failed for denied IPv4/IPv6 and approved-IP wrong port";
  });
  await check("UDP bypass", async () => {
    await exec(worker, ["python3", "-c", `import socket\nfor family,host in [(socket.AF_INET,'${v4front}.30'),(socket.AF_INET6,'${v6front}::30')]:\n try: socket.socket(family,socket.SOCK_DGRAM).sendto(b'probe',(host,443))\n except PermissionError: print('DENIED',family)`]);
    return "IPv4/IPv6 UDP attempts sent by fixture; denied-server packet counter checked below";
  });
  await check("Workers cannot change network rules", async () => {
    expect((await exec(worker, ["nft", "flush", "ruleset"], false)).code !== 0, "Worker changed firewall");
    expect((await exec(proxy, ["nft", "flush", "ruleset"], false)).code !== 0, "Proxy changed firewall");
    return "Both unprivileged processes denied NET_ADMIN operation";
  });
  await check("Forbidden server received zero requests and zero TCP/UDP packets", async () => {
    const events = (await exec(denied, ["cat", "/tmp/events.jsonl"])).stdout;
    const rules = await ruleset(denied);
    await save("denied-server-events.jsonl", events);
    await save("denied-server-packet-counter.txt", rules);
    expect(events.trim() === "", `Denied server received events: ${events}`);
    expect(/counter received\s*\{\s*packets 0 bytes 0/.test(rules), `Denied server received packets: ${rules}`);
    return "Independent server-side HTTP/DNS event count = 0; input TCP/UDP packet count = 0";
  });
  await check("Resource bounds are effective", async () => {
    const pids = await exec(worker, ["python3", "-c", "import subprocess;children=[]\ntry:\n for i in range(70): children.append(subprocess.Popen(['sleep','30']))\nexcept OSError as e: print('PIDS_BLOCKED',len(children),e.errno)\nfinally:\n for p in children: p.terminate()\n for p in children: p.wait()"]);
    expect(pids.stdout.includes("PIDS_BLOCKED"), "PID limit was not enforced");
    const memory = await exec(worker, ["python3", "-c", "x=bytearray(256*1024*1024);print('UNEXPECTED')"], false);
    const events = (await exec(worker, ["cat", "/sys/fs/cgroup/memory.events"])).stdout;
    expect(memory.code !== 0 && /oom_kill [1-9]/.test(events), "Memory OOM kill not observed");
    const before = (await exec(worker, ["cat", "/sys/fs/cgroup/cpu.stat"])).stdout;
    await exec(worker, ["python3", "-c", "import time;end=time.monotonic()+2\nwhile time.monotonic()<end: pass"]);
    const after = (await exec(worker, ["cat", "/sys/fs/cgroup/cpu.stat"])).stdout;
    const value = (text: string) => Number(text.match(/nr_throttled (\d+)/)?.[1] ?? 0);
    expect(value(after) > value(before), "CPU throttle not observed");
    await save("resource-evidence.json", { pids, memory, events, before, after });
    return "Fork limit, memory OOM kill and increasing CPU throttling observed";
  });
  await save("worker-rules-after.txt", await ruleset(holder));
  await save("proxy-rules-after.txt", await ruleset(proxyHolder));
  await save("allowed-server-events.jsonl", (await exec(allowed, ["cat", "/tmp/events.jsonl"])).stdout);
  await save("proxy-access.log", (await exec(proxy, ["cat", "/tmp/access.log"], false)).stdout);
  await save("proxy-cache.log", (await exec(proxy, ["cat", "/tmp/cache.log"], false)).stdout);
  await check("Proxy failure remains closed", async () => {
    await docker(["stop", "--time", "1", proxy]);
    expect((await exec(worker, [...proxied, "http://approved.test:8080/after-stop"], false)).code !== 0, "Proxy still reachable");
    expect((await exec(worker, [...curl, `http://${v4front}.30:8080/after-stop`], false)).code !== 0, "Direct fallback reachable");
    return "No proxy or direct fallback after stopping proxy";
  });
  await save("pending.json", ["Docker Desktop execution", ...(hostMode ? [] : ["Mac-loopback routing"]), "Public/LAN/VPN routing, IPv6 host mapping and explicit SNI capture", "Nmap raw-packet profile", "Cross-run proxy access", "DNS rebinding and CNAME policy compiler", "Host/app-volume secret canaries", "Credential redaction", "Aggregate scratch and file bounds", "Deadline/cancellation/crash recovery", "Broker implementation and application integration", "Non-MITM encrypted request semantics"]);
} catch (error) {
  await save("fatal.txt", String(error));
  console.error(error);
  process.exitCode = 1;
} finally {
  await cleanup();
  await save("results.json", results);
  if (results.some((result) => !result.passed)) process.exitCode = 1;
  console.log(`Evidence retained at ${directory}`);
}
