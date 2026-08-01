import {
  normalizeAuthenticatedRequestCookies,
  partitionAuthenticatedRequestCookieHeaders,
} from "../../authentication/services/authenticated-request-context-cookie.helpers";
import {
  splitAuthenticatedCookieEntries,
  splitAuthenticatedHeaderEntries,
} from "../../authentication/services/authenticated-request-context-redaction";
import { PageInspectionAuthentication, PageInspectionSnapshot } from "../model/page-inspection.types";
import {
  PlaywrightPageInspectionAuthentication,
  PlaywrightPageInspectionCookie,
} from "../model/playwright-page-inspection-authentication.types";

export function createPlaywrightPageInspectionAuthentication(
  authentication: PageInspectionAuthentication,
): PlaywrightPageInspectionAuthentication {
  const { headerDerivedCookies, remainingHeaders } =
    partitionAuthenticatedRequestCookieHeaders(authentication.headers);
  const headers: Record<string, string> = {};

  remainingHeaders.forEach((entry) => {
    const separatorIndex = entry.indexOf(":");
    if (separatorIndex <= 0) {
      return;
    }
    const name = entry.slice(0, separatorIndex).trim();
    const value = entry.slice(separatorIndex + 1).trim();
    if (!name || !value) {
      return;
    }
    headers[name] = value;
  });

  return {
    cookies: createPlaywrightPageInspectionCookies(
      authentication.origin,
      normalizeAuthenticatedRequestCookies(headerDerivedCookies, [authentication.cookies]),
    ),
    headers,
  };
}

export function mergePlaywrightPageInspectionHeaders(
  requestHeaders: Record<string, string>,
  authenticationHeaders: Record<string, string>,
): Record<string, string> {
  const headers = { ...requestHeaders };
  Object.entries(authenticationHeaders).forEach(([name, value]) => {
    const existingName = Object.keys(headers).find(
      (candidate) => candidate.toLowerCase() === name.toLowerCase(),
    );
    if (existingName) {
      delete headers[existingName];
    }
    headers[name] = value;
  });
  return headers;
}

export function redactPlaywrightPageInspectionSnapshot(
  snapshot: PageInspectionSnapshot,
  authentication: PageInspectionAuthentication | undefined,
): PageInspectionSnapshot {
  if (!authentication) {
    return snapshot;
  }

  return {
    ...snapshot,
    requestedUrl: redactPlaywrightPageInspectionValue(snapshot.requestedUrl, authentication),
    finalUrl: redactPlaywrightPageInspectionValue(snapshot.finalUrl, authentication),
    contentType: snapshot.contentType
      ? redactPlaywrightPageInspectionValue(snapshot.contentType, authentication)
      : null,
    title: redactPlaywrightPageInspectionValue(snapshot.title, authentication),
    visibleText: redactPlaywrightPageInspectionValue(snapshot.visibleText, authentication),
    forms: snapshot.forms.map((form) => ({
      ...form,
      action: form.action
        ? redactPlaywrightPageInspectionValue(form.action, authentication)
        : null,
      fields: form.fields.map((field) => ({
        ...field,
        name: field.name
          ? redactPlaywrightPageInspectionValue(field.name, authentication)
          : null,
        type: redactPlaywrightPageInspectionValue(field.type, authentication),
      })),
    })),
    links: snapshot.links.map((link) => ({
      url: redactPlaywrightPageInspectionValue(link.url, authentication),
      text: redactPlaywrightPageInspectionValue(link.text, authentication),
    })),
    scripts: snapshot.scripts.map((script) => ({
      src: script.src ? redactPlaywrightPageInspectionValue(script.src, authentication) : null,
      type: script.type
        ? redactPlaywrightPageInspectionValue(script.type, authentication)
        : null,
    })),
    domOutline: snapshot.domOutline.map((node) => ({
      ...node,
      id: node.id ? redactPlaywrightPageInspectionValue(node.id, authentication) : null,
      role: node.role ? redactPlaywrightPageInspectionValue(node.role, authentication) : null,
      name: node.name ? redactPlaywrightPageInspectionValue(node.name, authentication) : null,
      heading: node.heading
        ? redactPlaywrightPageInspectionValue(node.heading, authentication)
        : null,
    })),
    metadata: snapshot.metadata.map((entry) => ({
      name: redactPlaywrightPageInspectionValue(entry.name, authentication),
      content: redactPlaywrightPageInspectionValue(entry.content, authentication),
    })),
    securitySignals: {
      ...snapshot.securitySignals,
      contentSecurityPolicy: snapshot.securitySignals.contentSecurityPolicy
        ? redactPlaywrightPageInspectionValue(
            snapshot.securitySignals.contentSecurityPolicy,
            authentication,
          )
        : null,
      frameOptions: snapshot.securitySignals.frameOptions
        ? redactPlaywrightPageInspectionValue(snapshot.securitySignals.frameOptions, authentication)
        : null,
      referrerPolicy: snapshot.securitySignals.referrerPolicy
        ? redactPlaywrightPageInspectionValue(snapshot.securitySignals.referrerPolicy, authentication)
        : null,
      permissionsPolicy: snapshot.securitySignals.permissionsPolicy
        ? redactPlaywrightPageInspectionValue(snapshot.securitySignals.permissionsPolicy, authentication)
        : null,
    },
  };
}

export function redactPlaywrightPageInspectionError(
  error: unknown,
  authentication: PageInspectionAuthentication | undefined,
): Error {
  const message = error instanceof Error ? error.message : String(error);
  return new Error(
    authentication ? redactPlaywrightPageInspectionValue(message, authentication) : message,
  );
}

function createPlaywrightPageInspectionCookies(
  origin: string,
  value: string,
): PlaywrightPageInspectionCookie[] {
  return splitAuthenticatedCookieEntries(value).flatMap((entry) => {
    const separatorIndex = entry.indexOf("=");
    if (separatorIndex <= 0) {
      return [];
    }
    const name = entry.slice(0, separatorIndex).trim();
    const cookieValue = entry.slice(separatorIndex + 1).trim();
    return name ? [{ name, value: cookieValue, url: origin }] : [];
  });
}

function redactPlaywrightPageInspectionValue(
  value: string,
  authentication: PageInspectionAuthentication,
): string {
  return getPlaywrightPageInspectionSecretValues(authentication).reduce(
    (redacted, secret) => redacted.replaceAll(secret, "[redacted]"),
    value,
  );
}

function getPlaywrightPageInspectionSecretValues(
  authentication: PageInspectionAuthentication,
): string[] {
  const values = new Set<string>([authentication.cookies]);
  addPlaywrightPageInspectionCookieSecretValues(values, authentication.cookies);
  splitAuthenticatedHeaderEntries(authentication.headers).forEach((entry) => {
    const separatorIndex = entry.indexOf(":");
    const headerName = entry.slice(0, separatorIndex).trim();
    const headerValue = entry.slice(separatorIndex + 1).trim();
    if (separatorIndex > 0 && headerValue) {
      values.add(headerValue);
    }
    if (headerName.toLowerCase() === "cookie") {
      addPlaywrightPageInspectionCookieSecretValues(values, headerValue);
    }
  });
  return [...values].filter(Boolean).sort((left, right) => right.length - left.length);
}

function addPlaywrightPageInspectionCookieSecretValues(
  values: Set<string>,
  cookies: string,
) {
  splitAuthenticatedCookieEntries(cookies).forEach((entry) => {
    const separatorIndex = entry.indexOf("=");
    const cookieValue = entry.slice(separatorIndex + 1).trim();
    if (separatorIndex > 0 && cookieValue) {
      values.add(cookieValue);
    }
  });
}
