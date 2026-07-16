import { resolve } from "node:path";
import { OpenCodeServerService } from "../src/features/chat/services/opencode-server.service";
import { getSessionChatWorkspace } from "../src/features/chat/services/opencode-runtime.config";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

const firstSessionId = `smoke-a-${crypto.randomUUID()}`;
const secondSessionId = `smoke-b-${crypto.randomUUID()}`;
const firstWorkspace = getSessionChatWorkspace(firstSessionId);
const secondWorkspace = getSessionChatWorkspace(secondSessionId);
const repositoryRoot = resolve(import.meta.dir, "..");

assert(firstWorkspace !== secondWorkspace, "Session workspaces must differ.");
assert(
  !firstWorkspace.startsWith(`${repositoryRoot}/`),
  "Session workspace must not be inside the NullTrace repository.",
);

const firstServer = new OpenCodeServerService();
let conversationId = "";

try {
  await firstServer.run(firstSessionId, "never", async (client) => {
    const path = await client.path.get();
    assert(
      path.data?.directory === firstWorkspace,
      "OpenCode resolved the wrong first session workspace.",
    );

    const config = await client.config.get();
    const serializedConfig = JSON.stringify(config.data);
    assert(serializedConfig.includes('"bash":"deny"'), "Shell permission is not denied.");
    assert(serializedConfig.includes('"webfetch":"allow"'), "Web access is not enabled.");

    const conversation = await client.session.create();
    assert(conversation.data?.id, "Could not create a smoke conversation.");
    conversationId = conversation.data.id;
  });

  await firstServer.run(secondSessionId, "never", async (client) => {
    const path = await client.path.get();
    assert(
      path.data?.directory === secondWorkspace,
      "OpenCode resolved the wrong second session workspace.",
    );
  });
} finally {
  await firstServer.close();
}

const restartedServer = new OpenCodeServerService();
try {
  await restartedServer.run(firstSessionId, "never", async (client) => {
    const conversation = await client.session.get({
      path: { id: conversationId },
    });
    assert(
      conversation.data?.id === conversationId,
      "Conversation did not reopen after server restart.",
    );
  });
} finally {
  await restartedServer.close();
}

console.log("OpenCode chat runtime smoke check passed.");
