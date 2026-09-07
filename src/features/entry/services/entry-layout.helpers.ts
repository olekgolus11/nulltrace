import { titleArtBlood } from "../data/entry.constants";
import { EntryLayout } from "../model/entry-layout.types";

export function getEntryLayout(width: number): EntryLayout {
  const sidebarWidth = Math.min(38, Math.floor(width / 3));
  const mainWidth = width - sidebarWidth;
  const titleWidth = Math.max(...titleArtBlood.map((line) => Bun.stringWidth(line)));

  return {
    sidebarWidth,
    mainWidth,
    showTitleArt: width >= 100 && mainWidth - 4 >= titleWidth,
    inputWidth: Math.max(1, Math.min(50, mainWidth - 6)),
  };
}
