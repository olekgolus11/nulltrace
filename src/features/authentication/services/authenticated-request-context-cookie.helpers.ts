import {
  splitAuthenticatedCookieEntries,
  splitAuthenticatedHeaderEntries,
} from "./authenticated-request-context-redaction";

export function partitionAuthenticatedRequestCookieHeaders(value: string) {
  const headerDerivedCookies: string[] = [];
  const remainingHeaders: string[] = [];

  splitAuthenticatedHeaderEntries(value).forEach((entry) => {
    const separatorIndex = entry.indexOf(":");
    const name = entry.slice(0, separatorIndex).trim();
    if (separatorIndex > 0 && name.toLowerCase() === "cookie") {
      headerDerivedCookies.push(entry.slice(separatorIndex + 1).trim());
    } else {
      remainingHeaders.push(entry);
    }
  });

  return { headerDerivedCookies, remainingHeaders };
}

// Header-derived cookies have lower precedence. Later exact-name entries win within each source.
export function normalizeAuthenticatedRequestCookies(
  headerDerivedCookies: readonly string[],
  structuredCookies: readonly string[],
): string {
  const cookiesByName = new Map<string, string>();

  [...headerDerivedCookies, ...structuredCookies]
    .flatMap(splitAuthenticatedCookieEntries)
    .forEach((entry) => {
      const separatorIndex = entry.indexOf("=");
      if (separatorIndex <= 0) {
        return;
      }
      const name = entry.slice(0, separatorIndex).trim();
      if (!name) {
        return;
      }
      const value = entry.slice(separatorIndex + 1).trim();
      cookiesByName.delete(name);
      cookiesByName.set(name, value);
    });

  return [...cookiesByName].map(([name, value]) => `${name}=${value}`).join("; ");
}
