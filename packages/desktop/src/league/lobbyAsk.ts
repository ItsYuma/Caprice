export type LobbyAsk = {
  queue: boolean;
  cancel: boolean;
  accept: boolean;
  ban: string;
  pick: string;
};

type CommandKind = "queue" | "cancel" | "accept" | "ban" | "pick";

type Command = {
  kind: CommandKind;
  next: number;
  name: string;
};

const fillers = new Set([
  "a",
  "an",
  "and",
  "also",
  "capri",
  "champ",
  "champion",
  "for",
  "hey",
  "it",
  "just",
  "me",
  "my",
  "now",
  "oh",
  "ok",
  "okay",
  "please",
  "the",
  "then",
  "to",
  "up",
  "us",
  "yeah",
  "yo",
]);

const stops = new Set([
  "champion",
  "champ",
  "client",
  "door",
  "game",
  "her",
  "him",
  "it",
  "lobby",
  "match",
  "me",
  "one",
  "queue",
  "someone",
  "something",
  "that",
  "them",
  "this",
  "up",
  "window",
  "you",
]);

export function parseLobby(text: string): LobbyAsk | undefined {
  const normalized = stripAddress(normalize(text));

  if (normalized.length === 0 || isQuestion(normalized)) {
    return undefined;
  }

  const found = scan(normalized);

  if (found === undefined) {
    return undefined;
  }

  if (
    found.cancel &&
    (found.queue ||
      found.accept ||
      found.ban.length > 0 ||
      found.pick.length > 0)
  ) {
    return undefined;
  }

  if (
    !found.cancel &&
    !found.queue &&
    !found.accept &&
    found.ban.length === 0 &&
    found.pick.length === 0
  ) {
    return undefined;
  }

  return found;
}

function scan(text: string): LobbyAsk | undefined {
  let index = 0;
  let queue = false;
  let cancel = false;
  let accept = false;
  let ban = "";
  let pick = "";

  while (index < text.length) {
    index = skipFillers(text, index);

    if (index >= text.length) {
      break;
    }

    const command = readCommand(text, index);

    if (command === undefined || command.next <= index) {
      return undefined;
    }

    if (command.kind === "queue") {
      if (queue) {
        return undefined;
      }

      queue = true;
    } else if (command.kind === "cancel") {
      if (cancel) {
        return undefined;
      }

      cancel = true;
    } else if (command.kind === "accept") {
      if (accept) {
        return undefined;
      }

      accept = true;
    } else if (command.kind === "ban") {
      if (ban.length > 0) {
        return undefined;
      }

      ban = command.name;
    } else if (pick.length > 0) {
      return undefined;
    } else {
      pick = command.name;
    }

    index = command.next;
  }

  return { queue, cancel, accept, ban, pick };
}

function readCommand(text: string, index: number): Command | undefined {
  const cancel = take(
    text,
    index,
    /^(?:cancel|stop|leave)\s+(?:the\s+)?(?:queue|search|searching|matchmaking)(?=\s|$)/,
  );

  if (cancel !== undefined) {
    return { kind: "cancel", next: index + cancel.length, name: "" };
  }

  const queue = take(
    text,
    index,
    /^(?:find(?:\s+me)?\s+(?:(?:a|the)\s+)?(?:match|game)|queue\s+up|queue(?:\s+for)?\s+(?:(?:a|the)\s+)?(?:match|game)|start\s+(?:the\s+)?(?:queue|matchmaking)|search\s+for\s+(?:(?:a|the)\s+)?(?:match|game))(?=\s|$)/,
  );

  if (queue !== undefined) {
    return { kind: "queue", next: index + queue.length, name: "" };
  }

  const accept = take(
    text,
    index,
    /^accept(?:\s+(?:the\s+)?(?:match|game|queue|ready\s+check))?(?=\s|$)/,
  );

  if (accept !== undefined) {
    return { kind: "accept", next: index + accept.length, name: "" };
  }

  const ban = take(text, index, /^ban(?=\s)/);

  if (ban !== undefined) {
    const name = readName(text, index + ban.length);

    if (name === undefined) {
      return undefined;
    }

    return { kind: "ban", next: name.next, name: name.name };
  }

  const pick = take(text, index, /^(?:pick|select)(?=\s)/);
  const lock = take(text, index, /^lock\s+in(?=\s)/);
  const verb = pick ?? lock;

  if (verb === undefined) {
    return undefined;
  }

  const name = readName(text, index + verb.length);

  if (name === undefined) {
    return undefined;
  }

  return { kind: "pick", next: name.next, name: name.name };
}

function readName(
  text: string,
  index: number,
): { name: string; next: number } | undefined {
  const words: string[] = [];
  let cursor = skipFillers(text, index);

  if (isCommandAt(text, cursor)) {
    return undefined;
  }

  while (cursor < text.length && words.length < 4) {
    if (words.length > 0 && isCommandAt(text, cursor)) {
      break;
    }

    const word = readWord(text, cursor);

    if (word.length === 0) {
      break;
    }

    if (isFiller(word)) {
      if (word === "and" && words.length > 0) {
        const after = skipSpaces(text, cursor + word.length);

        if (after < text.length && !isCommandAt(text, after)) {
          words.push(word);
          cursor = after;

          continue;
        }
      }

      break;
    }

    words.push(word);
    cursor = skipSpaces(text, cursor + word.length);
  }

  const name = words.join(" ");

  if (!isChampionQuery(name)) {
    return undefined;
  }

  return { name, next: cursor };
}

function isCommandAt(text: string, index: number): boolean {
  return readCommand(text, index) !== undefined;
}

function isChampionQuery(name: string): boolean {
  if (name.length === 0 || name.length > 40) {
    return false;
  }

  const wanted = compact(name);

  if (wanted.length < 2 || stops.has(wanted)) {
    return false;
  }

  return true;
}

function compact(text: string): string {
  let word = "";

  for (const part of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (part.length === 0 || part === "and") {
      continue;
    }

    word += part;
  }

  return word;
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replaceAll("’", "'")
    .replaceAll("‘", "'")
    .replaceAll("&", " and ")
    .replace(/[^a-z0-9'\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripAddress(text: string): string {
  let rest = text;

  for (;;) {
    const next = rest
      .replace(
        /^(?:hey|capri|please|can you|could you|would you|i'll|i will|i'm gonna|im gonna|i want you to|i need you to)\s+/,
        "",
      )
      .trim();

    if (next === rest) {
      return rest;
    }

    rest = next;
  }
}

function isQuestion(text: string): boolean {
  return /^(?:who|what|why|how|when|where|did|do|does|is|are|was|were|should|could we|can we|am|shall)\b/.test(
    text,
  );
}

function skipFillers(text: string, index: number): number {
  let cursor = skipSpaces(text, index);

  while (cursor < text.length) {
    const word = readWord(text, cursor);

    if (!isFiller(word)) {
      break;
    }

    cursor = skipSpaces(text, cursor + word.length);
  }

  return cursor;
}

function skipSpaces(text: string, index: number): number {
  let cursor = index;

  while (text[cursor] === " ") {
    cursor += 1;
  }

  return cursor;
}

function readWord(text: string, index: number): string {
  let end = index;

  while (end < text.length && isNameChar(text[end] ?? "")) {
    end += 1;
  }

  return text.slice(index, end);
}

function isNameChar(char: string): boolean {
  if (char === "'") {
    return true;
  }

  const code = char.charCodeAt(0);

  return (code >= 97 && code <= 122) || (code >= 48 && code <= 57);
}

function isFiller(word: string): boolean {
  return fillers.has(word);
}

function take(
  text: string,
  index: number,
  pattern: RegExp,
): string | undefined {
  const found = pattern.exec(text.slice(index));

  if (found?.[0] === undefined || found.index !== 0) {
    return undefined;
  }

  return found[0];
}
