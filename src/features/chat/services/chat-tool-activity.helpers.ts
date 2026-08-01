export function getInspectPageActivityLabel(input: unknown) {
  if (!input || typeof input !== "object" || !("url" in input)) {
    return inspectPageLabel;
  }

  const url = input.url;
  if (typeof url !== "string" || !url.trim()) {
    return inspectPageLabel;
  }

  try {
    const parsedUrl = new URL(url);
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      return inspectPageLabel;
    }
    if (hasUnsafeInspectPagePath(parsedUrl.pathname)) {
      return inspectPageLabel;
    }

    return `${inspectPageLabel} ${parsedUrl.pathname}`;
  } catch {
    return inspectPageLabel;
  }
}

const inspectPageLabel = "Inspect page";
const maxInspectPagePathLength = 160;
const sensitivePathMarkers = new Set([
  "invite",
  "magic-link",
  "recover",
  "recovery",
  "reset",
  "token",
  "verification",
  "verify",
]);

function hasUnsafeInspectPagePath(pathname: string) {
  if (pathname.length > maxInspectPagePathLength) {
    return true;
  }

  const segments = pathname
    .split("/")
    .filter(Boolean)
    .map((segment) => decodeURIComponent(segment));

  return segments.some((segment, index) => {
    if (segment.includes(";")) {
      return true;
    }

    const hasSensitiveMarkerValue =
      sensitivePathMarkers.has(segment.toLowerCase()) && index < segments.length - 1;
    const isLongHexValue = /^[a-f\d]{24,}$/i.test(segment);
    const isLongEncodedValue = segment.length >= 32 && /^[a-z\d_-]+$/i.test(segment);
    return hasSensitiveMarkerValue || isLongHexValue || isLongEncodedValue;
  });
}
