import {
  chatModel,
  connectMcp,
  contractText,
  modelDeadlineMs,
  openSession,
  personaText,
  type ChatPost,
  type McpServer,
  type ModelEnv,
  type Result,
  type Session,
  type ShellModelPayload,
  type Tool,
  type TranscriptEvent,
} from "@caprice/core";

import { loadModelSource, readMcpServers } from "./endpoint.ts";
import type { Integration } from "./integration.ts";

export type CapriceDeps = {
  voiceSkill: string;
  hostSkill: string;
  env: ModelEnv;
  inShell: boolean;
  readShell: () => Promise<ShellModelPayload>;
  postShell: ChatPost;
  postBrowser: (
    url: string,
    body: string,
    apiKey: string,
    signal: AbortSignal,
    deadlineMs?: number,
  ) => Promise<Result<string>>;
  remembered: readonly TranscriptEvent[];
  integrations: readonly Integration[];
  mcp?: readonly McpServer[];
};

export type CapriceStartup =
  | { status: "ready"; session: Session }
  | { status: "misconfigured"; message: string };

export async function openCaprice(deps: CapriceDeps): Promise<CapriceStartup> {
  try {
    const source = await loadModelSource(deps.env, {
      inShell: deps.inShell,
      readShell: deps.readShell,
    });

    const persona = personaFrom(
      deps.voiceSkill,
      deps.hostSkill,
      deps.integrations,
    );

    const servers = deps.mcp ?? readMcpServers(import.meta.env.CAPRICE_MCP);
    const connected = await connectMcp(servers);

    if (!connected.ok) {
      return { status: "misconfigured", message: connected.error.message };
    }

    const tools = toolsFrom(deps.integrations, connected.value.tools);

    if (source.where === "shell") {
      const deadlineMs = source.config.timeoutMs ?? modelDeadlineMs;

      return ready(
        openSession(
          persona,
          chatModel(
            source.config.model,
            source.config.protocol,
            deps.postShell,
            deadlineMs,
          ),
          tools,
          deps.remembered,
        ),
      );
    }

    const endpoint = source.endpoint;

    return ready(
      openSession(
        persona,
        chatModel(
          endpoint.model,
          endpoint.protocol,
          (body, signal, deadlineMs) =>
            deps.postBrowser(
              endpoint.url,
              body,
              endpoint.apiKey,
              signal,
              deadlineMs,
            ),
        ),
        tools,
        deps.remembered,
      ),
    );
  } catch (caught) {
    if (caught instanceof Error && caught.message.length > 0) {
      return { status: "misconfigured", message: caught.message };
    }

    return { status: "misconfigured", message: "the model is not configured" };
  }
}

function ready(session: Session): CapriceStartup {
  return { status: "ready", session };
}

function personaFrom(
  voiceSkill: string,
  hostSkill: string,
  integrations: readonly Integration[],
): string {
  const parts = [personaText(voiceSkill), contractText(hostSkill)];

  for (const integration of integrations) {
    const instructions = integration.instructions.trim();

    if (instructions.length > 0) {
      parts.push(instructions);
    }
  }

  return parts.join("\n\n");
}

function toolsFrom(
  integrations: readonly Integration[],
  mcpTools: readonly Tool[],
): Tool[] {
  const tools: Tool[] = [];

  for (const integration of integrations) {
    for (const tool of integration.tools) {
      tools.push(tool);
    }
  }

  for (const tool of mcpTools) {
    tools.push(tool);
  }

  return tools;
}
