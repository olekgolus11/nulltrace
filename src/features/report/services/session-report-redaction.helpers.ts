export function redactSessionReportText(value: string) {
  return value
    .replace(urlUserInfoPattern, "$1[redacted]@")
    .replace(sensitiveAssignmentPattern, "$1[redacted]")
    .replace(sensitiveHeaderPattern, "$1[redacted]")
    .replace(authenticationSchemePattern, "$1 [redacted]")
    .replace(jwtPattern, "[redacted]");
}

const urlUserInfoPattern = /\b([a-z][a-z0-9+.-]*:\/\/)[^@\s/]+@/gi;
const sensitiveAssignmentPattern =
  /(\b(?:(?:access|refresh|id|oauth|auth)[_-]?token|client[_-]?secret|api[_-]?key|authorization|cookie|password|passwd|secret|session|token)\s*=\s*)[^&#\s`"'<>]+/gi;
const sensitiveHeaderPattern =
  /(\b(?:authorization|cookie|proxy-authorization|set-cookie|x-api-key)\s*:\s*)[^\r\n]+/gi;
const authenticationSchemePattern =
  /\b(Bearer|Basic|Digest)\s+[A-Za-z0-9._~+/=-]+/gi;
const jwtPattern =
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]{8,})?\b/g;
