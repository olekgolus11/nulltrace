"""Build-only extraction: no source hooks, links, devices or archive-provided paths."""
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import sys
import tarfile

lock_path, archive_directory, destination = sys.argv[1:4]
collection = sys.argv[4] if len(sys.argv) == 5 else "datasets"
if collection not in ("datasets", "sources"):
    raise ValueError("Unknown source collection")
lock = json.loads(Path(lock_path).read_text())
for dataset_id, dataset in lock[collection].items():
    archive = Path(archive_directory) / (dataset_id + ".tar.gz")
    with archive.open("rb") as source:
        checksum = hashlib.sha256()
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            checksum.update(chunk)
        if checksum.hexdigest() != dataset["sha256"]:
            raise ValueError("Dataset archive checksum mismatch")
    root = Path(destination) / dataset_id
    root.mkdir(parents=True, exist_ok=False)
    entries = []
    seen = set()
    total = 0
    with tarfile.open(archive, "r:gz") as source:
        for number, member in enumerate(source):
            if number > 200_000 or len(member.name.encode()) > 4096:
                raise ValueError("Archive metadata capacity exceeded")
            parts = PurePosixPath(member.name).parts
            if not parts or parts[0] != dataset["archiveRoot"] or any(part in ("..", "") for part in parts):
                raise ValueError("Invalid archive path")
            if member.isdir():
                continue
            if not member.isfile() or len(parts) < 2:
                raise ValueError("Only regular dataset files are allowed")
            relative = "/".join(parts[1:])
            if relative in seen or "\\" in relative or "\x00" in relative or any(ord(c) < 32 or ord(c) == 127 for c in relative):
                raise ValueError("Invalid or duplicate dataset file")
            seen.add(relative)
            total += member.size
            if member.size < 0 or member.size > 1024 ** 3 or total > 8 * 1024 ** 3 or len(seen) > 100_000:
                raise ValueError("Dataset capacity exceeded")
            path = root / "files" / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            digest = hashlib.sha256()
            remaining = member.size
            with source.extractfile(member) as content, path.open("xb") as output:
                while remaining:
                    chunk = content.read(min(1024 * 1024, remaining))
                    if not chunk:
                        raise ValueError("Truncated dataset file")
                    output.write(chunk)
                    digest.update(chunk)
                    remaining -= len(chunk)
            os.chmod(path, 0o555 if collection == "sources" and member.mode & 0o111 else 0o444)
            entry_id = hashlib.sha256((dataset["revision"] + "/" + relative).encode()).hexdigest()
            entries.append({"id": entry_id, "path": relative, "bytes": member.size, "sha256": digest.hexdigest()})
    catalog = {"version": 1, "dataset": dataset_id, "revision": dataset["revision"], "entries": sorted(entries, key=lambda entry: entry["id"])}
    encoded = json.dumps(catalog, separators=(",", ":")) + "\n"
    if len(encoded.encode()) > 8 * 1024 ** 2:
        raise ValueError("Catalog metadata capacity exceeded")
    (root / "catalog.json").write_text(encoded)
    for parent, directories, files in os.walk(root):
        for file in files:
            path = Path(parent) / file
            os.chmod(path, 0o555 if collection == "sources" and path.stat().st_mode & 0o111 else 0o444)
        os.chmod(parent, 0o555)
