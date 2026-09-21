export type DatasetId = "seclists" | "nuclei-templates";

export interface DatasetCatalogEntry {
  id: string;
  path: string;
  bytes: number;
  sha256: string;
}

export interface DatasetCatalog {
  version: 1;
  dataset: DatasetId;
  revision: string;
  entries: DatasetCatalogEntry[];
}

export interface DatasetSelection {
  dataset: DatasetId;
  revision: string;
  entryId: string;
  sandboxPath: string;
  bytes: number;
  sha256: string;
}
