import Darwin
import Foundation
import XCTest

@testable import NullTraceCredentialCompanion

final class CredentialRecordStoreTests: XCTestCase {
  private var privateRoots: [URL] = []

  override func tearDownWithError() throws {
    for root in privateRoots {
      try? FileManager.default.removeItem(at: root)
    }
    privateRoots.removeAll()
    try super.tearDownWithError()
  }

  private func makeOwnership(_ installationNamespace: UUID = UUID()) throws
    -> CredentialCompanionOwnership
  {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent(
      UUID().uuidString, isDirectory: true)
    try FileManager.default.createDirectory(
      at: root, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
    privateRoots.append(root)
    return try CredentialCompanionOwnership.acquire(
      installationNamespace: installationNamespace, privateRootURL: root)
  }

  func testTargetContextUsesGenerationCompareAndSwap() async throws {
    let backend = MemoryCredentialRecordBackend()
    let store = CredentialRecordStore(backend: backend, ownership: try makeOwnership())
    let id = CredentialRecordID(UUID())
    let payload = Data(
      #"{"origin":"https://example.test","cookies":[{"name":"sid","value":"synthetic"}]}"#.utf8)

    let first = await store.save(
      kind: .targetContext,
      id: id,
      expectedGeneration: 0,
      schemaVersion: 1,
      payload: payload
    )
    XCTAssertEqual(first, .saved(generation: 1))

    let loaded = await store.load(kind: .targetContext, id: id)
    XCTAssertEqual(
      loaded,
      .value(
        StoredCredential(
          id: id, kind: .targetContext, generation: 1, schemaVersion: 1, payload: payload))
    )

    let staleWrite = await store.save(
      kind: .targetContext,
      id: id,
      expectedGeneration: 0,
      schemaVersion: 1,
      payload: payload
    )
    XCTAssertEqual(staleWrite, .failure(.conflict(currentGeneration: 1)))
  }

  func testDeleteLeavesTombstoneAndRejectsStaleResurrection() async throws {
    let backend = MemoryCredentialRecordBackend()
    let store = CredentialRecordStore(backend: backend, ownership: try makeOwnership())
    let id = CredentialRecordID(UUID())
    let payload = Data(
      #"{"origin":"https://example.test","headers":{"Authorization":"synthetic"}}"#.utf8)

    let saved = await store.save(
      kind: .targetContext,
      id: id,
      expectedGeneration: 0,
      schemaVersion: 1,
      payload: payload
    )
    XCTAssertEqual(saved, .saved(generation: 1))
    let deleted = await store.delete(kind: .targetContext, id: id, expectedGeneration: 1)
    XCTAssertEqual(deleted, .deleted(generation: 2))
    let afterDelete = await store.load(kind: .targetContext, id: id)
    XCTAssertEqual(afterDelete, .failure(.notFound))

    let staleSave = await store.save(
      kind: .targetContext,
      id: id,
      expectedGeneration: 1,
      schemaVersion: 1,
      payload: payload
    )
    XCTAssertEqual(staleSave, .failure(.conflict(currentGeneration: 2)))
  }

  func testRejectsUnknownFieldsAndOversizedPayloadWithoutWriting() async throws {
    let backend = MemoryCredentialRecordBackend()
    let store = CredentialRecordStore(
      backend: backend, ownership: try makeOwnership(), maximumPayloadBytes: 64)
    let id = CredentialRecordID(UUID())

    let unknownField = await store.save(
      kind: .targetContext,
      id: id,
      expectedGeneration: 0,
      schemaVersion: 1,
      payload: Data(
        #"{"origin":"https://example.test","cookies":[],"service":"caller-controlled"}"#.utf8)
    )
    XCTAssertEqual(unknownField, .failure(.invalidRequest))

    let oversized = await store.save(
      kind: .targetContext,
      id: id,
      expectedGeneration: 0,
      schemaVersion: 1,
      payload: Data(
        (#"{"origin":"https://example.test","headers":"""# + String(repeating: "x", count: 100)
          + #"""}"#).utf8)
    )
    XCTAssertEqual(oversized, .failure(.invalidRequest))
    let afterRejectedSaves = await store.load(kind: .targetContext, id: id)
    XCTAssertEqual(afterRejectedSaves, .failure(.notFound))
  }

  func testRejectsNonNormalizedOriginAndUnsupportedRecordKinds() async throws {
    let backend = MemoryCredentialRecordBackend()
    let store = CredentialRecordStore(backend: backend, ownership: try makeOwnership())
    let id = CredentialRecordID(UUID())

    let nonNormalizedOrigin = await store.save(
      kind: .targetContext,
      id: id,
      expectedGeneration: 0,
      schemaVersion: 1,
      payload: Data(
        #"{"origin":"https://Example.test","headers":{"Authorization":"synthetic"}}"#.utf8)
    )
    XCTAssertEqual(nonNormalizedOrigin, .failure(.invalidRequest))

    let reservedKind = await store.save(
      kind: .providerLogin,
      id: id,
      expectedGeneration: 0,
      schemaVersion: 1,
      payload: Data(#"{"provider":"synthetic","credentials":{}}"#.utf8)
    )
    XCTAssertEqual(reservedKind, .failure(.invalidRequest))
  }

  func testRejectsWrongTypesAndHeaderInjectionInNestedFields() async throws {
    let backend = MemoryCredentialRecordBackend()
    let store = CredentialRecordStore(backend: backend, ownership: try makeOwnership())
    let invalidPayloads = [
      #"{"origin":"https://example.test","cookies":[{"name":"sid","value":"v","domain":123}]}"#,
      #"{"origin":"https://example.test","cookies":[{"name":"sid","value":"v","path":false}]}"#,
      #"{"origin":"https://example.test","cookies":[{"name":"sid","value":"v","sameSite":[]}]}"#,
      #"{"origin":"https://example.test","cookies":[{"name":"sid","value":"v","httpOnly":1}]}"#,
      #"{"origin":"https://example.test","cookies":[{"name":"sid","value":"v","secure":"true"}]}"#,
      #"{"origin":"https://example.test","cookies":[{"name":"sid","value":"v","expires":true}]}"#,
      #"{"origin":"https://example.test","cookies":[{"name":"sid; Secure","value":"v"}]}"#,
      #"{"origin":"https://example.test","headers":{"Bad Name":"v"}}"#,
      #"{"origin":"https://example.test","headers":{"Authorization":"safe\r\nX-Injected: yes"}}"#,
      #"{"origin":"https://example.test:65536","headers":{"Authorization":"v"}}"#,
      #"{"origin":"https://example.test:0","headers":{"Authorization":"v"}}"#,
    ]

    for rawPayload in invalidPayloads {
      let result = await store.save(
        kind: .targetContext,
        id: CredentialRecordID(UUID()),
        expectedGeneration: 0,
        schemaVersion: 1,
        payload: Data(rawPayload.utf8)
      )
      XCTAssertEqual(result, .failure(.invalidRequest), "Rejected malformed synthetic payload")
    }
  }

  func testAcceptsCanonicalIPv6OriginAndDoesNotApplyLoopbackNetworkPolicy() async throws {
    let store = CredentialRecordStore(
      backend: MemoryCredentialRecordBackend(), ownership: try makeOwnership())
    let id = CredentialRecordID(UUID())
    let ipv6 = Data(
      #"{"origin":"https://[2001:db8::1]:8443","headers":{"Authorization":"v"}}"#.utf8)
    let loopback = Data(
      #"{"origin":"http://localhost","browserStorage":{"localStorage":{"token":"synthetic"}}}"#.utf8
    )

    let ipv6Result = await store.save(
      kind: .targetContext, id: id, expectedGeneration: 0, schemaVersion: 1, payload: ipv6)
    XCTAssertEqual(ipv6Result, .saved(generation: 1))
    let loopbackResult = await store.save(
      kind: .targetContext, id: CredentialRecordID(UUID()), expectedGeneration: 0, schemaVersion: 1,
      payload: loopback)
    XCTAssertEqual(loopbackResult, .saved(generation: 1))
  }

  func testRejectsOversizedEncodedRecordAndMalformedTombstone() async throws {
    let backend = MemoryCredentialRecordBackend()
    let store = CredentialRecordStore(
      backend: backend, ownership: try makeOwnership(), maximumPayloadBytes: 64)
    let oversizedID = CredentialRecordID(UUID())
    try backend.setRaw(Data(repeating: 0x41, count: 9_000), kind: .targetContext, id: oversizedID)
    let oversizedResult = await store.load(kind: .targetContext, id: oversizedID)
    XCTAssertEqual(oversizedResult, .failure(.corruptRecord))

    let tombstoneID = CredentialRecordID(UUID())
    let malformedTombstone = CredentialRecordEnvelope(
      kind: .targetContext,
      id: tombstoneID.value,
      generation: 4,
      schemaVersion: 1,
      isDeleted: true,
      payload: Data("unexpected".utf8)
    )
    try backend.setRaw(
      try JSONEncoder().encode(malformedTombstone), kind: .targetContext, id: tombstoneID)
    let tombstoneLoad = await store.load(kind: .targetContext, id: tombstoneID)
    XCTAssertEqual(tombstoneLoad, .failure(.corruptRecord))
    let tombstoneDelete = await store.delete(
      kind: .targetContext, id: tombstoneID, expectedGeneration: 4)
    XCTAssertEqual(tombstoneDelete, .failure(.corruptRecord))
  }

  func testDeleteFailureDoesNotConfirmAndReopenedStoreKeepsGeneration() async throws {
    let backend = MemoryCredentialRecordBackend()
    let ownership = try makeOwnership()
    let firstStore = CredentialRecordStore(backend: backend, ownership: ownership)
    let id = CredentialRecordID(UUID())
    let payload = Data(
      #"{"origin":"https://example.test","headers":{"Authorization":"synthetic"}}"#.utf8)
    let saved = await firstStore.save(
      kind: .targetContext, id: id, expectedGeneration: 0, schemaVersion: 1, payload: payload)
    XCTAssertEqual(saved, .saved(generation: 1))

    backend.failWrites()
    let deleteResult = await firstStore.delete(kind: .targetContext, id: id, expectedGeneration: 1)
    XCTAssertEqual(deleteResult, .failure(.backendFailure))
    let afterFailedDelete = await firstStore.load(kind: .targetContext, id: id)
    XCTAssertEqual(
      afterFailedDelete,
      .value(
        StoredCredential(
          id: id, kind: .targetContext, generation: 1, schemaVersion: 1, payload: payload)))

    backend.allowWrites()
    let reopenedStore = CredentialRecordStore(backend: backend, ownership: ownership)
    let reopened = await reopenedStore.load(kind: .targetContext, id: id)
    XCTAssertEqual(
      reopened,
      .value(
        StoredCredential(
          id: id, kind: .targetContext, generation: 1, schemaVersion: 1, payload: payload)))
    let secondSave = await reopenedStore.save(
      kind: .targetContext, id: id, expectedGeneration: 1, schemaVersion: 1, payload: payload)
    XCTAssertEqual(secondSave, .saved(generation: 2))
  }

  func testGenerationMaximumFailsClosedWithoutOverflow() async throws {
    let backend = MemoryCredentialRecordBackend()
    let store = CredentialRecordStore(backend: backend, ownership: try makeOwnership())
    let id = CredentialRecordID(UUID())
    let payload = Data(#"{"origin":"https://example.test","headers":{"Authorization":"v"}}"#.utf8)
    let maxGenerationRecord = CredentialRecordEnvelope(
      kind: .targetContext,
      id: id.value,
      generation: UInt64.max,
      schemaVersion: 1,
      isDeleted: false,
      payload: payload
    )
    try backend.setRaw(try JSONEncoder().encode(maxGenerationRecord), kind: .targetContext, id: id)

    let overflowSave = await store.save(
      kind: .targetContext, id: id, expectedGeneration: UInt64.max, schemaVersion: 1,
      payload: payload)
    XCTAssertEqual(overflowSave, .failure(.invalidRequest))
    let overflowDelete = await store.delete(
      kind: .targetContext, id: id, expectedGeneration: UInt64.max)
    XCTAssertEqual(overflowDelete, .failure(.invalidRequest))
    let stillAtMaximum = await store.load(kind: .targetContext, id: id)
    XCTAssertEqual(
      stillAtMaximum,
      .value(
        StoredCredential(
          id: id, kind: .targetContext, generation: UInt64.max, schemaVersion: 1, payload: payload))
    )
  }

  func testStoreInstancesSharingOwnershipSerializeCompareAndSwap() async throws {
    let backend = MemoryCredentialRecordBackend(readDelayMicroseconds: 100_000)
    let ownership = try makeOwnership()
    let firstStore = CredentialRecordStore(backend: backend, ownership: ownership)
    let secondStore = CredentialRecordStore(backend: backend, ownership: ownership)
    let id = CredentialRecordID(UUID())
    let payload = Data(
      #"{"origin":"https://example.test","headers":{"Authorization":"synthetic"}}"#.utf8)

    async let first = firstStore.save(
      kind: .targetContext, id: id, expectedGeneration: 0, schemaVersion: 1, payload: payload)
    async let second = secondStore.save(
      kind: .targetContext, id: id, expectedGeneration: 0, schemaVersion: 1, payload: payload)
    let results = await [first, second]

    XCTAssertEqual(results.filter { $0 == .saved(generation: 1) }.count, 1)
    XCTAssertEqual(results.filter { $0 == .failure(.conflict(currentGeneration: 1)) }.count, 1)
  }

  func testSecondProcessCannotOwnInstallationLockAndProcessDeathReleasesIt() throws {
    let namespace = UUID()
    let root = try makePrivateRoot()
    let holderProcess = try startLockProbe(mode: "hold", namespace: namespace, root: root)
    try waitForProbeReady(holderProcess)
    let competingProcess = try startLockProbe(mode: "acquire", namespace: namespace, root: root)
    try waitForProcessExit(competingProcess)
    XCTAssertEqual(competingProcess.terminationStatus, 73)

    XCTAssertEqual(kill(holderProcess.processIdentifier, SIGKILL), 0)
    try waitForProcessExit(holderProcess)
    XCTAssertEqual(holderProcess.terminationReason, .uncaughtSignal)

    let afterDeath = try CredentialCompanionOwnership.acquire(
      installationNamespace: namespace, privateRootURL: root)
    XCTAssertEqual(afterDeath.installationNamespace, namespace)
  }

  func testDifferentInstallationsHaveIndependentLocks() throws {
    let root = try makePrivateRoot()
    let first = try CredentialCompanionOwnership.acquire(
      installationNamespace: UUID(), privateRootURL: root)
    let second = try CredentialCompanionOwnership.acquire(
      installationNamespace: UUID(), privateRootURL: root)
    XCTAssertNotEqual(first.installationNamespace, second.installationNamespace)
  }

  func testReplacingLockPathFailsClosedBeforeSyntheticBackendAccess() async throws {
    let namespace = UUID()
    let root = try makePrivateRoot()
    let ownership = try CredentialCompanionOwnership.acquire(
      installationNamespace: namespace, privateRootURL: root)
    let backend = MemoryCredentialRecordBackend()
    let store = CredentialRecordStore(backend: backend, ownership: ownership)
    let lockPath =
      root
      .appendingPathComponent(
        "credential-companion-\(namespace.uuidString.lowercased())", isDirectory: true
      )
      .appendingPathComponent("owner.lock")

    try FileManager.default.removeItem(at: lockPath)
    let replacement = open(
      lockPath.path, O_CREAT | O_EXCL | O_RDWR | O_CLOEXEC, mode_t(S_IRUSR | S_IWUSR))
    XCTAssertGreaterThanOrEqual(replacement, 0)
    if replacement >= 0 { close(replacement) }

    let result = await store.load(kind: .targetContext, id: CredentialRecordID(UUID()))
    XCTAssertEqual(result, .failure(.unavailable))
    XCTAssertEqual(backend.readCount, 0)
  }

  func testReplacingInstallationDirectoryOrRootFailsClosed() async throws {
    for replacingRoot in [false, true] {
      let namespace = UUID()
      let root = try makePrivateRoot()
      let ownership = try CredentialCompanionOwnership.acquire(
        installationNamespace: namespace, privateRootURL: root)
      let backend = MemoryCredentialRecordBackend()
      let store = CredentialRecordStore(backend: backend, ownership: ownership)
      let installPath = root.appendingPathComponent(
        "credential-companion-\(namespace.uuidString.lowercased())", isDirectory: true)
      let originalPath = replacingRoot ? root : installPath
      let displacedPath = originalPath.deletingLastPathComponent().appendingPathComponent(
        "displaced-\(UUID().uuidString)", isDirectory: true)

      try FileManager.default.moveItem(at: originalPath, to: displacedPath)
      try FileManager.default.createDirectory(
        at: originalPath, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700]
      )
      privateRoots.append(displacedPath)

      let result = await store.load(kind: .targetContext, id: CredentialRecordID(UUID()))
      XCTAssertEqual(result, .failure(.unavailable))
      XCTAssertEqual(backend.readCount, 0)
    }
  }

  func testLockAcquisitionRejectsSymlinkAndHardLinkedLockFiles() throws {
    let namespace = UUID()
    let root = try makePrivateRoot()
    let directory = root.appendingPathComponent(
      "credential-companion-\(namespace.uuidString.lowercased())", isDirectory: true)
    try FileManager.default.createDirectory(
      at: directory, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
    let target = root.appendingPathComponent("untrusted-lock-target")
    let targetDescriptor = open(
      target.path, O_CREAT | O_EXCL | O_RDWR | O_CLOEXEC, mode_t(S_IRUSR | S_IWUSR))
    XCTAssertGreaterThanOrEqual(targetDescriptor, 0)
    if targetDescriptor >= 0 { close(targetDescriptor) }
    try FileManager.default.createSymbolicLink(
      at: directory.appendingPathComponent("owner.lock"), withDestinationURL: target)
    XCTAssertThrowsError(
      try CredentialCompanionOwnership.acquire(
        installationNamespace: namespace, privateRootURL: root))

    try FileManager.default.removeItem(at: directory.appendingPathComponent("owner.lock"))
    try FileManager.default.linkItem(at: target, to: directory.appendingPathComponent("owner.lock"))
    XCTAssertThrowsError(
      try CredentialCompanionOwnership.acquire(
        installationNamespace: namespace, privateRootURL: root))
  }

  private func makePrivateRoot() throws -> URL {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent(
      UUID().uuidString, isDirectory: true)
    try FileManager.default.createDirectory(
      at: root, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
    privateRoots.append(root)
    return root
  }

  private func startLockProbe(mode: String, namespace: UUID, root: URL) throws -> Process {
    let testProductsDirectory = Bundle(for: Self.self).bundleURL.deletingLastPathComponent()
    let executable = testProductsDirectory.appendingPathComponent("CredentialLockProbe")
    guard FileManager.default.isExecutableFile(atPath: executable.path) else {
      XCTFail("The synthetic credential lock probe executable was not built.")
      throw CredentialCompanionOwnershipFailure.unavailable
    }
    let process = Process()
    process.executableURL = executable
    process.arguments = [mode, namespace.uuidString, root.path]
    process.standardOutput = Pipe()
    process.standardError = Pipe()
    process.standardInput = Pipe()
    try process.run()
    return process
  }

  private func waitForProbeReady(_ process: Process) throws {
    guard let output = process.standardOutput as? Pipe else {
      throw CredentialCompanionOwnershipFailure.unavailable
    }
    var descriptor = pollfd(
      fd: output.fileHandleForReading.fileDescriptor, events: Int16(POLLIN), revents: 0)
    guard poll(&descriptor, 1, 5_000) == 1 else {
      process.terminate()
      process.waitUntilExit()
      throw CredentialCompanionOwnershipFailure.unavailable
    }
    let line = output.fileHandleForReading.availableData
    guard String(data: line, encoding: .utf8)?.contains("held") == true else {
      process.terminate()
      process.waitUntilExit()
      throw CredentialCompanionOwnershipFailure.unavailable
    }
  }

  private func waitForProcessExit(_ process: Process) throws {
    let deadline = Date().addingTimeInterval(5)
    while process.isRunning && Date() < deadline {
      usleep(10_000)
    }
    guard !process.isRunning else {
      process.terminate()
      let terminationDeadline = Date().addingTimeInterval(1)
      while process.isRunning && Date() < terminationDeadline { usleep(10_000) }
      if process.isRunning {
        _ = kill(process.processIdentifier, SIGKILL)
        let killDeadline = Date().addingTimeInterval(1)
        while process.isRunning && Date() < killDeadline { usleep(10_000) }
      }
      throw CredentialCompanionOwnershipFailure.unavailable
    }
    process.waitUntilExit()
  }
}

private final class MemoryCredentialRecordBackend: CredentialRecordBackend, @unchecked Sendable {
  private let lock = NSLock()
  private let readDelayMicroseconds: useconds_t
  private var records: [CredentialRecordKey: Data] = [:]
  private var shouldFailWrites = false
  private(set) var readCount = 0

  init(readDelayMicroseconds: useconds_t = 0) {
    self.readDelayMicroseconds = readDelayMicroseconds
  }

  func read(_ key: CredentialRecordKey) throws -> Data? {
    lock.lock()
    readCount += 1
    let data = records[key]
    lock.unlock()
    if readDelayMicroseconds > 0 {
      usleep(readDelayMicroseconds)
    }
    return data
  }

  func write(_ data: Data, for key: CredentialRecordKey) throws {
    lock.lock()
    defer { lock.unlock() }
    if shouldFailWrites {
      throw CredentialBackendFailure.other
    }
    records[key] = data
  }

  func setRaw(_ data: Data, kind: CredentialRecordKind, id: CredentialRecordID) throws {
    lock.lock()
    defer { lock.unlock() }
    records[CredentialRecordKey(kind: kind, id: id)] = data
  }

  func failWrites() {
    lock.lock()
    defer { lock.unlock() }
    shouldFailWrites = true
  }

  func allowWrites() {
    lock.lock()
    defer { lock.unlock() }
    shouldFailWrites = false
  }
}
