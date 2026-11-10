# Talk chord

Alt+Space and Ctrl+Space are heard with [handy-keys](https://github.com/handy-computer/handy-keys), the hook Handy uses. The page is parked off the work area and is not focusable, so a key event never arrives there. `talk_arm` registers the chord labels from `talkChords`. The hook reports press and release. While it can, it swallows the chord, so the focused app does not also see it.

The shell waits `talkHoldDelay` (200 ms) before it emits `talk-press`. A shorter hold emits nothing. `talk-release` is only sent after that press. The page starts listening on `talk-press` and stops on `talk-release`. The parked page is not the clock for that wait.

On macOS the hook needs Accessibility. On Linux it reads evdev, so the user needs the `input` group. Swallowing the chord there also needs write access to `/dev/uinput`. If blocking cannot start, the hook still listens when it can open, and it does not swallow. If the hook cannot start, `talk_arm` fails and that chord is skipped.

Set aside: `tauri-plugin-global-shortcut`. It registers with `RegisterHotKey`. That API has no key-up, so the plugin polls `GetAsyncKeyState` until the key looks up. Windows already owns Alt+Space, so that chord fails to register. Calling register from a sync command also deadlocks: the plugin hops back to the main thread and the command is already on it. A low-level hook is what makes the same two chords work while another app is focused.
