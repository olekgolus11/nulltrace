import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { Model, Provider } from "@opencode-ai/sdk";
import {
  getSelectedOpenCodeModel,
  setSelectedOpenCodeModel,
} from "../src/features/chat/services/opencode-runtime.config";
import { OpenCodeServerService } from "../src/features/chat/services/opencode-server.service";

interface ModelOption {
  provider: Provider;
  model: Model;
}

function createModelOptions(providers: Provider[]) {
  return providers
    .flatMap((provider) => Object.values(provider.models).map((model) => ({ provider, model })))
    .sort((left, right) =>
      `${left.provider.id}/${left.model.id}`.localeCompare(
        `${right.provider.id}/${right.model.id}`,
      ),
    );
}

function formatModel(option: ModelOption) {
  return `${option.provider.id}/${option.model.id} (${option.model.name})`;
}

const server = new OpenCodeServerService();
let options: ModelOption[] = [];

try {
  const response = await server.run("model-selector", "never", (client) =>
    client.config.providers(),
  );
  if (!response.data) {
    throw new Error("OpenCode returned no provider data.");
  }
  options = createModelOptions(response.data.providers);
} catch (error) {
  const detail = error instanceof Error ? error.message : String(error);
  console.error(`Could not load OpenCode models: ${detail}`);
  process.exitCode = 1;
} finally {
  await server.close();
}

if (options.length === 0) {
  if (process.exitCode !== 1) {
    console.error("No OpenCode models are available. Run bun run chat:auth first.");
    process.exitCode = 1;
  }
} else if (!stdin.isTTY) {
  console.error("Model selection requires an interactive terminal.");
  process.exitCode = 1;
} else {
  const current = getSelectedOpenCodeModel();
  if (current) {
    console.log(`Current model: ${current.providerID}/${current.modelID}`);
  }

  const readline = createInterface({ input: stdin, output: stdout });
  try {
    while (true) {
      const query = (await readline.question("Search models, or q to cancel: ")).trim();
      if (query.toLowerCase() === "q") {
        break;
      }

      const normalizedQuery = query.toLowerCase();
      const matches = options.filter((option) =>
        formatModel(option).toLowerCase().includes(normalizedQuery),
      );
      if (matches.length === 0) {
        console.log("No matching models.");
        continue;
      }

      const visibleMatches = matches.slice(0, 30);
      visibleMatches.forEach((option, index) => {
        console.log(`${index + 1}. ${formatModel(option)}`);
      });
      if (matches.length > visibleMatches.length) {
        console.log(
          `${matches.length - visibleMatches.length} more matches. Refine the search to see them.`,
        );
      }

      const answer = (
        await readline.question("Select a number, or press Enter to search again: ")
      ).trim();
      if (!answer) {
        continue;
      }

      const selectedIndex = Number(answer) - 1;
      const selected = visibleMatches[selectedIndex];
      if (!Number.isInteger(selectedIndex) || !selected) {
        console.log("Invalid selection.");
        continue;
      }

      setSelectedOpenCodeModel({
        providerID: selected.provider.id,
        modelID: selected.model.id,
      });
      console.log(`Selected model: ${selected.provider.id}/${selected.model.id}`);
      break;
    }
  } finally {
    readline.close();
  }
}
