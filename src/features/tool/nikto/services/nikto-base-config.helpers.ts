import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";

export function loadNiktoBaseConfig() {
  const executablePath = Bun.which("nikto");
  const resolvedExecutablePath = executablePath
    ? realpathSync(executablePath)
    : null;
  const executablePrefix = executablePath
    ? dirname(dirname(executablePath))
    : null;
  const candidates = [
    ...(executablePath
      ? [
          join(dirname(executablePath), "nikto.conf"),
          join(dirname(executablePath), "nikto.conf.default"),
        ]
      : []),
    ...(resolvedExecutablePath
      ? [
          join(dirname(resolvedExecutablePath), "nikto.conf"),
          join(dirname(resolvedExecutablePath), "nikto.conf.default"),
        ]
      : []),
    join(process.cwd(), "nikto.conf"),
    ...(process.env.HOME ? [join(process.env.HOME, "nikto.conf")] : []),
    ...(process.env.USERPROFILE ? [join(process.env.USERPROFILE, "nikto.conf")] : []),
    ...(executablePrefix ? [join(executablePrefix, "etc", "nikto.conf")] : []),
    "/etc/nikto.conf",
  ];
  const configPath = candidates.find((candidate) => existsSync(candidate));
  if (!configPath) {
    throw new Error(
      "Authenticated Nikto could not locate the active base configuration.",
    );
  }
  return readFileSync(configPath, "utf8");
}
