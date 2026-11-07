# Resident speech

Speech-to-text runs in the Tauri process. The microphone and the weights stay there. TypeScript receives a transcript through `Listener`.

`ResidentStt` is the engine contract: samples in, text out. `SttEngine` is the set of engines the shell can load. The only variant is Parakeet, int8 ONNX, from the directory in `CAPRICE_STT_MODEL`. The directory holds the encoder, the decoder, `nemo128.onnx`, and `vocab.txt`. `transcribe-rs` 0.3.12 loads it, so `ort` stays pinned to `2.0.0-rc.12`.

At startup the slot is empty. The first transcription reads that directory, calls `ParakeetModel::load` with int8 weights, and stores the engine. Later transcriptions reuse it until the window exits. Captured audio is resampled to 16 kHz mono before it is transcribed. A second engine is a new variant and a branch in the loader. Capture, resampling, and the listen commands stay as they are.

Chat and spoken replies are HTTP. Those choices are `chat-over-http.md` and `tts-over-http.md`.

Set aside: Whisper, a TypeScript worker that owns the weights, and a Python sidecar. The model in use is Parakeet, and the page reloads.
