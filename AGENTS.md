# Caprice

Annoying desktop companion. She talks, and later she uses the computer when the host confirms it. Read `CAPRI.md` before changing her voice. Read `MILESTONES.md` before adding a feature past the current milestone.

## Commands

From the repo root, with Bun 1.4.4:

| Command                       | What it does                                           |
| ----------------------------- | ------------------------------------------------------ |
| `bun install`                 | Install the workspace                                  |
| `bun test`                    | Tests under `packages/` and `scripts/`                 |
| `bun run lint`                | Oxlint, including anti-slop                            |
| `bun fmt`                     | Format                                                 |
| `bun run format:check`        | Format check                                           |
| `bun run typecheck`           | `bun check` on each package                            |
| `scripts/install.sh`          | Linux and macOS setup: tools, Woof, Bark, config       |
| `scripts/install.ps1`         | Windows setup. Same flags as `scripts/install.sh`      |
| `bun run dev`                 | Tauri window. Fills unset vars from the install config |
| `bun run dev -- --release`    | Same window. The Rust shell uses the release profile   |
| `cargo check`                 | Rust shell, from `packages/desktop/src-tauri`          |
| `cargo test`                  | Rust shell tests, from `packages/desktop/src-tauri`    |
| `cargo fmt`                   | Format the shell                                       |
| `cargo clippy -- -D warnings` | Rust lints for the shell. Warnings fail                |

The shell needs Rust 1.99.1. Tauri 2.12 does not build on 1.83. `rust-toolchain.toml` at the repo root selects it. The Tauri CLI asks `rustc` from `packages/desktop`, and rustup only walks parent directories.

Rocky Linux 9, RHEL 9, and AlmaLinux 9 ship WebKitGTK 4.0. The window links WebKitGTK 4.1. `scripts/install.sh` installs Podman and distrobox, creates a Fedora container named `caprice`, and finishes setup inside it. `config.json` records that container. `bun run dev` enters it.

On Windows, `scripts/install.ps1` installs the Visual C++ build tools. Rust links with `link.exe` from that package.

Stable Bun 1.4.4 has `bun test`, `bun fmt`, and `bun check`. `bun lint` in that release is only a package script, so lint is Oxlint until a stable Bun ships the linter. When that lands, point `lint` at `bun lint` and keep the same rules.

## Layout

| Path                         | Owns                                                  |
| ---------------------------- | ----------------------------------------------------- |
| `packages/core`              | `Session`, `Model`, `Tool`, `Result`, persona slicing |
| `packages/voice`             | `Listener` and `Speaker`                              |
| `packages/desktop`           | React window and `sayAndSpeak`                        |
| `scripts/`                   | `install.sh`, `install.ps1`, and the dev launcher     |
| `skills/`                    | Text the local model reads                            |
| `docs/architecture.md`       | The diagram and the dependency rule                   |
| `docs/technical-directions/` | A decision later work would guess wrong without       |
| `CAPRI.md`                   | Character facts the product may use                   |
| `MILESTONES.md`              | What is next                                          |
| `tools/oxlint/anti-slop`     | Vendored upstream. Do not restyle it                  |

`packages/core` does not import `packages/voice` or `packages/desktop`. `packages/voice` does not import the other packages. The shell is the only composer. Rust opens the window. It does not own the session.

## Files

A file owns one job. Split it when a second job shows up: tests apart from the runtime, a new engine apart from capture, an HTTP client apart from the microphone. Rust tests for a module live in a sibling file included with `#[cfg(test)]`, so the implementation file stays the runtime. Leave a file together when the pieces are one behavior and splitting them would make that behavior harder to read.

## Docs

Update the doc that owns the fact in the same change that moves it.

- A command, a package, or a working rule: `AGENTS.md`
- A boundary or the diagram: `docs/architecture.md`
- A technical decision: `docs/technical-directions/`
- Her voice or a limit copied from the show: `CAPRI.md` and the skill under `skills/`
- Sequence of work: `MILESTONES.md`

Record a decision when the choice is between real alternatives and a later change would guess wrong without the note. One file per decision. Name it for the choice. State what was chosen, why, and what was set aside. Do not restate `docs/architecture.md`. Update the note when the choice changes. Delete it when the choice is gone.

Do not add a markdown file for a fact one of those can hold. Prefer one mermaid diagram updated in place over a new drawing. No design diaries, no changelog docs, no per-package essays.

## Comments

Do not add comments. A comment means the name is wrong or the function is doing too much. Fix that.

Comments that may stay:

- A license header
- A behavior forced by an external dependency, platform, vendor, or protocol, at the exact call
- `// prettier-ignore`, and a lint suppression whose rule is faulty, pedantic, or style-only
- A doc comment that is the public API contract
- An issue or RFC link for a constraint the code cannot express

Our own surprises do not get a comment. Rename, extract, or retype until the behavior is obvious.

Do not suppress a lint rule that catches real bugs or protects correctness. `eslint-disable`, `@ts-ignore`, and `@ts-expect-error` are not a fix. `SAFETY:` exists only because anti-slop requires it on a type assertion, and only when an external type forces the assertion. Otherwise delete the assertion.

`tools/oxlint/anti-slop` is upstream, comments included. Leave it alone.

## Lint

Anti-slop is vendored from `dmmulroy/anti-slop` at `13909c9e07590f5a85d93c62712259fe14a883f7`. Rules are errors in `oxlint.config.ts`. Effect rules stay off. We do not mock modules. We do not take `unknown` except on a type predicate's subject. We do not use `typeof` to narrow values. We do not name a local symbol with the substring `shape`. Rust warnings are errors: `cargo clippy -- -D warnings` from `packages/desktop/src-tauri`. `clippy` is a component in `rust-toolchain.toml`.

## Local model

`skills/capri/SKILL.md` is her voice. `personaText` starts at `## Voice`. `skills/host/SKILL.md` is the tool contract. When a skill's job changes, change the skill and the test that pins its heading. Do not copy the skill into TypeScript.

The window talks to whatever chat endpoint the environment names. Set both of these before `bun run dev`. There is no default host, port, or model name.

| Variable                | What it is                                                         |
| ----------------------- | ------------------------------------------------------------------ |
| `CAPRICE_MODEL_URL`     | Full URL that accepts a JSON body `{ model, messages }`            |
| `CAPRICE_MODEL`         | Model name sent in that body                                       |
| `CAPRICE_MODEL_API_KEY` | Optional bearer token. Omit it when the endpoint does not need one |

Inside the Tauri window, Rust reads those variables when the page asks and posts the chat body. A page opened outside Tauri gets the same names through Vite and posts with `postJson`, so that endpoint must allow the page origin. `postJson` is the browser fetch for a JSON body. It sets `content-type: application/json`, and `Authorization: Bearer` when the key is non-empty. Spoken audio outside the window uses `postSpeech`, because the response is bytes. `packages/core` does not read the environment and does not open files.

`tryCatch` turns a rejected promise into a `Result<T>`. Success is `{ ok: true, value }`. Failure is `{ ok: false, error }`. `value` is typed only on the success branch. Check `ok` before reading it. `say`, `sayAndSpeak`, and the page do that check and pass a failure upward. The page paints the host line `say` already stored, then shows `error.message`. An `Error` rejection is kept. A string rejection becomes an `Error` with that string. Anything else becomes an `Error` whose message is the fallback passed to `tryCatch`.

## Voice

Hold Alt+Space or Ctrl+Space while the Caprice window is focused, or hold the box. Release to send. A tap does not send. Listening starts after `talkHoldDelay` in `packages/desktop/src/talk.ts`, so a click that only focuses the window does not run a turn. The chords are `talkChords` in that file. They are window shortcuts, so they do not register a global hotkey. A window manager that already owns Alt+Space can swallow that chord before the page sees it. Ctrl+Space still works. The box still works. WebKitGTK does not matter for speech.

`listenAndSay` waits for `listen`, then runs `say`, then the speaker. The box keeps the last turn's `hear`, `reply`, and `voice` times so a slow hello shows which step waited. `hear` starts at release, and `voice` ends when the audio bytes are ready, before playback. The listener is `captureListener`. Inside the Tauri window, Rust records the default microphone and sends the clip to a speech worker. The worker is this binary started with `--speech-worker`. It loads the model once and stays until the window exits. The page calls `speech_listen_start`, `speech_listen_stop`, and `speech_speak`. `scriptedListener` and `recordingSpeaker` stay for tests.

| Variable              | What it is                                                                                                                                                           |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CAPRICE_STT_ENGINE`  | Speech engine name. Empty or `onnx` loads the int8 ONNX directory. `bark` loads a Parakeet safetensors checkpoint. Any other name is an error                        |
| `CAPRICE_STT_MODEL`   | Directory for that engine. ONNX needs the encoder, the decoder, `nemo128.onnx`, and `vocab.txt`. Bark needs `config.json`, `tokenizer.json`, and `model.safetensors` |
| `CAPRICE_TTS_ENGINE`  | Empty or `http` is the POST. `woof` is the resident child                                                                                                            |
| `CAPRICE_TTS_WOOF`    | Underdog Woof directory. The installer stores the Hugging Face checkout here                                                                                         |
| `CAPRICE_PYTHON`      | Interpreter for the Woof child. Empty uses `python3`                                                                                                                 |
| `CAPRICE_TTS_URL`     | Full URL for a JSON body `{ model, input }`                                                                                                                          |
| `CAPRICE_TTS_MODEL`   | Model name sent in that body                                                                                                                                         |
| `CAPRICE_TTS_VOICE`   | Optional. HTTP adds `voice` when this is non-empty. Woof uses empty or `juno` for Juno and `mira` for Mira                                                           |
| `CAPRICE_TTS_API_KEY` | Optional bearer token. Omit it when the endpoint does not need one                                                                                                   |

The ONNX variant loads the int8 weights through `transcribe-rs`. The Bark variant loads the safetensors checkpoint through telmo, in bf16, and prepends a quarter second of silence. Another speech model is a new engine variant in that worker, not a new language. No microphone name, host, or model id is hardcoded. Caprice does not start Handy and does not use the Web Speech API.

`CAPRICE_TTS_ENGINE` selects the spoken reply. Empty or `http` posts to `CAPRICE_TTS_URL` with `CAPRICE_TTS_MODEL`. `woof` is a resident child. `CAPRICE_PYTHON` is that interpreter when it is set, and empty uses `python3`. `CAPRICE_TTS_WOOF` is the Underdog Woof directory. Rust speaks inside the window and returns the bytes. The page plays them. `speech_credit` is `Voice by Underdog Woof` for `woof`, and empty for HTTP. `scripts/install.sh` and `scripts/install.ps1` download Woof and Bark into the user data directory and write `config.json`. `bun run dev` fills any unset `CAPRICE_*` variable from that file. Outside Tauri the page does not invoke. Listening fails because the speech model is unavailable. Speaking uses `postSpeech` only when both `CAPRICE_TTS_URL` and `CAPRICE_TTS_MODEL` are set, and otherwise rejects with `speech is not configured`.
