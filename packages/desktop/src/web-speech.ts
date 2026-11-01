import {
  browserRecognizer,
  browserSpeaker,
  speechListener,
  speechSpeaker,
  type PushListener,
  type RecognitionSource,
  type Speaker,
  type WebSynthesis,
  type WebUtterance,
} from "@caprice/voice";

export const listenLimit =
  "this window has no speech recognition. WebKit on Linux does not provide it. Listening needs microphone permission where the webview has it.";

export const speakLimit = "this window has no speech synthesis.";

export type WebSpeechParts = {
  recognition: RecognitionSource | undefined;
  synthesis: WebSynthesis | undefined;
  utterance: (new (text: string) => WebUtterance) | undefined;
};

export type WindowVoice = {
  listener: PushListener;
  speaker: Speaker;
  listenLimit: string | undefined;
};

export function voiceFromParts(parts: WebSpeechParts): WindowVoice {
  return {
    listener: listenerFrom(parts.recognition),
    speaker: speakerFrom(parts.synthesis, parts.utterance),
    listenLimit: parts.recognition === undefined ? listenLimit : undefined,
  };
}

export function readWindowSpeech(): WebSpeechParts {
  const spoken = readSynthesis();

  return {
    recognition: readRecognition(),
    synthesis: spoken?.synthesis,
    utterance: spoken?.utterance,
  };
}

function listenerFrom(
  recognition: RecognitionSource | undefined,
): PushListener {
  if (recognition === undefined) {
    return {
      release() {},
      async listen() {
        throw new Error(listenLimit);
      },
    };
  }

  return speechListener(browserRecognizer(recognition));
}

function speakerFrom(
  synthesis: WebSynthesis | undefined,
  utterance: (new (text: string) => WebUtterance) | undefined,
): Speaker {
  if (synthesis === undefined || utterance === undefined) {
    return speechSpeaker({
      async speak() {
        throw new Error(speakLimit);
      },
    });
  }

  return browserSpeaker(synthesis, utterance);
}

function readRecognition(): RecognitionSource | undefined {
  // WebKit exposes recognition as webkitSpeechRecognition. WebKitGTK 2.52 leaves both unset.
  const Maker = window.SpeechRecognition ?? window.webkitSpeechRecognition;

  if (Maker === undefined) {
    return undefined;
  }

  return {
    open() {
      return new Maker();
    },
  };
}

function readSynthesis():
  | {
      synthesis: WebSynthesis;
      utterance: new (text: string) => WebUtterance;
    }
  | undefined {
  // The DOM type marks speechSynthesis as always present. WebKitGTK omits it.
  if (
    typeof window.speechSynthesis === "undefined" ||
    typeof window.SpeechSynthesisUtterance === "undefined"
  ) {
    return undefined;
  }

  const synthesis = window.speechSynthesis;
  const DomUtterance = window.SpeechSynthesisUtterance;
  const reals = new WeakMap<WebUtterance, SpeechSynthesisUtterance>();

  class Spoken implements WebUtterance {
    onend: (() => void) | null = null;
    onerror: (() => void) | null = null;
    readonly text: string;

    constructor(text: string) {
      this.text = text;
      reals.set(this, new DomUtterance(text));
    }
  }

  return {
    utterance: Spoken,
    synthesis: {
      prepare() {
        // Chromium drops speech until the voice list has been read.
        synthesis.getVoices();
      },
      speak(utterance) {
        const real = reals.get(utterance);

        if (real === undefined) {
          throw new Error(speakLimit);
        }

        real.onend = () => {
          utterance.onend?.();
        };

        real.onerror = () => {
          utterance.onerror?.();
        };

        // Chromium pauses the speech service after a gap and then never fires end.
        if (synthesis.paused) {
          synthesis.resume();
        }

        synthesis.speak(real);
      },
    },
  };
}
