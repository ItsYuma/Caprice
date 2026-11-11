export type LivePlayer = {
  champion: string;
  summoner: string;
  riotId: string;
  raw: string;
  team: string;
  position: string;
  level: number;
  kills: number;
  deaths: number;
  assists: number;
  cs: number;
  itemGold: number;
  smite: boolean;
  keystone: number;
};

export type LiveEvent = {
  id: number;
  name: string;
  time: number;
  killer: string;
  victim: string;
  recipient: string;
  assisters: readonly string[];
  count: number;
  dragon: string;
  stolen: boolean;
  result: string;
};

export type LiveMatch = {
  gameTime: number;
  gameMode: string;
  mapNumber: number;
  you: LivePlayer | undefined;
  allies: readonly LivePlayer[];
  enemies: readonly LivePlayer[];
  events: readonly LiveEvent[];
};

type JsonRecord = {
  readonly [key: string]: JsonValue;
};

type JsonValue =
  string | number | boolean | null | JsonRecord | readonly JsonValue[];

export function parseLiveMatch(body: string): LiveMatch | undefined {
  let parsed: unknown;

  try {
    parsed = JSON.parse(body);
  } catch {
    return undefined;
  }

  if (!isPlainObject(parsed)) {
    return undefined;
  }

  const game = readObject(parsed, "gameData");

  const gameTime =
    game === undefined ? undefined : readNumber(game, "gameTime");

  if (gameTime === undefined) {
    return undefined;
  }

  const players = readPlayers(readArray(parsed, "allPlayers"));
  const you = findYou(readObject(parsed, "activePlayer"), players);
  const allies: LivePlayer[] = [];
  const enemies: LivePlayer[] = [];

  for (const player of players) {
    if (player === you) {
      continue;
    }

    if (
      you !== undefined &&
      player.team.length > 0 &&
      player.team === you.team
    ) {
      allies.push(player);

      continue;
    }

    if (you !== undefined && player.team.length > 0) {
      enemies.push(player);
    }
  }

  return {
    gameTime,
    gameMode: game === undefined ? "" : (readString(game, "gameMode") ?? ""),
    mapNumber: game === undefined ? 0 : (readNumber(game, "mapNumber") ?? 0),
    you,
    allies,
    enemies,
    events: readEvents(parsed),
  };
}

export function nameKey(name: string): string {
  let base = name.split("#")[0] ?? "";
  base = base.replace(/\s*\((?:bot|ai)\)\s*$/i, "").replace(/\s+bot$/i, "");
  let key = "";

  for (const char of base.toLowerCase()) {
    const code = char.codePointAt(0) ?? 0;
    const digit = code >= 48 && code <= 57;
    const lower = code >= 97 && code <= 122;

    if (digit || lower) {
      key += char;
    }
  }

  return key;
}

export function samePlayer(name: string, player: LivePlayer): boolean {
  const want = nameKey(name);

  if (want.length === 0) {
    return false;
  }

  return (
    nameKey(player.summoner) === want ||
    nameKey(player.riotId) === want ||
    nameKey(player.champion) === want ||
    nameKey(player.raw) === want
  );
}

export function namesYou(match: LiveMatch, name: string): boolean {
  if (match.you === undefined) {
    return false;
  }

  return samePlayer(name, match.you);
}

export function roleName(position: string, smite: boolean): string {
  const pos = position.toUpperCase();

  if (pos === "JUNGLE") {
    return "jungle";
  }

  if (pos === "TOP") {
    return "top";
  }

  if (pos === "MIDDLE" || pos === "MID") {
    return "mid";
  }

  if (pos === "BOTTOM" || pos === "ADC") {
    return "bottom";
  }

  if (pos === "UTILITY" || pos === "SUPPORT") {
    return "support";
  }

  if (smite) {
    return "jungle";
  }

  return "";
}

function findYou(
  active: JsonRecord | undefined,
  players: readonly LivePlayer[],
): LivePlayer | undefined {
  if (active !== undefined) {
    const names = [
      readString(active, "summonerName") ?? "",
      riotIdOf(active),
      readString(active, "riotIdGameName") ?? "",
    ];

    for (const name of names) {
      const found = playerNamed(players, name);

      if (found !== undefined) {
        return found;
      }
    }

    const fromAbilities = championFromAbilities(active, players);

    if (fromAbilities !== undefined) {
      return fromAbilities;
    }

    const fromRune = playerByKeystone(active, players);

    if (fromRune !== undefined) {
      return fromRune;
    }
  }

  const only = players[0];

  if (players.length === 1 && only !== undefined) {
    return only;
  }

  return undefined;
}

function playerNamed(
  players: readonly LivePlayer[],
  name: string,
): LivePlayer | undefined {
  if (nameKey(name).length === 0) {
    return undefined;
  }

  for (const player of players) {
    if (samePlayer(name, player)) {
      return player;
    }
  }

  return undefined;
}

function championFromAbilities(
  active: JsonRecord,
  players: readonly LivePlayer[],
): LivePlayer | undefined {
  const abilities = readObject(active, "abilities");

  if (abilities === undefined) {
    return undefined;
  }

  const blob = JSON.stringify(abilities).toLowerCase();

  for (const player of players) {
    const champion = nameKey(player.champion);
    const raw = nameKey(player.raw);

    if (champion.length >= 3 && blob.includes(champion)) {
      return player;
    }

    if (raw.length >= 3 && blob.includes(raw)) {
      return player;
    }
  }

  return undefined;
}

function playerByKeystone(
  active: JsonRecord,
  players: readonly LivePlayer[],
): LivePlayer | undefined {
  const runes = readObject(active, "fullRunes");
  const id = keystoneId(runes);

  if (id === undefined) {
    return undefined;
  }

  let found: LivePlayer | undefined;

  for (const player of players) {
    if (player.keystone !== id) {
      continue;
    }

    if (found !== undefined) {
      return undefined;
    }

    found = player;
  }

  return found;
}

function readPlayers(items: readonly JsonValue[]): LivePlayer[] {
  const players: LivePlayer[] = [];

  for (const item of items) {
    if (!isPlainObject(item)) {
      continue;
    }

    const player = readPlayer(item);

    if (player !== undefined) {
      players.push(player);
    }
  }

  return players;
}

function readPlayer(value: JsonRecord): LivePlayer | undefined {
  const champion = readString(value, "championName") ?? "";

  if (champion.length === 0) {
    return undefined;
  }

  const scores = readObject(value, "scores");

  return {
    champion,
    summoner: readString(value, "summonerName") ?? "",
    riotId: riotIdOf(value),
    raw: rawKey(readString(value, "rawChampionName") ?? ""),
    team: readString(value, "team") ?? "",
    position: readString(value, "position") ?? "",
    level: readNumber(value, "level") ?? 0,
    kills: scores === undefined ? 0 : (readNumber(scores, "kills") ?? 0),
    deaths: scores === undefined ? 0 : (readNumber(scores, "deaths") ?? 0),
    assists: scores === undefined ? 0 : (readNumber(scores, "assists") ?? 0),
    cs: scores === undefined ? 0 : (readNumber(scores, "creepScore") ?? 0),
    itemGold: itemGold(readArray(value, "items")),
    smite: hasSmite(readObject(value, "summonerSpells")),
    keystone: keystoneId(readObject(value, "runes")) ?? -1,
  };
}

function itemGold(items: readonly JsonValue[]): number {
  let gold = 0;

  for (const item of items) {
    if (!isPlainObject(item)) {
      continue;
    }

    const price = readNumber(item, "price") ?? 0;
    const count = readNumber(item, "count") ?? 1;

    if (price > 0 && count > 0) {
      gold += price * count;
    }
  }

  return gold;
}

function hasSmite(spells: JsonRecord | undefined): boolean {
  if (spells === undefined) {
    return false;
  }

  for (const field of Object.values(spells)) {
    if (!isPlainObject(field)) {
      continue;
    }

    const display = (readString(field, "displayName") ?? "").toLowerCase();
    const raw = (readString(field, "rawDisplayName") ?? "").toLowerCase();

    if (display === "smite" || raw.includes("smite")) {
      return true;
    }
  }

  return false;
}

function readEvents(root: JsonRecord): LiveEvent[] {
  const wrapped = readObject(root, "events");

  const items =
    wrapped === undefined
      ? readArray(root, "events")
      : readArray(wrapped, "Events");

  const events: LiveEvent[] = [];

  for (const item of items) {
    if (!isPlainObject(item)) {
      continue;
    }

    const event = readEvent(item);

    if (event !== undefined) {
      events.push(event);
    }
  }

  return events;
}

function readEvent(value: JsonRecord): LiveEvent | undefined {
  const id = readNumber(value, "EventID");
  const name = readString(value, "EventName");

  if (
    id === undefined ||
    !Number.isInteger(id) ||
    id < 0 ||
    name === undefined
  ) {
    return undefined;
  }

  const assisters: string[] = [];

  for (const item of readArray(value, "Assisters")) {
    if (isString(item) && item.length > 0) {
      assisters.push(item);
    }
  }

  return {
    id,
    name,
    time: readNumber(value, "EventTime") ?? 0,
    killer: readString(value, "KillerName") ?? "",
    victim: readString(value, "VictimName") ?? "",
    recipient: readString(value, "Recipient") ?? "",
    assisters,
    count: readNumber(value, "KillStreak") ?? 0,
    dragon: readString(value, "DragonType") ?? "",
    stolen: readFlag(value, "Stolen"),
    result: readString(value, "Result") ?? "",
  };
}

function riotIdOf(value: JsonRecord): string {
  const riot = readString(value, "riotId");

  if (riot !== undefined && riot.length > 0) {
    return riot;
  }

  const game = readString(value, "riotIdGameName") ?? "";
  const tag = readString(value, "riotIdTagLine") ?? "";

  if (game.length === 0) {
    return "";
  }

  if (tag.length === 0) {
    return game;
  }

  return `${game}#${tag}`;
}

function rawKey(raw: string): string {
  const marker = "displayname_";
  const at = raw.toLowerCase().lastIndexOf(marker);

  if (at >= 0) {
    return raw.slice(at + marker.length);
  }

  return raw;
}

function keystoneId(value: JsonRecord | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  const keystone = readObject(value, "keystone");

  if (keystone === undefined) {
    return undefined;
  }

  return readNumber(keystone, "id");
}

function readFlag(value: JsonRecord, key: string): boolean {
  for (const [name, field] of Object.entries(value)) {
    if (name !== key) {
      continue;
    }

    if (isBoolean(field)) {
      return field;
    }

    if (isString(field)) {
      return field.toLowerCase() === "true";
    }
  }

  return false;
}

function readArray(value: JsonRecord, key: string): readonly JsonValue[] {
  for (const [name, field] of Object.entries(value)) {
    if (name === key && Array.isArray(field)) {
      return field;
    }
  }

  return [];
}

function readObject(value: JsonRecord, key: string): JsonRecord | undefined {
  for (const [name, field] of Object.entries(value)) {
    if (name === key && isPlainObject(field)) {
      return field;
    }
  }

  return undefined;
}

function readString(value: JsonRecord, key: string): string | undefined {
  for (const [name, field] of Object.entries(value)) {
    if (name === key && isString(field)) {
      return field;
    }
  }

  return undefined;
}

function readNumber(value: JsonRecord, key: string): number | undefined {
  for (const [name, field] of Object.entries(value)) {
    if (name === key && isNumber(field)) {
      return field;
    }
  }

  return undefined;
}

function isPlainObject(value: unknown): value is JsonRecord {
  return Object.prototype.toString.call(value) === "[object Object]";
}

function isString(value: unknown): value is string {
  return Object.prototype.toString.call(value) === "[object String]";
}

function isBoolean(value: unknown): value is boolean {
  return Object.prototype.toString.call(value) === "[object Boolean]";
}

function isNumber(value: unknown): value is number {
  return (
    Object.prototype.toString.call(value) === "[object Number]" &&
    Number.isFinite(value)
  );
}
