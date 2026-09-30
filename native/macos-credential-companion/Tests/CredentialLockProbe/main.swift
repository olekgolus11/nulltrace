import Foundation

@testable import NullTraceCredentialCompanion

guard CommandLine.arguments.count == 4,
  let namespace = UUID(uuidString: CommandLine.arguments[2])
else {
  exit(64)
}

let mode = CommandLine.arguments[1]
let root = URL(fileURLWithPath: CommandLine.arguments[3], isDirectory: true)
do {
  let ownership = try CredentialCompanionOwnership.acquire(
    installationNamespace: namespace,
    privateRootURL: root
  )
  if mode == "acquire" {
    print("acquired")
    exit(0)
  }
  guard mode == "hold" else { exit(64) }
  print("held")
  fflush(stdout)
  _ = readLine()
  withExtendedLifetime(ownership) {}
} catch CredentialCompanionOwnershipFailure.alreadyOwned {
  exit(73)
} catch {
  exit(74)
}
