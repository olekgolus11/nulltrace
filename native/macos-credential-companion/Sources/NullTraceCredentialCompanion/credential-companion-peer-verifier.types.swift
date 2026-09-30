import CryptoKit
import Darwin
import Foundation
import Security

public enum CredentialCompanionPeerRole: Sendable, Equatable {
  case server(expectedHostname: String)
  case client
}

public struct CredentialCompanionPeerVerificationPolicy: Sendable, Equatable {
  public let expectedLeafSHA256Hex: String
  public let role: CredentialCompanionPeerRole
  public let enrollmentAnchorCertificatesDER: [Data]

  public init?(
    expectedLeafSHA256Hex: String,
    role: CredentialCompanionPeerRole,
    enrollmentAnchorCertificatesDER: [Data]
  ) {
    guard expectedLeafSHA256Hex.utf8.count == 64,
      expectedLeafSHA256Hex.utf8.allSatisfy({ (48...57).contains($0) || (97...102).contains($0) }),
      enrollmentAnchorCertificatesDER.count > 0,
      enrollmentAnchorCertificatesDER.count <= 8,
      enrollmentAnchorCertificatesDER.allSatisfy({ !$0.isEmpty && $0.count <= 512 * 1024 }),
      enrollmentAnchorCertificatesDER.reduce(0, { $0 + $1.count }) <= 2 * 1024 * 1024,
      Self.isValidRole(role),
      Self.containsOnlyCertificates(enrollmentAnchorCertificatesDER),
      !Self.pinMatchesAnchor(expectedLeafSHA256Hex, anchors: enrollmentAnchorCertificatesDER)
    else {
      return nil
    }

    self.expectedLeafSHA256Hex = expectedLeafSHA256Hex
    self.role = role
    self.enrollmentAnchorCertificatesDER = enrollmentAnchorCertificatesDER
  }

  private static func isValidRole(_ role: CredentialCompanionPeerRole) -> Bool {
    guard case .server(let hostname) = role else { return true }
    guard !hostname.isEmpty, hostname.utf8.count <= 253,
      hostname.utf8.allSatisfy({ (33...126).contains($0) })
    else {
      return false
    }
    var ipv4 = in_addr()
    var ipv6 = in6_addr()
    if inet_pton(AF_INET, hostname, &ipv4) == 1 || inet_pton(AF_INET6, hostname, &ipv6) == 1 {
      return true
    }
    guard hostname == hostname.lowercased() else { return false }
    let labels = hostname.split(separator: ".", omittingEmptySubsequences: false)
    return labels.allSatisfy { label in
      guard !label.isEmpty, label.utf8.count <= 63,
        let first = label.utf8.first, let last = label.utf8.last,
        Self.isASCIILetterOrDigit(first), Self.isASCIILetterOrDigit(last)
      else {
        return false
      }
      return label.utf8.allSatisfy { Self.isASCIILetterOrDigit($0) || $0 == 45 }
    }
  }

  private static func isASCIILetterOrDigit(_ value: UInt8) -> Bool {
    (48...57).contains(value) || (97...122).contains(value)
  }

  private static func containsOnlyCertificates(_ values: [Data]) -> Bool {
    values.allSatisfy { value in
      guard let certificate = SecCertificateCreateWithData(kCFAllocatorDefault, value as CFData)
      else { return false }
      return SecCertificateCopyData(certificate) as Data? == value
    }
  }

  private static func pinMatchesAnchor(_ pin: String, anchors: [Data]) -> Bool {
    anchors.contains { anchorDER in
      guard let certificate = SecCertificateCreateWithData(kCFAllocatorDefault, anchorDER as CFData),
        let canonicalDER = SecCertificateCopyData(certificate) as Data?
      else {
        return true
      }
      return SHA256.hash(data: canonicalDER).map { String(format: "%02x", $0) }.joined() == pin
    }
  }
}

public enum CredentialCompanionPeerVerificationFailure: Error, Equatable, Sendable {
  case invalidInput
  case invalidCertificate
  case untrustedPeer
}

public enum CredentialCompanionPeerVerificationResult: Equatable, Sendable {
  case verified
  case failure(CredentialCompanionPeerVerificationFailure)
}
