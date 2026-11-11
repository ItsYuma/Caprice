# Tray

Caprice does not draw the presence window on the work area. The icon is the system tray. Windows places that at the end of the taskbar, which is the bottom right when the taskbar is on the bottom. The tray menu is Settings, Stop, and Quit.

Settings opens a decorated window labeled `settings`, about 720 by 640, centered, and on the taskbar. Opening it again shows the one that is already there. The presence page stays a real window, parked at (-32000, -32000), skipped on the taskbar, and marked as a tool window so it stays out of Alt+Tab. Speech, the talk hold, and League polling live on that page. A hidden webview is suspended by the browser after a few minutes, and Windows cannot turn that policy off, so `visible: false` was set aside.

Talk is a global hold of Alt+Space or Ctrl+Space (`talk-chord.md`). Settings can restrict that to one of the two. When settings are absent, both still work. There is no box on screen, and the presence page is never focused, so a window-local shortcut would not hear the key. The shell waits `talkHoldDelay` before it reports the chord down, so a tap does not send.

Set aside: the frameless box at the top left of the work area, dragging that box, and keeping the shortcuts local to a focused window.
