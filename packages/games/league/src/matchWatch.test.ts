import { expect, test } from "bun:test";

import type { LiveEvent, LiveMatch, LivePlayer } from "./liveMatch.ts";
import { freshWatch, markNoted, stepWatch, type Watch } from "./matchWatch.ts";

test("an early match starts, and a late one does not replay", () => {
  const started = stepWatch(
    freshWatch(),
    rift(you(), [event(0, "GameStart")], 8),
  );

  expect(started.remark).toEqual({ kind: "started", champion: "Ahri" });
  expect(started.watch.inMatch).toBe(true);

  const late = stepWatch(
    freshWatch(),
    rift(
      you({ kills: 4 }),
      [event(0, "GameStart"), kill(4, "Ada", "Draven")],
      200,
      [enemy({ champion: "Draven", summoner: "Draven", deaths: 8, kills: 1 })],
    ),
  );

  expect(late.remark).toBeUndefined();
  expect(late.watch.lastEventId).toBe(4);
  expect(late.watch.noted).toContain("feeding:draven");
  expect(late.watch.killsAtDeath).toBe(4);

  const again = stepWatch(
    late.watch,
    rift(you({ kills: 4 }), [kill(4, "Ada", "Draven")], 210),
  );

  expect(again.remark).toBeUndefined();
});

test("rift objectives wait until they can exist", () => {
  const early = stepWatch(
    freshWatch(),
    rift(you(), [dragon(1, "Ada", 10), grub(2, "Ada", 300)], 40),
  );

  expect(early.remark).toBeUndefined();
  expect(early.watch.lastEventId).toBe(2);

  const dragonOk = stepWatch(
    early.watch,
    rift(
      you(),
      [dragon(1, "Ada", 10), grub(2, "Ada", 300), dragon(3, "Ada", 310)],
      320,
    ),
  );

  expect(dragonOk.remark).toMatchObject({
    kind: "objective",
    name: "the infernal dragon",
    ally: true,
  });

  const grubOk = stepWatch(arm(), rift(you(), [grub(1, "Ada", 480)], 500));

  expect(grubOk.remark).toMatchObject({
    kind: "objective",
    name: "the voidgrubs",
  });

  const herald = stepWatch(
    arm(),
    rift(you(), [named(1, "HeraldKill", "Ada", 800)], 820),
  );

  expect(herald.remark).toBeUndefined();

  const baron = stepWatch(
    arm(),
    rift(you(), [named(1, "BaronKill", "Ada", 720)], 800),
  );

  expect(baron.remark).toBeUndefined();

  const swift = stepWatch(
    arm(),
    rift(you(), [named(1, "BaronKill", "Ada", 720)], 800, [], "SWIFTPLAY"),
  );

  expect(swift.remark).toMatchObject({
    kind: "objective",
    name: "Baron",
    ally: true,
  });

  const aram = stepWatch(
    arm(),
    rift(you(), [dragon(1, "Ada", 10)], 20, [], "CLASSIC", 12),
  );

  expect(aram.remark).toMatchObject({ kind: "objective" });
});

test("an objective with no killer is skipped, and a steal stays theirs", () => {
  const missing = stepWatch(arm(), rift(you(), [dragon(1, "", 320)], 340));

  expect(missing.remark).toBeUndefined();

  const stolen = stepWatch(
    arm(),
    rift(you(), [{ ...dragon(1, "Jungler", 320), stolen: true }], 340, [
      enemy({ champion: "Lee Sin", summoner: "Jungler", position: "JUNGLE" }),
    ]),
  );

  expect(stolen.remark).toMatchObject({
    kind: "objective",
    ally: false,
    stolen: true,
    name: "the infernal dragon",
  });
});

test("one poll keeps the sharpest fact", () => {
  const both = stepWatch(
    freshWatch(),
    rift(
      you(),
      [
        event(0, "GameStart"),
        kill(1, "Ada", "Draven"),
        {
          ...event(2, "Multikill"),
          killer: "Ada",
          count: 2,
        },
        event(3, "FirstBlood", { recipient: "Ada" }),
      ],
      40,
      [enemy({ champion: "Draven", summoner: "Draven", position: "BOTTOM" })],
    ),
  );

  expect(both.remark).toMatchObject({
    kind: "multikill",
    count: 2,
    victim: "Draven",
  });
});

test("a death names the killer and a jungler who only assisted", () => {
  const foes = [
    enemy({ champion: "Ahri", summoner: "Mid", position: "MIDDLE" }),
    enemy({
      champion: "Lee Sin",
      summoner: "Jungler",
      position: "JUNGLE",
      smite: true,
    }),
  ];

  const died = stepWatch(
    freshWatch(),
    rift(
      you(),
      [
        {
          ...event(1, "ChampionKill"),
          killer: "Mid",
          victim: "Ada",
          assisters: ["Jungler"],
        },
      ],
      50,
      foes,
    ),
  );

  expect(died.remark).toMatchObject({
    kind: "death",
    killer: "Ahri",
    role: "mid",
    gank: "Lee Sin",
    cause: "champion",
  });

  const byJungler = stepWatch(
    freshWatch(),
    rift(
      you(),
      [{ ...event(1, "ChampionKill"), killer: "Jungler", victim: "Ada" }],
      50,
      foes,
    ),
  );

  expect(byJungler.remark).toMatchObject({
    kind: "death",
    killer: "Lee Sin",
    role: "jungle",
    gank: "",
  });

  const turret = stepWatch(
    freshWatch(),
    rift(
      you(),
      [
        {
          ...event(1, "ChampionKill"),
          killer: "Turret_T2_C_03_A",
          victim: "Ada",
        },
      ],
      50,
    ),
  );

  expect(turret.remark).toMatchObject({
    kind: "death",
    cause: "turret",
    gank: "",
  });
});

test("a streak is counted forward, then shut down", () => {
  let watch = stepWatch(freshWatch(), rift(you(), [], 5)).watch;
  watch = killStep(watch, 1, 20).watch;
  watch = killStep(watch, 2, 30).watch;
  const third = killStep(watch, 3, 40);

  expect(third.remark).toMatchObject({
    kind: "kill",
    streak: 3,
    victim: "Draven",
  });

  const down = stepWatch(
    third.watch,
    rift(
      you({ kills: 3, deaths: 1 }),
      [{ ...event(4, "ChampionKill"), killer: "Draven", victim: "Ada" }],
      55,
      [enemy()],
    ),
  );

  expect(down.remark).toMatchObject({
    kind: "death",
    streak: 3,
    killer: "Draven",
  });
  expect(down.watch.announcedStreak).toBe(0);
  expect(down.watch.killsAtDeath).toBe(3);
});

test("a score change waits one poll for the event name", () => {
  const armed = stepWatch(freshWatch(), rift(you(), [], 5));
  const pending = stepWatch(armed.watch, rift(you({ deaths: 1 }), [], 12));

  expect(pending.remark).toBeUndefined();
  expect(pending.watch.pendingDeath).toBe(true);

  const named = stepWatch(
    pending.watch,
    rift(
      you({ deaths: 1 }),
      [{ ...event(1, "ChampionKill"), killer: "Draven", victim: "Ada" }],
      14,
      [enemy()],
    ),
  );

  expect(named.remark).toMatchObject({ kind: "death", killer: "Draven" });

  const quiet = stepWatch(pending.watch, rift(you({ deaths: 1 }), [], 16));

  expect(quiet.remark).toMatchObject({ kind: "death", cause: "unknown" });
});

test("a new game replaces the old one, and the result is not repeated", () => {
  const going = stepWatch(
    freshWatch(),
    rift(you(), [event(0, "GameStart")], 400),
  );

  const ended = stepWatch(
    going.watch,
    rift(
      you(),
      [event(0, "GameStart"), event(8, "GameEnd", { result: "Win" })],
      1800,
    ),
  );

  expect(ended.remark).toEqual({ kind: "ended", win: true });
  expect(ended.watch.inMatch).toBe(false);

  const scoreboard = stepWatch(
    ended.watch,
    rift(
      you(),
      [event(0, "GameStart"), event(8, "GameEnd", { result: "Win" })],
      1802,
    ),
  );

  expect(scoreboard.remark).toBeUndefined();
  expect(scoreboard.watch.inMatch).toBe(false);

  const next = stepWatch(
    scoreboard.watch,
    rift(you({ champion: "Jinx" }), [event(0, "GameStart")], 4),
  );

  expect(next.remark).toEqual({ kind: "started", champion: "Jinx" });
});

test("an event from the future is ignored", () => {
  const step = stepWatch(
    freshWatch(),
    rift(
      you(),
      [event(1, "ChampionKill", { killer: "Ada", victim: "Draven", time: 80 })],
      10,
    ),
  );

  expect(step.remark).toBeUndefined();
  expect(step.watch.lastEventId).toBe(1);
});

test("someone fed is said once, after they have had time to do it", () => {
  const early = stepWatch(
    freshWatch(),
    rift(you(), [], 40, [enemy({ deaths: 6, kills: 0 })]),
  );

  expect(early.remark).toBeUndefined();

  const noted = stepWatch(
    early.watch,
    rift(you(), [], 140, [enemy({ deaths: 6, kills: 0 })]),
  );

  expect(noted.remark).toMatchObject({
    kind: "player",
    champion: "Draven",
    tone: "feeding",
    ally: false,
  });
  expect(noted.watch.noted).toEqual([]);

  const marked = markNoted(
    noted.watch,
    noted.remark?.kind === "player" ? noted.remark.key : "",
  );

  const again = stepWatch(
    marked,
    rift(you(), [], 150, [enemy({ deaths: 7, kills: 0 })]),
  );

  expect(again.remark).toBeUndefined();
});

function arm(): Watch {
  return stepWatch(freshWatch(), rift(you(), [], 5)).watch;
}

function killStep(watch: Watch, kills: number, time: number) {
  return stepWatch(
    watch,
    rift(you({ kills }), [kill(kills, "Ada", "Draven")], time, [enemy()]),
  );
}

function rift(
  self: LivePlayer,
  events: LiveEvent[],
  gameTime: number,
  enemies: LivePlayer[] = [],
  gameMode = "CLASSIC",
  mapNumber = 11,
): LiveMatch {
  return {
    gameTime,
    gameMode,
    mapNumber,
    you: self,
    allies: [],
    enemies,
    events,
  };
}

function you(patch: Partial<LivePlayer> = {}): LivePlayer {
  return player({
    champion: "Ahri",
    summoner: "Ada",
    riotId: "Ada#NA1",
    team: "ORDER",
    position: "MIDDLE",
    ...patch,
  });
}

function enemy(patch: Partial<LivePlayer> = {}): LivePlayer {
  return player({
    champion: "Draven",
    summoner: "Draven",
    team: "CHAOS",
    position: "BOTTOM",
    ...patch,
  });
}

function player(patch: Partial<LivePlayer>): LivePlayer {
  return {
    champion: "",
    summoner: "",
    riotId: "",
    raw: "",
    team: "",
    position: "",
    level: 1,
    kills: 0,
    deaths: 0,
    assists: 0,
    cs: 0,
    itemGold: 0,
    smite: false,
    keystone: -1,
    ...patch,
  };
}

function event(
  id: number,
  name: string,
  patch: Partial<LiveEvent> = {},
): LiveEvent {
  return {
    id,
    name,
    time: 1,
    killer: "",
    victim: "",
    recipient: "",
    assisters: [],
    count: 0,
    dragon: "",
    stolen: false,
    result: "",
    ...patch,
  };
}

function kill(id: number, killer: string, victim: string): LiveEvent {
  return event(id, "ChampionKill", { killer, victim, time: id });
}

function dragon(id: number, killer: string, time: number): LiveEvent {
  return event(id, "DragonKill", { killer, time, dragon: "Fire" });
}

function grub(id: number, killer: string, time: number): LiveEvent {
  return event(id, "HordeKill", { killer, time });
}

function named(
  id: number,
  name: string,
  killer: string,
  time: number,
): LiveEvent {
  return event(id, name, { killer, time });
}
