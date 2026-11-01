import type { Heard, Listener, Speaker } from "./ports.ts";

export type PushListener = Listener & {
  release: () => void;
};

export type SpeechCapture = {
  stop: () => void;
};

export type SpeechRecognizer = {
  capture: (
    onText: (text: string) => void,
    onEnd: () => void,
    onError: (message: string) => void,
  ) => SpeechCapture;
};

export type RecognitionAlternative = {
  transcript: string;
};

export type RecognitionResult = {
  isFinal: boolean;
  length: number;
  item: (index: number) => RecognitionAlternative;
};

export type RecognitionResultList = {
  length: number;
  item: (index: number) => RecognitionResult;
};

export type RecognitionResultEvent = {
  resultIndex: number;
  results: RecognitionResultList;
};

export type RecognitionErrorEvent = {
  error: string;
};

export type BrowserRecognition = {
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: RecognitionResultEvent) => void) | null;
  onerror: ((event: RecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

export type RecognitionSource = {
  open: () => BrowserRecognition;
};

export type WebUtterance = {
  text: string;
  onend: (() => void) | null;
  onerror: (() => void) | null;
};

export type WebSynthesis = {
  prepare: () => void;
  speak: (utterance: WebUtterance) => void;
};

export type SpeechSynthesisEngine = {
  speak: (text: string) => Promise<void>;
};

type OpenListen = {
  stop: () => void;
};

export function speechListener(recognizer: SpeechRecognizer): PushListener {
  let current: OpenListen | undefined;
  let releasedEarly = false;

  return {
    release() {
      if (current === undefined) {
        releasedEarly = true;

        return;
      }

      current.stop();
    },
    listen() {
      if (current !== undefined) {
        return Promise.reject(new Error("already listening"));
      }

      const stopOnStart = releasedEarly;
      releasedEarly = false;
      let text = "";
      let done = false;
      let stop = () => {};

      const pending = new Promise<Heard>((resolve, reject) => {
        const capture = recognizer.capture(
          (next) => {
            text = next;
          },
          () => {
            if (done) {
              return;
            }

            done = true;
            current = undefined;
            resolve({ text: text.trim() });
          },
          (message) => {
            if (done) {
              return;
            }

            done = true;
            current = undefined;
            reject(new Error(message));
          },
        );

        stop = () => {
          capture.stop();
        };
      });

      if (!done) {
        current = { stop };

        if (stopOnStart) {
          stop();
        }
      }

      return pending;
    },
  };
}

export function speechSpeaker(engine: SpeechSynthesisEngine): Speaker {
  return {
    async speak(text) {
      const trimmed = text.trim();

      if (trimmed.length === 0) {
        return;
      }

      await engine.speak(trimmed);
    },
  };
}

export function browserRecognizer(source: RecognitionSource): SpeechRecognizer {
  return {
    capture(onText, onEnd, onError) {
      const recognition = source.open();
      let ended = false;

      const end = () => {
        if (ended) {
          return;
        }

        ended = true;
        onEnd();
      };

      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.onresult = (event) => {
        onText(transcript(event));
      };

      recognition.onerror = (event) => {
        // Silence is no-speech and a stop is aborted. The recognizer then fires end.
        if (event.error === "no-speech" || event.error === "aborted") {
          return;
        }

        onError(recognitionFailure(event.error));
      };

      recognition.onend = () => {
        end();
      };

      try {
        recognition.start();
      } catch (error) {
        onError(
          error instanceof Error ? error.message : "could not start listening",
        );
      }

      return {
        stop() {
          try {
            recognition.stop();
          } catch {
            end();
          }
        },
      };
    },
  };
}

export function browserSpeaker(
  synthesis: WebSynthesis,
  Utterance: new (text: string) => WebUtterance,
): Speaker {
  return speechSpeaker({
    speak(text) {
      synthesis.prepare();

      return new Promise((resolve, reject) => {
        const utterance = new Utterance(text);
        let settled = false;

        const finish = (settle: () => void) => {
          if (settled) {
            return;
          }

          settled = true;
          settle();
        };

        utterance.onend = () => {
          finish(resolve);
        };

        utterance.onerror = () => {
          finish(() => {
            reject(new Error("could not speak"));
          });
        };

        synthesis.speak(utterance);
      });
    },
  });
}

function transcript(event: RecognitionResultEvent): string {
  const parts: string[] = [];

  for (let index = 0; index < event.results.length; index += 1) {
    const result = event.results.item(index);

    if (result.length === 0) {
      continue;
    }

    parts.push(result.item(0).transcript);
  }

  return parts.join("");
}

function recognitionFailure(code: string): string {
  if (code === "not-allowed") {
    return "microphone permission is required";
  }

  if (code === "audio-capture") {
    return "no microphone is available";
  }

  if (code === "service-not-allowed") {
    return "speech recognition is unavailable in this window";
  }

  if (code === "network") {
    return "speech recognition failed in this browser engine";
  }

  return `speech recognition failed: ${code}`;
}
