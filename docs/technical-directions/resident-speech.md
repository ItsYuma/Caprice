# Resident speech

Speech-to-text runs in the Tauri process. The microphone and the weights stay there. TypeScript receives a transcript through `Listener`.

`ResidentStt` is the engine contract: samples in, text out. `SttEngine` is the set of engines the shell can load. The only variant is Parakeet, int8 ONNX, from the directory in `CAPRICE_STT_MODEL`. `transcribe-rs` 0.3.12 loads it, so `ort` stays pinned to `2.0.0-rc.12`. The shell loads that engine on the first transcription and keeps it until the window exits. A second engine is a new variant and a branch in the loader. Capture, resampling, and the listen commands stay as they are.

Spoken audio and the chat model stay HTTP. `CAPRICE_TTS_URL` and `CAPRICE_MODEL_URL` name the servers. The shell does not load those weights. A local server that Caprice must keep alive is a supervisor beside those clients, still behind `Speaker` and `Model`. A resident TTS engine, if one is linked later, is the same enum pattern on the speak side.

Set aside: a TypeScript worker that owns the weights, a Python sidecar, and loading the chat model in the shell. The page reloads, and those two models are already swappable by URL.
