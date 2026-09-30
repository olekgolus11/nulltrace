import CoreFoundation
import Darwin
import Foundation

public actor CredentialRecordStore {
  private static let maximumAllowedPayloadBytes = 64 * 1024
  private let backend: any CredentialRecordBackend
  private let ownership: CredentialCompanionOwnership
  private let maximumPayloadBytes: Int

  // The backend is constructed by the trusted companion with enrollment-owned identity.
  // It is never an operation argument or caller-claimed authorization.
  init(
    backend: any CredentialRecordBackend,
    ownership: CredentialCompanionOwnership,
    maximumPayloadBytes: Int = 64 * 1024
  ) {
    self.backend = backend
    self.ownership = ownership
    self.maximumPayloadBytes = min(maximumPayloadBytes, Self.maximumAllowedPayloadBytes)
  }

  public func load(kind: CredentialRecordKind, id: CredentialRecordID) -> CredentialReadResult {
    let key = CredentialRecordKey(kind: kind, id: id)
    do {
      return try ownership.withExclusiveTransaction {
        guard let data = try ownership.withBackendAccess({ try backend.read(key) }) else {
          return .failure(.notFound)
        }
        guard data.count <= maximumEncodedRecordBytes else {
          return .failure(.corruptRecord)
        }
        guard let envelope = try? JSONDecoder().decode(CredentialRecordEnvelope.self, from: data),
          envelope.kind == kind,
          envelope.id == id.value,
          envelope.generation > 0
        else {
          return .failure(.corruptRecord)
        }
        if envelope.isDeleted {
          guard envelope.schemaVersion == 1, envelope.payload.isEmpty else {
            return .failure(.corruptRecord)
          }
          return .failure(.notFound)
        }
        guard isValidPayload(envelope.payload, schemaVersion: envelope.schemaVersion, kind: kind)
        else {
          return .failure(.corruptRecord)
        }
        return .value(
          StoredCredential(
            id: id,
            kind: kind,
            generation: envelope.generation,
            schemaVersion: envelope.schemaVersion,
            payload: envelope.payload
          )
        )
      }
    } catch let failure as CredentialBackendFailure {
      return .failure(map(failure))
    } catch is CredentialCompanionOwnershipFailure {
      return .failure(.unavailable)
    } catch {
      return .failure(.backendFailure)
    }
  }

  public func save(
    kind: CredentialRecordKind,
    id: CredentialRecordID,
    expectedGeneration: UInt64,
    schemaVersion: UInt16,
    payload: Data
  ) -> CredentialWriteResult {
    guard expectedGeneration < UInt64.max,
      schemaVersion > 0,
      isValidPayload(payload, schemaVersion: schemaVersion, kind: kind)
    else {
      return .failure(.invalidRequest)
    }
    return mutate(
      kind: kind,
      id: id,
      expectedGeneration: expectedGeneration,
      schemaVersion: schemaVersion,
      payload: payload,
      isDeleted: false
    )
  }

  public func delete(
    kind: CredentialRecordKind,
    id: CredentialRecordID,
    expectedGeneration: UInt64
  ) -> CredentialWriteResult {
    guard expectedGeneration < UInt64.max else {
      return .failure(.invalidRequest)
    }
    return mutate(
      kind: kind,
      id: id,
      expectedGeneration: expectedGeneration,
      schemaVersion: 1,
      payload: Data(),
      isDeleted: true
    )
  }

  private func mutate(
    kind: CredentialRecordKind,
    id: CredentialRecordID,
    expectedGeneration: UInt64,
    schemaVersion: UInt16,
    payload: Data,
    isDeleted: Bool
  ) -> CredentialWriteResult {
    let key = CredentialRecordKey(kind: kind, id: id)
    do {
      return try ownership.withExclusiveTransaction {
        let current: CredentialRecordEnvelope?
        if let data = try ownership.withBackendAccess({ try backend.read(key) }) {
          guard data.count <= maximumEncodedRecordBytes else {
            return .failure(.corruptRecord)
          }
          guard let decoded = try? JSONDecoder().decode(CredentialRecordEnvelope.self, from: data),
            decoded.kind == kind,
            decoded.id == id.value,
            decoded.generation > 0,
            decoded.isDeleted
              ? decoded.schemaVersion == 1 && decoded.payload.isEmpty
              : isValidPayload(decoded.payload, schemaVersion: decoded.schemaVersion, kind: kind)
          else {
            return .failure(.corruptRecord)
          }
          current = decoded
        } else {
          current = nil
        }
        let actualGeneration = current?.generation ?? 0
        guard expectedGeneration == actualGeneration else {
          return .failure(.conflict(currentGeneration: actualGeneration))
        }
        let nextGeneration = actualGeneration + 1
        let envelope = CredentialRecordEnvelope(
          kind: kind,
          id: id.value,
          generation: nextGeneration,
          schemaVersion: schemaVersion,
          isDeleted: isDeleted,
          payload: payload
        )
        let encoded = try JSONEncoder().encode(envelope)
        try ownership.withBackendAccess { try backend.write(encoded, for: key) }
        return isDeleted ? .deleted(generation: nextGeneration) : .saved(generation: nextGeneration)
      }
    } catch let failure as CredentialBackendFailure {
      return .failure(map(failure))
    } catch is CredentialCompanionOwnershipFailure {
      return .failure(.unavailable)
    } catch {
      return .failure(.backendFailure)
    }
  }

  private func isValidPayload(
    _ payload: Data,
    schemaVersion: UInt16,
    kind: CredentialRecordKind
  ) -> Bool {
    guard schemaVersion == 1,
      !payload.isEmpty,
      payload.count <= maximumPayloadBytes,
      let object = try? JSONSerialization.jsonObject(with: payload),
      let dictionary = object as? [String: Any]
    else {
      return false
    }
    guard kind == .targetContext else {
      return false
    }
    return isValidTargetContext(dictionary)
  }

  private var maximumEncodedRecordBytes: Int {
    maximumPayloadBytes * 2 + 8 * 1024
  }

  private func isValidTargetContext(_ value: [String: Any]) -> Bool {
    let allowedKeys: Set<String> = ["origin", "cookies", "headers", "browserStorage"]
    guard value.keys.allSatisfy(allowedKeys.contains),
      let origin = value["origin"] as? String,
      isNormalizedHttpOrigin(origin)
    else {
      return false
    }

    let hasCookies = value["cookies"] != nil
    let hasHeaders = value["headers"] != nil
    let hasBrowserStorage = value["browserStorage"] != nil
    guard hasCookies || hasHeaders || hasBrowserStorage else {
      return false
    }
    if hasHeaders && !isValidHeaders(value["headers"]) {
      return false
    }
    if hasCookies && !isValidCookies(value["cookies"], origin: origin) {
      return false
    }
    if hasBrowserStorage && !isValidBrowserStorage(value["browserStorage"]) {
      return false
    }
    return true
  }

  private func isNormalizedHttpOrigin(_ value: String) -> Bool {
    guard value.utf8.count <= 2048,
      let components = URLComponents(string: value),
      let scheme = components.scheme,
      let rawHost = components.host,
      scheme == "http" || scheme == "https",
      components.user == nil,
      components.password == nil,
      components.query == nil,
      components.fragment == nil,
      components.path.isEmpty || components.path == "/",
      rawHost == rawHost.lowercased(),
      components.port.map((1...65_535).contains) ?? true,
      !((scheme == "http" && components.port == 80)
        || (scheme == "https" && components.port == 443)),
      isCanonicalHost(unbracketedHost(rawHost))
    else {
      return false
    }
    let portPart = components.port.map { ":\($0)" } ?? ""
    let host = unbracketedHost(rawHost)
    let hostPart = host.contains(":") ? "[\(host)]" : host
    let normalized = "\(scheme)://\(hostPart)\(portPart)"
    return value == normalized
  }

  private func isCanonicalHost(_ host: String) -> Bool {
    guard !host.isEmpty, host.utf8.count <= 253 else {
      return false
    }
    if host.contains(":") {
      var address = in6_addr()
      guard inet_pton(AF_INET6, host, &address) == 1 else {
        return false
      }
      var output = [CChar](repeating: 0, count: Int(INET6_ADDRSTRLEN))
      guard inet_ntop(AF_INET6, &address, &output, socklen_t(output.count)) != nil else {
        return false
      }
      return string(from: output) == host
    }
    if host.utf8.allSatisfy({ ($0 >= 48 && $0 <= 57) || $0 == 46 }) {
      var address = in_addr()
      guard inet_pton(AF_INET, host, &address) == 1 else {
        return false
      }
      var output = [CChar](repeating: 0, count: Int(INET_ADDRSTRLEN))
      guard inet_ntop(AF_INET, &address, &output, socklen_t(output.count)) != nil else {
        return false
      }
      return string(from: output) == host
    }
    guard !host.hasSuffix("."), !host.hasPrefix(".") else {
      return false
    }
    return host.split(separator: ".").allSatisfy { label in
      guard label.count <= 63,
        label.first != "-",
        label.last != "-"
      else {
        return false
      }
      return label.utf8.allSatisfy { byte in
        (byte >= 97 && byte <= 122) || (byte >= 48 && byte <= 57) || byte == 45
      }
    }
  }

  private func unbracketedHost(_ host: String) -> String {
    guard host.hasPrefix("["), host.hasSuffix("]") else {
      return host
    }
    return String(host.dropFirst().dropLast())
  }

  private func string(from output: [CChar]) -> String {
    let bytes = output.prefix { $0 != 0 }.map { UInt8(bitPattern: $0) }
    return String(decoding: bytes, as: UTF8.self)
  }

  private func isValidHeaders(_ raw: Any?) -> Bool {
    guard let headers = raw as? [String: Any], !headers.isEmpty, headers.count <= 128 else {
      return false
    }
    return headers.allSatisfy { name, value in
      isRFCToken(name)
        && name.utf8.count <= 256
        && (value as? String).map { isValidHeaderValue($0) && $0.utf8.count <= 16 * 1024 } == true
    }
  }

  private func isValidCookies(_ raw: Any?, origin: String) -> Bool {
    guard let cookies = raw as? [[String: Any]], cookies.count <= 256 else {
      return false
    }
    let host = URLComponents(string: origin)?.host.map(unbracketedHost)
    let keys: Set<String> = [
      "name", "value", "domain", "path", "expires", "httpOnly", "secure", "sameSite",
    ]
    return cookies.allSatisfy { cookie in
      guard cookie.keys.allSatisfy(keys.contains),
        let name = cookie["name"] as? String,
        isRFCToken(name),
        name.utf8.count <= 256,
        let value = cookie["value"] as? String,
        isValidCookieValue(value),
        value.utf8.count <= 16 * 1024
      else {
        return false
      }
      if let rawDomain = cookie["domain"] {
        guard let domain = rawDomain as? String, domain == host else {
          return false
        }
      }
      if let rawPath = cookie["path"] {
        guard let path = rawPath as? String,
          path.utf8.count <= 2048,
          isValidHeaderValue(path)
        else {
          return false
        }
      }
      if let rawExpires = cookie["expires"] {
        guard let expires = rawExpires as? NSNumber,
          CFGetTypeID(expires) != CFBooleanGetTypeID(),
          expires.doubleValue.isFinite,
          (-62_135_596_800.0...4_102_444_800.0).contains(expires.doubleValue)
        else {
          return false
        }
      }
      if let rawHTTPOnly = cookie["httpOnly"], !isJSONBoolean(rawHTTPOnly) {
        return false
      }
      if let rawSecure = cookie["secure"], !isJSONBoolean(rawSecure) {
        return false
      }
      if let rawSameSite = cookie["sameSite"] {
        guard let sameSite = rawSameSite as? String,
          ["Strict", "Lax", "None"].contains(sameSite)
        else {
          return false
        }
      }
      return true
    }
  }

  private func isRFCToken(_ value: String) -> Bool {
    let punctuation = Set("!#$%&'*+-.^_`|~".utf8)
    return !value.isEmpty
      && value.utf8.allSatisfy { byte in
        (byte >= 48 && byte <= 57)
          || (byte >= 65 && byte <= 90)
          || (byte >= 97 && byte <= 122)
          || punctuation.contains(byte)
      }
  }

  private func isValidHeaderValue(_ value: String) -> Bool {
    value.utf8.allSatisfy { byte in
      byte >= 32 && byte != 127
    }
  }

  private func isValidCookieValue(_ value: String) -> Bool {
    value.utf8.allSatisfy { byte in
      (byte >= 33 && byte <= 43)
        || (byte >= 45 && byte <= 58)
        || (byte >= 60 && byte <= 91)
        || (byte >= 93 && byte <= 126)
    }
  }

  private func isJSONBoolean(_ value: Any) -> Bool {
    guard let number = value as? NSNumber else {
      return false
    }
    return CFGetTypeID(number) == CFBooleanGetTypeID()
  }

  private func isValidBrowserStorage(_ raw: Any?) -> Bool {
    guard let storage = raw as? [String: Any],
      !storage.isEmpty,
      storage.count <= 2,
      storage.keys.allSatisfy(["localStorage", "sessionStorage"].contains)
    else {
      return false
    }
    return storage.values.allSatisfy { rawStore in
      guard let entries = rawStore as? [String: Any], entries.count <= 1024 else {
        return false
      }
      return entries.allSatisfy { key, value in
        key.utf8.count <= 4096 && (value as? String).map { $0.utf8.count <= 16 * 1024 } == true
      }
    }
  }

  private func map(_ failure: CredentialBackendFailure) -> CredentialStoreFailure {
    switch failure {
    case .unavailable: .unavailable
    case .denied: .denied
    case .corrupt: .corruptRecord
    case .other: .backendFailure
    }
  }
}
