import CoreFoundation
import Darwin
import Foundation
import Security

private let frame = Array("synthetic-bootstrap-only".utf8)

private func child(expectedRequirement: String) -> Never {
  var token = audit_token_t()
  var tokenLength = socklen_t(MemoryLayout<audit_token_t>.size)
  let tokenStatus = getsockopt(3, SOL_LOCAL, LOCAL_PEERTOKEN, &token, &tokenLength)
  var peerPID: pid_t = -1
  var pidLength = socklen_t(MemoryLayout<pid_t>.size)
  let pidStatus = getsockopt(3, SOL_LOCAL, LOCAL_PEERPID, &peerPID, &pidLength)
  var code: SecCode?
  let attributes = [kSecGuestAttributeAudit as String: Data(bytes: &token, count: MemoryLayout<audit_token_t>.size)] as CFDictionary
  let codeStatus = tokenStatus == 0 ? SecCodeCopyGuestWithAttributes(nil, attributes, [], &code) : errSecParam
  var requirement: SecRequirement?
  let requirementStatus = SecRequirementCreateWithString(expectedRequirement as CFString, [], &requirement)
  let validityStatus = code.flatMap { code in requirement.map { SecCodeCheckValidity(code, [], $0) } } ?? errSecCSReqInvalid
  let tokenPID = audit_token_to_pid(token)
  let lengthsValid = tokenLength == socklen_t(MemoryLayout<audit_token_t>.size) && pidLength == socklen_t(MemoryLayout<pid_t>.size)
  let accepted = tokenStatus == 0 && pidStatus == 0 && lengthsValid && tokenPID == peerPID && codeStatus == errSecSuccess && requirementStatus == errSecSuccess && validityStatus == errSecSuccess
  var queuedFrame = [UInt8](repeating: 0, count: 128)
  let queuedBytes = Int32(recv(3, &queuedFrame, queuedFrame.count, MSG_PEEK | MSG_DONTWAIT))
  var result: Int32 = -1
  if accepted {
    var buffer = [UInt8](repeating: 0, count: 128)
    result = Int32(recv(3, &buffer, buffer.count, 0))
  } else {
    result = queuedBytes
  }
  let response = "tokenStatus=\(tokenStatus);pidStatus=\(pidStatus);lengthsValid=\(lengthsValid);tokenPid=\(tokenPID);peerPid=\(peerPID);codeStatus=\(codeStatus);requirementStatus=\(requirementStatus);validityStatus=\(validityStatus);accepted=\(accepted);queuedBytes=\(queuedBytes);consumedBytes=\(accepted ? result : 0);peekedFrameBytes=\(queuedBytes)\n"
  _ = response.withCString { Darwin.send(3, $0, strlen($0), 0) }
  exit(accepted && result > 0 ? 0 : 1)
}

private func launcher(childPath: String, expectedRequirement: String) -> Never {
  let processGroupStatus = setpgid(0, 0)
  guard processGroupStatus == 0 || getpgrp() == getpid(), getpgrp() == getpid() else { exit(69) }
  var packetSockets: [Int32] = [0, 0]
  let seqpacketStatus = socketpair(AF_UNIX, SOCK_SEQPACKET, 0, &packetSockets)
  let seqpacketErrno = seqpacketStatus == 0 ? 0 : errno
  if seqpacketStatus == 0 { close(packetSockets[0]); close(packetSockets[1]) }
  var sockets: [Int32] = [0, 0]
  guard socketpair(AF_UNIX, SOCK_STREAM, 0, &sockets) == 0 else { exit(70) }
  defer { close(sockets[0]); close(sockets[1]) }
  _ = frame.withUnsafeBytes { Darwin.send(sockets[0], $0.baseAddress, $0.count, 0) }
  var actions: posix_spawn_file_actions_t?
  guard posix_spawn_file_actions_init(&actions) == 0,
    posix_spawn_file_actions_addclose(&actions, sockets[0]) == 0,
    posix_spawn_file_actions_adddup2(&actions, sockets[1], 3) == 0,
    posix_spawn_file_actions_addclose(&actions, sockets[1]) == 0,
    posix_spawn_file_actions_addclose(&actions, STDOUT_FILENO) == 0,
    posix_spawn_file_actions_addclose(&actions, STDERR_FILENO) == 0 else { exit(71) }
  var pid: pid_t = 0
  let args = [childPath, "child", expectedRequirement]
  let pointers = args.map { strdup($0) } + [nil]
  let environment: [UnsafeMutablePointer<CChar>?] = [strdup("PATH=/usr/bin:/bin:/usr/sbin:/sbin"), nil]
  let status = childPath.withCString { path in pointers.withUnsafeBufferPointer { arguments in
    environment.withUnsafeBufferPointer { env in
      posix_spawn(&pid, path, &actions, nil, UnsafeMutablePointer(mutating: arguments.baseAddress!), UnsafeMutablePointer(mutating: env.baseAddress!))
    }
  } }
  pointers.compactMap { $0 }.forEach { free($0) }
  environment.compactMap { $0 }.forEach { free($0) }
  posix_spawn_file_actions_destroy(&actions)
  guard status == 0 else { exit(72) }
  var token = audit_token_t()
  var tokenLength = socklen_t(MemoryLayout<audit_token_t>.size)
  let tokenStatus = getsockopt(sockets[0], SOL_LOCAL, LOCAL_PEERTOKEN, &token, &tokenLength)
  var peerPID: pid_t = -1
  var pidLength = socklen_t(MemoryLayout<pid_t>.size)
  let pidStatus = getsockopt(sockets[0], SOL_LOCAL, LOCAL_PEERPID, &peerPID, &pidLength)
  let parentTokenPID = audit_token_to_pid(token)
  var response = [UInt8](repeating: 0, count: 1024)
  var descriptor = pollfd(fd: sockets[0], events: Int16(POLLIN), revents: 0)
  let ready = poll(&descriptor, 1, 5_000)
  if ready <= 0 { _ = kill(pid, SIGKILL) }
  let count = ready > 0 ? recv(sockets[0], &response, response.count, 0) : -1
  var childStatus: Int32 = 0
  let childDeadline = Date().addingTimeInterval(1)
  var waitResult = waitpid(pid, &childStatus, WNOHANG)
  while waitResult == 0 && Date() < childDeadline {
    usleep(10_000)
    waitResult = waitpid(pid, &childStatus, WNOHANG)
  }
  if waitResult == 0 {
    _ = kill(pid, SIGKILL)
    waitResult = waitpid(pid, &childStatus, 0)
  }
  let summary = "seqpacketStatus=\(seqpacketStatus);seqpacketErrno=\(seqpacketErrno);parentTokenStatus=\(tokenStatus);parentPIDStatus=\(pidStatus);parentTokenPID=\(parentTokenPID);parentPeerPID=\(peerPID);parentPID=\(getpid());processGroup=\(getpgrp());parentLengthsValid=\(tokenLength == socklen_t(MemoryLayout<audit_token_t>.size) && pidLength == socklen_t(MemoryLayout<pid_t>.size));parentPIDCrosscheck=\(parentTokenPID == peerPID);childPID=\(pid);childStatus=\((childStatus >> 8) & 0xff)\n"
  if count > 0 { _ = response.withUnsafeBytes { write(STDOUT_FILENO, $0.baseAddress, count) } }
  _ = summary.withCString { write(STDOUT_FILENO, $0, strlen($0)) }
  exit(Int32((childStatus >> 8) & 0xff))
}

let args = CommandLine.arguments
guard args.count > 1 else { exit(64) }
switch args[1] {
case "child" where args.count == 3: child(expectedRequirement: args[2])
case "launcher" where args.count == 4: launcher(childPath: args[2], expectedRequirement: args[3])
default: exit(64)
}
