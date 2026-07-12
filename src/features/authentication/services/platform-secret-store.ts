import { AuthenticatedContextStorageMode } from "../model/authenticated-request-context.types";

export interface SecretStoreValue {
  value: string;
  storageMode: AuthenticatedContextStorageMode;
}

export interface SecretStore {
  save: (key: string, value: string) => Promise<AuthenticatedContextStorageMode>;
  load: (key: string) => Promise<SecretStoreValue | null>;
  clear: (key: string) => Promise<void>;
}

export interface SecretStoreCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface SecretStoreCommandRunner {
  run: (command: string[], input?: string) => Promise<SecretStoreCommandResult>;
}

export interface PlatformSecretStoreAdapter {
  isAvailable: () => Promise<boolean>;
  save: (key: string, value: string) => Promise<void>;
  load: (key: string) => Promise<string | null>;
  clear: (key: string) => Promise<void>;
}

const serviceName = "NullTrace Authenticated Request Context";

function createCommandError(action: string, result: SecretStoreCommandResult) {
  void result;
  return new Error(`Unable to ${action} protected authentication context.`);
}

const bunSecretStoreCommandRunner: SecretStoreCommandRunner = {
  async run(command, input) {
    const process = Bun.spawn(command, {
      stdin: input === undefined ? "ignore" : "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdin = process.stdin;
    if (input !== undefined && stdin) {
      stdin.write(input);
      stdin.end();
    }

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
      process.exited,
    ]);

    return { exitCode, stdout, stderr };
  },
};

export class MacOSKeychainSecretStoreAdapter
  implements PlatformSecretStoreAdapter
{
  constructor(private readonly commandRunner: SecretStoreCommandRunner) {}

  async isAvailable() {
    const result = await this.commandRunner.run(["security", "list-keychains"]);
    return result.exitCode === 0;
  }

  async save(key: string, value: string) {
    const result = await this.commandRunner.run([
      "security",
      "add-generic-password",
      "-U",
      "-s",
      serviceName,
      "-a",
      key,
      "-w",
      value,
    ]);
    if (result.exitCode !== 0) {
      throw createCommandError("save", result);
    }
  }

  async load(key: string) {
    const result = await this.commandRunner.run([
      "security",
      "find-generic-password",
      "-s",
      serviceName,
      "-a",
      key,
      "-w",
    ]);
    if (result.exitCode !== 0) {
      return null;
    }
    return result.stdout.replace(/\r?\n$/, "");
  }

  async clear(key: string) {
    const result = await this.commandRunner.run([
      "security",
      "delete-generic-password",
      "-s",
      serviceName,
      "-a",
      key,
    ]);
    if (result.exitCode !== 0) {
      throw createCommandError("clear", result);
    }
  }
}

export class LinuxSecretServiceSecretStoreAdapter
  implements PlatformSecretStoreAdapter
{
  constructor(private readonly commandRunner: SecretStoreCommandRunner) {}

  async isAvailable() {
    const result = await this.commandRunner.run(["secret-tool", "--version"]);
    return result.exitCode === 0;
  }

  async save(key: string, value: string) {
    const result = await this.commandRunner.run(
      [
        "secret-tool",
        "store",
        "--label=NullTrace Authenticated Request Context",
        "service",
        "nulltrace",
        "context",
        key,
      ],
      value,
    );
    if (result.exitCode !== 0) {
      throw createCommandError("save", result);
    }
  }

  async load(key: string) {
    const result = await this.commandRunner.run([
      "secret-tool",
      "lookup",
      "service",
      "nulltrace",
      "context",
      key,
    ]);
    if (result.exitCode !== 0) {
      return null;
    }
    return result.stdout.replace(/\r?\n$/, "");
  }

  async clear(key: string) {
    const result = await this.commandRunner.run([
      "secret-tool",
      "clear",
      "service",
      "nulltrace",
      "context",
      key,
    ]);
    if (result.exitCode !== 0) {
      throw createCommandError("clear", result);
    }
  }
}

const windowsCredentialManagerType = String.raw`
using System;
using System.Runtime.InteropServices;
public static class NullTraceCredentialManager {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct Credential {
    public UInt32 Flags; public UInt32 Type; public string TargetName; public string Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public UInt32 CredentialBlobSize; public IntPtr CredentialBlob; public UInt32 Persist;
    public UInt32 AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName;
  }
  [DllImport("Advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern bool CredWrite(ref Credential credential, UInt32 flags);
  [DllImport("Advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern bool CredRead(string target, UInt32 type, UInt32 flags, out IntPtr credential);
  [DllImport("Advapi32.dll", SetLastError = true)]
  public static extern bool CredDelete(string target, UInt32 type, UInt32 flags);
  [DllImport("Advapi32.dll", SetLastError = true)]
  public static extern void CredFree(IntPtr credential);
}`;

function windowsCommand(operation: "save" | "load" | "clear") {
  const common = `$type = @'${windowsCredentialManagerType}'@; Add-Type -TypeDefinition $type; $target = 'NullTrace/AuthContext/' + $args[0];`;
  if (operation === "save") {
    return `${common} $bytes = [Convert]::FromBase64String([Console]::In.ReadToEnd()); $credential = New-Object NullTraceCredentialManager+Credential; $credential.Type = 1; $credential.TargetName = $target; $credential.UserName = 'NullTrace'; $credential.Persist = 2; $credential.CredentialBlobSize = $bytes.Length; $credential.CredentialBlob = [Runtime.InteropServices.Marshal]::AllocCoTaskMem($bytes.Length); [Runtime.InteropServices.Marshal]::Copy($bytes, 0, $credential.CredentialBlob, $bytes.Length); $ok = [NullTraceCredentialManager]::CredWrite([ref]$credential, 0); [Runtime.InteropServices.Marshal]::FreeCoTaskMem($credential.CredentialBlob); if (!$ok) { exit 1 }`;
  }
  if (operation === "load") {
    return `${common} $pointer = [IntPtr]::Zero; if (![NullTraceCredentialManager]::CredRead($target, 1, 0, [ref]$pointer)) { exit 2 }; $credential = [Runtime.InteropServices.Marshal]::PtrToStructure($pointer, [type][NullTraceCredentialManager+Credential]); $bytes = New-Object byte[] $credential.CredentialBlobSize; [Runtime.InteropServices.Marshal]::Copy($credential.CredentialBlob, $bytes, 0, $bytes.Length); [NullTraceCredentialManager]::CredFree($pointer); [Console]::Out.Write([Convert]::ToBase64String($bytes));`;
  }
  return `${common} if (![NullTraceCredentialManager]::CredDelete($target, 1, 0)) { exit 1 }`;
}

export class WindowsCredentialManagerSecretStoreAdapter
  implements PlatformSecretStoreAdapter
{
  constructor(private readonly commandRunner: SecretStoreCommandRunner) {}

  async isAvailable() {
    const result = await this.commandRunner.run([
      "powershell.exe",
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "$PSVersionTable.PSVersion.ToString()",
    ]);
    return result.exitCode === 0;
  }

  async save(key: string, value: string) {
    const result = await this.commandRunner.run(
      [
        "powershell.exe",
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        windowsCommand("save"),
        key,
      ],
      Buffer.from(value, "utf8").toString("base64"),
    );
    if (result.exitCode !== 0) {
      throw createCommandError("save", result);
    }
  }

  async load(key: string) {
    const result = await this.commandRunner.run([
      "powershell.exe",
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      windowsCommand("load"),
      key,
    ]);
    if (result.exitCode !== 0) {
      return null;
    }
    return Buffer.from(result.stdout.trim(), "base64").toString("utf8");
  }

  async clear(key: string) {
    const result = await this.commandRunner.run([
      "powershell.exe",
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      windowsCommand("clear"),
      key,
    ]);
    if (result.exitCode !== 0) {
      throw createCommandError("clear", result);
    }
  }
}

export function createPlatformSecretStoreAdapter(
  platform: NodeJS.Platform = process.platform,
  commandRunner: SecretStoreCommandRunner = bunSecretStoreCommandRunner,
): PlatformSecretStoreAdapter | null {
  if (platform === "darwin") {
    return new MacOSKeychainSecretStoreAdapter(commandRunner);
  }
  if (platform === "linux") {
    return new LinuxSecretServiceSecretStoreAdapter(commandRunner);
  }
  if (platform === "win32") {
    return new WindowsCredentialManagerSecretStoreAdapter(commandRunner);
  }
  return null;
}

export class PlatformSecretStore implements SecretStore {
  private readonly memory = new Map<string, string>();
  private readonly memoryKeys = new Set<string>();

  constructor(
    private readonly adapter: PlatformSecretStoreAdapter | null = createPlatformSecretStoreAdapter(),
  ) {}

  async save(key: string, value: string) {
    try {
      if (!this.adapter || !(await this.adapter.isAvailable())) {
        this.memory.set(key, value);
        this.memoryKeys.add(key);
        return "memory" as const;
      }

      await this.adapter.save(key, value);
      this.memory.delete(key);
      this.memoryKeys.delete(key);
      return "secure" as const;
    } catch {
      this.memory.set(key, value);
      this.memoryKeys.add(key);
      return "memory" as const;
    }
  }

  async load(key: string): Promise<SecretStoreValue | null> {
    const memoryValue = this.memory.get(key);
    if (memoryValue !== undefined) {
      return { value: memoryValue, storageMode: "memory" };
    }

    if (!this.adapter || this.memoryKeys.has(key)) {
      return null;
    }

    try {
      if (!(await this.adapter.isAvailable())) {
        return null;
      }
      const value = await this.adapter.load(key);
      return value === null ? null : { value, storageMode: "secure" };
    } catch {
      return null;
    }
  }

  async clear(key: string) {
    this.memory.delete(key);
    this.memoryKeys.delete(key);

    try {
      if (!this.adapter || !(await this.adapter.isAvailable())) {
        return;
      }
      await this.adapter.clear(key);
    } catch {
      // A missing platform credential is already effectively cleared.
    }
  }
}

export const platformSecretStore = new PlatformSecretStore();
