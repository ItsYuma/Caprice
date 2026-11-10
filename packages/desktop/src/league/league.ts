import {
  fail,
  ok,
  playText,
  type Result,
  type Tool,
  type ToolContext,
} from "@caprice/core";

import type { Integration } from "../integration.ts";

export type LeagueBridge = {
  live: (path: string) => Promise<string>;
  lcu: (request: string) => Promise<string>;
};

const unavailable = "league client is not available in this window";

const liveDescription = [
  "Read Riot's Live Client Data API at 127.0.0.1:2999.",
  "The input is one path starting with /liveclientdata/.",
  "An empty input is /liveclientdata/allgamedata.",
  "A # in a riot id can stay as #.",
  "Paths: /liveclientdata/allgamedata, /liveclientdata/activeplayer, /liveclientdata/activeplayername, /liveclientdata/activeplayerabilities, /liveclientdata/activeplayerrunes, /liveclientdata/playerlist, /liveclientdata/playerscores?riotId=, /liveclientdata/playersummonerspells?riotId=, /liveclientdata/playermainrunes?riotId=, /liveclientdata/playeritems?riotId=, /liveclientdata/eventdata, /liveclientdata/gamestats.",
].join(" ");

const lcuDescription = [
  "Read and change the running League client.",
  "GET reads. POST, PUT, PATCH, and DELETE change the client.",
  "The input's first line is a method and a path.",
  "A JSON body may follow.",
  "POST, PUT, and PATCH send {} when the body is empty.",
  "Any path on that client is allowed.",
  'Routes: GET /lol-gameflow/v1/gameflow-phase, GET /lol-summoner/v1/current-summoner, GET /lol-lobby/v2/lobby, POST /lol-lobby/v2/lobby/matchmaking/search, DELETE /lol-lobby/v2/lobby/matchmaking/search, GET /lol-matchmaking/v1/ready-check, POST /lol-matchmaking/v1/ready-check/accept, POST /lol-matchmaking/v1/ready-check/decline, GET /lol-champ-select/v1/session, GET /lol-champ-select/v1/pickable-champion-ids, GET /lol-game-data/assets/v1/champion-summary.json, PATCH /lol-champ-select/v1/session/actions/<id> with {"championId":<number>,"completed":true}, POST /lol-champ-select/v1/session/actions/<id>/complete.',
].join(" ");

export function shellLeagueBridge(
  inShell: boolean,
  live: (path: string) => Promise<string>,
  lcu: (request: string) => Promise<string>,
): LeagueBridge {
  if (!inShell) {
    return {
      async live() {
        throw new Error(unavailable);
      },
      async lcu() {
        throw new Error(unavailable);
      },
    };
  }

  return { live, lcu };
}

export function leagueIntegration(
  skill: string,
  bridge: LeagueBridge,
): Integration {
  return {
    instructions: playText(skill),
    tools: leagueTools(bridge),
  };
}

export function leagueTools(bridge: LeagueBridge): Tool[] {
  return [
    {
      name: "league_live",
      description: liveDescription,
      kind: "read",
      parse: parseLive,
      async run(input, context) {
        throwIfCancelled(context);

        return bridge.live(input);
      },
    },
    {
      name: "league_lcu",
      description: lcuDescription,
      kind: "action",
      parse: parseLcu,
      async run(input, context) {
        throwIfCancelled(context);

        return bridge.lcu(input);
      },
    },
  ];
}

function throwIfCancelled(context: ToolContext): void {
  if (context.signal.aborted) {
    throw new Error("cancelled");
  }
}

function parseLive(input: string): Result<string> {
  const text = input.trim();

  if (text.includes("\n") || text.includes("\r")) {
    return fail("live client input is one path");
  }

  const path = localPath(
    text.length === 0 ? "/liveclientdata/allgamedata" : text,
  );

  if (!path.ok) {
    return path;
  }

  if (!path.value.startsWith("/liveclientdata/")) {
    return fail("live client path must start with /liveclientdata/");
  }

  return path;
}

function parseLcu(input: string): Result<string> {
  const lines = splitLines(input.trim());
  const words = splitWords(lines[0]?.trim() ?? "");

  if (words.length !== 2) {
    return fail("league client input is a method and a path");
  }

  const method = words[0]?.toUpperCase() ?? "";
  const rawPath = words[1] ?? "";

  if (!isMethod(method)) {
    return fail("league client method is not allowed");
  }

  const path = localPath(rawPath);

  if (!path.ok) {
    return path;
  }

  const body = lines.slice(1).join("\n").trim();

  if (method === "GET" && body.length > 0) {
    return fail("GET takes no body");
  }

  if (body.length === 0) {
    if (method === "POST" || method === "PUT" || method === "PATCH") {
      return ok(`${method} ${path.value}\n{}`);
    }

    return ok(`${method} ${path.value}`);
  }

  if (!isJson(body)) {
    return fail("league client body is not json");
  }

  return ok(`${method} ${path.value}\n${body}`);
}

function localPath(path: string): Result<string> {
  if (!path.startsWith("/") || path.startsWith("//")) {
    return fail("league path must start with /");
  }

  return ok(path);
}

function isMethod(method: string): boolean {
  return (
    method === "GET" ||
    method === "POST" ||
    method === "PUT" ||
    method === "PATCH" ||
    method === "DELETE"
  );
}

function isJson(body: string): boolean {
  try {
    JSON.parse(body);

    return true;
  } catch {
    return false;
  }
}

function splitLines(text: string): string[] {
  return text.replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n");
}

function splitWords(line: string): string[] {
  const words: string[] = [];
  let current = "";

  for (const char of line) {
    if (char === " " || char === "\t") {
      if (current.length > 0) {
        words.push(current);
        current = "";
      }

      continue;
    }

    current += char;
  }

  if (current.length > 0) {
    words.push(current);
  }

  return words;
}
