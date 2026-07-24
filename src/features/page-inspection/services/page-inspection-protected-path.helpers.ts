export function isPageInspectionProtectedUrl(
  urlValue: string,
  targetOrigin: string,
  protectedPaths: string[],
) {
  const url = new URL(urlValue, targetOrigin);
  if (url.origin !== targetOrigin) {
    return false;
  }

  return protectedPaths.some((protectedPath) => {
    const protectedUrl = new URL(protectedPath, targetOrigin);
    if (protectedUrl.origin !== targetOrigin) {
      return false;
    }

    const normalizedPath = protectedUrl.pathname.replace(/\/+$/, "") || "/";
    return (
      url.pathname === normalizedPath ||
      (normalizedPath !== "/" && url.pathname.startsWith(`${normalizedPath}/`))
    );
  });
}
