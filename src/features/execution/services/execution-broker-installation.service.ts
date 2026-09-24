import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { Database } from "bun:sqlite";
import { FileHandle, lstat, mkdir, open, realpath, unlink } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import {
  ExecutionBrokerInstallation,
  ExecutionBrokerInstallationOptions,
} from "../types/execution-broker-installation.types";
import { assertExecutionBrokerJournal, provisionExecutionBrokerJournal } from "./execution-broker-journal.helpers";

const privateDirectoryMode = 0o700;
const privateFileMode = 0o600;
const managedFiles = ["broker.key", "client.token", "receipts.sqlite"] as const;
const journalSidecars = ["receipts.sqlite-journal", "receipts.sqlite-wal", "receipts.sqlite-shm"] as const;

interface DirectoryIdentity {
  device: number;
  inode: number;
  uid: number;
}

interface LockIdentity extends DirectoryIdentity {
  path: string;
  handle: FileHandle;
}

export class ExecutionBrokerInstallationService {
  private readonly requestedDirectory: string;
  private readonly installationId: string;

  constructor(options: ExecutionBrokerInstallationOptions) {
    if (!/^[A-Za-z0-9_-]{1,96}$/.test(options.installationId)) {
      throw new Error("Invalid execution broker installation identity.");
    }
    if (!options.directory || !isAbsolute(options.directory) || options.directory.includes("\0")) {
      throw new Error("Broker installation directory must be absolute.");
    }
    this.requestedDirectory = resolve(options.directory);
    this.installationId = options.installationId;
  }

  async provision(): Promise<ExecutionBrokerInstallation> {
    const uid = process.getuid?.();
    const effectiveUid = process.geteuid?.();
    if (uid === undefined || effectiveUid === undefined || uid === 0 || effectiveUid !== uid) {
      throw new Error("Broker installation must run as the unprivileged real user.");
    }
    const directory = await this.resolveDirectory(uid);
    const directoryIdentity = await this.ensurePrivateDirectory(directory, uid);
    const lock = await this.acquireLock(directory, uid);
    let installation: ExecutionBrokerInstallation | null = null;
    let failure: unknown;

    try {
      await this.assertDirectoryIdentity(directory, directoryIdentity);
      installation = await this.loadOrCreate(directory, directoryIdentity, uid);
    } catch (error) {
      failure = error;
    }

    let lockFailure: unknown;
    try {
      await this.releaseLock(lock, directoryIdentity);
    } catch (error) {
      lockFailure = error;
    }

    if (failure || lockFailure) {
      installation?.hmacKey.fill(0);
      throw failure ?? lockFailure;
    }
    if (!installation) throw new Error("Broker installation did not produce credentials.");
    return installation;
  }

  private async resolveDirectory(uid: number): Promise<string> {
    const parentPath = dirname(this.requestedDirectory);
    const name = basename(this.requestedDirectory);
    if (!name || name === "." || name === "..") throw new Error("Invalid execution broker installation directory.");
    const parent = await realpath(parentPath);
    const parentStat = await lstat(parent);
    if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) {
      throw new Error("Broker installation parent is not a directory.");
    }
    const privateParent = parentStat.uid === uid && (parentStat.mode & 0o022) === 0;
    const stickySharedParent = parentStat.uid === 0 && (parentStat.mode & 0o1000) !== 0 && (parentStat.mode & 0o002) !== 0;
    if (!privateParent && !stickySharedParent) throw new Error("Broker installation parent is not owner-controlled.");
    return join(parent, name);
  }

  private async ensurePrivateDirectory(directory: string, uid: number): Promise<DirectoryIdentity> {
    let created = false;
    try {
      await mkdir(directory, { mode: privateDirectoryMode });
      created = true;
    } catch (error) {
      if (!this.isFileError(error, "EEXIST")) throw error;
    }

    const pathStat = await lstat(directory);
    if (pathStat.isSymbolicLink() || !pathStat.isDirectory() || pathStat.uid !== uid ||
      (!created && (pathStat.mode & 0o7777) !== privateDirectoryMode)) {
      throw new Error("Broker installation directory is not private and owner-controlled.");
    }

    const handle = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try {
      const stat = await handle.stat();
      if (!stat.isDirectory() || stat.uid !== uid) throw new Error("Broker installation directory is not owned by this user.");
      if (created && (stat.mode & 0o7777) !== privateDirectoryMode) await handle.chmod(privateDirectoryMode);
      const privateStat = await handle.stat();
      if ((privateStat.mode & 0o7777) !== privateDirectoryMode) {
        throw new Error("Broker installation directory must have mode 0700.");
      }
      const identity = { device: privateStat.dev, inode: privateStat.ino, uid: privateStat.uid };
      await this.assertDirectoryIdentity(directory, identity);
      await handle.sync();
      return identity;
    } finally {
      await handle.close();
    }
  }

  private async acquireLock(directory: string, uid: number): Promise<LockIdentity> {
    const path = join(directory, "broker-provision.lock");
    const handle = await open(
      path,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
      privateFileMode,
    );
    try {
      let stat = await handle.stat();
      if (stat.isFile() && stat.uid === uid && stat.nlink === 1 && (stat.mode & 0o7777) !== privateFileMode) {
        await handle.chmod(privateFileMode);
        stat = await handle.stat();
      }
      if (!stat.isFile() || stat.uid !== uid || (stat.mode & 0o7777) !== privateFileMode || stat.nlink !== 1) {
        throw new Error("Broker provisioning lock is not private and owner-controlled.");
      }
      await handle.sync();
      return { path, handle, device: stat.dev, inode: stat.ino, uid: stat.uid };
    } catch (error) {
      await handle.close();
      throw error;
    }
  }

  private async releaseLock(lock: LockIdentity, directoryIdentity: DirectoryIdentity): Promise<void> {
    await lock.handle.close();
    await this.assertDirectoryIdentity(dirname(lock.path), directoryIdentity);
    const stat = await lstat(lock.path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.uid !== lock.uid ||
      stat.dev !== lock.device || stat.ino !== lock.inode || (stat.mode & 0o7777) !== privateFileMode) {
      throw new Error("Broker provisioning lock changed while held.");
    }
    await unlink(lock.path);
    const directoryHandle = await open(dirname(lock.path), constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try { await directoryHandle.sync(); }
    finally { await directoryHandle.close(); }
  }

  private async loadOrCreate(
    directory: string,
    directoryIdentity: DirectoryIdentity,
    uid: number,
  ): Promise<ExecutionBrokerInstallation> {
    const paths = managedFiles.map((name) => join(directory, name));
    const present = await Promise.all(paths.map(async (path) => await lstat(path).then(() => true).catch((error) => {
      if (this.isFileError(error, "ENOENT")) return false;
      throw error;
    })));
    const presentCount = present.filter(Boolean).length;
    if (presentCount !== 0 && presentCount !== managedFiles.length) {
      throw new Error("Broker installation is partial; existing state was left untouched.");
    }

    let key: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    let tokenBytes: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    if (presentCount === 0) {
      key = randomBytes(32);
      const tokenSeed = randomBytes(32);
      tokenBytes = Buffer.from(tokenSeed.toString("hex"), "ascii");
      tokenSeed.fill(0);
      try {
        await this.createPrivateFile(paths[0]!, key, uid, directory, directoryIdentity);
        await this.createPrivateFile(paths[1]!, tokenBytes, uid, directory, directoryIdentity);
        await this.createPrivateFile(paths[2]!, Buffer.alloc(0), uid, directory, directoryIdentity);
        await this.initializeJournal(paths[2]!, key, uid);
      } catch (error) {
        key.fill(0);
        tokenBytes.fill(0);
        throw error;
      }
    } else {
      try {
        key = await this.readPrivateFile(paths[0]!, 32, uid);
        tokenBytes = await this.readPrivateFile(paths[1]!, 64, uid);
        const token = tokenBytes.toString("ascii");
        if (key.byteLength !== 32 || tokenBytes.byteLength !== 64 || !/^[a-f0-9]{64}$/.test(token) ||
          !Buffer.from(token, "ascii").equals(tokenBytes)) {
          throw new Error("Broker installation credentials are malformed.");
        }
        await this.assertNoJournalSidecars(directory);
        await this.assertJournal(paths[2]!, key, uid, true);
      } catch (error) {
        key.fill(0);
        tokenBytes.fill(0);
        throw error;
      }
    }

    try {
      await this.assertDirectoryIdentity(directory, directoryIdentity);
      await this.assertPrivateFile(paths[0]!, 32, uid);
      await this.assertPrivateFile(paths[1]!, 64, uid);
      await this.assertPrivateFile(paths[2]!, undefined, uid);
      await this.assertNoJournalSidecars(directory);
      return {
        directory,
        installationId: this.installationId,
        journalPath: paths[2]!,
        hmacKey: Uint8Array.from(key),
        clientToken: tokenBytes.toString("ascii"),
      };
    } finally {
      key.fill(0);
      tokenBytes.fill(0);
    }
  }

  private async createPrivateFile(
    path: string,
    content: Uint8Array,
    uid: number,
    directory: string,
    directoryIdentity: DirectoryIdentity,
  ): Promise<void> {
    await this.assertDirectoryIdentity(directory, directoryIdentity);
    const handle = await open(
      path,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
      privateFileMode,
    );
    try {
      const created = await handle.stat();
      if (!created.isFile() || created.uid !== uid || created.nlink !== 1) {
        throw new Error("Broker installation file is not private and owner-controlled.");
      }
      if ((created.mode & 0o7777) !== privateFileMode) await handle.chmod(privateFileMode);
      await handle.writeFile(content);
      await handle.sync();
      const written = await handle.stat();
      if (!written.isFile() || written.uid !== uid || written.nlink !== 1 ||
        (written.mode & 0o7777) !== privateFileMode || written.size !== content.byteLength) {
        throw new Error("Broker installation file could not be verified.");
      }
      await this.assertPathMatches(path, written);
    } finally {
      await handle.close();
    }
  }

  private async initializeJournal(path: string, key: Uint8Array, uid: number): Promise<void> {
    await this.assertNoJournalSidecars(dirname(path));
    const database = new Database(path, { readwrite: true, create: false });
    try {
      database.exec("PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL;");
      database.transaction(() => provisionExecutionBrokerJournal(database, this.installationId, key))();
      assertExecutionBrokerJournal(database, this.installationId, key);
    } finally {
      database.close();
    }
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.uid !== uid || stat.nlink !== 1 || (stat.mode & 0o7777) !== privateFileMode) {
        throw new Error("Broker receipt journal is not private and owner-controlled.");
      }
      await handle.sync();
    } finally {
      await handle.close();
    }
  }

  private async assertJournal(path: string, key: Uint8Array, uid: number, readOnly: boolean): Promise<void> {
    await this.assertPrivateFile(path, undefined, uid);
    const database = new Database(path, { readonly: readOnly, readwrite: !readOnly, create: false });
    try { assertExecutionBrokerJournal(database, this.installationId, key); }
    finally { database.close(); }
  }

  private async readPrivateFile(path: string, expectedBytes: number, uid: number): Promise<Buffer> {
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.uid !== uid || stat.nlink !== 1 ||
        (stat.mode & 0o7777) !== privateFileMode || stat.size !== expectedBytes) {
        throw new Error("Broker installation file is not private and owner-controlled.");
      }
      const content = await handle.readFile();
      if (content.byteLength !== expectedBytes) {
        content.fill(0);
        throw new Error("Broker installation file changed while being read.");
      }
      await this.assertPathMatches(path, stat);
      return content;
    } finally {
      await handle.close();
    }
  }

  private async assertPrivateFile(path: string, expectedBytes: number | undefined, uid: number): Promise<void> {
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.uid !== uid || stat.nlink !== 1 ||
        (stat.mode & 0o7777) !== privateFileMode || (expectedBytes !== undefined && stat.size !== expectedBytes)) {
        throw new Error("Broker installation file is not private and owner-controlled.");
      }
      await this.assertPathMatches(path, stat);
    } finally {
      await handle.close();
    }
  }

  private async assertNoJournalSidecars(directory: string): Promise<void> {
    for (const name of journalSidecars) {
      try {
        await lstat(join(directory, name));
        throw new Error("Broker receipt journal has an unexpected SQLite sidecar.");
      } catch (error) {
        if (!this.isFileError(error, "ENOENT")) throw error;
      }
    }
  }

  private async assertDirectoryIdentity(directory: string, identity: DirectoryIdentity): Promise<void> {
    const stat = await lstat(directory);
    if (stat.isSymbolicLink() || !stat.isDirectory() || stat.uid !== identity.uid || stat.dev !== identity.device ||
      stat.ino !== identity.inode || (stat.mode & 0o7777) !== privateDirectoryMode || await realpath(directory) !== directory) {
      throw new Error("Broker installation directory changed while provisioning.");
    }
  }

  private async assertPathMatches(path: string, opened: { dev: number; ino: number; uid: number; mode: number }): Promise<void> {
    const current = await lstat(path);
    if (current.isSymbolicLink() || !current.isFile() || current.dev !== opened.dev || current.ino !== opened.ino ||
      current.uid !== opened.uid || current.nlink !== 1 || (current.mode & 0o7777) !== privateFileMode) {
      throw new Error("Broker installation file changed while provisioning.");
    }
  }

  private isFileError(error: unknown, code: string): boolean {
    return error instanceof Error && "code" in error && error.code === code;
  }
}
