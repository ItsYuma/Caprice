# Caprice

> "Hey, little baby. Wake up. Your computer has a girl in it now."

Annoying desktop companion inspired by Capri from _Cyberpunk: Edgerunners 2_. She talks back. Later she handles tasks, after you confirm them.

```sh
bun install
bun test
CAPRICE_MODEL_URL=http://your-brain/v1/chat/completions \
CAPRICE_MODEL=your-model \
CAPRICE_STT_MODEL=/path/to/parakeet-model \
CAPRICE_TTS_URL=http://your-voice/v1/audio/speech \
CAPRICE_TTS_MODEL=your-tts \
bun run dev
```

`CAPRICE_MODEL_URL` and `CAPRICE_MODEL` are required. Hearing needs `CAPRICE_STT_MODEL`, a directory of Parakeet ONNX files. The shell loads those int8 weights once and keeps them. Spoken replies also need `CAPRICE_TTS_URL` and `CAPRICE_TTS_MODEL`. Nothing in the repo picks a host, a port, or a model path.

How the repo is put together: `AGENTS.md` and `docs/architecture.md`. Who she is allowed to be: `CAPRI.md`. What is next: `MILESTONES.md`.
