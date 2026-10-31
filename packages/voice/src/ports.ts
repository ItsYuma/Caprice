export type Heard = {
  text: string;
};

export type Listener = {
  listen: () => Promise<Heard>;
};

export type Speaker = {
  speak: (text: string) => Promise<void>;
};

export function scriptedListener(lines: readonly string[]): Listener {
  let index = 0;

  return {
    async listen() {
      const text = lines[index];

      if (text === undefined) {
        throw new Error("scripted listener has no more lines");
      }

      index += 1;

      return { text };
    },
  };
}

export type Recording = {
  speaker: Speaker;
  spoken: () => readonly string[];
};

export function recordingSpeaker(): Recording {
  const said: string[] = [];

  return {
    speaker: {
      async speak(text: string) {
        said.push(text);
      },
    },
    spoken: () => said.slice(),
  };
}
