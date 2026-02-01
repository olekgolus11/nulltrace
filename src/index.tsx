#!/usr/bin/env bun
import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { App } from "./App.tsx";

// Create the OpenTUI renderer
// OpenTUI handles alternate screen buffer and cursor hiding automatically
const renderer = await createCliRenderer({
  exitOnCtrlC: false, // We handle quit with 'q' key in App
});

// Create React root and render the app
const root = createRoot(renderer);
root.render(<App />);

// The renderer will keep running until destroyed (when user presses 'q')
