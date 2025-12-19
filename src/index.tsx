#!/usr/bin/env bun
import { render } from "ink";
import { App } from "./App.tsx";

// Clear the terminal and render the app
console.clear();

const { waitUntilExit } = render(<App />);

await waitUntilExit();
