import { expect, test } from "bun:test";
import { createIsolationBuildArguments } from "../isolation-build.helpers";
import release from "../release.lock.json";
import { createHash } from "node:crypto";

test("builds only known targets and platforms with immutable image references", () => {
  const args = createIsolationBuildArguments("tools", "linux/arm64");
  expect(args[0]).toBe("build");
  for (const pin of Object.values(release.images)) {
    expect(pin.reference).toMatch(/@sha256:[a-f0-9]{64}$/);
    expect(pin.platforms.map((platform) => platform.architecture)).toEqual(expect.arrayContaining(["arm64", "amd64"]));
  }
  expect(args).toContain(`FFUF_SHA256=${release.ffuf.sha256.arm64}`);
  expect(args.join(" ")).not.toContain(":latest");
  expect(() => createIsolationBuildArguments("--privileged", "linux/arm64")).toThrow();
  expect(() => createIsolationBuildArguments("tools", "linux/arm64 --mount /:/host")).toThrow();
});


test("Dockerfile defaults and copied license files match the release lock", async () => {
  const dockerfile = await Bun.file(new URL("../Dockerfile", import.meta.url)).text();
  for (const [id, pin] of Object.entries(release.images)) {
    expect(dockerfile).toContain(`ARG ${id.toUpperCase()}_IMAGE=${pin.reference}`);
  }
  for (const [name, digest] of Object.entries(release.licenseFiles)) {
    const bytes = await Bun.file(new URL(`../licenses/${name}`, import.meta.url)).arrayBuffer();
    expect(createHash("sha256").update(Buffer.from(bytes)).digest("hex")).toBe(digest);
  }
});
