export type ChatContextToolSchema =
  | {
      type: "string";
      description: string;
    }
  | {
      type: "number";
      description: string;
    }
  | {
      type: "boolean";
      description: string;
    };

export type ChatContextToolArgs = Record<string, unknown>;

export interface ChatContextToolExecution<TArgs extends ChatContextToolArgs> {
  opencodeConversationId: string;
  args: TArgs;
}

export interface ChatContextToolDefinition<
  TArgs extends ChatContextToolArgs,
  TResult,
> {
  name: string;
  description: string;
  args: Record<keyof TArgs & string, ChatContextToolSchema>;
  execute: (
    input: ChatContextToolExecution<TArgs>,
  ) => TResult | Promise<TResult>;
}
