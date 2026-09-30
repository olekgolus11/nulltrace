import CryptoKit
import Foundation
import Security

public struct CredentialCompanionPeerVerifier: Sendable {
  private let policy: CredentialCompanionPeerVerificationPolicy

  public init(policy: CredentialCompanionPeerVerificationPolicy) {
    self.policy = policy
  }

  public func verify(
    certificateChainDER: [Data]
  ) -> CredentialCompanionPeerVerificationResult {
    guard certificateChainDER.count > 0,
      certificateChainDER.count <= Self.maximumChainCertificates,
      Self.totalSize(certificateChainDER) <= Self.maximumTotalDERBytes,
      certificateChainDER.allSatisfy({ !$0.isEmpty && $0.count <= Self.maximumCertificateDERBytes })
    else {
      return .failure(.invalidInput)
    }

    let chainResult = Self.makeCertificates(certificateChainDER)
    guard case .success(let certificates) = chainResult else {
      return .failure(.invalidCertificate)
    }

    let sslPolicy: SecPolicy
    switch policy.role {
    case .server(let expectedHostname):
      sslPolicy = SecPolicyCreateSSL(true, expectedHostname as CFString)
    case .client:
      sslPolicy = SecPolicyCreateSSL(false, nil)
    }

    var trust: SecTrust?
    guard SecTrustCreateWithCertificates(certificates as CFArray, sslPolicy, &trust) == errSecSuccess,
      let peerTrust = trust
    else {
      return .failure(.untrustedPeer)
    }

    guard Self.applyEnrollmentAnchors(policy.enrollmentAnchorCertificatesDER, to: peerTrust),
      SecTrustSetKeychains(peerTrust, [] as CFArray) == errSecSuccess,
      SecTrustSetNetworkFetchAllowed(peerTrust, false) == errSecSuccess,
      SecTrustEvaluateWithError(peerTrust, nil)
    else {
      return .failure(.untrustedPeer)
    }

    guard let leaf = certificates.first,
      let canonicalLeafDER = SecCertificateCopyData(leaf) as Data?,
      Data(SHA256.hash(data: canonicalLeafDER)) == Self.decodePin(policy.expectedLeafSHA256Hex)
    else {
      return .failure(.untrustedPeer)
    }

    return .verified
  }
}

private extension CredentialCompanionPeerVerifier {
  static let maximumChainCertificates = 8
  static let maximumCertificateDERBytes = 512 * 1024
  static let maximumTotalDERBytes = 2 * 1024 * 1024

  static func decodePin(_ value: String) -> Data? {
    guard value.utf8.count == 64,
      value.utf8.allSatisfy({ (48...57).contains($0) || (97...102).contains($0) })
    else {
      return nil
    }
    var bytes = Data()
    bytes.reserveCapacity(32)
    var index = value.startIndex
    while index < value.endIndex {
      let next = value.index(index, offsetBy: 2)
      guard let byte = UInt8(value[index..<next], radix: 16) else { return nil }
      bytes.append(byte)
      index = next
    }
    return bytes
  }

  static func totalSize(_ certificates: [Data]) -> Int {
    certificates.reduce(into: 0) { total, certificate in
      let (sum, overflow) = total.addingReportingOverflow(certificate.count)
      total = overflow ? Int.max : sum
    }
  }

  static func makeCertificates(_ data: [Data]) -> Result<[SecCertificate], CredentialCompanionPeerVerificationFailure> {
    var certificates: [SecCertificate] = []
    certificates.reserveCapacity(data.count)
    for der in data {
      guard let certificate = SecCertificateCreateWithData(kCFAllocatorDefault, der as CFData),
        SecCertificateCopyData(certificate) as Data? == der
      else {
        return .failure(.invalidCertificate)
      }
      certificates.append(certificate)
    }
    return .success(certificates)
  }

  static func applyEnrollmentAnchors(_ anchorDER: [Data], to trust: SecTrust) -> Bool {
    guard case .success(let anchors) = makeCertificates(anchorDER),
      SecTrustSetAnchorCertificates(trust, anchors as CFArray) == errSecSuccess,
      SecTrustSetAnchorCertificatesOnly(trust, true) == errSecSuccess
    else {
      return false
    }
    return true
  }
}
