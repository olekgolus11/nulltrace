// swift-tools-version: 6.0
import PackageDescription

let package = Package(
  name: "NullTraceCredentialCompanion",
  platforms: [.macOS(.v13)],
  products: [
    .library(name: "NullTraceCredentialCompanion", targets: ["NullTraceCredentialCompanion"]),
  ],
  targets: [
    .target(name: "NullTraceCredentialCompanion"),
    .executableTarget(
      name: "CredentialLockProbe",
      dependencies: ["NullTraceCredentialCompanion"],
      path: "Tests/CredentialLockProbe"
    ),
    .testTarget(
      name: "NullTraceCredentialCompanionTests",
      dependencies: ["NullTraceCredentialCompanion", "CredentialLockProbe"]
    ),
  ]
)
