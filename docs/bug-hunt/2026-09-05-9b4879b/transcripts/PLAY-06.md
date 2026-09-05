# PLAY-06 — PASS

**Why this case exists.** Every id in the card must be one find_music returned, character for character. The contract makes the model hand-copy 22-character opaque ids out of prose, and a single wrong character silently drops a song — observed once in a 17-track playlist, where find_music returned …S5XeNUgr and the card carried …S6XeNUgr.

## Tool calls (3)

### 1. `find_music`

- service: `spotify`
- ok: `true` · 320ms
- **args:** `{"query":"Norah Jones","limit":4}`
- summary: 4 track(s) for "Norah Jones": Don't Know Why — Norah Jones (3:06) [id: 1zNXF2svmdlNxfS5XeNUgr] | Sunrise — Norah Jones (3:21) [id: 7zkLpY72g6lKQbiHDqri1S] | Come Away With Me — Norah Jones (3:18) [id: 6jGnykaS6TkWp15utXSAeI] | Turn Me On — Norah Jones (2:35) [id: 1qzHqfvKrZWo6dVHM1dXrj]. Pick from these by name when you build a playlist — use propose_playlist with the bracketed track ids exactly as given.

### 2. `find_music`

- service: `spotify`
- ok: `true` · 424ms
- **args:** `{"query":"Fleetwood Mac","limit":4}`
- summary: 4 track(s) for "Fleetwood Mac": Dreams - 2004 Remaster — Fleetwood Mac (4:18) [id: 0ofHAoxe9vBkTCp2UQIavz] | The Chain - 2004 Remaster — Fleetwood Mac (4:30) [id: 5e9TFTbltYBg2xThimr0rU] | Landslide — Fleetwood Mac (3:19) [id: 5ihS6UUlyQAfmp48eSkxuQ] | Silver Springs - 2004 Remaster — Fleetwood Mac (4:49) [id: 4nZi6XNe36Ut4Nij3IQ1yC]. Pick from these by name when you build a playlist — use propose_playlist with the bracketed track ids exactly as given.

### 3. `propose_playlist`

- service: `spotify`
- ok: `true` · 0ms
- **args:** `{"name":"For Maya","note":"Eight songs from Fleetwood Mac and Norah Jones, the artists you love","occasion":"for Maya","trackIds":["0ofHAoxe9vBkTCp2UQIavz","1zNXF2svmdlNxfS5XeNUgr","5e9TFTbltYBg2xThimr0rU","6jGnykaS6TkWp15utXSAeI","5ihS6UUlyQAfmp48eSkxuQ","7zkLpY72g6lKQbiHDqri1S","4nZi6XNe36Ut4Nij3IQ1yC","1qzHqfvKrZWo6dVHM1dXrj"]}`
- summary: I've put a playlist card in front of them: "For Maya", 8 track(s) — Dreams - 2004 Remaster — Fleetwood Mac (4:18) | Don't Know Why — Norah Jones (3:06) | The Chain - 2004 Remaster — Fleetwood Mac (4:30) | Come Away With Me — Norah Jones (3:18) | Landslide — Fleetwood Mac (3:19) | Sunrise — Norah Jones (3:21) | Silver Springs - 2004 Remaster — Fleetwood Mac (4:49) | Turn Me On — Norah Jones (2:35). Tell them what you chose and why, and that confirming hands over the links because no Spotify account is connected. Do not say it is saved.

## Final reply

> I've put together eight songs for Maya — a mix of Fleetwood Mac and Norah Jones, flowing between them. It opens with *Dreams* and *Don't Know Why*, moves through *The Chain* and *Come Away With Me*, then *Landslide*, *Sunrise*, *Silver Springs*, and closes with *Turn Me On*. 
> 
> The playlist is waiting for you to confirm — just say the word and it's ready for her.
