# Architecture

Caprice separates four responsibilities: the assistant turn, model adapters, runtime management, and game integrations. TypeScript owns conversation and tool execution. Rust owns the desktop shell, the microphone, child processes, and the League client's credentials and loopback transport.

`packages/core` imports neither voice, desktop, nor a game. `packages/voice` imports neither core nor desktop. A game package imports neither core, voice, nor desktop. Desktop is the composition root. React observes the application and binds input; it does not construct provider requests or implement game behavior.

```mermaid
flowchart TB
  subgraph desktop [Desktop composition]
    page[React presence and input]
    turn[Listen, assistant, speak]
  end
  subgraph gamespkg [Game packages]
    league[League tools and followers]
    client[League client]
  end
  subgraph core [Core]
    session[Assistant turn state machine]
    adapter[Model adapter]
    events[Conversation and tool events]
  end
  subgraph voice [Voice ports]
    listen[Listener]
    speak[Speaker]
  end
  subgraph shell [Rust shell]
    model[Configured model transport and runtime]
    speech[Capture and speech runtime states]
    commands[Registered game commands]
  end
  page --> turn
  turn --> session
  turn --> listen
  turn --> speak
  page --> league
  league --> session
  league --> commands
  commands --> client
  session --> adapter
  session --> events
  adapter --> model
  listen --> speech
  speak --> speech
```

## Assistant

A turn retains the original user request separately from model output and tool results. Events distinguish `user`, `assistant`, `tool-call`, and `tool-result`. Tools carry their name, description, read/action classification, input parser, and implementation. The model-facing registry comes from the tools actually offered. Instructions live in skills; core receives their text and does not open files.

The host request authorizes the actions needed for it. "Pick Yasuo" permits lookup and selection without a second confirmation. Tool data is not a new user request. Input validation and transport restrictions remain enforced by code; a prompt is not a substitute for those boundaries.

The assistant executes at most four tools before asking for a final answer without tools. Invalid or failed calls are reported to the model as tool errors. Cancellation stops subsequent steps and suppresses late responses; it cannot undo an action already accepted by a game API. Conversation trimming must retain valid call/result exchanges. Persistence keeps bounded user and assistant messages, not raw game payloads.

## Adapters and runtimes

A model adapter translates between core events and a provider protocol. The current chat adapter supports the text-call convention and native function calls. A different provider protocol belongs in another adapter. Changing model weights behind the same protocol is configuration.

The runtime layer manages process ownership, readiness, deadlines, cancellation, and shutdown. An external brain endpoint does not belong to Caprice; a managed child does. Stopping Caprice must not terminate an externally owned service. STT and Woof are resident children, independent of the assistant loop. Provider failures reset only the affected runtime.

Rust obtains the brain endpoint and credentials from configuration. The page sends a body and request identifier, not a destination or secret. Request identifiers keep cancellation of an old model call from aborting a newer call.

## Voice

Push-to-talk progresses through arming, recording, finishing, and the reply. Microphone ownership remains in Rust until the utterance is finished or cancelled. Streaming engines receive incremental resampled audio while held; whole-clip engines transcribe after release. No incomplete transcript is used to execute actions after a recording or feed failure.

The page decodes the returned audio, applies the reply pitch, echo, and tremolo (`reply-color.md`), and plays that buffer. Escape cancels capture, the assistant turn, synthesis, and playback. Cancelling playback also prevents a pending synthesis result from starting later. The `hear`, `reply`, and `voice` times separate transcription after release, model/tool work, and synthesis before playback.

Nothing is drawn on the work area. The shell icon is the system tray. The page runs off that area (`tray-presence.md`). Hold Alt+Space or Ctrl+Space from any focused app (`talk-chord.md`). Release sends. A tap does not send. The tray menu stops the turn or quits.

## Games

A game package implements `@caprice/games`. Desktop loads it when detection finds it or `enabledGames` lists it. Core does not import a game. A game that speaks on its own also supplies a follower. One gate runs every follower. It speaks only while the host is idle, and holding talk or Escape cancels the line. The reply uses `notice`, so tools are refused and the saved thread stays unchanged.

The League client is `packages/games/league/rust`. It delegates credential discovery, request parsing, and HTTP exchange to separate modules. The desktop shell only registers the commands. Blocking process discovery runs off the async executor. Credentials remain in Rust, requests stay on loopback, redirects and retries are disabled, and response reads are bounded.

Live commentary is the league package's follower: a poll of that same live-client read. Desktop runs it. One new fact becomes a host line.

A spoken queue, cancel, accept, ban, or pick is a lobby plan. The league package sends those client calls. `direct` keeps that exchange and refuses tools. A later step from the plan uses the same remark gate.
