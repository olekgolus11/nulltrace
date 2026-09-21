import { DatasetCatalog, DatasetCatalogEntry, DatasetId, DatasetSelection } from "../types/dataset-catalog.types";
import { parseDatasetCatalog } from "./dataset-catalog.helpers";

export class DatasetCatalogService {
  private readonly catalogs = new Map<DatasetId, DatasetCatalog>();
  private readonly entries = new Map<DatasetId, Map<string, DatasetCatalogEntry>>();

  constructor(catalogs: unknown[], revisions: Record<DatasetId, string>) {
    if (catalogs.length > 2) throw new Error("Too many dataset catalogs.");
    for (const value of catalogs) {
      const catalog = parseDatasetCatalog(value, revisions);
      if (this.catalogs.has(catalog.dataset)) throw new Error("Duplicate dataset catalog.");
      this.catalogs.set(catalog.dataset, catalog);
      this.entries.set(catalog.dataset, new Map(catalog.entries.map((entry) => [entry.id, entry])));
    }
  }

  resolve(dataset: DatasetId, revision: string, entryId: string): DatasetSelection {
    const catalog = this.catalogs.get(dataset);
    const entry = this.entries.get(dataset)?.get(entryId);
    if (!catalog || catalog.revision !== revision || !entry) throw new Error("Dataset selection is not installed.");
    return {
      dataset, revision, entryId,
      sandboxPath: `/opt/nulltrace/catalogs/${dataset}/files/${entry.path}`,
      bytes: entry.bytes, sha256: entry.sha256,
    };
  }
}
