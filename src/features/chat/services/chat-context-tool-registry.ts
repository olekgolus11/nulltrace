import {
  ChatContextToolArgs,
  ChatContextToolDefinition,
} from "../model/chat-context-tool.types";

export class ChatContextToolRegistry {
  private readonly definitions = new Map<
    string,
    ChatContextToolDefinition<ChatContextToolArgs, unknown>
  >();

  constructor(
    definitions: ChatContextToolDefinition<ChatContextToolArgs, unknown>[] = [],
  ) {
    definitions.forEach((definition) => {
      this.register(definition);
    });
  }

  register<TArgs extends ChatContextToolArgs, TResult>(
    definition: ChatContextToolDefinition<TArgs, TResult>,
  ) {
    this.definitions.set(
      definition.name,
      definition as ChatContextToolDefinition<ChatContextToolArgs, unknown>,
    );
  }

  listDefinitions() {
    return [...this.definitions.values()];
  }

  async execute(
    name: string,
    opencodeConversationId: string,
    args: ChatContextToolArgs,
  ) {
    const definition = this.definitions.get(name);
    if (!definition) {
      throw new Error(`Unknown chat context tool: ${name}`);
    }

    return definition.execute({
      opencodeConversationId,
      args,
    });
  }
}
