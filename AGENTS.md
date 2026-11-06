# Caprice

Annoying desktop companion. She talks, and later she uses the computer when the host confirms it. Read `CAPRI.md` before changing her voice. Read `MILESTONES.md` before adding a feature past the current milestone.

## Commands

From the repo root, with Bun 1.4.4:

| Command                                    | What it does                                        |
| ------------------------------------------ | --------------------------------------------------- |
| `bun install`                              | Install the workspace                               |
| `bun test`                                 | Tests under `packages/`                             |
| `bun run lint`                             | Oxlint, including anti-slop                         |
| `bun fmt`                                  | Format                                              |
| `bun run format:check`                     | Format check                                        |
| `bun run typecheck`                        | `bun check` on each package                         |
| `bun run dev`                              | Tauri window                                        |
| `cargo check`                              | Rust shell, from `packages/desktop/src-tauri`       |
| `cargo test`                               | Rust shell tests, from `packages/desktop/src-tauri` |
| `cargo fmt`                                | Format the shell                                    |
| `python3 -m unittest speech/serve_test.py` | Speech worker protocol                              |

The shell needs Rust 1.99.1. Tauri 2.12 does not build on 1.83. `packages/desktop/src-tauri/rust-toolchain.toml` selects it.

Stable Bun 1.4.4 has `bun test`, `bun fmt`, and `bun check`. `bun lint` in that release is only a package script, so lint is Oxlint until a stable Bun ships the linter. When that lands, point `lint` at `bun lint` and keep the same rules.

## Layout

| Path                     | Owns                                        |
| ------------------------ | ------------------------------------------- |
| `packages/core`          | `Session`, `Model`, `Tool`, persona slicing |
| `packages/voice`         | `Listener` and `Speaker`                    |
| `packages/desktop`       | Tauri window and `sayAndSpeak`              |
| `skills/`                | Text the local model reads                  |
| `docs/architecture.md`   | The diagram and the dependency rule         |
| `CAPRI.md`               | Character facts the product may use         |
| `MILESTONES.md`          | What is next                                |
| `tools/oxlint/anti-slop` | Vendored upstream. Do not restyle it        |

`packages/core` does not import `packages/voice` or `packages/desktop`. `packages/voice` does not import the other packages. The shell is the only composer. Rust opens the window. It does not own the session.

## Docs

Update the doc that owns the fact in the same change that moves it.

- A command, a package, or a working rule: `AGENTS.md`
- A boundary or the diagram: `docs/architecture.md`
- Her voice or a limit copied from the show: `CAPRI.md` and the skill under `skills/`
- Sequence of work: `MILESTONES.md`

Do not add a markdown file for a fact one of those can hold. A new doc needs a reason those cannot. Prefer one mermaid diagram updated in place over a new drawing. No design diaries, no changelog docs, no per-package essays.

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

Anti-slop is vendored from `dmmulroy/anti-slop` at `13909c9e07590f5a85d93c62712259fe14a883f7`. Rules are errors in `oxlint.config.ts`. Effect rules stay off. We do not mock modules. We do not take `unknown` except on a type predicate's subject. We do not use `typeof` to narrow values. We do not name a local symbol with the substring `shape`.

## Local model

`skills/capri/SKILL.md` is her voice. `personaText` starts at `## Voice`. `skills/host/SKILL.md` is the tool contract. When a skill's job changes, change the skill and the test that pins its heading. Do not copy the skill into TypeScript.

The window talks to whatever chat endpoint the environment names. Set both of these before `bun run dev`. There is no default host, port, or model name.

| Variable                | What it is                                                         |
| ----------------------- | ------------------------------------------------------------------ |
| `CAPRICE_MODEL_URL`     | Full URL that accepts a JSON body `{ model, messages }`            |
| `CAPRICE_MODEL`         | Model name sent in that body                                       |
| `CAPRICE_MODEL_API_KEY` | Optional bearer token. Omit it when the endpoint does not need one |

Inside the Tauri window, Rust reads those variables when the page asks and posts the chat body. A page opened outside Tauri gets the same names through Vite and posts itself, so that endpoint must allow the page origin. `packages/core` does not read the environment and does not open files.

## Voice

Hold Alt+Space while the Caprice window is focused, or hold the button. Release to send. The chord is `talkChord` in `packages/desktop/src/talk.ts`. It is a window shortcut, so it does not register a global hotkey. A window manager that already owns Alt+Space can swallow the chord before the page sees it. The button still works. WebKitGTK does not matter for speech.

`listenAndSay` waits for `listen`, then runs `say`, then the speaker. The listener is `captureListener`. Inside the Tauri window, Rust records the default microphone and a resident worker transcribes a wav path. The worker is a Python process. Protocol is JSON lines on stdin/stdout. It loads once and stays up until the window process exits. The page calls `speech_listen_start`, `speech_listen_stop`, and `speech_speak`. `scriptedListener` and `recordingSpeaker` stay for tests.

| Variable               | What it is                                                         |
| ---------------------- | ------------------------------------------------------------------ |
| `CAPRICE_STT_WORKER`   | Script path                                                        |
| `CAPRICE_STT_PYTHON`   | Interpreter override. The shell uses `python3` when this is unset  |
| `CAPRICE_STT_MODEL`    | Required by that script                                            |
| `CAPRICE_STT_DEVICE`   | `auto`, `cpu`, or `cuda`. The script uses auto when unset          |
| `CAPRICE_STT_COMPUTE`  | GPU uses float16 and CPU uses int8 unless this is set              |
| `CAPRICE_STT_LANGUAGE` | Optional                                                           |
| `CAPRICE_TTS_URL`      | Full URL for a JSON body `{ model, input }`                        |
| `CAPRICE_TTS_MODEL`    | Model name sent in that body                                       |
| `CAPRICE_TTS_VOICE`    | Optional `voice` field. Omit the field when this is empty          |
| `CAPRICE_TTS_API_KEY`  | Optional bearer token. Omit it when the endpoint does not need one |

No microphone name, sample rate, host, or model id is hardcoded. Caprice does not shell out to Handy or Parakeet and does not use the Web Speech API.

Spoken replies need `CAPRICE_TTS_URL` and `CAPRICE_TTS_MODEL`. Rust posts inside the window. The page plays the bytes. There is no resident TTS model. Outside Tauri the page does not invoke. Listening fails because the speech worker is unavailable. Speaking uses `fetch` only when both TTS variables are set, and otherwise rejects with `speech is not configured`.
