import { createHash } from "node:crypto";
import { DatasetCatalog, DatasetCatalogEntry, DatasetId } from "../types/dataset-catalog.types";
import { requireExecutionRecord } from "./execution-validation.helpers";

export function parseDatasetCatalog(value: unknown, revisions: Record<DatasetId, string>): DatasetCatalog {
  const record = requireExecutionRecord(value, ["version", "dataset", "revision", "entries"]);
  if (record.version !== 1 || (record.dataset !== "seclists" && record.dataset !== "nuclei-templates") ||
    typeof record.revision !== "string" || !/^[a-f0-9]{40}$/.test(record.revision) ||
    revisions[record.dataset] !== record.revision || !Array.isArray(record.entries) || record.entries.length > 100_000) {
    throw new Error("Unsupported dataset catalog or revision.");
  }
  const revision = record.revision;
  const ids = new Set<string>();
  const paths = new Set<string>();
  let totalBytes = 0;
  const entries: DatasetCatalogEntry[] = record.entries.map((value: unknown) => {
    const entry = requireExecutionRecord(value, ["id", "path", "bytes", "sha256"]);
    if (typeof entry.path !== "string" || !entry.path || Buffer.byteLength(entry.path) > 4096 ||
      /[\\\x00-\x1f\x7f]/.test(entry.path) || entry.path.split("/").some((part) => !part || part === "." || part === "..")) {
      throw new Error("Invalid dataset path.");
    }
    const id = createHash("sha256").update(`${revision}/${entry.path}`).digest("hex");
    if (entry.id !== id || ids.has(id) || paths.has(entry.path) ||
      typeof entry.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(entry.sha256) ||
      typeof entry.bytes !== "number" || !Number.isSafeInteger(entry.bytes) || entry.bytes < 0 || entry.bytes > 1024 ** 3) {
      throw new Error("Invalid dataset entry.");
    }
    totalBytes += entry.bytes;
    if (totalBytes > 8 * 1024 ** 3) throw new Error("Dataset capacity exceeded.");
    ids.add(id);
    paths.add(entry.path);
    return { id, path: entry.path, bytes: entry.bytes, sha256: entry.sha256 };
  });
  return { version: 1, dataset: record.dataset, revision, entries };
}
