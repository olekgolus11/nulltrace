import Foundation

public enum CredentialRecordKind: String, Codable, Sendable {
  case targetContext = "target-context"
  case providerLogin = "provider-login"
  case rawEvidenceKey = "raw-evidence-key"
}

public struct CredentialRecordID: Hashable, Codable, Sendable {
  public let value: UUID

  public init(_ value: UUID) {
    self.value = value
  }
}

public enum CredentialStoreFailure: Equatable, Sendable {
  case invalidRequest
  case conflict(currentGeneration: UInt64)
  case notFound
  case unavailable
  case denied
  case corruptRecord
  case backendFailure
}

public struct StoredCredential: Equatable, Sendable {
  public let id: CredentialRecordID
  public let kind: CredentialRecordKind
  public let generation: UInt64
  public let schemaVersion: UInt16
  public let payload: Data
}

public enum CredentialReadResult: Equatable, Sendable {
  case value(StoredCredential)
  case failure(CredentialStoreFailure)
}

public enum CredentialWriteResult: Equatable, Sendable {
  case saved(generation: UInt64)
  case deleted(generation: UInt64)
  case failure(CredentialStoreFailure)
}
