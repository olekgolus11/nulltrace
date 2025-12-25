#!/usr/bin/env bun
import { render } from "ink";
import { App } from "./App.tsx";

// ANSI escape sequences for alternate screen buffer
const ENTER_ALT_SCREEN = "\x1b[?1049h";
const LEAVE_ALT_SCREEN = "\x1b[?1049l";
const HIDE_CURSOR = "\x1b[?25l";
const SHOW_CURSOR = "\x1b[?25h";
const CLEAR_SCREEN = "\x1b[2J";
const MOVE_HOME = "\x1b[H";

// Enter alternate screen buffer (fullscreen mode)
process.stdout.write(ENTER_ALT_SCREEN + HIDE_CURSOR + CLEAR_SCREEN + MOVE_HOME);

// Cleanup function to restore terminal state
function cleanup() {
  process.stdout.write(SHOW_CURSOR + LEAVE_ALT_SCREEN);
}

// Handle various exit scenarios
process.on("exit", cleanup);
process.on("SIGINT", () => {
  cleanup();
  process.exit(0);
});
process.on("SIGTERM", () => {
  cleanup();
  process.exit(0);
});

// Render the app
const { waitUntilExit } = render(<App />);

await waitUntilExit();

// Cleanup on normal exit
cleanup();
