import { createOpencode } from "@opencode-ai/sdk";

interface PromptModel {
  providerID: string;
  modelID: string;
}

function readNumberEnv(name: string, fallback: number) {
  const rawValue = process.env[name];
  if (!rawValue) {
    return fallback;
  }

  const parsedValue = Number(rawValue);
  return Number.isFinite(parsedValue) ? parsedValue : fallback;
}

function readPromptModel(): PromptModel | undefined {
  const providerID = process.env.OPENCODE_PROVIDER_ID;
  const modelID = process.env.OPENCODE_MODEL_ID;

  if (!providerID || !modelID) {
    return undefined;
  }

  return {
    providerID,
    modelID,
  };
}

function createPromptBody(text: string) {
  const model = readPromptModel();

  return {
    ...(model ? { model } : {}),
    parts: [
      {
        type: "text" as const,
        text,
      },
    ],
  };
}

function requireData<T>(value: T | undefined, label: string): T {
  if (value === undefined) {
    throw new Error(`${label} did not return data`);
  }

  return value;
}

async function sendPrompt(
  client: Awaited<ReturnType<typeof createOpencode>>["client"],
  sessionId: string,
  text: string,
) {
  const result = await client.session.prompt({
    path: {
      id: sessionId,
    },
    body: createPromptBody(text),
  });

  return result.data;
}

async function listMessageCount(
  client: Awaited<ReturnType<typeof createOpencode>>["client"],
  sessionId: string,
) {
  const messages = await client.session.messages({
    path: {
      id: sessionId,
    },
  });

  return requireData(messages.data, "session.messages").length;
}

async function getSessionTitle(
  client: Awaited<ReturnType<typeof createOpencode>>["client"],
  sessionId: string,
) {
  const session = await client.session.get({
    path: {
      id: sessionId,
    },
  });

  return requireData(session.data, "session.get").title;
}

async function main() {
  const hostname = process.env.OPENCODE_HOSTNAME ?? "127.0.0.1";
  const port = readNumberEnv("OPENCODE_PORT", 4096);
  const timeout = readNumberEnv("OPENCODE_TIMEOUT_MS", 10000);
  const title = `NullTrace OpenCode SDK smoke ${new Date().toISOString()}`;
  const shouldCheckEvents = process.argv.includes("--events");
  const shouldCreateWithoutTitle = process.argv.includes("--no-title");

  console.log("Starting OpenCode SDK smoke check...");
  console.log(`Server target: ${hostname}:${port}`);

  const firstRuntime = await createOpencode({
    hostname,
    port,
    timeout,
  });

  const pathInfo = await firstRuntime.client.path.get();
  const pathData = requireData(pathInfo.data, "path.get");
  console.log(`Server directory: ${pathData.directory}`);
  console.log(`Server worktree: ${pathData.worktree}`);

  const session = await firstRuntime.client.session.create(
    shouldCreateWithoutTitle
      ? undefined
      : {
          body: {
            title,
          },
        },
  );
  const createdSession = requireData(session.data, "session.create");
  const sessionId = createdSession.id;
  console.log(`Created session: ${sessionId}`);
  console.log(`Created title: ${createdSession.title}`);

  await sendPrompt(
    firstRuntime.client,
    sessionId,
    "Reply with one short sentence confirming this is the first NullTrace SDK smoke prompt.",
  );
  console.log(
    `Messages after first prompt: ${await listMessageCount(firstRuntime.client, sessionId)}`,
  );
  console.log(`Title after first prompt: ${await getSessionTitle(firstRuntime.client, sessionId)}`);

  firstRuntime.server.close();
  console.log("Closed first OpenCode server.");

  const secondRuntime = await createOpencode({
    hostname,
    port,
    timeout,
  });

  const reopenedSession = await secondRuntime.client.session.get({
    path: {
      id: sessionId,
    },
  });
  console.log(`Reopened session: ${requireData(reopenedSession.data, "session.get").id}`);

  const seenEvents: string[] = [];
  const seenTitles: string[] = [];
  const eventTask = shouldCheckEvents
    ? (async () => {
        const events = await secondRuntime.client.event.subscribe();

        for await (const event of events.stream) {
          seenEvents.push(event.type);

          if (
            event.type === "session.updated" &&
            "info" in event.properties &&
            typeof event.properties.info.title === "string"
          ) {
            seenTitles.push(event.properties.info.title);
          }

          if (seenEvents.length >= 8) {
            break;
          }
        }
      })()
    : null;

  await sendPrompt(
    secondRuntime.client,
    sessionId,
    "Reply with one short sentence confirming this is the second prompt after reopening the session.",
  );
  console.log(
    `Messages after reopened prompt: ${await listMessageCount(secondRuntime.client, sessionId)}`,
  );

  secondRuntime.server.close();
  console.log("Closed second OpenCode server.");

  if (eventTask) {
    await Promise.race([eventTask, new Promise((resolve) => setTimeout(resolve, 1000))]);
    console.log(`Observed event types: ${seenEvents.join(", ") || "none"}`);
    console.log(`Observed titles: ${seenTitles.join(" | ") || "none"}`);
  }

  console.log("OpenCode SDK smoke check completed.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
