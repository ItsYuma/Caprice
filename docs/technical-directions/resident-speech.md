# Resident speech

Speech-to-text runs in the Tauri process. The microphone and the weights stay there. TypeScript receives a transcript through `Listener`.

The speech model we want is [Underdog Bark 3.0 Pro](https://huggingface.co/ConwayResearch/Underdog-Bark-3.0-Pro). It is an English Parakeet-TDT 0.6B model. The published weights are BF16 `model.safetensors`, plus Core ML and MLX packages. The licence is CC BY-NC 4.0. It loads in Python as `ParakeetForTDT`, or in Swift on Apple silicon. It does not ship the int8 ONNX files.

`ResidentStt` is the engine contract: samples in, text out. `SttEngine` is the set of engines the shell can load. The only variant today is the ONNX loader in `transcribe-rs` 0.3.12, so `ort` stays pinned to `2.0.0-rc.12`. `CAPRICE_STT_MODEL` is a directory with the encoder, the decoder, `nemo128.onnx`, and `vocab.txt`. At startup the slot is empty. The first transcription reads that directory, calls `ParakeetModel::load` with int8 weights, and stores the engine. Later transcriptions reuse it until the window exits. Captured audio is resampled to 16 kHz mono before it is transcribed. That loader cannot open Bark's safetensors. A Bark engine is a new variant and a branch in the loader, once a runtime can keep those weights resident without a Python process. Capture, resampling, and the listen commands stay as they are.

Chat and spoken replies are HTTP. Those choices are `chat-over-http.md` and `tts-over-http.md`.

Set aside: Whisper, the Handy ONNX bundle as the model we ship, a TypeScript worker that owns the weights, and a Python sidecar. The page reloads, and Bark's Python path is the sidecar we already removed.
