# gigacook.github.io 👨‍🍳

My corner of the internet, dressed up as a terminal. Live at **[gigacook.github.io](https://gigacook.github.io)**.

| Path | What's there |
|---|---|
| `/` | A fake terminal. Type `help`. `memcheck` scans your tab's RAM (scientifically), `mp3` downloads nothing (emotionally), `kirurgi` hands you a Swedish surgery exam question. |
| `/truth` | Click the eye, get today's line from one of eleven dead philosophers. Web version of [zeroCortisol](https://github.com/gigacook/zeroCortisol). |
| `/play` | [goonyjump](https://github.com/gigacook/goonyjump) in solo browser mode. `solo.js` fakes the server so `game.js` runs unchanged. |
| `/runner` | SUPER RUNNER: NES desert race, 2 players on one keyboard. Extra tabs join via BroadcastChannel, no server needed. |
| `/brawl` | GOON BRAWL vs a CPU or a training dummy. The server's `Match` simulation runs in the page; `src/network.js` stands in for Socket.IO and drives the CPU. |

There is also a secret. You know the one. ↑ ↑ ↓ ↓ …

No build step, no framework, no tracking. Quotes and exam questions load live from their own repos.

Type `play` in the terminal for the arcade menu.

Updating the games after changing their source repos:
- goonyjump: copy `game.js` into `play/`
- super runner: copy `index.html` into `runner/` (keep the tab-multiplayer hint and favicon)
- slopbrawl: copy `public/src/*` (except `network.js` and `hostInfo.js`), `shared/*` and `server/{match,physics,combat}.js` into `brawl/`, then rewrite `'/shared/` imports to `'../shared/`

## ☕ Support

Everything here is free. If it made you smile, you can buy me a coffee:

[![Support me on Ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/gigacook)
