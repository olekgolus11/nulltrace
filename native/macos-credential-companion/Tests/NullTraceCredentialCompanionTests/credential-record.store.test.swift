import Foundation
import XCTest
@testable import NullTraceCredentialCompanion

final class CredentialRecordStoreTests: XCTestCase {
  func testTargetContextUsesGenerationCompareAndSwap() async throws {
    let backend = MemoryCredentialRecordBackend()
    let store = CredentialRecordStore(backend: backend)
    let id = CredentialRecordID(UUID())
    let payload = Data(#"{"origin":"https://example.test","cookies":[{"name":"sid","value":"synthetic"}]}"#.utf8)

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
      .value(StoredCredential(id: id, kind: .targetContext, generation: 1, schemaVersion: 1, payload: payload))
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

  func testDeleteLeavesTombstoneAndRejectsStaleResurrection() async {
    let backend = MemoryCredentialRecordBackend()
    let store = CredentialRecordStore(backend: backend)
    let id = CredentialRecordID(UUID())
    let payload = Data(#"{"origin":"https://example.test","headers":{"Authorization":"synthetic"}}"#.utf8)

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

  func testRejectsUnknownFieldsAndOversizedPayloadWithoutWriting() async {
    let backend = MemoryCredentialRecordBackend()
    let store = CredentialRecordStore(backend: backend, maximumPayloadBytes: 64)
    let id = CredentialRecordID(UUID())

    let unknownField = await store.save(
      kind: .targetContext,
      id: id,
      expectedGeneration: 0,
      schemaVersion: 1,
      payload: Data(#"{"origin":"https://example.test","cookies":[],"service":"caller-controlled"}"#.utf8)
    )
    XCTAssertEqual(unknownField, .failure(.invalidRequest))

    let oversized = await store.save(
      kind: .targetContext,
      id: id,
      expectedGeneration: 0,
      schemaVersion: 1,
      payload: Data((#"{"origin":"https://example.test","headers":"""# + String(repeating: "x", count: 100) + #"""}"#).utf8)
    )
    XCTAssertEqual(oversized, .failure(.invalidRequest))
    let afterRejectedSaves = await store.load(kind: .targetContext, id: id)
    XCTAssertEqual(afterRejectedSaves, .failure(.notFound))
  }

  func testRejectsNonNormalizedOriginAndUnsupportedRecordKinds() async {
    let backend = MemoryCredentialRecordBackend()
    let store = CredentialRecordStore(backend: backend)
    let id = CredentialRecordID(UUID())

    let nonNormalizedOrigin = await store.save(
      kind: .targetContext,
      id: id,
      expectedGeneration: 0,
      schemaVersion: 1,
      payload: Data(#"{"origin":"https://Example.test","headers":{"Authorization":"synthetic"}}"#.utf8)
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

  func testRejectsWrongTypesAndHeaderInjectionInNestedFields() async {
    let backend = MemoryCredentialRecordBackend()
    let store = CredentialRecordStore(backend: backend)
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

  func testAcceptsCanonicalIPv6OriginAndDoesNotApplyLoopbackNetworkPolicy() async {
    let store = CredentialRecordStore(backend: MemoryCredentialRecordBackend())
    let id = CredentialRecordID(UUID())
    let ipv6 = Data(#"{"origin":"https://[2001:db8::1]:8443","headers":{"Authorization":"v"}}"#.utf8)
    let loopback = Data(#"{"origin":"http://localhost","browserStorage":{"localStorage":{"token":"synthetic"}}}"#.utf8)

    let ipv6Result = await store.save(kind: .targetContext, id: id, expectedGeneration: 0, schemaVersion: 1, payload: ipv6)
    XCTAssertEqual(ipv6Result, .saved(generation: 1))
    let loopbackResult = await store.save(kind: .targetContext, id: CredentialRecordID(UUID()), expectedGeneration: 0, schemaVersion: 1, payload: loopback)
    XCTAssertEqual(loopbackResult, .saved(generation: 1))
  }

  func testRejectsOversizedEncodedRecordAndMalformedTombstone() async throws {
    let backend = MemoryCredentialRecordBackend()
    let store = CredentialRecordStore(backend: backend, maximumPayloadBytes: 64)
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
    try backend.setRaw(try JSONEncoder().encode(malformedTombstone), kind: .targetContext, id: tombstoneID)
    let tombstoneLoad = await store.load(kind: .targetContext, id: tombstoneID)
    XCTAssertEqual(tombstoneLoad, .failure(.corruptRecord))
    let tombstoneDelete = await store.delete(kind: .targetContext, id: tombstoneID, expectedGeneration: 4)
    XCTAssertEqual(tombstoneDelete, .failure(.corruptRecord))
  }

  func testDeleteFailureDoesNotConfirmAndReopenedStoreKeepsGeneration() async throws {
    let backend = MemoryCredentialRecordBackend()
    let firstStore = CredentialRecordStore(backend: backend)
    let id = CredentialRecordID(UUID())
    let payload = Data(#"{"origin":"https://example.test","headers":{"Authorization":"synthetic"}}"#.utf8)
    let saved = await firstStore.save(kind: .targetContext, id: id, expectedGeneration: 0, schemaVersion: 1, payload: payload)
    XCTAssertEqual(saved, .saved(generation: 1))

    backend.failWrites()
    let deleteResult = await firstStore.delete(kind: .targetContext, id: id, expectedGeneration: 1)
    XCTAssertEqual(deleteResult, .failure(.backendFailure))
    let afterFailedDelete = await firstStore.load(kind: .targetContext, id: id)
    XCTAssertEqual(afterFailedDelete, .value(StoredCredential(id: id, kind: .targetContext, generation: 1, schemaVersion: 1, payload: payload)))

    backend.allowWrites()
    let reopenedStore = CredentialRecordStore(backend: backend)
    let reopened = await reopenedStore.load(kind: .targetContext, id: id)
    XCTAssertEqual(reopened, .value(StoredCredential(id: id, kind: .targetContext, generation: 1, schemaVersion: 1, payload: payload)))
    let secondSave = await reopenedStore.save(kind: .targetContext, id: id, expectedGeneration: 1, schemaVersion: 1, payload: payload)
    XCTAssertEqual(secondSave, .saved(generation: 2))
  }

  func testGenerationMaximumFailsClosedWithoutOverflow() async throws {
    let backend = MemoryCredentialRecordBackend()
    let store = CredentialRecordStore(backend: backend)
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

    let overflowSave = await store.save(kind: .targetContext, id: id, expectedGeneration: UInt64.max, schemaVersion: 1, payload: payload)
    XCTAssertEqual(overflowSave, .failure(.invalidRequest))
    let overflowDelete = await store.delete(kind: .targetContext, id: id, expectedGeneration: UInt64.max)
    XCTAssertEqual(overflowDelete, .failure(.invalidRequest))
    let stillAtMaximum = await store.load(kind: .targetContext, id: id)
    XCTAssertEqual(stillAtMaximum, .value(StoredCredential(id: id, kind: .targetContext, generation: UInt64.max, schemaVersion: 1, payload: payload)))
  }
}

private final class MemoryCredentialRecordBackend: CredentialRecordBackend, @unchecked Sendable {
  private let lock = NSLock()
  private var records: [CredentialRecordKey: Data] = [:]
  private var shouldFailWrites = false

  func read(_ key: CredentialRecordKey) throws -> Data? {
    lock.lock()
    defer { lock.unlock() }
    return records[key]
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
