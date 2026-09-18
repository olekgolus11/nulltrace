function trimTrailingSlash(pathname: string) {
  if (pathname === "/") {
    return pathname;
  }

  const trimmedPathname = pathname.replace(/\/+$/, "");
  return trimmedPathname || "/";
}

export function normalizeTargetUrl(value: string) {
  const trimmedValue = value.trim();
  const explicitScheme = trimmedValue.match(/^([a-z][a-z\d+.-]*):\/\//i)?.[1];
  if (explicitScheme && !/^https?$/i.test(explicitScheme)) {
    throw new Error("Target URL must use HTTP or HTTPS.");
  }

  const input = /^https?:\/\//i.test(trimmedValue) ? trimmedValue : `https://${trimmedValue}`;

  const url = new URL(input);
  if (!url.hostname) {
    throw new Error("Target URL must include a hostname.");
  }
  url.protocol = url.protocol.toLowerCase();
  url.hostname = url.hostname.toLowerCase();
  url.hash = "";

  if (
    (url.protocol === "https:" && url.port === "443") ||
    (url.protocol === "http:" && url.port === "80")
  ) {
    url.port = "";
  }

  url.pathname = trimTrailingSlash(url.pathname);

  const pathname = url.pathname === "/" ? "" : url.pathname;
  const normalizedUrl = `${url.protocol}//${url.host}${pathname}${url.search}`;

  return normalizedUrl;
}
