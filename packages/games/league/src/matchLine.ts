import { roleName, type LiveMatch } from "./liveMatch.ts";
import type { Remark } from "./matchWatch.ts";

export function remarkCue(match: LiveMatch, remark: Remark): string {
  return [
    "Live match. One or two short sentences out loud. Mock the host about the event, or enjoy it. Use the event and the score line. Do not call a tool. Do not add a fact. Do not read it back.",
    "",
    statusLine(match),
    `Event: ${eventLine(remark)}`,
  ].join("\n");
}

export function remarkFallback(remark: Remark): string {
  if (remark.kind === "started") {
    if (remark.champion.length > 0) {
      return `You're on ${remark.champion}. This better be funny.`;
    }

    return "Match is up. Entertain me.";
  }

  if (remark.kind === "ended") {
    return remark.win ? "You won. I'll allow it." : "You lost. That was dull.";
  }

  if (remark.kind === "kill") {
    if (remark.firstBlood) {
      return "First blood. Don't waste it.";
    }

    if (remark.streak >= 3) {
      return `${remark.streak} in a row. I'm still watching.`;
    }

    if (remark.victim.length > 0) {
      return `${remark.victim} is dead. Don't look proud.`;
    }

    return "You got one. Don't get proud.";
  }

  if (remark.kind === "death") {
    if (remark.streak >= 3) {
      return "There goes the streak.";
    }

    if (remark.gank.length > 0) {
      return `${remark.gank} walked in. You stayed.`;
    }

    if (remark.cause === "turret") {
      return "A turret. Really.";
    }

    if (remark.cause === "minion") {
      return "Minions. I'm embarrassed for you.";
    }

    if (remark.cause === "monster") {
      return "A monster killed you. Bold.";
    }

    if (remark.killer.length > 0) {
      return `${remark.killer} killed you. Predictable.`;
    }

    return "You died. Rude.";
  }

  if (remark.kind === "multikill") {
    if (remark.count >= 5) {
      return "A penta. I felt that.";
    }

    if (remark.count === 4) {
      return "A quadra. Don't stop to bow.";
    }

    if (remark.count === 3) {
      return "A triple. Fine, that was good.";
    }

    return "A double. I'm awake.";
  }

  if (remark.kind === "objective") {
    if (remark.stolen && remark.ally) {
      return "You stole it. Good.";
    }

    if (remark.stolen) {
      return "They stole it. Cute.";
    }

    if (remark.ally) {
      return "Your side took it. About time.";
    }

    return "They took it. Were you busy?";
  }

  if (remark.tone === "feeding" && remark.ally) {
    return `${remark.champion} is feeding. Inspiring.`;
  }

  if (remark.tone === "feeding") {
    return `${remark.champion} is feeding. Go collect.`;
  }

  if (remark.ally) {
    return `${remark.champion} is actually playing.`;
  }

  return `${remark.champion} is fed. Stay away.`;
}

function statusLine(match: LiveMatch): string {
  const minute = Math.floor(match.gameTime / 60);
  const you = match.you;

  if (you === undefined) {
    return `Minute ${minute}.`;
  }

  const role = roleName(you.position, you.smite);
  const roleBit = role.length > 0 ? `, ${role}` : "";

  return `Minute ${minute}. You are ${you.champion}${roleBit}, level ${you.level}, ${you.kills}/${you.deaths}/${you.assists}, ${you.cs} cs, ${you.itemGold} gold in items.`;
}

function eventLine(remark: Remark): string {
  if (remark.kind === "started") {
    if (remark.champion.length > 0) {
      return `The match started. You are playing ${remark.champion}.`;
    }

    return "The match started.";
  }

  if (remark.kind === "ended") {
    return remark.win ? "Your team won." : "Your team lost.";
  }

  if (remark.kind === "kill") {
    const who = labeled(remark.victim, remark.side, remark.role);
    let line = who.length > 0 ? `You killed ${who}.` : "You got a kill.";

    if (remark.firstBlood) {
      line = `${line} It was first blood.`;
    }

    if (remark.streak >= 3) {
      line = `${line} You are on a ${streakName(remark.streak)}, ${remark.streak} kills without dying.`;
    }

    return line;
  }

  if (remark.kind === "death") {
    let line = deathLine(remark.cause, remark.killer, remark.role);

    if (remark.gank.length > 0) {
      line = `${line} The enemy jungler ${remark.gank} was there.`;
    }

    if (remark.streak >= 3) {
      line = `${line} Your ${streakName(remark.streak)} ended.`;
    }

    return line;
  }

  if (remark.kind === "multikill") {
    let line = `You got ${multiWord(remark.count)}.`;

    if (remark.victim.length > 0) {
      line = `${line} The last one was ${remark.victim}.`;
    }

    if (remark.streak >= 3) {
      line = `${line} You are on a ${streakName(remark.streak)}, ${remark.streak} kills without dying.`;
    }

    return line;
  }

  if (remark.kind === "objective") {
    if (remark.ally && remark.stolen) {
      return `Your side stole ${remark.name}.`;
    }

    if (remark.ally) {
      return `Your side took ${remark.name}.`;
    }

    if (remark.stolen) {
      return `The enemy stole ${remark.name}.`;
    }

    return `The enemy took ${remark.name}.`;
  }

  const who = labeled(
    remark.champion,
    remark.ally ? "allied" : "enemy",
    remark.role,
  );

  const score = `${remark.kills}/${remark.deaths}`;

  if (remark.tone === "feeding") {
    return `${who} is feeding at ${score}.`;
  }

  return `${who} is fed at ${score}.`;
}

function deathLine(cause: string, killer: string, role: string): string {
  if (cause === "turret") {
    return "You died to a turret.";
  }

  if (cause === "minion") {
    return "You died to minions.";
  }

  if (cause === "monster") {
    return "You died to a monster.";
  }

  if (cause === "unknown" || killer.length === 0) {
    return "You died.";
  }

  return `You died to ${labeled(killer, "enemy", role)}.`;
}

function labeled(name: string, side: string, role: string): string {
  if (name.length === 0) {
    return "";
  }

  if (role.length === 0) {
    return name;
  }

  const team = side.length > 0 ? `${side} ` : "";

  return `${name}, the ${team}${roleWord(role)}`;
}

function roleWord(role: string): string {
  if (role === "jungle") {
    return "jungler";
  }

  return role;
}

function streakName(streak: number): string {
  if (streak >= 8) {
    return "Legendary";
  }

  if (streak === 7) {
    return "Godlike";
  }

  if (streak === 6) {
    return "Dominating";
  }

  if (streak === 5) {
    return "Unstoppable";
  }

  if (streak === 4) {
    return "Rampage";
  }

  return "Killing Spree";
}

function multiWord(count: number): string {
  if (count >= 5) {
    return "a penta kill";
  }

  if (count === 4) {
    return "a quadra kill";
  }

  if (count === 3) {
    return "a triple kill";
  }

  if (count === 2) {
    return "a double kill";
  }

  return "a multikill";
}
