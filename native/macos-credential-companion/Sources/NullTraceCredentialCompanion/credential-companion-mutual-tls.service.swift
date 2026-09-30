import Dispatch
import Foundation
import Network
import Security

public struct CredentialCompanionMutualTLSConnector: Sendable {
  public init() {}

  public func connect(
    port: UInt16,
    localIdentity: SecIdentity,
    localCertificateChainDER: [Data],
    peerPolicy: CredentialCompanionPeerVerificationPolicy
  ) async throws -> NWConnection {
    guard port > 0,
      case .server = peerPolicy.role,
      let endpointPort = NWEndpoint.Port(rawValue: port)
    else {
      throw CredentialCompanionMutualTLSFailure.invalidConfiguration
    }

    let parameters = try Self.makeParameters(
      localIdentity: localIdentity,
      localCertificateChainDER: localCertificateChainDER,
      peerPolicy: peerPolicy,
      localRole: .client
    )
    let connection = NWConnection(
      to: .hostPort(host: NWEndpoint.Host("127.0.0.1"), port: endpointPort),
      using: parameters
    )
    let attempt = TLSConnectionAttempt(connection: connection)

    return try await withTaskCancellationHandler {
      try await withCheckedThrowingContinuation { continuation in
        attempt.start(continuation)
      }
    } onCancel: {
      attempt.cancel()
    }
  }
}

enum CredentialCompanionMutualTLSLocalRole {
  case client
  case server
}

extension CredentialCompanionMutualTLSConnector {
  static func makeParameters(
    localIdentity: SecIdentity,
    localCertificateChainDER: [Data],
    peerPolicy: CredentialCompanionPeerVerificationPolicy,
    localRole: CredentialCompanionMutualTLSLocalRole
  ) throws -> NWParameters {
    guard Self.hasOppositePeerRole(peerPolicy.role, localRole: localRole),
      let localCertificates = Self.makeLocalCertificates(
        localIdentity: localIdentity, certificateChainDER: localCertificateChainDER)
    else {
      throw CredentialCompanionMutualTLSFailure.invalidConfiguration
    }

    let securityIdentity = sec_identity_create_with_certificates(
      localIdentity, localCertificates as CFArray)
    guard let securityIdentity else {
      throw CredentialCompanionMutualTLSFailure.invalidConfiguration
    }

    let tlsOptions = NWProtocolTLS.Options()
    let securityOptions = tlsOptions.securityProtocolOptions
    sec_protocol_options_set_min_tls_protocol_version(securityOptions, .TLSv13)
    sec_protocol_options_set_max_tls_protocol_version(securityOptions, .TLSv13)
    sec_protocol_options_set_local_identity(securityOptions, securityIdentity)
    sec_protocol_options_set_peer_authentication_required(securityOptions, true)
    sec_protocol_options_set_tls_resumption_enabled(securityOptions, false)
    sec_protocol_options_set_tls_tickets_enabled(securityOptions, false)
    sec_protocol_options_set_tls_false_start_enabled(securityOptions, false)

    if case .client = localRole,
      case .server(let expectedHostname) = peerPolicy.role
    {
      expectedHostname.withCString { hostname in
        sec_protocol_options_set_tls_server_name(securityOptions, hostname)
      }
    }

    let verifier = CredentialCompanionPeerVerifier(policy: peerPolicy)
    let verificationQueue = DispatchQueue(label: "nulltrace.companion.mutual-tls.peer-verification")
    sec_protocol_options_set_verify_block(
      securityOptions,
      { metadata, _, completion in
        completion(Self.verifyPresentedPeerChain(metadata, using: verifier))
      },
      verificationQueue
    )

    let tcpOptions = NWProtocolTCP.Options()
    tcpOptions.enableFastOpen = false
    let parameters = NWParameters(tls: tlsOptions, tcp: tcpOptions)
    parameters.allowFastOpen = false
    parameters.preferNoProxies = true
    return parameters
  }
}

extension CredentialCompanionMutualTLSConnector {
  static let maximumLocalCertificateCount = 8
  static let maximumCertificateDERBytes = 512 * 1024
  static let maximumTotalDERBytes = 2 * 1024 * 1024

  static func hasOppositePeerRole(
    _ peerRole: CredentialCompanionPeerRole,
    localRole: CredentialCompanionMutualTLSLocalRole
  ) -> Bool {
    switch (localRole, peerRole) {
    case (.client, .server), (.server, .client):
      return true
    case (.client, .client), (.server, .server):
      return false
    }
  }

  static func makeLocalCertificates(
    localIdentity: SecIdentity,
    certificateChainDER: [Data]
  ) -> [SecCertificate]? {
    guard !certificateChainDER.isEmpty,
      certificateChainDER.count <= maximumLocalCertificateCount,
      certificateChainDER.allSatisfy({ !$0.isEmpty && $0.count <= maximumCertificateDERBytes }),
      Self.totalSize(certificateChainDER) <= maximumTotalDERBytes
    else {
      return nil
    }

    var identityCertificate: SecCertificate?
    guard SecIdentityCopyCertificate(localIdentity, &identityCertificate) == errSecSuccess,
      let localLeafCertificate = identityCertificate,
      let localLeafDER = SecCertificateCopyData(localLeafCertificate) as Data?,
      localLeafDER == certificateChainDER[0]
    else {
      return nil
    }

    var certificates: [SecCertificate] = []
    certificates.reserveCapacity(certificateChainDER.count)
    for certificateDER in certificateChainDER {
      guard let certificate = SecCertificateCreateWithData(kCFAllocatorDefault, certificateDER as CFData),
        SecCertificateCopyData(certificate) as Data? == certificateDER
      else {
        return nil
      }
      certificates.append(certificate)
    }
    return certificates
  }

  static func totalSize(_ values: [Data]) -> Int {
    values.reduce(into: 0) { total, value in
      let (sum, overflow) = total.addingReportingOverflow(value.count)
      total = overflow ? Int.max : sum
    }
  }

  static func verifyPresentedPeerChain(
    _ metadata: sec_protocol_metadata_t,
    using verifier: CredentialCompanionPeerVerifier
  ) -> Bool {
    var chainDER: [Data] = []
    var totalDERBytes = 0
    var invalid = false

    let wasAccessible = sec_protocol_metadata_access_peer_certificate_chain(metadata) { certificate in
      guard !invalid else { return }
      guard chainDER.count < maximumLocalCertificateCount else {
        invalid = true
        return
      }

      let certificateReference = sec_certificate_copy_ref(certificate).takeRetainedValue()
      let certificateDataReference = SecCertificateCopyData(certificateReference)
      let certificateLength = CFDataGetLength(certificateDataReference)
      guard certificateLength > 0,
        certificateLength <= maximumCertificateDERBytes
      else {
        invalid = true
        return
      }

      let (newTotal, overflow) = totalDERBytes.addingReportingOverflow(certificateLength)
      guard !overflow, newTotal <= maximumTotalDERBytes else {
        invalid = true
        return
      }
      totalDERBytes = newTotal
      let certificateData = certificateDataReference as Data
      chainDER.append(certificateData)
    }

    guard wasAccessible, !invalid, !chainDER.isEmpty else { return false }
    return verifier.verify(certificateChainDER: chainDER) == .verified
  }
}

private final class TLSConnectionAttempt: @unchecked Sendable {
  private let connection: NWConnection
  private let queue = DispatchQueue(label: "nulltrace.companion.mutual-tls.connection")
  private let lock = NSLock()
  private var continuation: CheckedContinuation<NWConnection, any Error>?
  private var timeoutWorkItem: DispatchWorkItem?
  private var isSettled = false
  private var settledFailure: CredentialCompanionMutualTLSFailure?

  init(connection: NWConnection) {
    self.connection = connection
  }

  func start(_ continuation: CheckedContinuation<NWConnection, any Error>) {
    lock.lock()
    guard !isSettled else {
      let failure = settledFailure ?? .cancelled
      lock.unlock()
      continuation.resume(throwing: failure)
      return
    }
    self.continuation = continuation
    lock.unlock()

    guard !Task.isCancelled else {
      cancel()
      return
    }

    let timeout = DispatchWorkItem { [weak self] in self?.timeout() }
    lock.lock()
    guard !isSettled else {
      lock.unlock()
      timeout.cancel()
      return
    }
    timeoutWorkItem = timeout
    lock.unlock()

    connection.stateUpdateHandler = { [weak self] state in self?.handle(state) }
    queue.asyncAfter(deadline: .now() + .seconds(8), execute: timeout)
    connection.start(queue: queue)
  }

  func cancel() {
    finish(.failure(.cancelled), shouldCancelConnection: true)
  }

  private func timeout() {
    finish(.failure(.timedOut), shouldCancelConnection: true)
  }

  private func handle(_ state: NWConnection.State) {
    switch state {
    case .ready:
      finish(.success(connection), shouldCancelConnection: false)
    case .failed:
      finish(.failure(.handshakeFailed), shouldCancelConnection: true)
    case .cancelled:
      finish(.failure(.cancelled), shouldCancelConnection: true)
    case .setup, .preparing, .waiting:
      break
    @unknown default:
      finish(.failure(.handshakeFailed), shouldCancelConnection: true)
    }
  }

  private func finish(
    _ result: Result<NWConnection, CredentialCompanionMutualTLSFailure>,
    shouldCancelConnection: Bool
  ) {
    lock.lock()
    guard !isSettled else {
      lock.unlock()
      return
    }
    isSettled = true
    if case .failure(let failure) = result {
      settledFailure = failure
    }
    let continuation = self.continuation
    self.continuation = nil
    let timeout = timeoutWorkItem
    timeoutWorkItem = nil
    lock.unlock()

    timeout?.cancel()
    connection.stateUpdateHandler = nil
    if shouldCancelConnection {
      connection.cancel()
    }
    switch result {
    case .success(let connection):
      continuation?.resume(returning: connection)
    case .failure(let failure):
      continuation?.resume(throwing: failure)
    }
  }
}
