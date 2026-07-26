import { homedir } from "node:os";
import { join } from "node:path";

export function getMacOSLoginKeychainPath(homeDirectory: string = homedir()) {
  return join(homeDirectory, "Library", "Keychains", "login.keychain-db");
}

export function getConfiguredMacOSKeychainPath() {
  return process.env.NULLTRACE_MACOS_KEYCHAIN_PATH?.trim() || undefined;
}

export function appendMacOSKeychainPath(command: string[], keychainPath?: string) {
  return keychainPath ? [...command, keychainPath] : command;
}
