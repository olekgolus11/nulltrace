import { loadExecutionBrokerDaemonConfiguration } from "../../src/features/execution/services/execution-broker-daemon-config.helpers";
import { DockerCommandService } from "../../src/features/execution/services/docker-command.service";
import { ExecutionBrokerHostService } from "../../src/features/execution/services/execution-broker-host.service";

let host: ExecutionBrokerHostService | null = null;
let stopRequested = false;
let startupFailed = false;
let closing: Promise<void> | null = null;

const started = (async () => {
  if (Bun.argv.length !== 3) throw new Error("Invalid broker invocation.");
  const startup = await loadExecutionBrokerDaemonConfiguration(Bun.argv[2]!);
  host = new ExecutionBrokerHostService({
    ...startup.hostOptions,
    docker: new DockerCommandService(startup.dockerExecutable),
  });
  try {
    await host.start();
  } finally {
    startup.hostOptions.hmacKey.fill(0);
  }
  if (!stopRequested) console.log("Execution broker ready.");
})().catch(() => {
  startupFailed = true;
  process.exitCode = 1;
  console.error("Execution broker could not start.");
});

function requestShutdown(): void {
  stopRequested = true;
  if (closing) return;
  closing = started.then(async () => {
    await host?.close();
    process.exit(startupFailed ? 1 : 0);
  }).catch(() => {
    console.error("Execution broker shutdown could not confirm cleanup.");
    process.exit(1);
  });
}

process.on("SIGTERM", requestShutdown);
process.on("SIGINT", requestShutdown);
