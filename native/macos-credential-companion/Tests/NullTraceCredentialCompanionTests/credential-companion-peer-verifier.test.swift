import CryptoKit
import Foundation
import XCTest

@testable import NullTraceCredentialCompanion

final class CredentialCompanionPeerVerifierTests: XCTestCase {
  private let leaf = CredentialCompanionPeerVerifierTests.fixture("synthetic-peer-leaf.der")
  private let root = CredentialCompanionPeerVerifierTests.fixture("synthetic-enrollment-root.der")
  private let unrelatedRoot = CredentialCompanionPeerVerifierTests.fixture("synthetic-unrelated-root.der")
  private let serverOnlyLeaf = CredentialCompanionPeerVerifierTests.fixture("synthetic-server-only-leaf.der")
  private let clientOnlyLeaf = CredentialCompanionPeerVerifierTests.fixture("synthetic-client-only-leaf.der")
  private let expiredLeaf = CredentialCompanionPeerVerifierTests.fixture("synthetic-expired-leaf.der")
  private let leafPin = "608ccf7f33f46a8a1531d310b57e3db76a2bbb2b6d9ac6b0c2989d7ad19f2ad2"

  func testVerifiesPinnedServerCertificateThroughEnrollmentCAAndHostnamePolicy() throws {
    let verifier = try makeVerifier(role: .server(expectedHostname: "companion.test"))
    XCTAssertEqual(verifier.verify(certificateChainDER: [leaf]), .verified)
  }

  func testVerifiesClientRoleUsingClientCertificatePolicy() throws {
    let verifier = try makeVerifier(role: .client)
    XCTAssertEqual(verifier.verify(certificateChainDER: [leaf]), .verified)
  }

  func testRejectsWrongServerHostname() throws {
    let verifier = try makeVerifier(role: .server(expectedHostname: "other.test"))
    XCTAssertEqual(verifier.verify(certificateChainDER: [leaf]), .failure(.untrustedPeer))
  }

  func testRejectsWrongPinEvenWhenCertificateChainIsTrusted() throws {
    let verifier = try makeVerifier(pin: String(repeating: "0", count: 64))
    XCTAssertEqual(verifier.verify(certificateChainDER: [leaf]), .failure(.untrustedPeer))
  }

  func testRejectsCertificateChainOutsideEnrollmentAnchors() throws {
    let verifier = try makeVerifier(anchors: [unrelatedRoot])
    XCTAssertEqual(verifier.verify(certificateChainDER: [leaf]), .failure(.untrustedPeer))
  }

  func testEnforcesRoleSpecificExtendedKeyUsage() throws {
    let serverCertificateAsClient = try makeVerifier(role: .client, peerLeaf: serverOnlyLeaf)
    XCTAssertEqual(
      serverCertificateAsClient.verify(certificateChainDER: [serverOnlyLeaf]),
      .failure(.untrustedPeer)
    )

    let clientCertificateAsServer = try makeVerifier(
      role: .server(expectedHostname: "companion.test"), peerLeaf: clientOnlyLeaf)
    XCTAssertEqual(
      clientCertificateAsServer.verify(certificateChainDER: [clientOnlyLeaf]),
      .failure(.untrustedPeer)
    )
  }

  func testRejectsExpiredCertificate() throws {
    let verifier = try makeVerifier(peerLeaf: expiredLeaf)
    XCTAssertEqual(verifier.verify(certificateChainDER: [expiredLeaf]), .failure(.untrustedPeer))
  }

  func testRejectsMissingOversizedAndMalformedCertificateChains() throws {
    let verifier = try makeVerifier()
    XCTAssertEqual(verifier.verify(certificateChainDER: []), .failure(.invalidInput))
    XCTAssertEqual(
      verifier.verify(certificateChainDER: [Data(repeating: 0x41, count: 512 * 1024 + 1)]),
      .failure(.invalidInput)
    )
    XCTAssertEqual(verifier.verify(certificateChainDER: [Data([0x30, 0x00])]), .failure(.invalidCertificate))
  }

  func testPolicyRejectsMalformedPinAnchorAndServerName() {
    XCTAssertNil(
      CredentialCompanionPeerVerificationPolicy(
        expectedLeafSHA256Hex: "not-a-pin",
        role: .client,
        enrollmentAnchorCertificatesDER: [root]
      ))
    XCTAssertNil(
      CredentialCompanionPeerVerificationPolicy(
        expectedLeafSHA256Hex: leafPin,
        role: .client,
        enrollmentAnchorCertificatesDER: [Data([0x30, 0x00])]
      ))
    for hostname in [
      "*.companion.test",
      "https://companion.test",
      "user@companion.test",
      "companion.test:443",
      "127.0.0.1\u{0}evil",
      "::1\u{0}evil",
    ] {
      XCTAssertNil(
        CredentialCompanionPeerVerificationPolicy(
          expectedLeafSHA256Hex: leafPin,
          role: .server(expectedHostname: hostname),
          enrollmentAnchorCertificatesDER: [root]
        ), "Rejected non-host TLS identity \(hostname)")
    }
  }

  private func makeVerifier(
    pin: String? = nil,
    role: CredentialCompanionPeerRole = .server(expectedHostname: "companion.test"),
    anchors: [Data]? = nil,
    peerLeaf: Data? = nil
  ) throws -> CredentialCompanionPeerVerifier {
    let policy = try XCTUnwrap(CredentialCompanionPeerVerificationPolicy(
      expectedLeafSHA256Hex: pin ?? Self.pin(for: peerLeaf ?? leaf),
      role: role,
      enrollmentAnchorCertificatesDER: anchors ?? [root]
    ))
    return CredentialCompanionPeerVerifier(policy: policy)
  }

  private static func pin(for certificateDER: Data) -> String {
    SHA256.hash(data: certificateDER).map { String(format: "%02x", $0) }.joined()
  }

  private static func fixture(_ name: String) -> Data {
    guard let fixtureURL = Bundle.module.url(
      forResource: name, withExtension: nil, subdirectory: "Fixtures")
    else {
      XCTFail("Synthetic certificate fixture \(name) could not be found.")
      return Data()
    }
    do {
      return try Data(contentsOf: fixtureURL)
    } catch {
      XCTFail("Synthetic certificate fixture \(name) could not be read: \(error)")
      return Data()
    }
  }
}
