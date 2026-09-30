import Foundation

struct CredentialRecordKey: Hashable, Sendable {
  let kind: CredentialRecordKind
  let id: CredentialRecordID
}

struct CredentialRecordEnvelope: Codable, Sendable {
  let kind: CredentialRecordKind
  let id: UUID
  let generation: UInt64
  let schemaVersion: UInt16
  let isDeleted: Bool
  let payload: Data
}

enum CredentialBackendFailure: Error, Sendable {
  case unavailable
  case denied
  case corrupt
  case other
}

protocol CredentialRecordBackend: Sendable {
  func read(_ key: CredentialRecordKey) throws -> Data?
  func write(_ data: Data, for key: CredentialRecordKey) throws
}
