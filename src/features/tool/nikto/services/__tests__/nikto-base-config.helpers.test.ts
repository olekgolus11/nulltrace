import { expect, test } from "bun:test";
import { getNiktoBaseConfigCandidates } from "../nikto-base-config.helpers";

test("includes the Debian and Kali packaged Nikto configuration", () => {
  expect(getNiktoBaseConfigCandidates()).toContain("/etc/nikto/config.txt");
});
