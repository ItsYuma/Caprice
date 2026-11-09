import { expect, test } from "bun:test";

import { leagueTools, shellLeagueBridge } from "./league.ts";

test("league tools pass the input through", async () => {
  const seen: string[] = [];

  const tools = leagueTools({
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
  expect(await tools[0]?.run("/liveclientdata/gamestats")).toBe("stats");
  expect(await tools[1]?.run("GET /lol-gameflow/v1/gameflow-phase")).toBe(
    "phase",
  );
  expect(seen).toEqual([
    "/liveclientdata/gamestats",
    "GET /lol-gameflow/v1/gameflow-phase",
  ]);
});

test("a failed league call is text the model can answer from", async () => {
  const tools = leagueTools({
    async live() {
      throw new Error("live client is not running");
    },
    async lcu() {
      throw "league client is not running";
    },
  });

  expect(await tools[0]?.run("")).toBe("live client is not running");
  expect(await tools[1]?.run("GET /lol-lobby/v2/lobby")).toBe(
    "league client is not running",
  );
});

test("outside the window the league client is unavailable", async () => {
  const tools = leagueTools(
    shellLeagueBridge(
      false,
      async () => "no",
      async () => "no",
    ),
  );

  expect(await tools[0]?.run("/liveclientdata/allgamedata")).toBe(
    "league client is not available in this window",
  );
  expect(await tools[1]?.run("GET /lol-summoner/v1/current-summoner")).toBe(
    "league client is not available in this window",
  );
});
