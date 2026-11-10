# Lobby plan

Spoken queue, cancel, accept, ban, and pick are parsed and sent by the desktop. The model writes the line. It does not choose the client calls for those sentences. Walking each call is a full reply, and a ban is several calls. The sequence is fixed, so the desktop runs it. A sentence that is not one of those commands still goes through the assistant, and the League tools stay available there.

The plan follows the client phase. Search runs in a lobby. Accept runs when the ready check is in progress. Ban and pick run on the local player's open action after champion select leaves planning. The lock is a patch with the champion id and `completed`, then a patch of the id and `complete` if that patch fails. Names are read from `champion-summary.json` on the client and kept until the client drops. A name that does not match is said once and dropped. Four missed client reads clear the plan. The desktop does not start the League executable.

The command the host spoke is kept with her reply, and tools are refused on that turn. A later step uses the remark gate: tools refused, the thread unchanged, and she waits until the host is idle.

Set aside: launching League, a shipped champion table, a fallback champion when the requested one is taken, and giving these commands back to the model as tool calls.
