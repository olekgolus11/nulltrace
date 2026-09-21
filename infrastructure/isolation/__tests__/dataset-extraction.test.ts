import { afterEach, expect, test } from "bun:test";
import { chmod, mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const directories: string[] = [];
afterEach(async () => {
  for (const path of directories.splice(0)) {
    await restoreWriteAccess(path);
    await rm(path, { recursive: true, force: true });
  }
});
async function restoreWriteAccess(path: string): Promise<void> {
  await chmod(path, 0o700);
  for (const entry of await readdir(path, { withFileTypes: true })) {
    if (entry.isDirectory()) await restoreWriteAccess(join(path, entry.name));
  }
}
const extractor = fileURLToPath(new URL("../build-catalog.py", import.meta.url));
const makeArchive = `
import tarfile,io,json,hashlib,sys
from pathlib import Path
root=Path(sys.argv[1]); mode=sys.argv[2]; archive=root/'seclists.tar.gz'
with tarfile.open(archive,'w:gz') as out:
    name={'traversal':'release/../../canary','absolute':'/canary'}.get(mode,'release/words.txt')
    item=tarfile.TarInfo(name)
    if mode in ['symlink','hardlink']:
        item.type=tarfile.SYMTYPE if mode=='symlink' else tarfile.LNKTYPE; item.linkname='/canary'
    else: item.size=4
    out.addfile(item,io.BytesIO(b'test') if item.isfile() else None)
    if mode=='duplicate': out.addfile(item,io.BytesIO(b'test'))
checksum=hashlib.sha256(archive.read_bytes()).hexdigest()
if mode=='checksum': checksum='0'*64
(root/'lock.json').write_text(json.dumps({'datasets':{'seclists':{'sha256':checksum,'archiveRoot':'release','revision':'a'*40}}}))
`;

async function extract(mode: string) {
  const directory = await mkdtemp(join(tmpdir(), "nulltrace-dataset-test-"));
  directories.push(directory);
  const fixture = Bun.spawn(["python3", "-c", makeArchive, directory, mode], { stdout: "pipe", stderr: "pipe" });
  expect(await fixture.exited).toBe(0);
  const child = Bun.spawn(["python3", extractor, join(directory, "lock.json"), directory, join(directory, "output")], { stdout: "pipe", stderr: "pipe" });
  const [exitCode] = await Promise.all([child.exited, new Response(child.stderr).text()]);
  return { directory, exitCode };
}

test("builds a real catalog with read-only files and preserved content hashes", async () => {
  const { directory, exitCode } = await extract("valid");
  expect(exitCode).toBe(0);
  const path = join(directory, "output/seclists/files/words.txt");
  expect(await readFile(path, "utf8")).toBe("test");
  expect((await stat(path)).mode & 0o777).toBe(0o444);
  const catalog = JSON.parse(await readFile(join(directory, "output/seclists/catalog.json"), "utf8"));
  expect(catalog.entries[0].sha256).toBe("9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08");
});

test.each(["traversal", "absolute", "symlink", "hardlink", "duplicate", "checksum"])("rejects hostile archive: %s", async (mode) => {
  expect((await extract(mode)).exitCode).not.toBe(0);
});
