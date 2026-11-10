import { expect, test } from "bun:test";

import { playing } from "./playing.ts";

test("the shell lists league tools and its live follower", () => {
  const games = playing(true);
  const league = games.integrations[0];

  expect(league?.instructions.startsWith("## Play")).toBe(true);
  expect(league?.tools.map((tool) => tool.name)).toEqual([
    "league_live",
    "league_lcu",
  ]);
  expect(games.remarks).toHaveLength(2);
  expect(games.lobby).toBeDefined();
});

test("a page outside the shell keeps the tools and skips the follower", () => {
  const games = playing(false);

  expect(games.integrations[0]?.tools.map((tool) => tool.name)).toEqual([
    "league_live",
    "league_lcu",
  ]);
  expect(games.remarks).toEqual([]);
  expect(games.lobby).toBeUndefined();
});
