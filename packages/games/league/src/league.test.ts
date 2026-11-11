import type { GameContext } from "@caprice/games";
import { expect, test } from "bun:test";

import { leaguePlugin, leagueTools, shellLeagueBridge } from "./league.ts";

const context: GameContext = {
  request: "pick Yasuo",
  signal: new AbortController().signal,
};

test("league tools pass a valid input through", async () => {
  const seen: string[] = [];

  const tools = leagueTools({
    inShell: true,
    async live(path) {
      seen.push(path);

      return "stats";
    },
    async lcu(request) {
      seen.push(request);

      return "phase";
    },
  });

  expect(tools.map((tool) => tool.name)).toEqual(["league_live", "league_lcu"]);
  expect(tools[0]?.kind).toBe("read");
  expect(tools[1]?.kind).toBe("action");
  expect(tools[0]?.description).toContain("/liveclientdata/allgamedata");
  expect(tools[1]?.description).toContain(
    "/lol-matchmaking/v1/ready-check/accept",
  );
  expect(await tools[0]?.parse("")).toEqual({
    ok: true,
    value: "/liveclientdata/allgamedata",
  });
  expect(await tools[0]?.run("/liveclientdata/gamestats", context)).toBe(
    "stats",
  );
  expect(
    await tools[1]?.run("GET /lol-gameflow/v1/gameflow-phase", context),
  ).toBe("phase");
  expect(seen).toEqual([
    "/liveclientdata/gamestats",
    "GET /lol-gameflow/v1/gameflow-phase",
  ]);
});

test("league input is checked before the client is called", () => {
  const tools = leagueTools({
    inShell: true,
    async live() {
      return "no";
    },
    async lcu() {
      return "no";
    },
  });

  expect(tools[0]?.parse("https://evil.example")).toMatchObject({
    ok: false,
  });
  expect(tools[0]?.parse("/other")).toMatchObject({ ok: false });
  expect(
    tools[1]?.parse(
      'patch /lol-champ-select/v1/session/actions/3\n{"championId":157,"completed":true}',
    ),
  ).toEqual({
    ok: true,
    value:
      'PATCH /lol-champ-select/v1/session/actions/3\n{"championId":157,"completed":true}',
  });
  expect(
    tools[1]?.parse("POST /lol-matchmaking/v1/ready-check/accept"),
  ).toEqual({
    ok: true,
    value: "POST /lol-matchmaking/v1/ready-check/accept\n{}",
  });
  expect(tools[1]?.parse("GET /lol-lobby/v2/lobby\n{}")).toMatchObject({
    ok: false,
  });
  expect(tools[1]?.parse("POST /lol-lobby/v2/lobby\nnot-json")).toMatchObject({
    ok: false,
  });
});

test("a live query keeps raw spaces and unicode", () => {
  const tools = leagueTools({
    inShell: true,
    async live() {
      return "stats";
    },
    async lcu() {
      return "phase";
    },
  });

  const spaced = "/liveclientdata/playerscores?riotId=Hide on bush#KR1";
  const named = "/liveclientdata/playerscores?riotId=플레이어#KR1";

  const summoner = "GET /lol-summoner/v1/current-summoner?riotId=플레이어#KR1";

  expect(tools[0]?.parse(spaced)).toEqual({ ok: true, value: spaced });
  expect(tools[0]?.parse(named)).toEqual({ ok: true, value: named });
  expect(tools[1]?.parse(summoner)).toEqual({ ok: true, value: summoner });
});

test("a league transport failure is not a successful result", async () => {
  const seen: string[] = [];

  const tools = leagueTools({
    inShell: true,
    async live(path) {
      seen.push(path);

      throw new Error("live client is not running");
    },
    async lcu() {
      return Promise.reject("league client is not running");
    },
  });

  const spaced = "/liveclientdata/playerscores?riotId=Hide on bush#KR1";

  await expect(tools[0]?.run(spaced, context)).rejects.toThrow(
    "live client is not running",
  );
  await expect(tools[1]?.run("GET /lol-lobby/v2/lobby", context)).rejects.toBe(
    "league client is not running",
  );
  expect(seen).toEqual([spaced]);
});

test("outside the window the league client is unavailable", async () => {
  const tools = leagueTools(
    shellLeagueBridge(
      false,
      async () => "no",
      async () => "no",
    ),
  );

  await expect(
    tools[0]?.run("/liveclientdata/allgamedata", context),
  ).rejects.toThrow("league client is not available in this window");
  await expect(
    tools[1]?.run("GET /lol-summoner/v1/current-summoner", context),
  ).rejects.toThrow("league client is not available in this window");
});

test("league stays unloaded until it is enabled or detected", () => {
  const bridge = shellLeagueBridge(
    true,
    async () => "stats",
    async () => "phase",
  );

  expect(
    leaguePlugin("## Play\nHi.", bridge, {
      enabled: false,
      detected: false,
    }),
  ).toBeUndefined();
});

test("the shell plugin keeps the play text and the lobby follower", () => {
  const bridge = shellLeagueBridge(
    true,
    async () => "stats",
    async () => "phase",
  );

  const plugin = leaguePlugin("## Play\nHi.", bridge, {
    enabled: true,
    detected: false,
  });

  expect(plugin?.id).toBe("league");
  expect(plugin?.instructions).toBe("## Play\nHi.");
  expect(plugin?.tools.map((tool) => tool.name)).toEqual([
    "league_live",
    "league_lcu",
  ]);
  expect(plugin?.follows).toHaveLength(2);
  expect(plugin?.hear).toBeDefined();
});

test("outside the shell the plugin keeps the live follower and skips the lobby", () => {
  const bridge = shellLeagueBridge(
    false,
    async () => "no",
    async () => "no",
  );

  const plugin = leaguePlugin("## Play\nHi.", bridge, {
    enabled: false,
    detected: true,
  });

  expect(plugin?.instructions).toBe("## Play\nHi.");
  expect(plugin?.follows).toHaveLength(1);
  expect(plugin?.hear).toBeUndefined();
});
