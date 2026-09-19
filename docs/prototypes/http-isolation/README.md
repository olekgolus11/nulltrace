# THROWAWAY HTTP isolation experiment

Question: can a short-lived NET_ADMIN initializer install effective per-run worker/proxy restrictions in their network namespaces on a desktop Docker engine, before untrusted execution and without shared VM firewall changes?

This is infrastructure evidence, not a production broker, tool migration or complete security acceptance suite. It uses only synthetic local fixtures. It must not use real credentials or application data.

Run from the repository root with `bun docs/prototypes/http-isolation/http-isolation.experiment.ts`. It builds a disposable test image, creates uniquely named private networks and containers, records evidence in a printed temporary directory, and removes its containers/networks in `finally`. The locally built image remains for repeat experiments. SIGINT/SIGTERM trigger cleanup; host/runtime loss still requires recovery and is not proven by that handler.

Add `--host-fixture` to test synthetic HTTP and HTTPS services bound exclusively to the Mac's `127.0.0.1`. This mode uses an upstream bridge with ordinary routing, resolves `host.docker.internal` in trusted setup, and permits only the two ephemeral fixture ports through the proxy firewall. The test URL and Host remain `localhost`; TLS verification uses the synthetic fixture certificate. Host servers stop during cleanup. No existing host service is contacted.

Only fixed experiment infrastructure gets NET_ADMIN. Workers and proxy get no capabilities, no-new-privileges, default seccomp, read-only root filesystems, memory/CPU/PID limits and a bounded tmpfs. There are no host/app/socket mounts in these containers. The host-side driver has Docker authority and stands in for the future broker; it is not its implementation.

Review the output and pending cases before interpreting any passing check. Squid cannot enforce encrypted HTTP semantics inside CONNECT. Nmap with raw packet privileges needs a different proof. Package versions and effective runtime details are captured by each run; the base image is pinned, but apt packages are not a release lockfile.
