import { invoke } from "@tauri-apps/api/core";
import leagueSkill from "../../../skills/league/SKILL.md?raw";

import type { Integration } from "./integration.ts";
import { leagueIntegration, shellLeagueBridge } from "./league/league.ts";
import { followLeague, liveMatchPath } from "./league/watchLeague.ts";
import type { RemarkFollow } from "./matchRemarks.ts";

export type Playing = {
  integrations: readonly Integration[];
  remarks: readonly RemarkFollow[];
};

export function playing(inShell: boolean): Playing {
  const bridge = shellLeagueBridge(
    inShell,
    (path) => invoke<string>("league_live", { path }),
    (request) => invoke<string>("league_lcu", { request }),
  );

  return {
    integrations: [leagueIntegration(leagueSkill, bridge)],
    remarks: inShell
      ? [
          followLeague(() =>
            invoke<string>("league_live", { path: liveMatchPath }),
          ),
        ]
      : [],
  };
}
