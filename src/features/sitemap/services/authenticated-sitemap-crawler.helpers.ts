import { load } from "cheerio";

export function hasLoginForm(body: string) {
  const $ = load(body);
  return $('form input[type="password"]').length > 0;
}

export function isLoginLikeUrl(url: URL) {
  return /(?:^|\/)(?:login|log-in|signin|sign-in|sso|oauth|authorize)(?:\/|$)/i.test(url.pathname);
}

export function isAuthenticationSignal(
  response: Response,
  url: URL,
  body: string,
  crossOriginRedirectUrl: URL | null,
) {
  return (
    response.status === 401 ||
    (crossOriginRedirectUrl !== null && isLoginLikeUrl(crossOriginRedirectUrl)) ||
    isLoginLikeUrl(url) ||
    hasLoginForm(body)
  );
}

export function toErrorMessage(error: unknown) {
  return error instanceof Error && error.message
    ? error.message
    : "Authenticated sitemap crawl failed.";
}
