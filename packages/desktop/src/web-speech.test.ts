import { expect, test } from "bun:test";

import type { BrowserRecognition, WebUtterance } from "@caprice/voice";

import { listenLimit, speakLimit, voiceFromParts } from "./web-speech.ts";

test("a window without web speech reports that limit and still has both ports", async () => {
  const voice = voiceFromParts({
    recognition: undefined,
    synthesis: undefined,
    utterance: undefined,
  });

  expect(voice.listenLimit).toBe(listenLimit);
  expect(voice.listener.listen()).rejects.toThrow(listenLimit);
  expect(voice.speaker.speak("hey")).rejects.toThrow(speakLimit);
  await voice.speaker.speak("   ");
});

test("voice from parts listens through recognition and speaks through synthesis", async () => {
  const fake = fakeRecognition();
  const spoken: string[] = [];

  const voice = voiceFromParts({
    recognition: { open: () => fake.recognition },
    synthesis: {
      prepare() {},
      speak(utterance) {
        spoken.push(utterance.text);
        utterance.onend?.();
      },
    },
    utterance: FakeUtterance,
  });

  const pending = voice.listener.listen();

  expect(voice.listenLimit).toBeUndefined();
  fake.emit("yo");
  voice.listener.release();

  expect(await pending).toEqual({ text: "yo" });
  await voice.speaker.speak("hey");
  expect(spoken).toEqual(["hey"]);
});

test("synthesis can exist when recognition does not", async () => {
  const spoken: string[] = [];

  const voice = voiceFromParts({
    recognition: undefined,
    synthesis: {
      prepare() {},
      speak(utterance) {
        spoken.push(utterance.text);
        utterance.onend?.();
      },
    },
    utterance: FakeUtterance,
  });

  expect(voice.listenLimit).toBe(listenLimit);
  await voice.speaker.speak("hey");
  expect(spoken).toEqual(["hey"]);
});

function fakeRecognition() {
  const recognition: BrowserRecognition = {
    continuous: false,
    interimResults: false,
    onresult: null,
    onerror: null,
    onend: null,
    start() {},
    stop() {
      recognition.onend?.();
    },
  };

  return {
    recognition,
    emit(text: string) {
      recognition.onresult?.({
        resultIndex: 0,
        results: {
          length: 1,
          item() {
            return {
              isFinal: true,
              length: 1,
              item() {
                return { transcript: text };
              },
            };
          },
        },
      });
    },
  };
}

class FakeUtterance implements WebUtterance {
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readonly text: string;

  constructor(text: string) {
    this.text = text;
  }
}
