export { recordingSpeaker, scriptedListener } from "./ports.ts";

export {
  browserRecognizer,
  browserSpeaker,
  speechListener,
  speechSpeaker,
} from "./speech.ts";

export type { Heard, Listener, Recording, Speaker } from "./ports.ts";

export type {
  BrowserRecognition,
  PushListener,
  RecognitionSource,
  SpeechRecognizer,
  WebSynthesis,
  WebUtterance,
} from "./speech.ts";
