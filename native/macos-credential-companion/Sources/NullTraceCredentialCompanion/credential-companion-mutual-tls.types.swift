import Foundation

public enum CredentialCompanionMutualTLSFailure: Error, Equatable, Sendable {
  case invalidConfiguration
  case handshakeFailed
  case timedOut
  case cancelled
}
