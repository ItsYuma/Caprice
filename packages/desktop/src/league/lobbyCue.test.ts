import { expect, test } from "bun:test";

import { lobbyCue, lobbyFallback } from "./lobbyCue.ts";
import { applyAsk, emptyMemory, type LobbyPlan } from "./lobbyRun.ts";
import { parseLobby } from "./lobbyAsk.ts";

test("the cue lists the fact and the steps still waiting", () => {
  const ask = parseLobby("find a match, ban zed, and pick ahri");

  if (ask === undefined) {
    throw new Error("ask");
  }

  const plan = applyAsk(emptyMemory(), ask).plan;

  const cue = lobbyCue("find a match, ban zed, and pick ahri", queued(plan), [
    { kind: "queued", already: false },
  ]);

  expect(cue.startsWith("Lobby.")).toBe(true);
  expect(cue).toContain("Do not call a tool.");
  expect(cue).toContain("Do not read the list back.");
  expect(cue).toContain("Heard: find a match, ban zed, and pick ahri");
  expect(cue).toContain("Started the queue.");
  expect(cue).toContain("Will ban Zed when it is your turn.");
  expect(cue).toContain("Will pick Ahri when it is your turn.");
  expect(
    lobbyFallback(queued(plan), [{ kind: "queued", already: false }]),
  ).toBe("Queue's up. I'll ban Zed and lock Ahri.");
});

test("a later fact is only that fact", () => {
  const cue = lobbyCue("", undefined, [{ kind: "banned", name: "Zed" }]);

  expect(cue).toContain("Banned Zed.");
  expect(cue).not.toContain("Heard:");
  expect(lobbyFallback(undefined, [{ kind: "banned", name: "Zed" }])).toBe(
    "Banned Zed.",
  );
  expect(lobbyFallback(undefined, [{ kind: "down" }])).toBe(
    "The client isn't running.",
  );
  expect(lobbyFallback(undefined, [{ kind: "no-lobby" }])).toBe(
    "You're not in a lobby.",
  );
});

function queued(plan: LobbyPlan | undefined): LobbyPlan | undefined {
  if (plan === undefined) {
    return undefined;
  }

  return { ...plan, queued: true, queueTold: true };
}
