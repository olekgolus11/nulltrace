import Foundation
import Security

struct KeychainCredentialRecordBackend: CredentialRecordBackend {
  private let installationNamespace: UUID

  // Internal construction keeps installation identity in the trusted companion boundary.
  init(installationNamespace: UUID) {
    self.installationNamespace = installationNamespace
  }

  func read(_ key: CredentialRecordKey) throws -> Data? {
    var query = query(for: key)
    query[kSecReturnData as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne

    var result: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &result)
    if status == errSecItemNotFound {
      return nil
    }
    guard status == errSecSuccess else {
      throw map(status)
    }
    guard let data = result as? Data else {
      throw CredentialBackendFailure.corrupt
    }
    return data
  }

  func write(_ data: Data, for key: CredentialRecordKey) throws {
    let baseQuery = query(for: key)
    let attributes = [kSecValueData as String: data] as CFDictionary
    let updateStatus = SecItemUpdate(baseQuery as CFDictionary, attributes)
    if updateStatus == errSecSuccess {
      return
    }
    guard updateStatus == errSecItemNotFound else {
      throw map(updateStatus)
    }
    var addQuery = baseQuery
    addQuery[kSecValueData as String] = data
    addQuery[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
    let addStatus = SecItemAdd(addQuery as CFDictionary, nil)
    guard addStatus == errSecSuccess else {
      throw map(addStatus)
    }
  }

  private func query(for key: CredentialRecordKey) -> [String: Any] {
    [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: "com.nulltrace.credential-companion.\(installationNamespace.uuidString.lowercased())",
      kSecAttrAccount as String: "\(key.kind.rawValue):\(key.id.value.uuidString.lowercased())",
    ]
  }

  private func map(_ status: OSStatus) -> CredentialBackendFailure {
    switch status {
    case errSecInteractionNotAllowed, errSecNotAvailable:
      .unavailable
    case errSecAuthFailed, errSecUserCanceled, errSecNoAccessForItem:
      .denied
    case errSecDecode, errSecInvalidItemRef:
      .corrupt
    default:
      .other
    }
  }
}
