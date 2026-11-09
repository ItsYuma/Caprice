# Caprice

> "Hey, little baby. Wake up. Your computer has a girl in it now."

Annoying desktop companion inspired by Capri from _Cyberpunk: Edgerunners 2_. She talks back, and she calls a tool when she needs one.

```sh
scripts/install.sh --model-url http://your-brain/v1/chat/completions --model your-model
bun run dev
```

On Windows, run `powershell -ExecutionPolicy Bypass -File scripts\install.ps1` with the same two flags. The Store `python.exe` alias is ignored. The script installs Python 3.12 for the current user, the Visual C++ build tools, and `bun run dev` puts `%USERPROFILE%\.cargo\bin` on `PATH`. The installer downloads Underdog Woof and Underdog Bark, creates a Python environment with numpy, and writes `config.json` under the user data directory (`~/.local/share/caprice` on Linux, `~/Library/Application Support/caprice` on macOS, `%LOCALAPPDATA%\caprice` on Windows). `bun run dev` reads that file when the variables are unset. The first launch compiles the window. `--voice mira` selects Mira. Empty or `juno` is Juno.

Rocky Linux 9, RHEL 9, and AlmaLinux 9 ship WebKitGTK 4.0. The installer creates a Fedora container named `caprice` and the window runs there. `bun run dev` enters that container.

The window is the chamfered box, with no title bar and no transcript. It says thinking, then shows a sine wave while the reply plays. The last 20 lines stay in `localStorage` for the next launch. The screen does not show them.

`CAPRICE_MODEL_URL` and `CAPRICE_MODEL` are required. Hearing needs `CAPRICE_STT_MODEL`. `CAPRICE_STT_ENGINE=bark` loads Underdog Bark 3.0 Pro from that directory (`config.json`, `tokenizer.json`, `model.safetensors`) once. Empty `CAPRICE_STT_ENGINE`, or `onnx`, loads an int8 ONNX directory (`encoder`, decoder, `nemo128.onnx`, `vocab.txt`) instead. Spoken replies use `CAPRICE_TTS_ENGINE`. Empty or `http` also needs `CAPRICE_TTS_URL` and `CAPRICE_TTS_MODEL`. `woof` needs `CAPRICE_TTS_WOOF`. `CAPRICE_PYTHON` is the interpreter when it is set. Empty uses `python3`. Nothing in the repo picks a host, a port, or a model path. The Bark weights are CC BY-NC 4.0. Woof's credit line is `Voice by Underdog Woof`. Commercial use is outside that licence.

How the repo is put together: `AGENTS.md` and `docs/architecture.md`. Why each model lives where it does: `docs/technical-directions/`. Who she is allowed to be: `CAPRI.md`. What is next: `MILESTONES.md`.
