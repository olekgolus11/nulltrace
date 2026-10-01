import Darwin
import Foundation
import XCTest

final class CredentialCompanionBootstrapPeerQualificationTests: XCTestCase {
  func testInheritedStreamSocketAuthenticatesLauncherOnlyBeforeReadingFrame() throws {
    let products = Bundle(for: Self.self).bundleURL.deletingLastPathComponent()
    let probe = products.appendingPathComponent("CredentialCompanionPeerProbe")
    XCTAssertTrue(FileManager.default.isExecutableFile(atPath: probe.path))
    let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
    defer { try? FileManager.default.removeItem(at: root) }

    let trustedLauncher = root.appendingPathComponent("trusted-launcher")
    let impostorLauncher = root.appendingPathComponent("same-id-impostor")
    let peer = root.appendingPathComponent("peer")
    try FileManager.default.copyItem(at: probe, to: trustedLauncher)
    try FileManager.default.copyItem(at: probe, to: impostorLauncher)
    try FileManager.default.copyItem(at: probe, to: peer)
    try sign(trustedLauncher, identifier: "org.nulltrace.test.launcher")
    let entitlements = root.appendingPathComponent("impostor-entitlements.plist")
    try Data("<?xml version=\"1.0\"?><plist version=\"1.0\"><dict><key>com.apple.security.get-task-allow</key><true/></dict></plist>".utf8).write(to: entitlements, options: .atomic)
    try sign(impostorLauncher, identifier: "org.nulltrace.test.launcher", entitlements: entitlements)
    try sign(peer, identifier: "org.nulltrace.test.peer")

    let trustedHash = try cdhash(of: trustedLauncher)
    let impostorHash = try cdhash(of: impostorLauncher)
    XCTAssertNotEqual(trustedHash, impostorHash, "Same signing identifier must not substitute for the pinned code hash.")
    let exactRequirement = "cdhash H\"\(trustedHash)\""

    let positive = try runProbe(launcher: trustedLauncher, peer: peer, requirement: exactRequirement)
    XCTAssertEqual(positive["accepted"], "true")
    XCTAssertEqual(positive["childStatus"], "0")
    XCTAssertEqual(positive["queuedBytes"], "24")
    XCTAssertEqual(positive["consumedBytes"], "24")
    XCTAssertEqual(positive["peekedFrameBytes"], "24")
    XCTAssertEqual(positive["validityStatus"], "0")
    assertChildEndpointAuthenticatesLauncher(positive)
    assertCreatorEndpointReportsSelf(positive)

    let negative = try runProbe(launcher: impostorLauncher, peer: peer, requirement: exactRequirement)
    XCTAssertEqual(negative["accepted"], "false")
    XCTAssertEqual(negative["childStatus"], "1")
    XCTAssertNotEqual(negative["validityStatus"], "0")
    XCTAssertEqual(negative["queuedBytes"], "24")
    XCTAssertEqual(negative["consumedBytes"], "0")
    XCTAssertEqual(negative["peekedFrameBytes"], "24", "The test-only nonblocking peek observes the full queued synthetic frame without consuming it.")
    assertChildEndpointAuthenticatesLauncher(negative)
    assertCreatorEndpointReportsSelf(negative)
    try FileManager.default.removeItem(at: root)
    XCTAssertFalse(FileManager.default.fileExists(atPath: root.path))
  }

  private func sign(_ executable: URL, identifier: String, entitlements: URL? = nil) throws {
    var arguments = ["--force", "--sign", "-", "--identifier", identifier]
    if let entitlements { arguments += ["--entitlements", entitlements.path] }
    arguments.append(executable.path)
    _ = try runBounded(executable: URL(fileURLWithPath: "/usr/bin/codesign"), arguments: arguments)
  }

  private func cdhash(of executable: URL) throws -> String {
    let output = try runBounded(executable: URL(fileURLWithPath: "/usr/bin/codesign"), arguments: ["-dvvv", executable.path])
    let combined = output.stdout + output.stderr
    guard let line = combined.split(separator: "\n").first(where: { $0.hasPrefix("CDHash=") }) else {
      XCTFail("codesign did not report a CodeDirectory hash")
      throw NSError(domain: "PeerQualification", code: 1)
    }
    return String(line.dropFirst("CDHash=".count)).lowercased()
  }

  private func runProbe(launcher: URL, peer: URL, requirement: String) throws -> [String: String] {
    let output = try runBounded(executable: launcher, arguments: ["launcher", peer.path, requirement], expectedExitCodes: [0, 1])
    return Dictionary(uniqueKeysWithValues: (output.stdout + output.stderr).split(whereSeparator: { $0 == ";" || $0.isNewline }).compactMap { part in
      let pair = part.trimmingCharacters(in: .whitespacesAndNewlines).split(separator: "=", maxSplits: 1)
      guard pair.count == 2 else { return nil }
      return (String(pair[0]), String(pair[1]))
    })
  }

  private func assertChildEndpointAuthenticatesLauncher(_ output: [String: String], file: StaticString = #filePath, line: UInt = #line) {
    XCTAssertEqual(output["tokenStatus"], "0", file: file, line: line)
    XCTAssertEqual(output["pidStatus"], "0", file: file, line: line)
    XCTAssertEqual(output["lengthsValid"], "true", file: file, line: line)
    XCTAssertEqual(output["tokenPid"], output["parentPID"], file: file, line: line)
    XCTAssertEqual(output["peerPid"], output["parentPID"], file: file, line: line)
  }

  private func assertCreatorEndpointReportsSelf(_ output: [String: String], file: StaticString = #filePath, line: UInt = #line) {
    XCTAssertTrue(output["seqpacketStatus"] == "0" || output["seqpacketStatus"] == "-1", file: file, line: line)
    XCTAssertNotNil(output["seqpacketErrno"], file: file, line: line)
    XCTAssertEqual(output["parentTokenStatus"], "0", file: file, line: line)
    XCTAssertEqual(output["parentPIDStatus"], "0", file: file, line: line)
    XCTAssertEqual(output["processGroup"], output["parentPID"], file: file, line: line)
    XCTAssertEqual(output["parentLengthsValid"], "true", file: file, line: line)
    XCTAssertEqual(output["parentPIDCrosscheck"], "true", file: file, line: line)
    XCTAssertEqual(output["parentTokenPID"], output["parentPID"], file: file, line: line)
    XCTAssertEqual(output["parentPeerPID"], output["parentPID"], file: file, line: line)
    XCTAssertNotEqual(output["parentTokenPID"], output["childPID"], file: file, line: line)
  }

  private func runBounded(executable: URL, arguments: [String], expectedExitCodes: Set<Int32> = [0]) throws -> (stdout: String, stderr: String) {
    let process = Process()
    process.executableURL = executable
    process.arguments = arguments
    process.environment = ["PATH": "/usr/bin:/bin:/usr/sbin:/sbin"]
    let stdout = Pipe()
    let stderr = Pipe()
    process.standardOutput = stdout
    process.standardError = stderr
    try process.run()
    let deadline = Date().addingTimeInterval(10)
    while process.isRunning && Date() < deadline { usleep(10_000) }
    if process.isRunning {
      _ = kill(-process.processIdentifier, SIGTERM)
      process.terminate()
      let stopDeadline = Date().addingTimeInterval(1)
      while process.isRunning && Date() < stopDeadline { usleep(10_000) }
      _ = kill(-process.processIdentifier, SIGKILL)
      if process.isRunning { _ = kill(process.processIdentifier, SIGKILL) }
      process.waitUntilExit()
      XCTFail("Subprocess exceeded its 10-second test deadline: \(executable.lastPathComponent)")
      throw NSError(domain: "PeerQualification", code: 2)
    }
    process.waitUntilExit()
    let out = String(data: stdout.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
    let err = String(data: stderr.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
    XCTAssertTrue(expectedExitCodes.contains(process.terminationStatus), "Unexpected exit \(process.terminationStatus): \(err)\n\(out)")
    return (out, err)
  }
}
