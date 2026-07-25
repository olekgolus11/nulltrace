import { expect, test } from "bun:test";
import { PageInspectionAuthenticationSelectionService } from "../page-inspection-authentication-selection.service";

test("consumes one operator authentication selection and rejects stale auth state", () => {
  const service = new PageInspectionAuthenticationSelectionService();

  service.select("session-one", 3);
  expect(service.isSelected("session-one", 3)).toBe(true);
  expect(service.consume("session-one", 3)).toBe(true);
  expect(service.consume("session-one", 3)).toBe(false);

  service.select("session-one", 3);
  expect(service.consume("session-one", 4)).toBe(false);
  expect(service.isSelected("session-one", 3)).toBe(false);

  service.select("session-one", 5);
  service.clearAll();
  expect(service.listSelectedAuthStateVersions()).toEqual({});
});
