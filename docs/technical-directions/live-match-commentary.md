# Live match commentary

The desktop polls the live client and speaks one line about what just changed. The model writes that line as a jab or a cheer. It does not read the fact back, and it does not add a kill, a score, or an objective the poll did not state. A fixed sentence is only the fallback when that call fails.

The poll is `league_live` on `/liveclientdata/allgamedata`. The event list is the source for kills, deaths, objectives, and the result. The score is a backup when it moves and the event list stays quiet for one more poll, so a late event still gets the names and a score jump is not also a second line. One poll speaks at most one fact. The newest, highest-priority fact wins.

Summoner's Rift in classic and practice tool ignores a dragon before 5:00, voidgrubs before 8:00, the herald before 15:00, and baron before 20:00, with ten seconds of slack. Other modes keep the client's events. An objective with no known killer is skipped. A client that stops answering is silence, not a win or a loss. A match already past 90 seconds is not replayed, and a score that was already there is not announced.

The line goes through `notice`. Tools are not offered. The saved thread is unchanged, so a game does not push the host's conversation out. The shared remark gate speaks only while the host is idle. Holding talk, or Escape, cancels the line.

Set aside: canned roast tables, item builds, a remembered "can we win this fight" tracker, emotion tags, and treating a disconnect as the match result. The fallback sentences stay short because the model is the voice.
