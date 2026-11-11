export type GameKind = "read" | "action";

export type GameContext = {
  request: string;
  signal: AbortSignal;
};

export type GameResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: Error };

export type GameTool = {
  name: string;
  description: string;
  kind: GameKind;
  parse: (input: string) => GameResult<string>;
  run: (input: string, context: GameContext) => Promise<string>;
};

export type GameSpeak = (cue: string, fallback: string) => Promise<boolean>;

export type GameFollow = (
  speak: GameSpeak,
  signal: AbortSignal,
) => Promise<void>;

export type GamePlugin = {
  id: string;
  instructions: string;
  tools: readonly GameTool[];
  follows: readonly GameFollow[];
  hear?: (
    text: string,
  ) => Promise<{ cue: string; fallback: string } | undefined>;
};
