# Local speech

The microphone and the weights stay in the Tauri process. TypeScript receives a transcript through `Listener`. There is no `--speech-worker` child.

`CAPRICE_STT_ENGINE` selects the listener. Empty or `parakeet` loads one Parakeet GGUF through `transcribe-cpp`. Parakeet is a streaming model: while the key is held, newly recorded samples are resampled to 16 kHz and fed to its buffered stream, 5.6 seconds of left context, an 0.08 second chunk, and 0.08 seconds of right context. Release flushes the tail and finalizes. `hear` for that engine is the tail after release. That is the runtime Handy uses. Caprice does not shell out to Handy. `http` does not stream. It posts the whole clip as a 16 kHz mono wav, base64, in `{ model, input }` to `CAPRICE_STT_URL` with `CAPRICE_STT_MODEL`, and reads `text` when the body is JSON. Both values are required for that engine. A model that cannot stream waits for release and transcribes the clip once.

`models_list` reads a directory. An empty argument is the app data `models` folder. A `*.gguf` whose name contains `parakeet` is family `parakeet`, role `stt`, and the only loadable entry. Other GGUF files are `gguf`. A directory with Bark's `config.json`, `tokenizer.json`, and `model.safetensors` is `bark`. An encoder and decoder ONNX pair is `onnx`. Piper and Kokoro names are `tts`. Nothing else is loaded. `bytes` is the size. `languages` and `note` are what a settings row shows.

Recording mode `hold` is push-to-talk and ignores voice activity. Mode `vad` uses the same energy gate as `voiced` in `packages/voice`: `threshold = 0.08 - (clamp(sensitivity, 0, 100) / 100) * 0.07`. Once speech has started, 800 ms under that threshold ends the utterance. The default mode is `hold`. The default sensitivity is 40.

Spoken replies stay a separate engine (`spoken-reply.md`). Chat stays HTTP (`chat-over-http.md`).

Set aside: the resident `--speech-worker`, Bark through telmo, `bark-stream`, ONNX through `transcribe-rs` and the pinned `ort` build, and the Python Underdog Woof child. Also set aside: shelling out to Handy, Whisper, and a second language runtime for the weights.
