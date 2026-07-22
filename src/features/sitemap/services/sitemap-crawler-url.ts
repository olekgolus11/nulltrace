export function normalizeCrawlUrl(value: URL) {
  const normalized = new URL(value.toString());
  normalized.hash = "";
  return normalized;
}

export function createAbsoluteCrawlUrl(value: string | undefined, baseUrl: URL) {
  if (!value || value.startsWith("javascript:") || value.startsWith("mailto:")) {
    return null;
  }

  try {
    return normalizeCrawlUrl(new URL(value, baseUrl));
  } catch {
    return null;
  }
}
