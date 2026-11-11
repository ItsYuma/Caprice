import { playText, type Tool } from "@caprice/core";
import type { GamePlugin, GameTool } from "@caprice/games";
import { leaguePlugin, shellLeagueBridge } from "@caprice/league";
import { invoke } from "@tauri-apps/api/core";
import leagueSkill from "../../../skills/league/SKILL.md?raw";

import type { Integration } from "./integration.ts";
import type { RemarkFollow } from "./matchRemarks.ts";

export type Playing = {
  integrations: readonly Integration[];
  remarks: readonly RemarkFollow[];
  hear: GamePlugin["hear"];
};

export function playing(input: {
  inShell: boolean;
  enabled: readonly string[];
  detected: readonly string[];
}): Playing {
  const enabled = includesLeague(input.enabled);
  const detected = includesLeague(input.detected);

  if (!enabled && !detected) {
    return emptyPlaying();
  }

  const bridge = shellLeagueBridge(
    input.inShell,
    (path) => invoke<string>("league_live", { path }),
    (request) => invoke<string>("league_lcu", { request }),
  );

  const plugin = leaguePlugin(playText(leagueSkill), bridge, {
    enabled,
    detected,
  });

  if (plugin === undefined) {
    return emptyPlaying();
  }

  return {
    integrations: [integrationFrom(plugin)],
    remarks: plugin.follows,
    hear: plugin.hear,
  };
}

function includesLeague(ids: readonly string[]): boolean {
  return ids.includes("league");
}

function emptyPlaying(): Playing {
  return {
    integrations: [],
    remarks: [],
    hear: undefined,
  };
}

function integrationFrom(plugin: GamePlugin): Integration {
  return {
    instructions: plugin.instructions,
    tools: toolsFrom(plugin.tools),
  };
}

function toolsFrom(tools: readonly GameTool[]): Tool[] {
  const adapted: Tool[] = [];

  for (const tool of tools) {
    adapted.push({
      name: tool.name,
      description: tool.description,
      kind: tool.kind,
      parse(input) {
        return tool.parse(input);
      },
      async run(input, context) {
        return tool.run(input, context);
      },
    });
  }

  return adapted;
}
