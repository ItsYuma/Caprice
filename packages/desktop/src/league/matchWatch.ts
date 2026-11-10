import {
  nameKey,
  namesYou,
  roleName,
  samePlayer,
  type LiveEvent,
  type LiveMatch,
  type LivePlayer,
} from "./liveMatch.ts";

export const lateJoinSec = 90;
export const playerNoteSec = 120;

const endedPriority = 100;
const deathPriority = 80;
const multiPriority = 70;
const killPriority = 60;
const objectivePriority = 50;
const startPriority = 20;

export type DeathCause =
  "champion" | "turret" | "minion" | "monster" | "unknown";

export type PlayerTone = "feeding" | "carrying";

export type Remark =
  | { kind: "started"; champion: string }
  | { kind: "ended"; win: boolean }
  | {
      kind: "kill";
      victim: string;
      role: string;
      side: string;
      streak: number;
      firstBlood: boolean;
    }
  | {
      kind: "death";
      killer: string;
      role: string;
      cause: DeathCause;
      gank: string;
      streak: number;
    }
  | { kind: "multikill"; count: number; victim: string; streak: number }
  | { kind: "objective"; name: string; ally: boolean; stolen: boolean }
  | {
      kind: "player";
      key: string;
      champion: string;
      ally: boolean;
      role: string;
      kills: number;
      deaths: number;
      tone: PlayerTone;
    };

export type Watch = {
  primed: boolean;
  inMatch: boolean;
  lastEventId: number;
  lastGameTime: number;
  lastKills: number;
  lastDeaths: number;
  killsAtDeath: number;
  announcedStreak: number;
  pendingKill: boolean;
  pendingDeath: boolean;
  noted: readonly string[];
};

export type Step = {
  watch: Watch;
  remark: Remark | undefined;
};

type Candidate = {
  priority: number;
  id: number;
  remark: Remark;
};

type Track = {
  killsAtDeath: number;
  announced: number;
  sawKill: boolean;
  sawDeath: boolean;
  lastVictim: string;
  firstBlood: boolean;
  started: boolean;
  ended: boolean;
};

export function freshWatch(): Watch {
  return {
    primed: false,
    inMatch: false,
    lastEventId: -1,
    lastGameTime: 0,
    lastKills: 0,
    lastDeaths: 0,
    killsAtDeath: 0,
    announcedStreak: 0,
    pendingKill: false,
    pendingDeath: false,
    noted: [],
  };
}

export function markNoted(watch: Watch, key: string): Watch {
  for (const note of watch.noted) {
    if (note === key) {
      return watch;
    }
  }

  const noted = watch.noted.slice();
  noted.push(key);

  return {
    primed: watch.primed,
    inMatch: watch.inMatch,
    lastEventId: watch.lastEventId,
    lastGameTime: watch.lastGameTime,
    lastKills: watch.lastKills,
    lastDeaths: watch.lastDeaths,
    killsAtDeath: watch.killsAtDeath,
    announcedStreak: watch.announcedStreak,
    pendingKill: watch.pendingKill,
    pendingDeath: watch.pendingDeath,
    noted,
  };
}

export function stepWatch(input: Watch, match: LiveMatch): Step {
  if (input.primed && match.gameTime + 15 < input.lastGameTime) {
    return stepWatch(freshWatch(), match);
  }

  let watch = input;

  if (!watch.primed) {
    const late = match.gameTime >= lateJoinSec;
    const ending = newest(match)?.name === "GameEnd";
    watch = {
      primed: true,
      inMatch: !late || !ending,
      lastEventId: late ? maxId(match) : -1,
      lastGameTime: match.gameTime,
      lastKills: match.you?.kills ?? 0,
      lastDeaths: match.you?.deaths ?? 0,
      killsAtDeath: match.you?.kills ?? 0,
      announcedStreak: 0,
      pendingKill: false,
      pendingDeath: false,
      noted: late ? historyNotes(match) : [],
    };

    if (late) {
      return { watch, remark: undefined };
    }
  }

  const track: Track = {
    killsAtDeath: watch.killsAtDeath,
    announced: watch.announcedStreak,
    sawKill: false,
    sawDeath: false,
    lastVictim: "",
    firstBlood: false,
    started: false,
    ended: false,
  };

  const candidates: Candidate[] = [];
  let lastEventId = watch.lastEventId;

  for (const event of newer(match.events, watch.lastEventId)) {
    lastEventId = Math.max(lastEventId, event.id);

    if (stale(match, event)) {
      continue;
    }

    const remark = remarkFor(match, event, track);

    if (remark !== undefined) {
      candidates.push(remark);
    }
  }

  const you = match.you;

  let pendingKill = watch.pendingKill;
  let pendingDeath = watch.pendingDeath;

  if (you !== undefined) {
    if (track.sawDeath) {
      pendingDeath = false;
    } else if (pendingDeath) {
      candidates.push(unnamedDeath(match, track));
      pendingDeath = false;
    } else if (you.deaths > watch.lastDeaths) {
      pendingDeath = true;
    }

    if (track.sawKill) {
      pendingKill = false;
    } else if (pendingKill) {
      candidates.push(unnamedKill(track));
      pendingKill = false;
    } else if (you.kills > watch.lastKills) {
      pendingKill = true;
    }
  }

  paint(candidates, track);

  if (match.gameTime >= playerNoteSec) {
    notePlayers(match, watch.noted, candidates);
  }

  const live = track.ended ? false : track.started ? true : watch.inMatch;
  const chosen = best(candidates);

  const spoken =
    chosen === undefined ? undefined : streakOn(chosen, match, track);

  return {
    remark: spoken?.remark,
    watch: {
      primed: true,
      inMatch: live,
      lastEventId,
      lastGameTime: match.gameTime,
      lastKills: you?.kills ?? watch.lastKills,
      lastDeaths: you?.deaths ?? watch.lastDeaths,
      killsAtDeath: track.killsAtDeath,
      announcedStreak: track.announced,
      pendingKill,
      pendingDeath,
      noted: watch.noted,
    },
  };
}

function newer(events: readonly LiveEvent[], lastId: number): LiveEvent[] {
  const next: LiveEvent[] = [];

  for (const event of events) {
    if (event.id > lastId) {
      next.push(event);
    }
  }

  next.sort((left, right) => left.id - right.id);

  return next;
}

function newest(match: LiveMatch): LiveEvent | undefined {
  let found: LiveEvent | undefined;

  for (const event of match.events) {
    if (found === undefined || event.id >= found.id) {
      found = event;
    }
  }

  return found;
}

function maxId(match: LiveMatch): number {
  return newest(match)?.id ?? -1;
}

function stale(match: LiveMatch, event: LiveEvent): boolean {
  if (event.time > match.gameTime + 30) {
    return true;
  }

  const gate = riftGate(match, event.name);

  if (gate === undefined) {
    return false;
  }

  return event.time < gate;
}

function riftGate(match: LiveMatch, name: string): number | undefined {
  if (match.mapNumber !== 11) {
    return undefined;
  }

  const mode = match.gameMode.toUpperCase();

  if (mode.length > 0 && mode !== "CLASSIC" && mode !== "PRACTICETOOL") {
    return undefined;
  }

  if (name === "DragonKill") {
    return 290;
  }

  if (name === "HordeKill") {
    return 470;
  }

  if (name === "HeraldKill") {
    return 890;
  }

  if (name === "BaronKill" || name === "AtakhanKill") {
    return 1190;
  }

  return undefined;
}

function remarkFor(
  match: LiveMatch,
  event: LiveEvent,
  track: Track,
): Candidate | undefined {
  if (event.name === "GameStart") {
    track.started = true;

    return {
      priority: startPriority,
      id: event.id,
      remark: { kind: "started", champion: match.you?.champion ?? "" },
    };
  }

  if (event.name === "GameEnd") {
    track.ended = true;

    return {
      priority: endedPriority,
      id: event.id,
      remark: { kind: "ended", win: won(event.result) },
    };
  }

  if (
    event.name === "FirstBlood" &&
    yours(match, event.recipient, event.killer)
  ) {
    track.firstBlood = true;

    return undefined;
  }

  if (event.name === "ChampionKill" && namesYou(match, event.killer)) {
    track.sawKill = true;
    const victim = championCalled(match, event.victim);
    const player = findCalled(match, event.victim);
    track.lastVictim = victim;

    return {
      priority: killPriority,
      id: event.id,
      remark: {
        kind: "kill",
        victim,
        role:
          player === undefined ? "" : roleName(player.position, player.smite),
        side: player === undefined ? "" : sideWord(match, player),
        streak: 0,
        firstBlood: false,
      },
    };
  }

  if (event.name === "ChampionKill" && namesYou(match, event.victim)) {
    track.sawDeath = true;

    return {
      priority: deathPriority,
      id: event.id,
      remark: deathRemark(match, event.killer, event.assisters, track),
    };
  }

  if (event.name === "Multikill" && namesYou(match, event.killer)) {
    track.sawKill = true;
    const count = event.count >= 2 ? event.count : 2;

    return {
      priority: multiPriority,
      id: event.id,
      remark: {
        kind: "multikill",
        count,
        victim: track.lastVictim,
        streak: 0,
      },
    };
  }

  const objective = objectiveName(event);

  if (objective.length === 0) {
    return undefined;
  }

  const side = killerSide(match, event.killer);

  if (side === "unknown") {
    return undefined;
  }

  return {
    priority: objectivePriority,
    id: event.id,
    remark: {
      kind: "objective",
      name: objective,
      ally: side === "ally",
      stolen: event.stolen,
    },
  };
}

function unnamedDeath(match: LiveMatch, track: Track): Candidate {
  track.sawDeath = true;

  return {
    priority: deathPriority,
    id: 0,
    remark: deathRemark(match, "", [], track),
  };
}

function unnamedKill(track: Track): Candidate {
  track.sawKill = true;

  return {
    priority: killPriority,
    id: 0,
    remark: {
      kind: "kill",
      victim: "",
      role: "",
      side: "",
      streak: 0,
      firstBlood: false,
    },
  };
}

function deathRemark(
  match: LiveMatch,
  killer: string,
  assisters: readonly string[],
  track: Track,
): Remark {
  const you = match.you;
  const streak = you === undefined ? 0 : you.kills - track.killsAtDeath;
  track.killsAtDeath = you?.kills ?? track.killsAtDeath;
  track.announced = 0;
  const kind = killerKind(killer);
  const player = kind === "champion" ? findCalled(match, killer) : undefined;
  const name = player?.champion ?? (kind === "champion" ? killer : "");
  const cause = name.length === 0 && kind === "champion" ? "unknown" : kind;

  return {
    kind: "death",
    killer: name,
    role: player === undefined ? "" : roleName(player.position, player.smite),
    cause,
    gank: gankChampion(match, killer, assisters),
    streak: streak >= 3 ? streak : 0,
  };
}

function paint(candidates: Candidate[], track: Track): void {
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];

    if (candidate === undefined) {
      continue;
    }

    if (candidate.remark.kind === "kill" && track.firstBlood) {
      candidates[index] = {
        priority: candidate.priority,
        id: candidate.id,
        remark: { ...candidate.remark, firstBlood: true },
      };
    }

    if (
      candidate.remark.kind === "multikill" &&
      candidate.remark.victim.length === 0 &&
      track.lastVictim.length > 0
    ) {
      candidates[index] = {
        priority: candidate.priority,
        id: candidate.id,
        remark: { ...candidate.remark, victim: track.lastVictim },
      };
    }
  }
}

function streakOn(
  chosen: Candidate,
  match: LiveMatch,
  track: Track,
): Candidate {
  const you = match.you;

  if (you === undefined) {
    return chosen;
  }

  if (chosen.remark.kind !== "kill" && chosen.remark.kind !== "multikill") {
    return chosen;
  }

  const streak = you.kills - track.killsAtDeath;

  if (streak < 3 || streak <= track.announced) {
    return chosen;
  }

  track.announced = streak;

  return {
    priority: chosen.priority,
    id: chosen.id,
    remark: { ...chosen.remark, streak },
  };
}

function notePlayers(
  match: LiveMatch,
  noted: readonly string[],
  candidates: Candidate[],
): void {
  if (match.you === undefined) {
    return;
  }

  pushNotes(match.enemies, false, noted, candidates);
  pushNotes(match.allies, true, noted, candidates);
}

function pushNotes(
  players: readonly LivePlayer[],
  ally: boolean,
  noted: readonly string[],
  candidates: Candidate[],
): void {
  for (const player of players) {
    const tone = toneOf(player, ally);

    if (tone === undefined || nameKey(player.champion).length === 0) {
      continue;
    }

    const key = noteKey(player.champion, tone);

    if (hasNote(noted, key)) {
      continue;
    }

    candidates.push({
      priority: tonePriority(tone, ally),
      id: 0,
      remark: {
        kind: "player",
        key,
        champion: player.champion,
        ally,
        role: roleName(player.position, player.smite),
        kills: player.kills,
        deaths: player.deaths,
        tone,
      },
    });
  }
}

function historyNotes(match: LiveMatch): string[] {
  const keys: string[] = [];

  for (const player of match.enemies) {
    rememberNote(keys, player, false);
  }

  for (const player of match.allies) {
    rememberNote(keys, player, true);
  }

  return keys;
}

function rememberNote(keys: string[], player: LivePlayer, ally: boolean): void {
  const tone = toneOf(player, ally);

  if (tone === undefined || nameKey(player.champion).length === 0) {
    return;
  }

  const key = noteKey(player.champion, tone);

  if (!hasNote(keys, key)) {
    keys.push(key);
  }
}

function toneOf(player: LivePlayer, ally: boolean): PlayerTone | undefined {
  if (player.deaths >= 5 && player.deaths >= player.kills * 2) {
    return "feeding";
  }

  if (
    ally &&
    player.kills >= 6 &&
    player.kills / Math.max(1, player.deaths) >= 2
  ) {
    return "carrying";
  }

  if (!ally && player.kills >= 5 && player.deaths <= 1) {
    return "carrying";
  }

  return undefined;
}

function tonePriority(tone: PlayerTone, ally: boolean): number {
  if (!ally && tone === "carrying") {
    return 36;
  }

  if (ally && tone === "feeding") {
    return 34;
  }

  if (!ally && tone === "feeding") {
    return 32;
  }

  return 30;
}

function noteKey(champion: string, tone: PlayerTone): string {
  return `${tone}:${nameKey(champion)}`;
}

function hasNote(notes: readonly string[], key: string): boolean {
  for (const note of notes) {
    if (note === key) {
      return true;
    }
  }

  return false;
}

function best(candidates: readonly Candidate[]): Candidate | undefined {
  let chosen: Candidate | undefined;

  for (const candidate of candidates) {
    if (
      chosen === undefined ||
      candidate.priority > chosen.priority ||
      (candidate.priority === chosen.priority && candidate.id > chosen.id)
    ) {
      chosen = candidate;
    }
  }

  return chosen;
}

function yours(match: LiveMatch, recipient: string, killer: string): boolean {
  return namesYou(match, recipient) || namesYou(match, killer);
}

function won(result: string): boolean {
  const text = result.toLowerCase();

  return text.includes("win") || text.includes("vic");
}

function championCalled(match: LiveMatch, name: string): string {
  const player = findCalled(match, name);

  if (player !== undefined && player.champion.length > 0) {
    return player.champion;
  }

  if (killerKind(name) !== "champion") {
    return "";
  }

  return name;
}

function findCalled(match: LiveMatch, name: string): LivePlayer | undefined {
  if (match.you !== undefined && samePlayer(name, match.you)) {
    return match.you;
  }

  for (const player of match.enemies) {
    if (samePlayer(name, player)) {
      return player;
    }
  }

  for (const player of match.allies) {
    if (samePlayer(name, player)) {
      return player;
    }
  }

  return undefined;
}

function sideWord(match: LiveMatch, player: LivePlayer): string {
  if (
    match.you !== undefined &&
    player.team.length > 0 &&
    player.team === match.you.team
  ) {
    return "allied";
  }

  return "enemy";
}

function killerSide(
  match: LiveMatch,
  killer: string,
): "ally" | "enemy" | "unknown" {
  if (killer.length === 0 || killerKind(killer) !== "champion") {
    return "unknown";
  }

  if (namesYou(match, killer)) {
    return "ally";
  }

  const player = findCalled(match, killer);

  if (player === undefined || match.you === undefined) {
    return "unknown";
  }

  if (player.team === match.you.team) {
    return "ally";
  }

  return "enemy";
}

function gankChampion(
  match: LiveMatch,
  killer: string,
  assisters: readonly string[],
): string {
  const jungler = enemyJungler(match);

  if (jungler === undefined || samePlayer(killer, jungler)) {
    return "";
  }

  for (const name of assisters) {
    if (samePlayer(name, jungler)) {
      return jungler.champion;
    }
  }

  return "";
}

function enemyJungler(match: LiveMatch): LivePlayer | undefined {
  for (const player of match.enemies) {
    if (roleName(player.position, player.smite) === "jungle") {
      return player;
    }
  }

  return undefined;
}

function objectiveName(event: LiveEvent): string {
  if (event.name === "DragonKill") {
    return dragonName(event.dragon);
  }

  if (event.name === "BaronKill") {
    return "Baron";
  }

  if (event.name === "HeraldKill") {
    return "the rift herald";
  }

  if (event.name === "HordeKill") {
    return "the voidgrubs";
  }

  if (event.name === "AtakhanKill") {
    return "atakhan";
  }

  if (event.name === "TurretKilled") {
    return "a turret";
  }

  if (event.name === "InhibKilled") {
    return "an inhibitor";
  }

  return "";
}

function dragonName(dragon: string): string {
  const key = dragon.toLowerCase();

  if (key === "fire") {
    return "the infernal dragon";
  }

  if (key === "earth" || key === "mountain") {
    return "the mountain dragon";
  }

  if (key === "water" || key === "ocean") {
    return "the ocean dragon";
  }

  if (key === "air" || key === "cloud") {
    return "the cloud dragon";
  }

  if (key === "hextech") {
    return "the hextech dragon";
  }

  if (key === "chemtech") {
    return "the chemtech dragon";
  }

  if (key === "elder") {
    return "the elder dragon";
  }

  return "the dragon";
}

function killerKind(name: string): DeathCause {
  const lower = name.toLowerCase();

  if (lower.length === 0) {
    return "unknown";
  }

  if (lower.includes("turret") || lower.includes("tower")) {
    return "turret";
  }

  if (lower.includes("minion")) {
    return "minion";
  }

  if (
    lower.startsWith("sru_") ||
    lower.includes("baron") ||
    lower.includes("dragon") ||
    lower.includes("herald") ||
    lower.includes("horde") ||
    lower.includes("grub") ||
    lower.includes("atakhan")
  ) {
    return "monster";
  }

  return "champion";
}
