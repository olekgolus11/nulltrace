function trimTrailingSlash(pathname: string) {
  if (pathname === "/") {
    return pathname;
  }

  const trimmedPathname = pathname.replace(/\/+$/, "");
  return trimmedPathname || "/";
}

export function normalizeTargetUrl(value: string) {
  const trimmedValue = value.trim();
  const input = trimmedValue.startsWith("http")
    ? trimmedValue
    : `https://${trimmedValue}`;

  const url = new URL(input);
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

  return {
    normalizedUrl,
    displayUrl: normalizedUrl,
  };
}
