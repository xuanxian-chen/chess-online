/*
 * server.js — WebSocket game server for the two-player chess game.
 *
 * Serves chess-online through a WebSocket so two players can play online on phones.
 * Deployed inside the GitHub Codespace; the public tunnel URL is set in game.js.
 *
 * Protocol (JSON messages):
 *   client -> server: {type:'join', room?}            create a game or join an existing one by room id
 *   client -> server: {type:'move', from, to, promo}  attempt a move (validated server-side)
 *   client -> server: {type:'new_game'}              restart the game in the current room
 *   client -> server: {type:'resign'}                resign (ends the game)
 *   client -> server: {type:'get_state'}             ask for the current state (after reconnect)
 *   client -> server: {type:'ping'}
 *   server -> client: {type:'room', room, color}      result of join (you are white or black)
 *   server -> client: {type:'state', state, turn, room, players}  broadcast of the game state
 *   server -> client: {type:'error', message}         error message
 *   server -> client: {type:'resigned', room, loser, winner}
 *   server -> client: {type:'pong'}
 */
const WebSocket = require('ws');
const engine = require('./chess-logic.js');

const PORT = parseInt(process.env.PORT || '7878', 10);
const HOST = process.env.HOST || '0.0.0.0';

const rooms = new Map();
const sockets = new Map(); // ws -> { room: string|null, color: 'w'|'b'|null }

function newRoomId() {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  let id = '';
  for (let i = 0; i < 8; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

function createRoom() {
  let id = newRoomId();
  while (rooms.has(id)) id = newRoomId();
  const room = { id: id, state: engine.initialState(), players: [], createdAt: Date.now() };
  rooms.set(id, room);
  return room;
}

function broadcast(room, message) {
  const data = JSON.stringify(message);
  for (const p of room.players) {
    if (p.socket.readyState === WebSocket.OPEN) p.socket.send(data);
  }
}

function sendTo(socket, message) {
  if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function roomSnapshot(room) {
  return {
    type: 'state',
    room: room.id,
    state: room.state,
    turn: room.state.turn,
    players: room.players.length
  };
}

function handleMessage(ws, entry, msg) {
  switch (msg.type) {
    case 'join': {
      let room;
      if (msg.room) {
        room = rooms.get(msg.room);
        if (!room) {
          sendTo(ws, { type: 'error', message: 'Room not found. You can create a new game.' });
          return;
        }
      } else {
        room = createRoom();
      }
      if (room.players.length >= 2) {
        sendTo(ws, { type: 'error', message: 'Room is full — someone is already playing there. Create a new game or join another room.' });
        return;
      }
      const color = room.players.some(p => p.color === 'w') ? 'b' : 'w';
      room.players.push({ socket: ws, color: color });
      entry.room = room.id;
      entry.color = color;
      broadcast(room, roomSnapshot(room));
      sendTo(ws, { type: 'room', room: room.id, color: color });
      break;
    }
    case 'move': {
      const room = entry.room ? rooms.get(entry.room) : null;
      if (!room) { sendTo(ws, { type: 'error', message: 'Not in a game — join one first.' }); return; }
      if (room.state.turn !== entry.color) {
        sendTo(ws, { type: 'error', message: "It's not your turn to move." });
        return;
      }
      if (typeof msg.from !== 'number' || typeof msg.to !== 'number') {
        sendTo(ws, { type: 'error', message: 'Invalid move.' });
        return;
      }
      const { legal, move, reason } = engine.validateMove(room.state, msg.from, msg.to, msg.promo);
      if (!legal) {
        sendTo(ws, { type: 'error', message: reason || 'Illegal move.' });
        return;
      }
      room.state = engine.applyMove(room.state, move);
      const status = engine.gameStatus(room.state);
      broadcast(room, Object.assign(roomSnapshot(room), { status: status }));
      break;
    }
    case 'new_game': {
      const room = entry.room ? rooms.get(entry.room) : null;
      if (!room) { sendTo(ws, { type: 'error', message: 'Not in a game.' }); return; }
      room.state = engine.initialState();
      broadcast(room, roomSnapshot(room));
      break;
    }
    case 'resign': {
      const room = entry.room ? rooms.get(entry.room) : null;
      if (!room) return;
      const loser = entry.color;
      broadcast(room, {
        type: 'resigned',
        room: room.id,
        loser: loser,
        winner: loser === 'w' ? 'b' : 'w'
      });
      break;
    }
    case 'get_state': {
      const room = entry.room ? rooms.get(entry.room) : null;
      if (room) sendTo(ws, roomSnapshot(room));
      return;
    }
    case 'ping': {
      sendTo(ws, { type: 'pong' });
      break;
    }
    default:
      sendTo(ws, { type: 'error', message: 'Unknown message type.' });
  }
}

const wss = new WebSocket.Server({ port: PORT, host: HOST });

wss.on('connection', (ws) => {
  sockets.set(ws, { room: null, color: null });
  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(typeof raw === 'string' ? raw : raw.toString()); } catch { return; }
    const entry = sockets.get(ws);
    if (!entry || !msg || typeof msg.type !== 'string') return;
    handleMessage(ws, entry, msg);
  });
  ws.on('close', () => {
    const entry = sockets.get(ws);
    if (!entry) return;
    if (entry.room) {
      const room = rooms.get(entry.room);
      if (room) {
        room.players = room.players.filter(p => p.socket !== ws);
        if (room.players.length === 0) broadcast(room, roomSnapshot(room));
      }
    }
    sockets.delete(ws);
  });
  ws.on('error', () => {});
  sendTo(ws, { type: 'welcome' });
});

wss.on('listening', () => {
  console.log(`chess server listening on ws://${HOST}:${PORT} (${rooms.size} rooms)`);
});

wss.on('error', (err) => {
  console.error('server error:', err);
});

// Clean up rooms with no players after a while.
setInterval(() => {
  const now = Date.now();
  for (const [id, room] of rooms) {
    if (room.players.length === 0 && now - room.createdAt > 5 * 60 * 1000) {
      rooms.delete(id);
    }
  }
}, 60000);
