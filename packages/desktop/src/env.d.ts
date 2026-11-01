interface ImportMetaEnv {
  readonly CAPRICE_MODEL_URL?: string;
  readonly CAPRICE_MODEL?: string;
  readonly CAPRICE_MODEL_API_KEY?: string;
}

interface Window {
  SpeechRecognition?: new () => import("@caprice/voice").BrowserRecognition;
  webkitSpeechRecognition?: new () => import("@caprice/voice").BrowserRecognition;
}
