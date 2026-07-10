# Use platform secret stores with memory-only fallback

NullTrace will protect persisted authentication material and authenticated evidence through a platform secret store: macOS Keychain, Linux Secret Service, or Windows Credential Manager. Linux desktop is a first-class target; when a supported system credential service is unavailable, NullTrace will keep protected data only for the current process and will not fall back to plaintext or a locally stored encryption key.
