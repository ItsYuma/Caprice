import { expect, test } from "bun:test";

import {
  browserRecognizer,
  browserSpeaker,
  speechListener,
  speechSpeaker,
  type BrowserRecognition,
  type RecognitionResultEvent,
  type WebUtterance,
} from "./speech.ts";

test("speech listener returns the text held until release", async () => {
  const manual = manualRecognizer();
  const listener = speechListener(manual.recognizer);
  const pending = listener.listen();

  manual.say("wake up");
  listener.release();

  expect(manual.stopped()).toBe(true);
  expect(await pending).toEqual({ text: "wake up" });
});

test("speech listener trims and ignores a second release", async () => {
  const manual = manualRecognizer();
  const listener = speechListener(manual.recognizer);
  const pending = listener.listen();

  manual.say("  hey  ");
  listener.release();
  listener.release();

  expect(await pending).toEqual({ text: "hey" });
});

test("speech listener resolves empty when released with no words", async () => {
  const manual = manualRecognizer();
  const listener = speechListener(manual.recognizer);
  const pending = listener.listen();

  listener.release();

  expect(await pending).toEqual({ text: "" });
});

test("speech listener stops a listen that starts after release", async () => {
  const manual = manualRecognizer();
  const listener = speechListener(manual.recognizer);

  listener.release();

  const pending = listener.listen();

  expect(manual.stopped()).toBe(true);
  expect(await pending).toEqual({ text: "" });

  const again = listener.listen();

  manual.say("later");
  listener.release();
  expect(await again).toEqual({ text: "later" });
});

test("speech listener rejects a second listen and a recognizer error", async () => {
  const manual = manualRecognizer();
  const listener = speechListener(manual.recognizer);
  const pending = listener.listen();

  expect(listener.listen()).rejects.toThrow("already listening");
  manual.fail("microphone permission is required");

  expect(pending).rejects.toThrow("microphone permission is required");
});

test("browser recognizer holds until stop and keeps the latest transcript", async () => {
  const fake = fakeRecognition();

  const listener = speechListener(
    browserRecognizer({ open: () => fake.recognition }),
  );

  const pending = listener.listen();

  expect(fake.recognition.continuous).toBe(true);
  expect(fake.recognition.interimResults).toBe(true);
  expect(fake.started()).toBe(true);
  fake.emit(resultEvent(["wake ", "up"]));
  listener.release();

  expect(fake.stopped()).toBe(true);
  expect(await pending).toEqual({ text: "wake up" });
});

test("browser recognizer treats silence as an empty result", async () => {
  const fake = fakeRecognition();

  const listener = speechListener(
    browserRecognizer({ open: () => fake.recognition }),
  );

  const pending = listener.listen();

  fake.silence();

  expect(await pending).toEqual({ text: "" });
});

test("browser recognizer asks for the microphone when permission is refused", async () => {
  const fake = fakeRecognition();

  const listener = speechListener(
    browserRecognizer({ open: () => fake.recognition }),
  );

  const pending = listener.listen();

  fake.fail("not-allowed");

  expect(pending).rejects.toThrow("microphone permission is required");
});

test("browser recognizer reports a missing service", async () => {
  const fake = fakeRecognition();

  const listener = speechListener(
    browserRecognizer({ open: () => fake.recognition }),
  );

  const pending = listener.listen();

  fake.fail("service-not-allowed");

  expect(pending).rejects.toThrow("speech recognition is unavailable");
});

test("speech speaker skips blank text and speaks the rest", async () => {
  const spoken: string[] = [];

  const speaker = speechSpeaker({
    async speak(text) {
      spoken.push(text);
    },
  });

  await speaker.speak("   ");
  await speaker.speak("  hey  ");

  expect(spoken).toEqual(["hey"]);
});

test("browser speaker speaks the trimmed line and finishes on end", async () => {
  const sink = utteranceSink();
  const speaker = browserSpeaker(sink.synthesis, FakeUtterance);

  const pending = speaker.speak("  hey  ");

  expect(sink.prepared()).toBe(1);
  expect(sink.spoken()).toEqual(["hey"]);
  sink.finish();
  await pending;
});

test("browser speaker does not prepare voices for a blank line", async () => {
  const sink = utteranceSink();
  const speaker = browserSpeaker(sink.synthesis, FakeUtterance);

  await speaker.speak(" ");

  expect(sink.prepared()).toBe(0);
  expect(sink.spoken()).toEqual([]);
});

test("browser speaker rejects when the utterance fails", async () => {
  const sink = utteranceSink();
  const speaker = browserSpeaker(sink.synthesis, FakeUtterance);
  const pending = speaker.speak("hey");

  sink.fail();

  expect(pending).rejects.toThrow("could not speak");
});

function manualRecognizer() {
  let onText: (text: string) => void = () => {};
  let onEnd: () => void = () => {};
  let onError: (message: string) => void = () => {};
  let stopped = false;

  return {
    recognizer: {
      capture(
        text: (value: string) => void,
        end: () => void,
        error: (message: string) => void,
      ) {
        onText = text;
        onEnd = end;
        onError = error;
        stopped = false;

        return {
          stop() {
            stopped = true;
            onEnd();
          },
        };
      },
    },
    say(text: string) {
      onText(text);
    },
    fail(message: string) {
      onError(message);
    },
    stopped: () => stopped,
  };
}

function fakeRecognition() {
  let started = false;
  let stopped = false;

  const recognition: BrowserRecognition = {
    continuous: false,
    interimResults: false,
    onresult: null,
    onerror: null,
    onend: null,
    start() {
      started = true;
    },
    stop() {
      stopped = true;
      recognition.onend?.();
    },
  };

  return {
    recognition,
    started: () => started,
    stopped: () => stopped,
    emit(event: RecognitionResultEvent) {
      recognition.onresult?.(event);
    },
    silence() {
      recognition.onerror?.({ error: "no-speech" });
      recognition.onend?.();
    },
    fail(code: string) {
      recognition.onerror?.({ error: code });
      recognition.onend?.();
    },
  };
}

function resultEvent(lines: readonly string[]): RecognitionResultEvent {
  return {
    resultIndex: 0,
    results: {
      length: lines.length,
      item(index) {
        const line = lines[index] ?? "";

        return {
          isFinal: index < lines.length - 1,
          length: 1,
          item() {
            return { transcript: line };
          },
        };
      },
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

function utteranceSink() {
  let prepared = 0;
  const spoken: FakeUtterance[] = [];

  return {
    synthesis: {
      prepare() {
        prepared += 1;
      },
      speak(utterance: WebUtterance) {
        if (utterance instanceof FakeUtterance) {
          spoken.push(utterance);
        }
      },
    },
    prepared: () => prepared,
    spoken: () => spoken.map((utterance) => utterance.text),
    finish() {
      spoken.at(-1)?.onend?.();
    },
    fail() {
      spoken.at(-1)?.onerror?.();
    },
  };
}
