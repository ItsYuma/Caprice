# Architecture

Caprice is a desktop companion. The shell is Tauri. The session, the model, and tools are TypeScript. Voice is a pair of ports with no devices yet.

`packages/core` imports neither `packages/voice` nor `packages/desktop`. `packages/voice` imports nothing from the other packages. `packages/desktop` is the only place that composes them. Skills are markdown the model reads. Core does not open files. The shell passes the skill text in.

```mermaid
flowchart TB
  subgraph shell [packages/desktop]
    window[Tauri window]
    host[sayAndSpeak]
  end
  subgraph voice [packages/voice]
    listener[Listener]
    speaker[Speaker]
  end
  subgraph corepkg [packages/core]
    session[Session]
    model[Model]
    tools[Tool]
  end
  skills[skills]
  window --> host
  host --> session
  host --> speaker
  skills --> window
  session --> model
  session --> tools
```

The listener is not wired. The next voice milestone connects `listen` to `say`. The speaker is wired: `sayAndSpeak` speaks the capri line. The stub model ignores the persona and quotes the host. A real model receives `persona`, `lines`, and `hostText`. Tools are stored on the session and are not called yet.

```mermaid
sequenceDiagram
  participant Host
  participant Session
  participant Model
  Host->>Session: say
  Session->>Model: persona, lines, hostText
  Model-->>Session: text
  Session-->>Host: capri line
```

Rust opens the window. It does not own the session. Computer tools, when they exist, cross that bridge from a `Tool` in core to a host implementation. One tool, one file, registered by name.
