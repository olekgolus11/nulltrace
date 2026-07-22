import { mkdirSync } from "node:fs";
import { join } from "node:path";

const testAppDataDirectory = join("/tmp", `nulltrace-bun-test-${crypto.randomUUID()}`);

mkdirSync(testAppDataDirectory, { recursive: true });
process.env.NULLTRACE_APP_DATA_DIR = testAppDataDirectory;
