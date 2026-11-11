import type { LobbyFact, LobbyPlan } from "./lobbyRun.ts";

export function lobbyCue(
  heard: string,
  snapshot: LobbyPlan | undefined,
  facts: readonly LobbyFact[],
): string {
  const lines = [
    "Lobby. One or two short sentences out loud. Tell the host what happened. Tease them if you want. Do not call a tool. Do not add a step that is not listed. Do not read the list back.",
    "",
  ];

  if (heard.trim().length > 0) {
    lines.push(`Heard: ${heard.trim()}`);
  }

  for (const line of stateLines(snapshot, facts)) {
    lines.push(line);
  }

  return lines.join("\n");
}

export function lobbyFallback(
  snapshot: LobbyPlan | undefined,
  facts: readonly LobbyFact[],
): string {
  const sentences: string[] = [];

  for (const fact of facts) {
    const line = factSentence(fact);

    if (line.length > 0) {
      sentences.push(line);
    }
  }

  const wait = waitSentence(snapshot, facts);

  if (wait.length > 0) {
    sentences.push(wait);
  }

  if (sentences.length === 0) {
    return "Okay.";
  }

  if (sentences.length === 1) {
    return sentences[0] ?? "Okay.";
  }

  return `${sentences[0]} ${sentences[1]}`;
}

function stateLines(
  snapshot: LobbyPlan | undefined,
  facts: readonly LobbyFact[],
): string[] {
  const lines: string[] = [];

  for (const fact of facts) {
    const line = factLine(fact);

    if (line.length > 0) {
      lines.push(line);
    }
  }

  if (snapshot === undefined || suppressWait(facts)) {
    return lines;
  }

  if (snapshot.queue && !snapshot.queued && !coversQueue(facts)) {
    lines.push("Will start the queue.");
  }

  if (snapshot.accept && !snapshot.accepted && !coversAccept(facts)) {
    lines.push("Will accept the ready check.");
  }

  if (snapshot.ban.length > 0 && !snapshot.banDone && !coversBan(facts)) {
    lines.push(`Will ban ${label(snapshot.ban)} when it is your turn.`);
  }

  if (snapshot.pick.length > 0 && !snapshot.pickDone && !coversPick(facts)) {
    lines.push(`Will pick ${label(snapshot.pick)} when it is your turn.`);
  }

  return lines;
}

function waitSentence(
  snapshot: LobbyPlan | undefined,
  facts: readonly LobbyFact[],
): string {
  if (snapshot === undefined || suppressWait(facts)) {
    return "";
  }

  const parts: string[] = [];

  if (snapshot.queue && !snapshot.queued && !coversQueue(facts)) {
    parts.push("start the queue");
  }

  if (snapshot.accept && !snapshot.accepted && !coversAccept(facts)) {
    parts.push("accept when it pops");
  }

  if (snapshot.ban.length > 0 && !snapshot.banDone && !coversBan(facts)) {
    parts.push(`ban ${label(snapshot.ban)}`);
  }

  if (snapshot.pick.length > 0 && !snapshot.pickDone && !coversPick(facts)) {
    parts.push(`lock ${label(snapshot.pick)}`);
  }

  if (parts.length === 0) {
    return "";
  }

  return `I'll ${joinAnd(parts)}.`;
}

function factLine(fact: LobbyFact): string {
  if (fact.kind === "down") {
    return "The League client is not running.";
  }

  if (fact.kind === "cancelled") {
    return "Cancelled the queue.";
  }

  if (fact.kind === "no-lobby") {
    return "Not in a lobby, so the queue did not start.";
  }

  if (fact.kind === "queue-failed") {
    return "The queue did not start.";
  }

  if (fact.kind === "queued") {
    return fact.already ? "Already in queue." : "Started the queue.";
  }

  if (fact.kind === "accepted") {
    return "Accepted the ready check.";
  }

  if (fact.kind === "accept-missed") {
    return "The ready check is already over.";
  }

  if (fact.kind === "banned") {
    return `Banned ${label(fact.name)}.`;
  }

  if (fact.kind === "picked") {
    return `Locked ${label(fact.name)}.`;
  }

  if (fact.kind === "ban-unknown" || fact.kind === "pick-unknown") {
    return `No champion named ${label(fact.query)}.`;
  }

  if (fact.kind === "ban-failed") {
    return `Could not ban ${label(fact.name)}.`;
  }

  if (fact.kind === "pick-failed") {
    return `Could not lock ${label(fact.name)}.`;
  }

  if (fact.kind === "ban-skipped") {
    return "This mode has no ban.";
  }

  if (fact.kind === "in-game") {
    return "The match already started.";
  }

  return "The lobby is gone.";
}

function factSentence(fact: LobbyFact): string {
  if (fact.kind === "down") {
    return "The client isn't running.";
  }

  if (fact.kind === "cancelled") {
    return "Queue's off.";
  }

  if (fact.kind === "no-lobby") {
    return "You're not in a lobby.";
  }

  if (fact.kind === "queue-failed") {
    return "The queue didn't start.";
  }

  if (fact.kind === "queued") {
    return fact.already ? "Already in queue." : "Queue's up.";
  }

  if (fact.kind === "accepted") {
    return "Accepted.";
  }

  if (fact.kind === "accept-missed") {
    return "The ready check is over.";
  }

  if (fact.kind === "banned") {
    return `Banned ${label(fact.name)}.`;
  }

  if (fact.kind === "picked") {
    return `Locked ${label(fact.name)}.`;
  }

  if (fact.kind === "ban-unknown" || fact.kind === "pick-unknown") {
    return `I don't know ${label(fact.query)}.`;
  }

  if (fact.kind === "ban-failed") {
    return `I couldn't ban ${label(fact.name)}.`;
  }

  if (fact.kind === "pick-failed") {
    return `I couldn't lock ${label(fact.name)}.`;
  }

  if (fact.kind === "ban-skipped") {
    return "No ban in this mode.";
  }

  if (fact.kind === "in-game") {
    return "The match already started.";
  }

  return "The lobby's gone.";
}

function suppressWait(facts: readonly LobbyFact[]): boolean {
  for (const fact of facts) {
    if (
      fact.kind === "in-game" ||
      fact.kind === "gone" ||
      fact.kind === "cancelled"
    ) {
      return true;
    }
  }

  return false;
}

function coversQueue(facts: readonly LobbyFact[]): boolean {
  for (const fact of facts) {
    if (
      fact.kind === "queued" ||
      fact.kind === "no-lobby" ||
      fact.kind === "queue-failed"
    ) {
      return true;
    }
  }

  return false;
}

function coversAccept(facts: readonly LobbyFact[]): boolean {
  for (const fact of facts) {
    if (fact.kind === "accepted" || fact.kind === "accept-missed") {
      return true;
    }
  }

  return false;
}

function coversBan(facts: readonly LobbyFact[]): boolean {
  for (const fact of facts) {
    if (
      fact.kind === "banned" ||
      fact.kind === "ban-unknown" ||
      fact.kind === "ban-failed" ||
      fact.kind === "ban-skipped"
    ) {
      return true;
    }
  }

  return false;
}

function coversPick(facts: readonly LobbyFact[]): boolean {
  for (const fact of facts) {
    if (
      fact.kind === "picked" ||
      fact.kind === "pick-unknown" ||
      fact.kind === "pick-failed"
    ) {
      return true;
    }
  }

  return false;
}

function joinAnd(parts: readonly string[]): string {
  if (parts.length === 1) {
    return parts[0] ?? "";
  }

  if (parts.length === 2) {
    return `${parts[0]} and ${parts[1]}`;
  }

  let text = "";

  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index] ?? "";

    if (index === 0) {
      text = part;
    } else if (index === parts.length - 1) {
      text = `${text}, and ${part}`;
    } else {
      text = `${text}, ${part}`;
    }
  }

  return text;
}

function label(name: string): string {
  let out = "";
  let cap = true;

  for (const char of name) {
    if (char === " " || char === "'") {
      out += char;
      cap = true;

      continue;
    }

    if (cap) {
      out += char.toUpperCase();
      cap = false;

      continue;
    }

    out += char;
  }

  return out.replaceAll(" And ", " and ");
}
