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
};

export function windowVoice(): WindowVoice {
  const inShell = "__TAURI_INTERNALS__" in window;
  const commands = inShell ? tauriCommands(speechBridge()) : undefined;

  return {
    inShell,
    hint: speechHint(inShell),
    listener: commands === undefined ? pageListener() : shellListener(commands),
    speaker:
      commands === undefined
        ? pageSpeaker(
            ttsEnv(),
            import.meta.env.CAPRICE_TTS_ENGINE ?? "",
            postSpeech,
            playSpeech,
          )
        : shellSpeaker(commands, playSpeech),
  };
}

function ttsEnv(): TtsEnv {
  return {
    CAPRICE_TTS_URL: import.meta.env.CAPRICE_TTS_URL,
    CAPRICE_TTS_MODEL: import.meta.env.CAPRICE_TTS_MODEL,
    CAPRICE_TTS_VOICE: import.meta.env.CAPRICE_TTS_VOICE,
    CAPRICE_TTS_API_KEY: import.meta.env.CAPRICE_TTS_API_KEY,
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
