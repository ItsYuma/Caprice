import {
  createMCPClient,
  type CallToolResult,
  type MCPClient,
} from "@ai-sdk/mcp";
import { z } from "zod";

import { fail, fromCause, ok, type Result } from "./result.ts";
import type { Tool, ToolKind } from "./tool.ts";

export type McpHeader = {
  name: string;
  value: string;
};

export type McpServer =
  | { transport: "http"; url: string; headers: readonly McpHeader[] }
  | { transport: "sse"; url: string; headers: readonly McpHeader[] }
  | { transport: "stdio"; command: string; args: readonly string[] };

export type McpConnection = {
  tools: readonly Tool[];
  close: () => Promise<void>;
};

const mcpOutput = z.looseObject({
  isError: z.boolean().optional(),
  content: z
    .array(
      z.looseObject({
        type: z.string(),
        text: z.string().optional(),
      }),
    )
    .optional(),
});

const mcpHeader = z.object({
  name: z.string().min(1),
  value: z.string(),
});

const mcpServer = z.discriminatedUnion("transport", [
  z.object({
    transport: z.literal("http"),
    url: z.string().min(1),
    headers: z.array(mcpHeader).optional(),
  }),
  z.object({
    transport: z.literal("sse"),
    url: z.string().min(1),
    headers: z.array(mcpHeader).optional(),
  }),
  z.object({
    transport: z.literal("stdio"),
    command: z.string().min(1),
    args: z.array(z.string()).optional(),
  }),
]);

export function parseMcpServers(raw: string | undefined): McpServer[] {
  const text = raw?.trim() ?? "";

  if (text.length === 0) {
    return [];
  }

  let parsed: ReturnType<typeof JSON.parse>;

  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("CAPRICE_MCP is not valid");
  }

  const servers = z.array(mcpServer).safeParse(parsed);

  if (!servers.success) {
    throw new Error("CAPRICE_MCP is not valid");
  }

  const listed: McpServer[] = [];

  for (const server of servers.data) {
    if (server.transport === "stdio") {
      listed.push({
        transport: "stdio",
        command: server.command,
        args: server.args ?? [],
      });

      continue;
    }

    listed.push({
      transport: server.transport,
      url: server.url,
      headers: headersOf(server.headers),
    });
  }

  return listed;
}

function headersOf(
  headers: readonly { name: string; value: string }[] | undefined,
): readonly McpHeader[] {
  if (headers === undefined) {
    return [];
  }

  const listed: McpHeader[] = [];

  for (const header of headers) {
    listed.push({ name: header.name, value: header.value });
  }

  return listed;
}

export async function connectMcp(
  servers: readonly McpServer[],
): Promise<Result<McpConnection>> {
  const clients: MCPClient[] = [];

  try {
    for (const server of servers) {
      const client = await openClient(server);

      clients.push(client);
    }

    const tools: Tool[] = [];

    for (const client of clients) {
      const listed = await client.tools();

      for (const [name, mcpTool] of Object.entries(listed)) {
        tools.push(adaptTool(name, mcpTool));
      }
    }

    return ok({
      tools,
      close() {
        return closeClients(clients);
      },
    });
  } catch (cause) {
    await closeClients(clients);

    return fromCause(cause, "the mcp server is not available");
  }
}

async function openClient(server: McpServer): Promise<MCPClient> {
  if (server.transport === "stdio") {
    const loaded = await import("@ai-sdk/mcp/mcp-stdio");
    const args: string[] = [];

    for (const arg of server.args) {
      args.push(arg);
    }

    return createMCPClient({
      transport: new loaded.StdioMCPTransport({
        command: server.command,
        args,
      }),
    });
  }

  return createMCPClient({
    transport: {
      type: server.transport,
      url: server.url,
      headers: headerFields(server.headers),
    },
  });
}

type ListedTool = Awaited<ReturnType<MCPClient["tools"]>>[string];

function adaptTool(name: string, mcpTool: ListedTool): Tool {
  const kind: ToolKind = "action";

  return {
    name,
    description: toolText(mcpTool.description, name),
    kind,
    parse(input) {
      const parsed = z.json().safeParse(readJson(input));

      if (!parsed.success) {
        return fail("the tool input is not valid");
      }

      return ok(JSON.stringify(parsed.data));
    },
    async run(input, context) {
      const parsed = z.json().safeParse(JSON.parse(input));

      if (!parsed.success) {
        throw new Error("the tool input is not valid");
      }

      const result = await firstResult(
        mcpTool.execute(parsed.data, {
          toolCallId: name,
          messages: [],
          abortSignal: context.signal,
          context: {},
        }),
      );

      return mcpText(result);
    },
  };
}

function toolText(
  description: ListedTool["description"],
  name: string,
): string {
  const parsed = z.string().safeParse(description);

  if (!parsed.success || parsed.data.length === 0) {
    return name;
  }

  return parsed.data;
}

async function firstResult(
  produced: ReturnType<ListedTool["execute"]>,
): Promise<CallToolResult> {
  const settled = await produced;

  if (!isStream(settled)) {
    return settled;
  }

  for await (const item of settled) {
    return item;
  }

  throw new Error("the tool failed");
}

function isStream(
  value: Awaited<ReturnType<ListedTool["execute"]>>,
): value is AsyncIterable<CallToolResult> {
  return Symbol.asyncIterator in value;
}

function readJson(input: string): ReturnType<typeof JSON.parse> | undefined {
  try {
    return JSON.parse(input);
  } catch {
    return undefined;
  }
}

function mcpText(result: CallToolResult): string {
  const parsed = mcpOutput.safeParse(result);

  if (!parsed.success) {
    return JSON.stringify(result);
  }

  const text = joinText(parsed.data.content);

  if (parsed.data.isError === true) {
    throw new Error(text.length > 0 ? text : "the tool failed");
  }

  if (text.length > 0) {
    return text;
  }

  return JSON.stringify(result);
}

function joinText(
  content: readonly { type: string; text?: string }[] | undefined,
): string {
  if (content === undefined) {
    return "";
  }

  const parts: string[] = [];

  for (const part of content) {
    if (part.type === "text" && part.text !== undefined) {
      parts.push(part.text);
    }
  }

  return parts.join("\n");
}

function headerFields(headers: readonly McpHeader[]) {
  const fields = new Map<string, string>();

  for (const header of headers) {
    fields.set(header.name, header.value);
  }

  return Object.fromEntries(fields);
}

async function closeClients(clients: readonly MCPClient[]): Promise<void> {
  for (const client of clients) {
    await client.close().then(
      () => undefined,
      () => undefined,
    );
  }
}
