# Chess Online — Two Player

A web-based chess game for **two players on phones** — online over the network or on one device.

**Board orientation:** when the second player (Black) joins, the board auto-flips so each player always sees their own pieces at the bottom — a "different direction" view. The **Flip Board** button rotates the board manually.

## Try it online

Open: https://xuanxian-chen.github.io/chess-online/

- **New Game** — creates an online game room; share the link shown under "Room" with your opponent.
- **Hot-Seat (2 players)** — play the other player on this same device (no server needed).
- **Join** — enter the room code to join a game someone else created.

### Controls

- **Tap** a piece to select it (legal moves are highlighted).
- **Tap** the board to move, or **drag** a piece to your target square.
- **Flip Board** — rotate the board 180°.
- **New Game** — restart the current game.
- **Resign** — give up the game.
- **Copy** — copy the shareable room link to the clipboard.

## Files

- `chess-logic.js` — chess engine: legal move generation, castling, en passant, promotion, check/checkmate/stalemate/draw detection. Shared by the browser and the server.
- `game.js` — client: board rendering (SVG pieces), touch/tap/drag interaction, two-player networking, hot-seat fallback.
- `server.js` — WebSocket game server: game rooms, server-side move validation, broadcasts to both players.
- `index.html` / `style.css` — UI.
- `tests/engine.test.js`, `tests/client-smoke.js` — tests.

## Architecture

```
phones (browser)  ──wss──▶  game server (Node.js, WebSocket)
  chess-logic.js              chess-logic.js
                              server.js
```

The game server is hosted on the GitHub Codespace of this repo and is exposed at:

```
wss://redesigned-palm-tree-v6wvq5pgjrq73jvj-7878.app.github.dev
```

(`game.js` hardcodes this URL; set it to `ws://localhost:7878` for local development.)

If the codespace is asleep, the page retries the connection every 2s — opening the page wakes it up. While the server is unreachable, the game falls back to hot-seat mode.

## Development

```
npm install     # install server dependencies (ws)
npm start       # run the game server: ws://localhost:7878
node tests/engine.test.js
node tests/client-smoke.js
```
