#!/usr/bin/env bun
import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { openCodeServerService } from "../features/chat/services/opencode-server.service";
import { sitemapRepository } from "../features/sitemap/services/sitemap.repository";
import { App } from "./App";

sitemapRepository.recoverInterruptedCrawls();

const renderer = await createCliRenderer({
  exitOnCtrlC: false,
  onDestroy: () => {
    void openCodeServerService.close();
  },
});

const root = createRoot(renderer);
root.render(<App />);
