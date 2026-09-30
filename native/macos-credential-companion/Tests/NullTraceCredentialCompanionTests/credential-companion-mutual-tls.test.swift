import Foundation
import Network
import Security
import XCTest
@testable import NullTraceCredentialCompanion

final class CredentialCompanionMutualTLSTests: XCTestCase {
  func testTLS13MutualAuthenticationTransfersCanaryOnlyAfterReady() async throws {
    let fixture = try SyntheticMutualTLSFixture.make()
    defer { XCTAssertNoThrow(try fixture.cleanup()) }

    let server = try LoopbackMutualTLSServer(
      identity: fixture.serverIdentity,
      chainDER: fixture.serverChainDER,
      peerPolicy: fixture.clientPolicy
    )
    server.start()
    defer { server.stop() }
    await fulfillment(of: [server.listenerReady], timeout: 5)

    let client = try await CredentialCompanionMutualTLSConnector().connect(
      port: server.port,
      localIdentity: fixture.clientIdentity,
      localCertificateChainDER: fixture.clientChainDER,
      peerPolicy: fixture.serverPolicy
    )
    defer { client.cancel() }
    await fulfillment(of: [server.connectionReady], timeout: 5)
    XCTAssertTrue(server.didReachReady)
    XCTAssertTrue(server.didNegotiateTLS13)

    let canary = Data("synthetic-mtls-canary".utf8)
    try await send(canary, over: client)
    await fulfillment(of: [server.applicationDataReceived], timeout: 5)
    XCTAssertEqual(server.receivedApplicationData, canary)
  }

  func testWrongServerNameAndWrongServerPinFailBeforeApplicationData() async throws {
    let fixture = try SyntheticMutualTLSFixture.make()
    defer { XCTAssertNoThrow(try fixture.cleanup()) }

    let wrongNamePolicy = try XCTUnwrap(CredentialCompanionPeerVerificationPolicy(
      expectedLeafSHA256Hex: fixture.serverPolicy.expectedLeafSHA256Hex,
      role: .server(expectedHostname: "wrong-companion.test"),
      enrollmentAnchorCertificatesDER: fixture.serverPolicy.enrollmentAnchorCertificatesDER
    ))
    let wrongPinPolicy = try XCTUnwrap(CredentialCompanionPeerVerificationPolicy(
      expectedLeafSHA256Hex: fixture.clientPolicy.expectedLeafSHA256Hex,
      role: .server(expectedHostname: "companion.test"),
      enrollmentAnchorCertificatesDER: fixture.serverPolicy.enrollmentAnchorCertificatesDER
    ))

    try await assertClientCannotSendApplicationData(
      fixture: fixture,
      serverPolicy: fixture.clientPolicy,
      clientPolicy: wrongNamePolicy
    )
    try await assertClientCannotSendApplicationData(
      fixture: fixture,
      serverPolicy: fixture.clientPolicy,
      clientPolicy: wrongPinPolicy
    )
  }

  func testWrongClientPinAndMissingClientIdentityFailAtServer() async throws {
    let fixture = try SyntheticMutualTLSFixture.make()
    defer { XCTAssertNoThrow(try fixture.cleanup()) }

    try await assertClientCannotSendApplicationData(
      fixture: fixture,
      serverPolicy: fixture.unrelatedClientPolicy,
      clientPolicy: fixture.serverPolicy
    )
    try await assertMissingClientIdentityFails(fixture: fixture)
  }

  func testConnectorRejectsNonServerPolicyAndInvalidPort() async throws {
    let fixture = try SyntheticMutualTLSFixture.make()
    defer { XCTAssertNoThrow(try fixture.cleanup()) }
    let connector = CredentialCompanionMutualTLSConnector()

    do {
      _ = try await connector.connect(
        port: 1,
        localIdentity: fixture.clientIdentity,
        localCertificateChainDER: fixture.clientChainDER,
        peerPolicy: fixture.clientPolicy
      )
      XCTFail("Client connector must require a server peer policy")
    } catch CredentialCompanionMutualTLSFailure.invalidConfiguration {
    }

    do {
      _ = try await connector.connect(
        port: 0,
        localIdentity: fixture.clientIdentity,
        localCertificateChainDER: fixture.clientChainDER,
        peerPolicy: fixture.serverPolicy
      )
      XCTFail("Client connector must reject port zero")
    } catch CredentialCompanionMutualTLSFailure.invalidConfiguration {
    }
  }

  func testCancellationAndFixedHandshakeTimeoutCancelHeldConnections() async throws {
    let fixture = try SyntheticMutualTLSFixture.make()
    defer { XCTAssertNoThrow(try fixture.cleanup()) }
    let localIdentity = TestSendableIdentity(
      identity: fixture.clientIdentity,
      chainDER: fixture.clientChainDER,
      peerPolicy: fixture.serverPolicy
    )

    let preCancelled = Task {
      try await CredentialCompanionMutualTLSConnector().connect(
        port: 1,
        localIdentity: localIdentity.identity,
        localCertificateChainDER: localIdentity.chainDER,
        peerPolicy: localIdentity.peerPolicy
      )
    }
    preCancelled.cancel()
    do {
      _ = try await preCancelled.value
      XCTFail("Cancellation before connection start must settle immediately")
    } catch CredentialCompanionMutualTLSFailure.cancelled {
    }

    let cancelledServer = try SilentLoopbackTCPServer()
    cancelledServer.start()
    defer { cancelledServer.stop() }
    await fulfillment(of: [cancelledServer.listenerReady], timeout: 5)
    let cancelledPort = cancelledServer.port
    let cancelledAttempt = Task {
      try await CredentialCompanionMutualTLSConnector().connect(
        port: cancelledPort,
        localIdentity: localIdentity.identity,
        localCertificateChainDER: localIdentity.chainDER,
        peerPolicy: localIdentity.peerPolicy
      )
    }
    await fulfillment(of: [cancelledServer.connectionAccepted], timeout: 5)
    cancelledAttempt.cancel()
    do {
      _ = try await cancelledAttempt.value
      XCTFail("Cancellation must settle the TLS handshake")
    } catch CredentialCompanionMutualTLSFailure.cancelled {
    }
    await fulfillment(of: [cancelledServer.connectionClosed], timeout: 5)

    let timedOutServer = try SilentLoopbackTCPServer()
    timedOutServer.start()
    defer { timedOutServer.stop() }
    await fulfillment(of: [timedOutServer.listenerReady], timeout: 5)
    do {
      _ = try await CredentialCompanionMutualTLSConnector().connect(
        port: timedOutServer.port,
        localIdentity: fixture.clientIdentity,
        localCertificateChainDER: fixture.clientChainDER,
        peerPolicy: fixture.serverPolicy
      )
      XCTFail("A peer that never speaks TLS must hit the fixed deadline")
    } catch CredentialCompanionMutualTLSFailure.timedOut {
    }
    await fulfillment(of: [timedOutServer.connectionClosed], timeout: 5)
  }
}

private struct TestSendableIdentity: @unchecked Sendable {
  let identity: SecIdentity
  let chainDER: [Data]
  let peerPolicy: CredentialCompanionPeerVerificationPolicy
}

private extension CredentialCompanionMutualTLSTests {
  func assertClientCannotSendApplicationData(
    fixture: SyntheticMutualTLSFixture,
    serverPolicy: CredentialCompanionPeerVerificationPolicy,
    clientPolicy: CredentialCompanionPeerVerificationPolicy
  ) async throws {
    let server = try LoopbackMutualTLSServer(
      identity: fixture.serverIdentity,
      chainDER: fixture.serverChainDER,
      peerPolicy: serverPolicy
    )
    server.start()
    defer { server.stop() }
    await fulfillment(of: [server.listenerReady], timeout: 5)

    do {
      let client = try await CredentialCompanionMutualTLSConnector().connect(
        port: server.port,
        localIdentity: fixture.clientIdentity,
        localCertificateChainDER: fixture.clientChainDER,
        peerPolicy: clientPolicy
      )
      defer { client.cancel() }
      let canary = Data("must-not-arrive".utf8)
      do {
        try await send(canary, over: client)
      } catch {
        // A client may briefly reach ready while a TLS 1.3 server is rejecting its certificate.
      }
    } catch {
      // Invalid peer certificates can fail the connection before the connector returns.
    }

    await fulfillment(of: [server.handshakeRejected], timeout: 5)
    XCTAssertFalse(server.didReachReady)
    XCTAssertFalse(server.didReceiveApplicationData)
  }

  func assertMissingClientIdentityFails(fixture: SyntheticMutualTLSFixture) async throws {
    let server = try LoopbackMutualTLSServer(
      identity: fixture.serverIdentity,
      chainDER: fixture.serverChainDER,
      peerPolicy: fixture.clientPolicy
    )
    server.start()
    defer { server.stop() }
    await fulfillment(of: [server.listenerReady], timeout: 5)

    let client = try MissingIdentityTLSClient(port: server.port, policy: fixture.serverPolicy)
    client.start()
    defer { client.cancel() }
    await fulfillment(of: [server.handshakeRejected], timeout: 5)
    XCTAssertFalse(server.didReachReady)
    XCTAssertFalse(server.didReceiveApplicationData)
  }

  func send(_ data: Data, over connection: NWConnection) async throws {
    let attempt = BoundedSendAttempt(connection: connection)
    try await withTaskCancellationHandler {
      try await withCheckedThrowingContinuation { continuation in
        attempt.start(data, continuation: continuation)
      }
    } onCancel: {
      attempt.cancel()
    }
  }
}

private final class BoundedSendAttempt: @unchecked Sendable {
  private let connection: NWConnection
  private let lock = NSLock()
  private let queue = DispatchQueue(label: "nulltrace.companion.mutual-tls.test-send-timeout")
  private var continuation: CheckedContinuation<Void, any Error>?
  private var settled = false
  private var settledFailure: (any Error)?

  init(connection: NWConnection) {
    self.connection = connection
  }

  func start(_ data: Data, continuation: CheckedContinuation<Void, any Error>) {
    lock.lock()
    guard !settled else {
      let error = settledFailure ?? CredentialCompanionMutualTLSFailure.cancelled
      lock.unlock()
      continuation.resume(throwing: error)
      return
    }
    self.continuation = continuation
    lock.unlock()
    queue.asyncAfter(deadline: .now() + .seconds(5)) { [weak self] in
      self?.finish(.failure(CredentialCompanionMutualTLSFailure.timedOut), cancelConnection: true)
    }
    connection.send(content: data, completion: .contentProcessed { [weak self] error in
      if let error {
        self?.finish(.failure(error), cancelConnection: true)
      } else {
        self?.finish(.success(()), cancelConnection: false)
      }
    })
  }

  func cancel() {
    finish(.failure(CredentialCompanionMutualTLSFailure.cancelled), cancelConnection: true)
  }

  private func finish(_ result: Result<Void, any Error>, cancelConnection: Bool) {
    lock.lock()
    guard !settled else {
      lock.unlock()
      return
    }
    settled = true
    if case .failure(let error) = result {
      settledFailure = error
    }
    let continuation = self.continuation
    self.continuation = nil
    lock.unlock()
    if cancelConnection { connection.cancel() }
    switch result {
    case .success:
      continuation?.resume()
    case .failure(let error):
      continuation?.resume(throwing: error)
    }
  }
}

private final class LoopbackMutualTLSServer: @unchecked Sendable {
  private let listener: NWListener
  private let queue = DispatchQueue(label: "nulltrace.companion.mutual-tls.test-server")
  private let lock = NSLock()
  let listenerReady = XCTestExpectation(description: "loopback TLS listener ready")
  let connectionReady = XCTestExpectation(description: "mutual TLS connection ready")
  let handshakeRejected = XCTestExpectation(description: "mutual TLS handshake rejected")
  let applicationDataReceived = XCTestExpectation(description: "application data received after TLS ready")
  private var _acceptedConnection: NWConnection?
  private var _receivedApplicationData = Data()
  private var _didNegotiateTLS13 = false
  private var _port: UInt16?
  private var _didReachReady = false
  private var _didReceiveApplicationData = false

  var port: UInt16 {
    lock.lock()
    defer { lock.unlock() }
    return _port ?? 0
  }

  var didReachReady: Bool {
    lock.lock()
    defer { lock.unlock() }
    return _didReachReady
  }

  var didReceiveApplicationData: Bool {
    lock.lock()
    defer { lock.unlock() }
    return _didReceiveApplicationData
  }

  var receivedApplicationData: Data {
    lock.lock()
    defer { lock.unlock() }
    return _receivedApplicationData
  }

  var didNegotiateTLS13: Bool {
    lock.lock()
    defer { lock.unlock() }
    return _didNegotiateTLS13
  }

  init(
    identity: SecIdentity,
    chainDER: [Data],
    peerPolicy: CredentialCompanionPeerVerificationPolicy
  ) throws {
    let parameters = try CredentialCompanionMutualTLSConnector.makeParameters(
      localIdentity: identity,
      localCertificateChainDER: chainDER,
      peerPolicy: peerPolicy,
      localRole: .server
    )
    parameters.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: .any)
    listener = try NWListener(using: parameters)
  }

  func start() {
    listener.newConnectionHandler = { [weak self] connection in
      self?.accept(connection)
    }
    listener.stateUpdateHandler = { [weak self] state in
      guard let self else { return }
      if case .ready = state {
        self.lock.lock()
        self._port = self.listener.port?.rawValue
        self.lock.unlock()
        self.listenerReady.fulfill()
      }
    }
    listener.start(queue: queue)
  }

  func stop() {
    listener.cancel()
    lock.lock()
    let connection = _acceptedConnection
    lock.unlock()
    connection?.cancel()
  }

  private func accept(_ connection: NWConnection) {
    lock.lock()
    _acceptedConnection = connection
    lock.unlock()
    connection.receive(minimumIncompleteLength: 1, maximumLength: 1024) { [weak self] data, _, _, _ in
      guard let self, let data, !data.isEmpty else { return }
      self.lock.lock()
      self._didReceiveApplicationData = true
      self._receivedApplicationData.append(data)
      self.lock.unlock()
      self.applicationDataReceived.fulfill()
    }
    connection.stateUpdateHandler = { [weak self] state in
      guard let self else { return }
      switch state {
      case .ready:
        let tlsMetadata = connection.metadata(definition: NWProtocolTLS.definition) as? NWProtocolTLS.Metadata
        let negotiatedTLS13 = tlsMetadata.map {
          sec_protocol_metadata_get_negotiated_tls_protocol_version($0.securityProtocolMetadata)
            == .TLSv13
        } ?? false
        self.lock.lock()
        self._didReachReady = true
        self._didNegotiateTLS13 = negotiatedTLS13
        self.lock.unlock()
        self.connectionReady.fulfill()
      case .failed, .cancelled:
        self.handshakeRejected.fulfill()
      default:
        break
      }
    }
    connection.start(queue: queue)
  }
}

private final class MissingIdentityTLSClient: @unchecked Sendable {
  private let connection: NWConnection
  private let queue = DispatchQueue(label: "nulltrace.companion.mutual-tls.test-no-identity")

  init(port: UInt16, policy: CredentialCompanionPeerVerificationPolicy) throws {
    guard case .server = policy.role, let endpointPort = NWEndpoint.Port(rawValue: port) else {
      throw CredentialCompanionMutualTLSFailure.invalidConfiguration
    }
    let tls = NWProtocolTLS.Options()
    let options = tls.securityProtocolOptions
    sec_protocol_options_set_min_tls_protocol_version(options, .TLSv13)
    sec_protocol_options_set_max_tls_protocol_version(options, .TLSv13)
    sec_protocol_options_set_peer_authentication_required(options, true)
    sec_protocol_options_set_tls_server_name(options, "companion.test")
    let verifier = CredentialCompanionPeerVerifier(policy: policy)
    sec_protocol_options_set_verify_block(options, { metadata, _, completion in
      completion(CredentialCompanionMutualTLSConnector.verifyPresentedPeerChain(metadata, using: verifier))
    }, queue)
    let parameters = NWParameters(tls: tls)
    parameters.allowFastOpen = false
    parameters.preferNoProxies = true
    connection = NWConnection(
      to: .hostPort(host: "127.0.0.1", port: endpointPort),
      using: parameters
    )
  }

  func start() {
    connection.stateUpdateHandler = { state in
      if case .ready = state { return }
    }
    connection.start(queue: queue)
  }

  func cancel() {
    connection.cancel()
  }
}

private final class SilentLoopbackTCPServer: @unchecked Sendable {
  private let listener: NWListener
  private let queue = DispatchQueue(label: "nulltrace.companion.mutual-tls.test-silent-server")
  private let lock = NSLock()
  let listenerReady = XCTestExpectation(description: "silent loopback TCP listener ready")
  let connectionAccepted = XCTestExpectation(description: "silent server accepted TCP connection")
  let connectionClosed = XCTestExpectation(description: "cancelled TLS connection reached EOF")
  private var acceptedConnection: NWConnection?
  private var _port: UInt16?

  var port: UInt16 {
    lock.lock()
    defer { lock.unlock() }
    return _port ?? 0
  }

  init() throws {
    let parameters = NWParameters.tcp
    parameters.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: .any)
    listener = try NWListener(using: parameters)
  }

  func start() {
    listener.newConnectionHandler = { [weak self] connection in
      guard let self else { return }
      self.lock.lock()
      self.acceptedConnection = connection
      self._port = self.listener.port?.rawValue
      self.lock.unlock()
      connection.stateUpdateHandler = { [weak self] state in
        guard let self else { return }
        switch state {
        case .ready:
          self.connectionAccepted.fulfill()
          self.receiveNextBytes(on: connection)
        case .failed, .cancelled:
          self.connectionClosed.fulfill()
        default:
          break
        }
      }
      connection.start(queue: self.queue)
    }
    listener.stateUpdateHandler = { [weak self] state in
      guard let self, case .ready = state else { return }
      self.lock.lock()
      self._port = self.listener.port?.rawValue
      self.lock.unlock()
      self.listenerReady.fulfill()
    }
    listener.start(queue: queue)
  }

  func stop() {
    listener.cancel()
    lock.lock()
    let connection = acceptedConnection
    lock.unlock()
    connection?.cancel()
  }

  private func receiveNextBytes(on connection: NWConnection) {
    connection.receive(minimumIncompleteLength: 1, maximumLength: 4096) { [weak self] _, _, isComplete, error in
      guard let self else { return }
      if isComplete || error != nil {
        self.connectionClosed.fulfill()
        return
      }
      self.receiveNextBytes(on: connection)
    }
  }
}
