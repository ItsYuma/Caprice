import { tryCatch } from "@caprice/core";

import {
  actionKindPresent,
  findChampion,
  openAction,
  parseChampions,
  parseChampSelect,
  parsePhase,
  parseReadyCheck,
  type ChampSelect,
  type Champion,
} from "./clientRead.ts";
import type { LobbyAsk } from "./lobbyAsk.ts";

export type LobbyCall = (request: string) => Promise<string>;

export const lobbyMissLimit = 4;

export type LobbyPlan = {
  queue: boolean;
  accept: boolean;
  ban: string;
  pick: string;
  queued: boolean;
  accepted: boolean;
  banDone: boolean;
  pickDone: boolean;
  queueTold: boolean;
  acceptTold: boolean;
  banTold: boolean;
  pickTold: boolean;
};

export type LobbyMemory = {
  plan: LobbyPlan | undefined;
  champions: readonly Champion[] | undefined;
  misses: number;
  downTold: boolean;
};

export type LobbyFact =
  | { kind: "down" }
  | { kind: "cancelled" }
  | { kind: "no-lobby" }
  | { kind: "queue-failed" }
  | { kind: "queued"; already: boolean }
  | { kind: "accepted" }
  | { kind: "accept-missed" }
  | { kind: "banned"; name: string }
  | { kind: "picked"; name: string }
  | { kind: "ban-unknown"; query: string }
  | { kind: "pick-unknown"; query: string }
  | { kind: "ban-failed"; name: string }
  | { kind: "pick-failed"; name: string }
  | { kind: "ban-skipped" }
  | { kind: "in-game" }
  | { kind: "gone" };

export type LobbyStep = {
  memory: LobbyMemory;
  fact: LobbyFact | undefined;
  snapshot: LobbyPlan | undefined;
};

const phasePath = "GET /lol-gameflow/v1/gameflow-phase";
const searchPath = "POST /lol-lobby/v2/lobby/matchmaking/search";
const readyPath = "GET /lol-matchmaking/v1/ready-check";
const acceptPath = "POST /lol-matchmaking/v1/ready-check/accept";
const sessionPath = "GET /lol-champ-select/v1/session";
const summaryPath = "GET /lol-game-data/assets/v1/champion-summary.json";

export function emptyMemory(): LobbyMemory {
  return {
    plan: undefined,
    champions: undefined,
    misses: 0,
    downTold: false,
  };
}

export function applyAsk(memory: LobbyMemory, ask: LobbyAsk): LobbyMemory {
  const previous = memory.plan;

  return {
    plan: {
      queue: ask.queue || previous?.queue === true,
      accept: ask.accept || previous?.accept === true,
      ban: ask.ban.length > 0 ? ask.ban : (previous?.ban ?? ""),
      pick: ask.pick.length > 0 ? ask.pick : (previous?.pick ?? ""),
      queued: ask.queue ? false : previous?.queued === true,
      accepted: ask.accept ? false : previous?.accepted === true,
      banDone: ask.ban.length > 0 ? false : previous?.banDone === true,
      pickDone: ask.pick.length > 0 ? false : previous?.pickDone === true,
      queueTold: ask.queue ? false : previous?.queueTold === true,
      acceptTold: ask.accept ? false : previous?.acceptTold === true,
      banTold: ask.ban.length > 0 ? false : previous?.banTold === true,
      pickTold: ask.pick.length > 0 ? false : previous?.pickTold === true,
    },
    champions: memory.champions,
    misses: 0,
    downTold: false,
  };
}

export async function runLobby(
  memory: LobbyMemory,
  lcu: LobbyCall,
): Promise<LobbyStep> {
  const plan = memory.plan;

  if (plan === undefined) {
    return { memory, fact: undefined, snapshot: undefined };
  }

  const read = await tryCatch(lcu(phasePath), "league client failed");

  if (!read.ok) {
    return miss(memory);
  }

  const phase = parsePhase(read.value);

  if (phase === undefined) {
    return miss(memory);
  }

  const base: LobbyMemory = { ...memory, misses: 0, downTold: false };
  const stop = stopped(phase);

  if (stop === "game") {
    return settle(base, plan, { kind: "in-game" }, true);
  }

  if (stop === "gone") {
    return settle(base, plan, { kind: "gone" }, true);
  }

  if (plan.queue && !plan.queued && queuedAlready(phase)) {
    const next = { ...plan, queued: true, queueTold: true };

    if (plan.queueTold) {
      return afterQueue(base, next, phase, lcu);
    }

    return settle(base, next, { kind: "queued", already: true });
  }

  if (plan.queue && !plan.queued && phase === "None") {
    return settle(
      base,
      { ...plan, queue: false, queueTold: true },
      {
        kind: "no-lobby",
      },
    );
  }

  if (plan.queue && !plan.queued && phase === "Lobby") {
    return search(base, plan, lcu);
  }

  return afterQueue(base, plan, phase, lcu);
}

async function afterQueue(
  memory: LobbyMemory,
  plan: LobbyPlan,
  phase: string,
  lcu: LobbyCall,
): Promise<LobbyStep> {
  if (plan.accept && !plan.accepted && phase === "ReadyCheck") {
    return acceptReady(memory, plan, lcu);
  }

  let next = plan;

  if (plan.accept && !plan.accepted && pastReady(phase)) {
    next = { ...plan, accept: false, acceptTold: true };

    if (!pending(next)) {
      return settle(memory, next, { kind: "accept-missed" });
    }
  }

  if (phase === "ChampSelect" && (banPending(next) || pickPending(next))) {
    return selectStep(memory, next, lcu);
  }

  return settle(memory, next, undefined);
}

async function search(
  memory: LobbyMemory,
  plan: LobbyPlan,
  lcu: LobbyCall,
): Promise<LobbyStep> {
  const posted = await tryCatch(lcu(searchPath), "league client failed");

  if (!posted.ok) {
    const message = posted.error.message.toLowerCase();

    if (message.includes("already")) {
      return settle(
        memory,
        { ...plan, queued: true, queueTold: true },
        {
          kind: "queued",
          already: true,
        },
      );
    }

    if (message.includes("404")) {
      return settle(
        memory,
        { ...plan, queue: false, queueTold: true },
        {
          kind: "no-lobby",
        },
      );
    }

    return settle(
      memory,
      { ...plan, queue: false, queueTold: true },
      {
        kind: "queue-failed",
      },
    );
  }

  return settle(
    memory,
    { ...plan, queued: true, queueTold: true },
    {
      kind: "queued",
      already: false,
    },
  );
}

async function acceptReady(
  memory: LobbyMemory,
  plan: LobbyPlan,
  lcu: LobbyCall,
): Promise<LobbyStep> {
  const read = await tryCatch(lcu(readyPath), "league client failed");

  if (!read.ok) {
    return settle(memory, plan, undefined);
  }

  const ready = parseReadyCheck(read.value);

  if (ready === undefined || ready.state.toLowerCase() !== "inprogress") {
    return settle(memory, plan, undefined);
  }

  if (ready.response.toLowerCase() === "accepted") {
    return settle(
      memory,
      { ...plan, accepted: true, acceptTold: true },
      {
        kind: "accepted",
      },
    );
  }

  const posted = await tryCatch(lcu(acceptPath), "league client failed");

  if (!posted.ok) {
    return settle(memory, plan, undefined);
  }

  return settle(
    memory,
    { ...plan, accepted: true, acceptTold: true },
    {
      kind: "accepted",
    },
  );
}

async function selectStep(
  memory: LobbyMemory,
  plan: LobbyPlan,
  lcu: LobbyCall,
): Promise<LobbyStep> {
  const loaded = await ensureChampions(memory, lcu);
  const read = await tryCatch(lcu(sessionPath), "league client failed");

  if (!read.ok) {
    return settle(loaded, plan, undefined);
  }

  const session = parseChampSelect(read.value);

  if (
    session === undefined ||
    session.phase.toUpperCase() === "PLANNING" ||
    session.actions.length === 0
  ) {
    return settle(loaded, plan, undefined);
  }

  if (banPending(plan)) {
    return banIn(loaded, plan, session, lcu);
  }

  if (pickPending(plan)) {
    return pickIn(loaded, plan, session, lcu);
  }

  return settle(loaded, plan, undefined);
}

async function banIn(
  memory: LobbyMemory,
  plan: LobbyPlan,
  session: ChampSelect,
  lcu: LobbyCall,
): Promise<LobbyStep> {
  if (!actionKindPresent(session, "ban")) {
    return settle(
      memory,
      { ...plan, banDone: true, banTold: true },
      {
        kind: "ban-skipped",
      },
    );
  }

  const action = openAction(session, "ban");

  if (action === undefined) {
    return settle(memory, plan, undefined);
  }

  return lockNamed(memory, plan, lcu, action.id, "ban");
}

async function pickIn(
  memory: LobbyMemory,
  plan: LobbyPlan,
  session: ChampSelect,
  lcu: LobbyCall,
): Promise<LobbyStep> {
  const action = openAction(session, "pick");

  if (action === undefined) {
    return settle(memory, plan, undefined);
  }

  return lockNamed(memory, plan, lcu, action.id, "pick");
}

async function lockNamed(
  memory: LobbyMemory,
  plan: LobbyPlan,
  lcu: LobbyCall,
  actionId: number,
  kind: "ban" | "pick",
): Promise<LobbyStep> {
  const query = kind === "ban" ? plan.ban : plan.pick;
  const champions = memory.champions;

  if (champions === undefined || champions.length === 0) {
    return settle(memory, plan, undefined);
  }

  const champion = findChampion(champions, query);

  if (champion === undefined) {
    if (kind === "ban") {
      return settle(
        memory,
        { ...plan, ban: "", banDone: true, banTold: true },
        {
          kind: "ban-unknown",
          query,
        },
      );
    }

    return settle(
      memory,
      { ...plan, pick: "", pickDone: true, pickTold: true },
      {
        kind: "pick-unknown",
        query,
      },
    );
  }

  if (!safeId(actionId) || !safeId(champion.id)) {
    return settle(memory, plan, undefined);
  }

  const locked = await lockChampion(lcu, actionId, champion.id);

  if (!locked) {
    if (kind === "ban") {
      return settle(
        memory,
        { ...plan, ban: champion.name, banDone: true, banTold: true },
        { kind: "ban-failed", name: champion.name },
      );
    }

    return settle(
      memory,
      { ...plan, pick: champion.name, pickDone: true, pickTold: true },
      { kind: "pick-failed", name: champion.name },
    );
  }

  if (kind === "ban") {
    return settle(
      memory,
      { ...plan, ban: champion.name, banDone: true, banTold: true },
      { kind: "banned", name: champion.name },
    );
  }

  return settle(
    memory,
    { ...plan, pick: champion.name, pickDone: true, pickTold: true },
    { kind: "picked", name: champion.name },
  );
}

async function ensureChampions(
  memory: LobbyMemory,
  lcu: LobbyCall,
): Promise<LobbyMemory> {
  if (memory.champions !== undefined && memory.champions.length > 0) {
    return memory;
  }

  const body = await tryCatch(lcu(summaryPath), "league client failed");

  if (!body.ok) {
    return memory;
  }

  const champions = parseChampions(body.value);

  if (champions.length === 0) {
    return memory;
  }

  return { ...memory, champions };
}

async function lockChampion(
  lcu: LobbyCall,
  actionId: number,
  championId: number,
): Promise<boolean> {
  const completed = await tryCatch(
    lcu(
      `PATCH /lol-champ-select/v1/session/actions/${actionId}\n{"championId":${championId},"completed":true}`,
    ),
    "league client failed",
  );

  if (completed.ok) {
    return true;
  }

  const hovered = await tryCatch(
    lcu(
      `PATCH /lol-champ-select/v1/session/actions/${actionId}\n{"championId":${championId}}`,
    ),
    "league client failed",
  );

  if (!hovered.ok) {
    return false;
  }

  const finished = await tryCatch(
    lcu(`POST /lol-champ-select/v1/session/actions/${actionId}/complete`),
    "league client failed",
  );

  return finished.ok;
}

function miss(memory: LobbyMemory): LobbyStep {
  const misses = memory.misses + 1;

  if (misses >= lobbyMissLimit) {
    return {
      memory: {
        plan: undefined,
        champions: undefined,
        misses: 0,
        downTold: false,
      },
      fact: undefined,
      snapshot: memory.plan,
    };
  }

  return {
    memory: { ...memory, misses, downTold: true },
    fact: memory.downTold ? undefined : { kind: "down" },
    snapshot: memory.plan,
  };
}

function settle(
  memory: LobbyMemory,
  plan: LobbyPlan,
  fact: LobbyFact | undefined,
  clear = false,
): LobbyStep {
  return {
    memory: {
      plan: clear || !pending(plan) ? undefined : plan,
      champions: memory.champions,
      misses: 0,
      downTold: false,
    },
    fact,
    snapshot: plan,
  };
}

function pending(plan: LobbyPlan): boolean {
  return (
    banPending(plan) ||
    pickPending(plan) ||
    (plan.queue && !plan.queued) ||
    (plan.accept && !plan.accepted)
  );
}

function banPending(plan: LobbyPlan): boolean {
  return plan.ban.length > 0 && !plan.banDone;
}

function pickPending(plan: LobbyPlan): boolean {
  return plan.pick.length > 0 && !plan.pickDone;
}

function queuedAlready(phase: string): boolean {
  return (
    phase === "Matchmaking" || phase === "ReadyCheck" || phase === "ChampSelect"
  );
}

function pastReady(phase: string): boolean {
  return phase === "ChampSelect" || stopped(phase) !== undefined;
}

function stopped(phase: string): "game" | "gone" | undefined {
  if (
    phase === "InProgress" ||
    phase === "GameStart" ||
    phase === "Reconnect" ||
    phase === "WaitingForStats" ||
    phase === "PreEndOfGame" ||
    phase === "EndOfGame"
  ) {
    return "game";
  }

  if (phase === "FailedToLaunch" || phase === "TerminatedInError") {
    return "gone";
  }

  return undefined;
}

function safeId(id: number): boolean {
  return Number.isInteger(id) && id >= 0 && id < 1_000_000;
}
