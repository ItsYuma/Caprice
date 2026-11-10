import { invoke } from "@tauri-apps/api/core";
import leagueSkill from "../../../skills/league/SKILL.md?raw";

import type { Integration } from "./integration.ts";
import { leagueIntegration, shellLeagueBridge } from "./league/league.ts";
import { openLobby, type LobbyDesk } from "./league/lobbyDesk.ts";
import { followLeague, liveMatchPath } from "./league/watchLeague.ts";
import type { RemarkFollow } from "./matchRemarks.ts";

export type Playing = {
  integrations: readonly Integration[];
  remarks: readonly RemarkFollow[];
  lobby: LobbyDesk | undefined;
};

export function playing(inShell: boolean): Playing {
  const bridge = shellLeagueBridge(
    inShell,
    (path) => invoke<string>("league_live", { path }),
    (request) => invoke<string>("league_lcu", { request }),
  );

  if (!inShell) {
    return {
      integrations: [leagueIntegration(leagueSkill, bridge)],
      remarks: [],
      lobby: undefined,
    };
  }

  const lobby = openLobby((request) => bridge.lcu(request));

  return {
    integrations: [leagueIntegration(leagueSkill, bridge)],
    remarks: [
      followLeague(() =>
        invoke<string>("league_live", { path: liveMatchPath }),
      ),
      lobby.follow,
    ],
    lobby,
  };
}
