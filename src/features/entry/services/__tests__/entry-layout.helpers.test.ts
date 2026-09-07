import { expect, test } from "bun:test";
import { titleArtBlood } from "../../data/entry.constants";
import { getEntryLayout } from "../entry-layout.helpers";

test("keeps entry columns and URL input inside compact terminals", () => {
  for (const width of [40, 60, 80, 100, 120, 160]) {
    const layout = getEntryLayout(width);
    expect(layout.mainWidth + layout.sidebarWidth).toBe(width);
    expect(layout.inputWidth + 6).toBeLessThanOrEqual(layout.mainWidth);
  }
});

test("shows the full banner only when its main column has room", () => {
  expect(getEntryLayout(99).showTitleArt).toBe(false);
  expect(getEntryLayout(100).showTitleArt).toBe(false);
  expect(getEntryLayout(160).showTitleArt).toBe(true);
  for (let width = 40; width <= 160; width++) {
    const layout = getEntryLayout(width);
    if (layout.showTitleArt) {
      expect(Math.max(...titleArtBlood.map((line) => Bun.stringWidth(line))))
        .toBeLessThanOrEqual(layout.mainWidth - 4);
    }
  }
});
