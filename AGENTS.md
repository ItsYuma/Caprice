# Caprice

Annoying desktop companion. She talks, and she uses the computer when she calls a tool. Read `CAPRI.md` before changing her voice. Read `MILESTONES.md` before adding a feature past the current milestone.

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
| `scripts/install.sh`          | Linux and macOS setup: tools and config                |
| `scripts/install.ps1`         | Windows setup. Same flags as `scripts/install.sh`      |
| `bun run dev`                 | Tauri window. Fills unset vars from the install config |
| `bun run dev -- --release`    | Same window. The Rust shell uses the release profile   |
| `cargo check`                 | Rust shell, from `packages/desktop/src-tauri`          |
| `cargo test`                  | Rust shell tests, from `packages/desktop/src-tauri`    |
| `cargo fmt`                   | Format the shell                                       |
| `cargo clippy -- -D warnings` | Rust lints for the shell. Warnings fail                |
| `cargo test`                  | League client, from `packages/games/league/rust`       |
| `cargo clippy -- -D warnings` | League client, from `packages/games/league/rust`       |

The shell needs Rust 1.99.1. Tauri 2.12 does not build on 1.83. `rust-toolchain.toml` at the repo root selects it. The Tauri CLI asks `rustc` from `packages/desktop`, and rustup only walks parent directories.

Rocky Linux 9, RHEL 9, and AlmaLinux 9 ship WebKitGTK 4.0. The window links WebKitGTK 4.1. `scripts/install.sh` installs Podman and distrobox, creates a Fedora container named `caprice`, and finishes setup inside it. `config.json` records that container. `bun run dev` enters it.

On Windows, `scripts/install.ps1` installs the Visual C++ build tools. Rust links with `link.exe` from that package.

Stable Bun 1.4.4 has `bun test`, `bun fmt`, and `bun check`. `bun lint` in that release is only a package script, so lint is Oxlint until a stable Bun ships the linter. When that lands, point `lint` at `bun lint` and keep the same rules.

## Layout

| Path                         | Owns                                                  |
| ---------------------------- | ----------------------------------------------------- |
| `packages/core`              | `Session`, `ToolLoopAgent`, `Tool`, MCP, persona       |
| `packages/voice`             | `Listener`, `Speaker`, STT, TTS, and VAD              |
| `packages/desktop`           | React window, `sayAndSpeak`, and which games load     |
| `packages/games/contract`    | The game plugin interface                             |
| `packages/games/league`      | League tools, followers, and the client crate         |
| `scripts/`                   | `install.sh`, `install.ps1`, and the dev launcher     |
| `skills/`                    | Text the local model reads                            |
| `docs/architecture.md`       | The diagram and the dependency rule                   |
| `docs/technical-directions/` | A decision later work would guess wrong without       |
| `CAPRI.md`                   | Character facts the product may use                   |
| `MILESTONES.md`              | What is next                                          |
| `tools/oxlint/anti-slop`     | Vendored upstream. Do not restyle it                  |

`packages/core` does not import `packages/voice`, `packages/desktop`, or `packages/games`. `packages/voice` does not import the other packages. A game package does not import core, voice, or desktop. The shell is the only composer. Rust opens the window. It does not own the session.

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

| Variable                   | What it is                                                                                     |
| -------------------------- | ---------------------------------------------------------------------------------------------- |
| `CAPRICE_MODEL_URL`        | Full URL that accepts a JSON body `{ model, messages }`                                        |
| `CAPRICE_MODEL`            | Model name sent in that body                                                                   |
| `CAPRICE_MODEL_API_KEY`    | Optional bearer token. Omit it when the endpoint does not need one                             |
| `CAPRICE_MODEL_PROTOCOL`   | Empty or `text` uses the whole-reply call convention. `native` sends registered function tools |
| `CAPRICE_MODEL_RUNTIME`    | Empty or `external` uses the endpoint as it is. `ollama` starts a configured child             |
| `CAPRICE_MODEL_EXECUTABLE` | Program for `ollama`. Required only for that runtime                                           |
| `CAPRICE_MCP`              | Optional JSON list of MCP servers. Empty means none                                           |

The assistant turn is `ToolLoopAgent`. Text and native both go through that one loop. `defineTool` adds a Zod schema on the existing tool type. That choice is `docs/technical-directions/agent-sdk.md`.

Inside the Tauri window, Rust reads the URL, the model name, and the bearer token. The page calls `model_complete` with the chat body and a request id, and `model_cancel` with that id. `model_endpoint` returns the model, the protocol, and the timeout. A managed runtime stops only a child it started and does not download model files. A page opened outside Tauri gets the same names through Vite and posts with `postJson`, so that endpoint must allow the page origin. `postJson` is the browser fetch for a JSON body. It sets `content-type: application/json`, and `Authorization: Bearer` when the key is non-empty. Spoken audio outside the window uses `postSpeech`, because the response is bytes. `packages/core` does not read the environment and does not open files.

`tryCatch` turns a rejected promise into a `Result<T>`. Success is `{ ok: true, value }`. Failure is `{ ok: false, error }`. `value` is typed only on the success branch. Check `ok` before reading it. `say`, `sayAndSpeak`, and the page do that check and pass a failure upward. The page paints the host line `say` already stored, then shows `error.message`. An `Error` rejection is kept. A string rejection becomes an `Error` with that string. Anything else becomes an `Error` whose message is the fallback passed to `tryCatch`.

## Voice

Hold Alt+Space or Ctrl+Space. Release to send. A tap does not send. Listening starts after `talkHoldDelay` in `packages/desktop/src/talk.ts`. The chords are `talkChords` in that file. The page is parked off-screen, so it never has focus. The shell hears those chords with the same global hook Handy uses, and it swallows them before the focused app sees them. That choice is `docs/technical-directions/talk-chord.md`. On macOS the hook needs Accessibility. On Linux it reads evdev, so the user needs the `input` group, and swallowing the chord needs write access to `/dev/uinput`. Without that, a window manager can still take Alt+Space. WebKitGTK does not matter for speech.

Nothing is drawn on the work area. The icon sits in the system tray, which Windows keeps at the end of the taskbar. The presence page runs in a window parked off that area so speech and League keep their timers. The tray menu is Settings, Stop, and Quit. Settings opens a decorated window. That choice is `docs/technical-directions/tray-presence.md`.

`listenAndSay` waits for `listen`, then runs `say`, then the speaker. `hear` is the transcript after the utterance ends, and `voice` ends when the audio bytes are ready, before playback. The listener is `captureListener`. Inside the Tauri window, Rust records the default microphone and loads Parakeet in that process. There is no `--speech-worker` child. The page calls `speech_listen_start`, `speech_listen_stop`, `speech_cancel`, `speech_speak`, and `speech_reply_cancel`. `scriptedListener` and `recordingSpeaker` stay for tests.

| Variable              | What it is                                                                                                                          |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `CAPRICE_STT_ENGINE`  | Empty or `parakeet` transcribes a Parakeet GGUF when the utterance ends. `http` posts the clip. `bark`, `bark-stream`, and `onnx` are retired |
| `CAPRICE_STT_MODEL`   | Parakeet GGUF path, or the model name for `http`                                                                                    |
| `CAPRICE_STT_URL`     | Full URL for HTTP speech. Required when the engine is `http`                                                                       |
| `CAPRICE_TTS_ENGINE`  | Empty or `http` is the POST. `piper` and `kokoro` can be selected and are not loaded yet                                           |
| `CAPRICE_TTS_URL`     | Full URL for a JSON body `{ model, input }`                                                                                         |
| `CAPRICE_TTS_MODEL`   | Model name sent in that body                                                                                                        |
| `CAPRICE_TTS_VOICE`   | Optional. HTTP adds `voice` when this is non-empty                                                                                  |
| `CAPRICE_TTS_API_KEY` | Optional bearer token. Omit it when the endpoint does not need one                                                                 |

Empty or `parakeet` loads one Parakeet GGUF through transcribe.cpp and transcribes the whole clip when the utterance ends. `http` posts that clip as a 16 kHz mono wav in `{ model, input }`. `models_list` discovers files under the app data `models` folder, or a directory chosen in settings. Recording mode `hold` is push-to-talk. `vad` ends the utterance after 800 ms under the energy gate. The default sensitivity is 40. Settings can restrict the talk chord to Alt+Space or Ctrl+Space. When settings are absent, both still work. That choice is `docs/technical-directions/local-speech.md`. No microphone name, host, or model id is hardcoded. Caprice does not start Handy and does not use the Web Speech API.

`CAPRICE_TTS_ENGINE` selects the spoken reply. Empty or `http` posts to `CAPRICE_TTS_URL` with `CAPRICE_TTS_MODEL`. Rust speaks inside the window and returns the bytes. The page colors those samples by raising the voice two semitones without shortening it, then two echoes 40 ms apart at -10 dB and -16 dB, then an 80 Hz sine tremolo at 15% wet. The first sample stays the first sample. The echo trail is 80 ms. That choice is `docs/technical-directions/reply-color.md`. `speech_credit` is empty. `scripts/install.sh` and `scripts/install.ps1` write `config.json` and do not download Bark or Woof. `bun run dev` fills any unset `CAPRICE_*` variable from that file. Outside Tauri the page does not invoke. Listening fails because the speech model is unavailable. Speaking uses `postSpeech` only when both `CAPRICE_TTS_URL` and `CAPRICE_TTS_MODEL` are set, and otherwise rejects with `speech is not configured`.

## League

`league_live` and `league_lcu` are the League tools. They live in `@caprice/league`. Desktop loads that package when `games_detected` finds the client or `enabledGames` includes `league`. The model sees `skills/host` from `## Contract` and `skills/league` from `## Play`, after the voice. A call is the whole reply, and the session runs it. The result is a host line the model answers from. A turn stops after four calls.

Rust calls `127.0.0.1` only, from `packages/games/league/rust`. `league_live` is the Live Client Data API on port 2999. `league_lcu` is the League client API. The port and the token come from the running client: its command line, then its lockfile. On Windows the command line is `LeagueClientUx.exe`, and the lockfile is also checked under the usual Riot folders on `C` through `H`. `CAPRICE_LEAGUE_LOCKFILE` is that lockfile when the install is somewhere else. The token is not shown to the model. Outside the Tauri window the tools are not loaded. While the Tauri window is open, the league package polls `/liveclientdata/allgamedata` through that same command. A new fact — the match starting or ending, your kill, death, or multikill, an objective, or one note that someone is fed or feeding — is spoken as one line that mocks or cheers, with tools refused. She does not talk over the host. The line is not saved in the thread. A dropped client is silence. On Summoner's Rift, a dragon, the voidgrubs, the herald, or baron before they can exist is ignored. Opening a match that is already past a minute and a half does not replay it.

A spoken queue, cancel, accept, ban, or pick is parsed and sent by the league package. She answers that command with tools refused, and the exchange is kept. A later step from that plan is spoken like a live-match line and is not kept. That choice is `docs/technical-directions/lobby-plan.md`.
