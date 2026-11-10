import type { PushListener, Speaker } from "@caprice/voice";
import { invoke } from "@tauri-apps/api/core";

import { playSpeech } from "./playback.ts";
import {
  pageListener,
  pageSpeaker,
  postSpeech,
  shellListener,
  shellSpeaker,
  speechHint,
  tauriCommands,
  type SpeechBridge,
  type TtsEnv,
} from "./speech.ts";

export type WindowVoice = {
  inShell: boolean;
  listener: PushListener;
  speaker: Speaker;
  hint: string;
  watchVoice: (ready: (ms: number) => void) => () => void;
};

export function windowVoice(): WindowVoice {
  const inShell = "__TAURI_INTERNALS__" in window;
  const commands = inShell ? tauriCommands(speechBridge()) : undefined;
  let noteVoice = (_ms: number) => {};

  const watchVoice = (ready: (ms: number) => void) => {
    const previous = noteVoice;

    noteVoice = ready;

    return () => {
      noteVoice = previous;
    };
  };

  const ready = (ms: number) => {
    noteVoice(ms);
  };

  return {
    inShell,
    hint: speechHint(inShell),
    watchVoice,
    listener: commands === undefined ? pageListener() : shellListener(commands),
    speaker:
      commands === undefined
        ? pageSpeaker(
            ttsEnv(),
            import.meta.env.CAPRICE_TTS_ENGINE ?? "",
            postSpeech,
            playSpeech,
            ready,
          )
        : shellSpeaker(commands, playSpeech, ready),
  };
}

function ttsEnv(): TtsEnv {
  return {
    CAPRICE_TTS_URL: import.meta.env.CAPRICE_TTS_URL,
    CAPRICE_TTS_MODEL: import.meta.env.CAPRICE_TTS_MODEL,
    CAPRICE_TTS_VOICE: import.meta.env.CAPRICE_TTS_VOICE,
    CAPRICE_TTS_API_KEY: import.meta.env.CAPRICE_TTS_API_KEY,
    CAPRICE_TTS_DEADLINE_MS: import.meta.env.CAPRICE_TTS_DEADLINE_MS,
  };
}

function speechBridge(): SpeechBridge {
  return {
    async run(command) {
      await invoke(command);
    },
    text(command) {
      return invoke<string>(command);
    },
    speak(command, text) {
      return invoke<string>(command, { text });
    },
  };
}
