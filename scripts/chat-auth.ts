import { spawn } from "node:child_process";
import {
  getOpenCodeExecutable,
  getOpenCodeRuntimeEnvironment,
  getOpenCodeRuntimeRoot,
} from "../src/features/chat/services/opencode-runtime.config";

const child = spawn(
  getOpenCodeExecutable(),
  ["--pure", "auth", "login", ...process.argv.slice(2)],
  {
    cwd: getOpenCodeRuntimeRoot(),
    env: getOpenCodeRuntimeEnvironment(),
    stdio: "inherit",
  },
);

child.once("error", (error) => {
  console.error(`Could not start OpenCode authentication: ${error.message}`);
  process.exitCode = 1;
});

child.once("exit", (code, signal) => {
  if (signal) {
    console.error(`OpenCode authentication stopped with signal ${signal}.`);
    process.exitCode = 1;
    return;
  }

  process.exitCode = code ?? 1;
});
