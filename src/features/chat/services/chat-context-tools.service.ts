import { ChatContextToolSchema } from "../model/chat-context-tool.types";
import { ChatContextToolRegistry } from "./chat-context-tool-registry";
import { findingChatContextToolsService } from "./finding-chat-context-tools.service";

export const chatContextToolRegistry = new ChatContextToolRegistry([
  ...findingChatContextToolsService.createToolDefinitions(),
]);

function toOpenCodeSchemaSource(schema: ChatContextToolSchema) {
  const description = JSON.stringify(schema.description);

  if (schema.type === "string") {
    return `tool.schema.string().describe(${description})`;
  }

  if (schema.type === "number") {
    return `tool.schema.number().describe(${description})`;
  }

  return `tool.schema.boolean().describe(${description})`;
}

function createToolArgsSource(
  args: Record<string, ChatContextToolSchema>,
) {
  const entries = Object.entries(args);
  if (entries.length === 0) {
    return "{}";
  }

  return `{
${entries
  .map(
    ([name, schema]) =>
      `    ${JSON.stringify(name)}: ${toOpenCodeSchemaSource(schema)},`,
  )
  .join("\n")}
  }`;
}

export function createOpenCodeToolSource(
  toolName: string,
  serviceImportPath: string,
  pluginImportPath: string,
) {
  const definition = chatContextToolRegistry
    .listDefinitions()
    .find((candidate) => candidate.name === toolName);
  if (!definition) {
    throw new Error(`Unknown chat context tool: ${toolName}`);
  }

  return `import { tool } from ${JSON.stringify(pluginImportPath)};
import { chatContextToolRegistry } from ${JSON.stringify(serviceImportPath)};

export default tool({
  description: ${JSON.stringify(definition.description)},
  args: ${createToolArgsSource(definition.args)},
  async execute(args, context) {
    const result = await chatContextToolRegistry.execute(
      ${JSON.stringify(definition.name)},
      context.sessionID,
      args,
    );

    return JSON.stringify(result);
  },
});
`;
}
