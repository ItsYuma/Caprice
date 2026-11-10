import { expect, test } from "bun:test";

import type { LiveMatch, LivePlayer } from "./liveMatch.ts";
import { remarkCue, remarkFallback } from "./matchLine.ts";
import type { Remark } from "./matchWatch.ts";

test("the cue is the fact, and the fallback is a short line", () => {
  const cue = remarkCue(sample(), {
    kind: "death",
    killer: "Draven",
    role: "bottom",
    cause: "champion",
    gank: "Lee Sin",
    streak: 4,
  });

  expect(cue.startsWith("Live match.")).toBe(true);
  expect(cue).toContain("Mock the host");
  expect(cue).toContain("Do not call a tool.");
  expect(cue).toContain("Do not read it back.");
  expect(cue).toContain(
    "Minute 8. You are Ahri, mid, level 7, 2/1/0, 50 cs, 900 gold in items.",
  );
  expect(cue).toContain(
    "Event: You died to Draven, the enemy bottom. The enemy jungler Lee Sin was there. Your Rampage ended.",
  );
  expect(
    remarkFallback({
      kind: "death",
      killer: "Draven",
      role: "bottom",
      cause: "champion",
      gank: "Lee Sin",
      streak: 4,
    }),
  ).toBe("There goes the streak.");
  expect(
    remarkFallback({
      kind: "death",
      killer: "Draven",
      role: "bottom",
      cause: "champion",
      gank: "Lee Sin",
      streak: 0,
    }),
  ).toBe("Lee Sin walked in. You stayed.");
});

test("fallbacks stay plain", () => {
  const remarks: Remark[] = [
    { kind: "started", champion: "Jinx" },
    { kind: "ended", win: false },
    {
      kind: "kill",
      victim: "Garen",
      role: "top",
      side: "enemy",
      streak: 0,
      firstBlood: true,
    },
    { kind: "multikill", count: 3, victim: "Garen", streak: 0 },
    { kind: "objective", name: "Baron", ally: false, stolen: true },
    {
      kind: "player",
      key: "carrying:garen",
      champion: "Garen",
      ally: false,
      role: "top",
      kills: 6,
      deaths: 0,
      tone: "carrying",
    },
  ];

  for (const remark of remarks) {
    expect(remarkFallback(remark).includes("[")).toBe(false);
    expect(remarkCue(sample(), remark).includes("[")).toBe(false);
  }

  expect(
    remarkCue(sample(), {
      kind: "objective",
      name: "Baron",
      ally: false,
      stolen: true,
    }),
  ).toContain("Event: The enemy stole Baron.");
});

function sample(): LiveMatch {
  const self: LivePlayer = {
    champion: "Ahri",
    summoner: "Ada",
    riotId: "Ada#NA1",
    raw: "Ahri",
    team: "ORDER",
    position: "MIDDLE",
    level: 7,
    kills: 2,
    deaths: 1,
    assists: 0,
    cs: 50,
    itemGold: 900,
    smite: false,
    keystone: -1,
  };

  return {
    gameTime: 8 * 60 + 12,
    gameMode: "CLASSIC",
    mapNumber: 11,
    you: self,
    allies: [],
    enemies: [],
    events: [],
  };
}
