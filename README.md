# Caprice

> "Hey, little baby. Wake up. Your computer has a girl in it now."

Annoying desktop companion inspired by Capri from _Cyberpunk: Edgerunners 2_. She talks back, and she calls a tool when she needs one.

```sh
scripts/install.sh --model-url http://your-brain/v1/chat/completions --model your-model
bun run dev
```

On Windows, run `powershell -ExecutionPolicy Bypass -File scripts\install.ps1` with the same two flags. The script installs the Visual C++ build tools, and `bun run dev` puts `%USERPROFILE%\.cargo\bin` on `PATH`. The installer writes `config.json` under the user data directory (`~/.local/share/caprice` on Linux, `~/Library/Application Support/caprice` on macOS, `%LOCALAPPDATA%\caprice` on Windows). Models live in that directory's `models` folder. `bun run dev` reads the config when the variables are unset. The first launch compiles the window. `--voice` is an optional HTTP voice.

Rocky Linux 9, RHEL 9, and AlmaLinux 9 ship WebKitGTK 4.0. The installer creates a Fedora container named `caprice` and the window runs there. `bun run dev` enters that container.

The window is the chamfered box, with no title bar and no transcript. It says thinking, then shows a sine wave while the reply plays. The last 20 lines stay in `localStorage` for the next launch. The screen does not show them.

`CAPRICE_MODEL_URL` and `CAPRICE_MODEL` are required. Hearing uses a Parakeet GGUF at `CAPRICE_STT_MODEL`, or HTTP when `CAPRICE_STT_ENGINE` is `http`. Empty speech engine means Parakeet, and the clip is transcribed when the talk key is released. Spoken replies use `CAPRICE_TTS_ENGINE`. Empty or `http` also needs `CAPRICE_TTS_URL` and `CAPRICE_TTS_MODEL`. Nothing in the repo picks a host, a port, or a model path. The tray opens Settings for the model directory, the provider, and the talk chord.

How the repo is put together: `AGENTS.md` and `docs/architecture.md`. Why each model lives where it does: `docs/technical-directions/`. Who she is allowed to be: `CAPRI.md`. What is next: `MILESTONES.md`.
