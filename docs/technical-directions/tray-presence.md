# Tray

Caprice does not draw a window on the work area. The icon is the system tray. Windows places that at the end of the taskbar, which is the bottom right when the taskbar is on the bottom. The tray menu stops the current turn or quits. A settings window can open from that menu later. This change does not add one.

The page still runs. It is a real window, parked at (-32000, -32000), skipped on the taskbar, and marked as a tool window so it stays out of Alt+Tab. Speech, the talk hold, and League polling live on that page. A hidden webview is suspended by the browser after a few minutes, and Windows cannot turn that policy off, so `visible: false` was set aside.

Talk is a global hold of Alt+Space or Ctrl+Space (`talk-chord.md`). There is no box on screen, and the page is never focused, so a window-local shortcut would not hear the key. The shell waits `talkHoldDelay` before it reports the chord down, so a tap does not send.

Set aside: the frameless box at the top left of the work area, dragging that box, and keeping the shortcuts local to a focused window.
