import Darwin
import Foundation

public enum CredentialCompanionOwnershipFailure: Error, Equatable, Sendable {
  case alreadyOwned
  case unavailable
}

/// A cooperative, process-wide ownership gate for one enrolled installation.
/// The installation namespace must come from the trusted enrollment boundary.
public final class CredentialCompanionOwnership: @unchecked Sendable {
  private static let directoryName = "credential-companion"
  private static let lockName = "owner.lock"
  private static let processLock = NSLock()

  public let installationNamespace: UUID
  private let rootPath: String
  private let rootDescriptor: Int32
  private let directoryDescriptor: Int32
  private let lockDescriptor: Int32
  private let installationDirectoryName: String
  private let lock = NSRecursiveLock()

  private init(
    installationNamespace: UUID,
    rootPath: String,
    rootDescriptor: Int32,
    directoryDescriptor: Int32,
    lockDescriptor: Int32,
    installationDirectoryName: String
  ) {
    self.installationNamespace = installationNamespace
    self.rootPath = rootPath
    self.rootDescriptor = rootDescriptor
    self.directoryDescriptor = directoryDescriptor
    self.lockDescriptor = lockDescriptor
    self.installationDirectoryName = installationDirectoryName
  }

  /// Acquires the lock below the companion's fixed per-user Application Support root.
  /// The namespace must come from trusted local enrollment; this lock is not authentication.
  public static func acquire(
    installationNamespace: UUID
  ) throws -> CredentialCompanionOwnership {
    guard
      let supportURL = FileManager.default.urls(
        for: .applicationSupportDirectory, in: .userDomainMask
      ).first
    else {
      throw CredentialCompanionOwnershipFailure.unavailable
    }
    let supportDescriptor = open(supportURL.path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
    guard supportDescriptor >= 0 else { throw CredentialCompanionOwnershipFailure.unavailable }
    do {
      try validateParentDirectory(supportDescriptor)
    } catch {
      close(supportDescriptor)
      throw error
    }
    let rootName = "NullTraceCredentialCompanion"
    if mkdirat(supportDescriptor, rootName, mode_t(S_IRWXU)) != 0 && errno != EEXIST {
      close(supportDescriptor)
      throw CredentialCompanionOwnershipFailure.unavailable
    }
    let rootDescriptor = openat(
      supportDescriptor, rootName, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
    close(supportDescriptor)
    guard rootDescriptor >= 0 else { throw CredentialCompanionOwnershipFailure.unavailable }
    do {
      if fchmod(rootDescriptor, mode_t(S_IRWXU)) != 0 {
        throw CredentialCompanionOwnershipFailure.unavailable
      }
      try validateDirectory(rootDescriptor)
    } catch {
      close(rootDescriptor)
      throw error
    }
    var buffer = [CChar](repeating: 0, count: Int(PATH_MAX))
    let rootPath = FileManager.default
      .urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
      .appendingPathComponent(rootName, isDirectory: true).path
      .withCString {
        realpath($0, &buffer).map { _ in
          String(decoding: buffer.prefix { $0 != 0 }.map { UInt8(bitPattern: $0) }, as: UTF8.self)
        }
      }
    guard let rootPath else {
      close(rootDescriptor)
      throw CredentialCompanionOwnershipFailure.unavailable
    }
    return try acquire(
      installationNamespace: installationNamespace, rootPath: rootPath,
      rootDescriptor: rootDescriptor)
  }

  /// Test-only root injection; production callers use the fixed Application Support root.
  static func acquire(
    installationNamespace: UUID,
    privateRootURL: URL
  ) throws -> CredentialCompanionOwnership {
    guard privateRootURL.isFileURL, privateRootURL.path.hasPrefix("/") else {
      throw CredentialCompanionOwnershipFailure.unavailable
    }
    let rootPath = privateRootURL.standardizedFileURL.path
    let rootDescriptor = open(rootPath, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
    guard rootDescriptor >= 0 else { throw CredentialCompanionOwnershipFailure.unavailable }
    return try acquire(
      installationNamespace: installationNamespace, rootPath: rootPath,
      rootDescriptor: rootDescriptor)
  }

  private static func acquire(
    installationNamespace: UUID,
    rootPath: String,
    rootDescriptor: Int32
  ) throws -> CredentialCompanionOwnership {

    processLock.lock()
    defer { processLock.unlock() }

    do {
      try validateDirectory(rootDescriptor)
    } catch {
      close(rootDescriptor)
      throw error
    }

    let installationDirectory = "\(directoryName)-\(installationNamespace.uuidString.lowercased())"
    if mkdirat(rootDescriptor, installationDirectory, mode_t(S_IRWXU)) != 0 && errno != EEXIST {
      close(rootDescriptor)
      throw CredentialCompanionOwnershipFailure.unavailable
    }
    let directoryDescriptor = openat(
      rootDescriptor,
      installationDirectory,
      O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC
    )
    guard directoryDescriptor >= 0 else {
      close(rootDescriptor)
      throw CredentialCompanionOwnershipFailure.unavailable
    }
    do {
      if fchmod(directoryDescriptor, mode_t(S_IRWXU)) != 0 {
        throw CredentialCompanionOwnershipFailure.unavailable
      }
      try validateDirectory(directoryDescriptor)
    } catch {
      close(directoryDescriptor)
      close(rootDescriptor)
      throw error
    }

    let lockDescriptor = openat(
      directoryDescriptor,
      lockName,
      O_RDWR | O_CREAT | O_NOFOLLOW | O_CLOEXEC,
      mode_t(S_IRUSR | S_IWUSR)
    )
    guard lockDescriptor >= 0 else {
      close(directoryDescriptor)
      close(rootDescriptor)
      throw CredentialCompanionOwnershipFailure.unavailable
    }
    do {
      try validateLockFile(lockDescriptor, directoryDescriptor: directoryDescriptor)
      guard flock(lockDescriptor, LOCK_EX | LOCK_NB) == 0 else {
        if errno == EWOULDBLOCK || errno == EAGAIN {
          throw CredentialCompanionOwnershipFailure.alreadyOwned
        }
        throw CredentialCompanionOwnershipFailure.unavailable
      }
      try validateLockFile(lockDescriptor, directoryDescriptor: directoryDescriptor)
    } catch {
      _ = flock(lockDescriptor, LOCK_UN)
      close(lockDescriptor)
      close(directoryDescriptor)
      close(rootDescriptor)
      throw error
    }

    let ownership = CredentialCompanionOwnership(
      installationNamespace: installationNamespace,
      rootPath: rootPath,
      rootDescriptor: rootDescriptor,
      directoryDescriptor: directoryDescriptor,
      lockDescriptor: lockDescriptor,
      installationDirectoryName: installationDirectory
    )
    do {
      try ownership.validateLiveOwnership()
    } catch {
      throw error
    }
    return ownership
  }

  /// Serializes read/check/write transactions across all stores using this guard.
  func withExclusiveTransaction<T>(_ operation: () throws -> T) throws -> T {
    lock.lock()
    defer { lock.unlock() }
    try validateLiveOwnership()
    return try operation()
  }

  /// Validates the lock path immediately before each backend operation.
  func withBackendAccess<T>(_ operation: () throws -> T) throws -> T {
    lock.lock()
    defer { lock.unlock() }
    try validateLiveOwnership()
    return try operation()
  }

  public func makeKeychainStore(maximumPayloadBytes: Int = 64 * 1024) throws
    -> CredentialRecordStore
  {
    try validateLiveOwnership()
    return CredentialRecordStore(
      backend: try KeychainCredentialRecordBackend(
        installationNamespace: installationNamespace, ownership: self),
      ownership: self,
      maximumPayloadBytes: maximumPayloadBytes
    )
  }

  private func validateLiveOwnership() throws {
    try Self.validateDirectory(rootDescriptor)
    try Self.validateDirectory(directoryDescriptor)
    var namedRoot = stat()
    guard rootPath.withCString({ lstat($0, &namedRoot) }) == 0,
      (namedRoot.st_mode & mode_t(S_IFMT)) == mode_t(S_IFDIR)
    else {
      throw CredentialCompanionOwnershipFailure.unavailable
    }
    var openedRoot = stat()
    guard fstat(rootDescriptor, &openedRoot) == 0,
      namedRoot.st_dev == openedRoot.st_dev,
      namedRoot.st_ino == openedRoot.st_ino
    else {
      throw CredentialCompanionOwnershipFailure.unavailable
    }
    var namedDirectory = stat()
    var openedDirectory = stat()
    guard
      fstatat(rootDescriptor, installationDirectoryName, &namedDirectory, AT_SYMLINK_NOFOLLOW) == 0,
      (namedDirectory.st_mode & mode_t(S_IFMT)) == mode_t(S_IFDIR),
      fstat(directoryDescriptor, &openedDirectory) == 0,
      namedDirectory.st_dev == openedDirectory.st_dev,
      namedDirectory.st_ino == openedDirectory.st_ino
    else {
      throw CredentialCompanionOwnershipFailure.unavailable
    }
    try Self.validateLockFile(lockDescriptor, directoryDescriptor: directoryDescriptor)
  }

  private static func validateParentDirectory(_ descriptor: Int32) throws {
    var information = stat()
    guard fstat(descriptor, &information) == 0,
      (information.st_mode & mode_t(S_IFMT)) == mode_t(S_IFDIR),
      information.st_uid == getuid(),
      (information.st_mode & mode_t(S_IWGRP | S_IWOTH)) == 0
    else {
      throw CredentialCompanionOwnershipFailure.unavailable
    }
  }

  private static func validateDirectory(_ descriptor: Int32) throws {
    var information = stat()
    guard fstat(descriptor, &information) == 0,
      (information.st_mode & mode_t(S_IFMT)) == mode_t(S_IFDIR),
      information.st_uid == getuid(),
      (information.st_mode & mode_t(S_IRWXU | S_IRWXG | S_IRWXO)) == mode_t(S_IRWXU)
    else {
      throw CredentialCompanionOwnershipFailure.unavailable
    }
  }

  private static func validateLockFile(
    _ descriptor: Int32,
    directoryDescriptor: Int32
  ) throws {
    var opened = stat()
    var named = stat()
    guard fstat(descriptor, &opened) == 0,
      fstatat(directoryDescriptor, lockName, &named, AT_SYMLINK_NOFOLLOW) == 0,
      (opened.st_mode & mode_t(S_IFMT)) == mode_t(S_IFREG),
      (named.st_mode & mode_t(S_IFMT)) == mode_t(S_IFREG),
      opened.st_dev == named.st_dev,
      opened.st_ino == named.st_ino,
      opened.st_uid == getuid(),
      opened.st_nlink == 1,
      (opened.st_mode & mode_t(S_IRWXU | S_IRWXG | S_IRWXO)) == mode_t(S_IRUSR | S_IWUSR),
      (named.st_mode & mode_t(S_IRWXU | S_IRWXG | S_IRWXO)) == mode_t(S_IRUSR | S_IWUSR)
    else {
      throw CredentialCompanionOwnershipFailure.unavailable
    }
  }

  deinit {
    _ = flock(lockDescriptor, LOCK_UN)
    close(lockDescriptor)
    close(directoryDescriptor)
    close(rootDescriptor)
  }
}
