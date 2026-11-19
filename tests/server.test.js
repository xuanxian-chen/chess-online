/*
 * tests/server.test.js — integration test for server.js: rooms, moves, broadcasts.
 * Run: node tests/server.test.js
 */
'use strict';
const assert = require('assert');
const WebSocket = require('ws');

const PORT = 7879;
process.env.PORT = String(PORT);
process.env.HOST = '127.0.0.1';

require('../server.js'); // starts the WebSocket server

function connect() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
    const timeout = setTimeout(() => { ws.terminate(); reject(new Error('connect timeout')); }, 5000);
    ws.on('open', () => { clearTimeout(timeout); resolve(ws); });
    ws.on('error', err => { clearTimeout(timeout); reject(err); });
  });
}

function send(ws, msg) { ws.send(JSON.stringify(msg)); }

function waitFor(ws, pred, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout waiting for message')), timeoutMs);
    ws.on('message', data => {
      const msg = JSON.parse(data.toString());
      if (pred(msg)) { clearTimeout(timer); resolve(msg); }
    });
  });
}

async function main() {
  // Wait for the server to accept connections.
  for (let i = 0; i < 30; i++) {
    try {
      const probe = await connect();
      probe.close();
      break;
    } catch (err) {
      await new Promise(r => setTimeout(r, 100));
      if (i === 29) throw err;
    }
  }

  // Player A joins a new room.
  const a = await connect();
  send(a, { type: 'join' });
  const aRoom = await waitFor(a, m => m.type === 'room');
  assert.strictEqual(aRoom.color, 'w');

  // Player B joins the same room — should be black.
  const b = await connect();
  send(b, { type: 'join', room: aRoom.room });
  const bRoom = await waitFor(b, m => m.type === 'room');
  assert.strictEqual(bRoom.color, 'b');
  assert.strictEqual(bRoom.room, aRoom.room);

  // A makes the first move: 1.e4 (from 12 to 28).
  send(a, { type: 'move', from: 12, to: 28 });
  const aState = await waitFor(a, m => m.type === 'state' && m.state.board[28] && m.state.board[28].type === 'p');
  assert.strictEqual(aState.state.turn, 'b');
  assert.strictEqual(aState.state.board[28].color, 'w');

  // B's illegal move is rejected.
  send(b, { type: 'move', from: 52, to: 20 });
  const bErr = await waitFor(b, m => m.type === 'error');
  assert.ok(/Illegal move|not your turn/i.test(bErr.message), 'expected illegal move error, got: ' + bErr.message);

  // B makes a legal move: 1...e5 (from 52 to 36).
  send(b, { type: 'move', from: 52, to: 36 });
  const bState = await waitFor(b, m => m.type === 'state' && m.state.board[36] && m.state.board[36].type === 'p');
  assert.strictEqual(bState.state.turn, 'w');
  assert.strictEqual(bState.state.board[36].color, 'b');
  assert.strictEqual(bState.state.board[28].type, 'p'); // white pawn still on e4

  // New game restarts the position.
  send(a, { type: 'new_game' });
  const newGame = await waitFor(a, m => m.type === 'state' && m.state.board[12] && m.state.board[28] === null);
  assert.strictEqual(newGame.state.turn, 'w');

  a.close(); b.close();
  console.log('server integration tests passed');
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
