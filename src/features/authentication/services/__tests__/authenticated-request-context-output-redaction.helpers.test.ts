import { expect, test } from "bun:test";
import {
  createAuthenticatedRequestContextJsonRedactor,
  createAuthenticatedRequestContextOutputRedactor,
} from "../authenticated-request-context-output-redaction.helpers";

test("redacts duplicate cookie names and values from authenticated output", () => {
  const context = {
    origin: "https://app.example.test",
    cookies:
      "private-cookie-name=old-cookie-secret; session-cookie-name=session-cookie-secret; private-cookie-name=new-cookie-secret",
    headers:
      "Cookie: header-cookie-name=header-cookie-secret | Authorization: Bearer authorization-secret",
    updatedAt: "2026-08-01T00:00:00.000Z",
  };
  const redact = createAuthenticatedRequestContextOutputRedactor(context);

  const output = redact(
    "private-cookie-name session-cookie-name header-cookie-name old-cookie-secret session-cookie-secret new-cookie-secret header-cookie-secret",
  );

  expect(output).not.toContain("private-cookie-name");
  expect(output).not.toContain("session-cookie-name");
  expect(output).not.toContain("header-cookie-name");
  expect(output).not.toContain("old-cookie-secret");
  expect(output).not.toContain("session-cookie-secret");
  expect(output).not.toContain("new-cookie-secret");
  expect(output).not.toContain("header-cookie-secret");

  const redactedJson = createAuthenticatedRequestContextJsonRedactor(context)(
    JSON.stringify({ "private-cookie-name": "safe", "header-cookie-name": "safe" }),
  );
  expect(redactedJson).not.toContain("private-cookie-name");
  expect(redactedJson).not.toContain("header-cookie-name");
});
