import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { DatasetCatalogService } from "../dataset-catalog.service";
import { parseDatasetCatalog } from "../dataset-catalog.helpers";

const revision = "a".repeat(40);
const revisions = { seclists: revision, "nuclei-templates": "b".repeat(40) };
function entry(path = "Discovery/Web-Content/common.txt") {
  return { id: createHash("sha256").update(`${revision}/${path}`).digest("hex"), path, bytes: 10, sha256: "c".repeat(64) };
}
function catalog() { return { version: 1, dataset: "seclists", revision, entries: [entry()] }; }

describe("installed dataset catalog", () => {
  test("resolves an immutable revision and opaque ID into a fixed sandbox path", () => {
    const input = catalog();
    const service = new DatasetCatalogService([input], revisions);
    input.entries[0]!.path = "/host/secret";
    const result = service.resolve("seclists", revision, entry().id);
    expect(result.sandboxPath).toBe("/opt/nulltrace/catalogs/seclists/files/Discovery/Web-Content/common.txt");
    expect(result.sha256).toBe("c".repeat(64));
  });
  test.each(["/etc/passwd", "../secret", "x/../../secret", "C:\\Users\\secret", "x//file", "x/./file", "bad\u0000file"])("rejects unsafe path %s", (path) => {
    expect(() => parseDatasetCatalog({ ...catalog(), entries: [entry(path)] }, revisions)).toThrow();
  });
  test("rejects host filenames, foreign revisions and unknown IDs as selections", () => {
    const service = new DatasetCatalogService([catalog()], revisions);
    expect(() => service.resolve("seclists", revision, "/Users/operator/words.txt")).toThrow();
    expect(() => service.resolve("seclists", "d".repeat(40), entry().id)).toThrow();
    expect(() => service.resolve("nuclei-templates", revisions["nuclei-templates"], entry().id)).toThrow();
  });
  test("rejects duplicate and inconsistent catalog entries", () => {
    for (const entries of [[entry(), entry()], [{ ...entry(), id: "d".repeat(64) }], [{ ...entry(), bytes: 2 ** 40 }]]) {
      expect(() => parseDatasetCatalog({ ...catalog(), entries }, revisions)).toThrow();
    }
    expect(() => parseDatasetCatalog({ ...catalog(), mount: "/host" }, revisions)).toThrow();
    expect(() => parseDatasetCatalog({ ...catalog(), revision: "d".repeat(40) }, revisions)).toThrow();
  });
});
