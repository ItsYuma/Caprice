import { expect, test } from "bun:test";

import { readDetectedIds, readEnabledGames } from "./gameFlags.ts";
import { playing } from "./playing.ts";

const context = {
  request: "stats",
  signal: new AbortController().signal,
};

test("detected league is loaded in the shell", () => {
  const games = playing({
    inShell: true,
    enabled: [],
    detected: ["league"],
  });

  const league = games.integrations[0];

  expect(league?.instructions.startsWith("## Play")).toBe(true);
  expect(league?.tools.map((tool) => tool.name)).toEqual([
    "league_live",
    "league_lcu",
  ]);
  expect(games.integrations).toHaveLength(1);
  expect(games.remarks).toHaveLength(2);
  expect(games.hear).toBeDefined();
});

test("enabled league is loaded in the shell", () => {
  const games = playing({
    inShell: true,
    enabled: ["league"],
    detected: [],
  });

  expect(games.integrations[0]?.tools.map((tool) => tool.name)).toEqual([
    "league_live",
    "league_lcu",
  ]);
  expect(games.remarks).toHaveLength(2);
  expect(games.hear).toBeDefined();
});

test("league stays out until it is detected or enabled", () => {
  const absent = playing({
    inShell: true,
    enabled: [],
    detected: [],
  });

  const other = playing({
    inShell: true,
    enabled: ["other"],
    detected: ["other"],
  });

  expect(absent.integrations).toEqual([]);
  expect(absent.remarks).toEqual([]);
  expect(absent.hear).toBeUndefined();
  expect(other.integrations).toEqual([]);
  expect(other.remarks).toEqual([]);
});

test("outside the shell the bridge rejects", async () => {
  const games = playing({
    inShell: false,
    enabled: ["league"],
    detected: [],
  });

  const tools = games.integrations[0]?.tools;

  expect(games.remarks).toHaveLength(1);
  expect(games.hear).toBeUndefined();
  await expect(
    tools?.[0]?.run("/liveclientdata/allgamedata", context),
  ).rejects.toThrow("league client is not available in this window");
  await expect(
    tools?.[1]?.run("GET /lol-summoner/v1/current-summoner", context),
  ).rejects.toThrow("league client is not available in this window");
});

test("a bad game list enables and detects nothing", () => {
  expect(readDetectedIds("")).toEqual([]);
  expect(readDetectedIds("nope")).toEqual([]);
  expect(readDetectedIds("{}")).toEqual([]);
  expect(readDetectedIds('["league", 1]')).toEqual([]);
  expect(readDetectedIds('["league"]')).toEqual(["league"]);
  expect(readEnabledGames("")).toEqual([]);
  expect(readEnabledGames("[]")).toEqual([]);
  expect(readEnabledGames("{}")).toEqual([]);
  expect(readEnabledGames('{"other":[]}')).toEqual([]);
  expect(readEnabledGames('{"enabledGames":"league"}')).toEqual([]);
  expect(readEnabledGames('{"enabledGames":["league"]}')).toEqual(["league"]);
});
