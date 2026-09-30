import CryptoKit
import Darwin
import Foundation
import Security

@testable import NullTraceCredentialCompanion

final class SyntheticMutualTLSFixture {
  let serverIdentity: SecIdentity
  let serverChainDER: [Data]
  let clientIdentity: SecIdentity
  let clientChainDER: [Data]
  let unrelatedClientIdentity: SecIdentity
  let unrelatedClientChainDER: [Data]
  let serverPolicy: CredentialCompanionPeerVerificationPolicy
  let clientPolicy: CredentialCompanionPeerVerificationPolicy
  let unrelatedClientPolicy: CredentialCompanionPeerVerificationPolicy

  private let cleanupLock = NSLock()
  private var temporaryDirectoryURL: URL?

  private init(
    temporaryDirectoryURL: URL,
    serverIdentity: SecIdentity,
    serverChainDER: [Data],
    clientIdentity: SecIdentity,
    clientChainDER: [Data],
    unrelatedClientIdentity: SecIdentity,
    unrelatedClientChainDER: [Data],
    serverPolicy: CredentialCompanionPeerVerificationPolicy,
    clientPolicy: CredentialCompanionPeerVerificationPolicy,
    unrelatedClientPolicy: CredentialCompanionPeerVerificationPolicy
  ) {
    self.temporaryDirectoryURL = temporaryDirectoryURL
    self.serverIdentity = serverIdentity
    self.serverChainDER = serverChainDER
    self.clientIdentity = clientIdentity
    self.clientChainDER = clientChainDER
    self.unrelatedClientIdentity = unrelatedClientIdentity
    self.unrelatedClientChainDER = unrelatedClientChainDER
    self.serverPolicy = serverPolicy
    self.clientPolicy = clientPolicy
    self.unrelatedClientPolicy = unrelatedClientPolicy
  }

  static func make() throws -> SyntheticMutualTLSFixture {
    let directoryURL = FileManager.default.temporaryDirectory
      .appendingPathComponent("nulltrace-mtls-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(
      at: directoryURL,
      withIntermediateDirectories: false,
      attributes: [.posixPermissions: 0o700]
    )
    var retainDirectory = false
    defer {
      if !retainDirectory {
        try? FileManager.default.removeItem(at: directoryURL)
      }
    }

    try writeConfiguration(in: directoryURL)
    try generateCertificate(
      name: "root",
      commonName: "NullTrace Synthetic Enrollment Root",
      role: .authority,
      directoryURL: directoryURL
    )
    try generateCertificate(
      name: "server",
      commonName: "companion.test",
      role: .server,
      directoryURL: directoryURL
    )
    try generateCertificate(
      name: "client",
      commonName: "NullTrace Synthetic Client",
      role: .client,
      directoryURL: directoryURL
    )
    try generateCertificate(
      name: "unrelated-client",
      commonName: "NullTrace Synthetic Unrelated Client",
      role: .client,
      directoryURL: directoryURL
    )

    let rootDER = try readData("root.der", in: directoryURL)
    let serverDER = try readData("server.der", in: directoryURL)
    let clientDER = try readData("client.der", in: directoryURL)
    let unrelatedClientDER = try readData("unrelated-client.der", in: directoryURL)
    guard let serverPolicy = CredentialCompanionPeerVerificationPolicy(
      expectedLeafSHA256Hex: Self.pin(for: serverDER),
      role: .server(expectedHostname: "companion.test"),
      enrollmentAnchorCertificatesDER: [rootDER]
    ),
      let clientPolicy = CredentialCompanionPeerVerificationPolicy(
        expectedLeafSHA256Hex: Self.pin(for: clientDER),
        role: .client,
        enrollmentAnchorCertificatesDER: [rootDER]
      ),
      let unrelatedClientPolicy = CredentialCompanionPeerVerificationPolicy(
        expectedLeafSHA256Hex: Self.pin(for: unrelatedClientDER),
        role: .client,
        enrollmentAnchorCertificatesDER: [rootDER]
      ),
      let serverIdentity = Self.identity(certificateDER: serverDER, privateKeyName: "server.key.der", in: directoryURL),
      let clientIdentity = Self.identity(certificateDER: clientDER, privateKeyName: "client.key.der", in: directoryURL),
      let unrelatedClientIdentity = Self.identity(
        certificateDER: unrelatedClientDER,
        privateKeyName: "unrelated-client.key.der",
        in: directoryURL
      )
    else {
      throw SyntheticMutualTLSFixtureError.identityOrPolicyCreationFailed
    }

    let fixture = SyntheticMutualTLSFixture(
      temporaryDirectoryURL: directoryURL,
      serverIdentity: serverIdentity,
      serverChainDER: [serverDER],
      clientIdentity: clientIdentity,
      clientChainDER: [clientDER],
      unrelatedClientIdentity: unrelatedClientIdentity,
      unrelatedClientChainDER: [unrelatedClientDER],
      serverPolicy: serverPolicy,
      clientPolicy: clientPolicy,
      unrelatedClientPolicy: unrelatedClientPolicy
    )
    retainDirectory = true
    return fixture
  }

  func cleanup() throws {
    cleanupLock.lock()
    defer { cleanupLock.unlock() }
    guard let directoryURL = temporaryDirectoryURL else { return }
    try FileManager.default.removeItem(at: directoryURL)
    temporaryDirectoryURL = nil
  }

  deinit {
    try? cleanup()
  }

  private enum CertificateRole: Equatable {
    case authority
    case server
    case client

    var extensionSection: String {
      switch self {
      case .authority: return "authority"
      case .server: return "server"
      case .client: return "client"
      }
    }
  }

  private static func writeConfiguration(in directoryURL: URL) throws {
    let configuration = """
      [req]
      distinguished_name = dn
      prompt = no
      [dn]
      CN = NullTrace Synthetic Certificate
      [authority]
      basicConstraints = critical,CA:true,pathlen:0
      keyUsage = critical,keyCertSign,cRLSign
      subjectKeyIdentifier = hash
      [server]
      basicConstraints = critical,CA:false
      keyUsage = critical,digitalSignature,keyEncipherment
      extendedKeyUsage = serverAuth
      subjectAltName = DNS:companion.test
      subjectKeyIdentifier = hash
      authorityKeyIdentifier = keyid,issuer
      [client]
      basicConstraints = critical,CA:false
      keyUsage = critical,digitalSignature,keyEncipherment
      extendedKeyUsage = clientAuth
      subjectKeyIdentifier = hash
      authorityKeyIdentifier = keyid,issuer
      """
    try Data(configuration.utf8).write(
      to: directoryURL.appendingPathComponent("openssl.cnf"),
      options: .atomic
    )
  }

  private static func generateCertificate(
    name: String,
    commonName: String,
    role: CertificateRole,
    directoryURL: URL
  ) throws {
    let keyURL = directoryURL.appendingPathComponent("\(name).key.pem")
    let keyDERURL = directoryURL.appendingPathComponent("\(name).key.der")
    let certificateURL = directoryURL.appendingPathComponent("\(name).pem")
    let certificateDERURL = directoryURL.appendingPathComponent("\(name).der")
    try createPrivateFile(at: keyURL)
    try createPrivateFile(at: keyDERURL)
    try runOpenSSL(["genrsa", "-out", keyURL.path, "2048"], in: directoryURL)
    try runOpenSSL(
      ["rsa", "-in", keyURL.path, "-outform", "DER", "-out", keyDERURL.path],
      in: directoryURL
    )

    if role == .authority {
      try runOpenSSL(
        [
          "req", "-new", "-x509", "-key", keyURL.path, "-sha256", "-days", "30",
          "-subj", "/CN=\(commonName)", "-config", directoryURL.appendingPathComponent("openssl.cnf").path,
          "-extensions", role.extensionSection, "-out", certificateURL.path,
        ],
        in: directoryURL
      )
    } else {
      let requestURL = directoryURL.appendingPathComponent("\(name).csr")
      try runOpenSSL(
        ["req", "-new", "-key", keyURL.path, "-subj", "/CN=\(commonName)", "-out", requestURL.path],
        in: directoryURL
      )
      let rootKeyURL = directoryURL.appendingPathComponent("root.key.pem")
      let rootCertificateURL = directoryURL.appendingPathComponent("root.pem")
      try runOpenSSL(
        [
          "x509", "-req", "-in", requestURL.path, "-CA", rootCertificateURL.path,
          "-CAkey", rootKeyURL.path, "-CAcreateserial", "-days", "30", "-sha256",
          "-extfile", directoryURL.appendingPathComponent("openssl.cnf").path,
          "-extensions", role.extensionSection, "-out", certificateURL.path,
        ],
        in: directoryURL
      )
    }

    try runOpenSSL(
      ["x509", "-in", certificateURL.path, "-outform", "DER", "-out", certificateDERURL.path],
      in: directoryURL
    )
  }

  private static func runOpenSSL(_ arguments: [String], in directoryURL: URL) throws {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/usr/bin/openssl")
    process.arguments = arguments
    process.currentDirectoryURL = directoryURL
    process.environment = [
      "OPENSSL_CONF": directoryURL.appendingPathComponent("openssl.cnf").path,
    ]
    process.standardInput = FileHandle.nullDevice
    process.standardOutput = FileHandle.nullDevice
    process.standardError = FileHandle.nullDevice
    do {
      try process.run()
    } catch {
      throw SyntheticMutualTLSFixtureError.opensslUnavailable
    }

    let deadline = Date().addingTimeInterval(15)
    while process.isRunning && Date() < deadline {
      Thread.sleep(forTimeInterval: 0.01)
    }
    if process.isRunning {
      process.terminate()
      let terminationDeadline = Date().addingTimeInterval(0.25)
      while process.isRunning && Date() < terminationDeadline {
        Thread.sleep(forTimeInterval: 0.01)
      }
      if process.isRunning {
        _ = Darwin.kill(process.processIdentifier, SIGKILL)
      }
      process.waitUntilExit()
      throw SyntheticMutualTLSFixtureError.opensslTimedOut
    }
    guard process.terminationStatus == 0 else {
      throw SyntheticMutualTLSFixtureError.opensslFailed
    }
  }

  private static func createPrivateFile(at url: URL) throws {
    guard FileManager.default.createFile(
      atPath: url.path,
      contents: Data(),
      attributes: [.posixPermissions: 0o600]
    ) else {
      throw SyntheticMutualTLSFixtureError.invalidGeneratedFile
    }
  }

  private static func readData(_ name: String, in directoryURL: URL) throws -> Data {
    let url = directoryURL.appendingPathComponent(name)
    let values = try url.resourceValues(forKeys: [.fileSizeKey])
    guard let fileSize = values.fileSize, fileSize > 0, fileSize <= 512 * 1024 else {
      throw SyntheticMutualTLSFixtureError.invalidGeneratedFile
    }
    return try Data(contentsOf: url, options: .mappedIfSafe)
  }

  private static func identity(
    certificateDER: Data,
    privateKeyName: String,
    in directoryURL: URL
  ) -> SecIdentity? {
    guard let certificate = SecCertificateCreateWithData(kCFAllocatorDefault, certificateDER as CFData),
      let privateKeyDER = try? readData(privateKeyName, in: directoryURL),
      let privateKey = SecKeyCreateWithData(
        privateKeyDER as CFData,
        [
          kSecAttrKeyType: kSecAttrKeyTypeRSA,
          kSecAttrKeyClass: kSecAttrKeyClassPrivate,
          kSecAttrKeySizeInBits: 2048,
        ] as CFDictionary,
        nil
      )
    else {
      return nil
    }
    return SecIdentityCreate(kCFAllocatorDefault, certificate, privateKey)
  }

  private static func pin(for certificateDER: Data) -> String {
    SHA256.hash(data: certificateDER).map { String(format: "%02x", $0) }.joined()
  }
}

private enum SyntheticMutualTLSFixtureError: Error {
  case identityOrPolicyCreationFailed
  case invalidGeneratedFile
  case opensslFailed
  case opensslTimedOut
  case opensslUnavailable
}
