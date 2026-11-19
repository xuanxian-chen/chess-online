/*
 * tests/client-smoke.js — smoke test for game.js using a minimal DOM shim (no browser needed).
 * Run: node tests/client-smoke.js
 */
'use strict';
const assert = require('assert');

/* ------------------------------------------------------------------ */
/* Minimal DOM shim                                                    */
/* ------------------------------------------------------------------ */

class FakeClassList {
  constructor(el) { this.el = el; }
  _has(c) { return this.el.classes.includes(c); }
  add(...cs) { for (const c of cs) if (!this.el.classes.includes(c)) this.el.classes.push(c); }
  remove(...cs) { this.el.classes = this.el.classes.filter(c => !cs.includes(c)); }
  toggle(c, force) {
    const on = force === undefined ? !this._has(c) : !!force;
    if (on && !this._has(c)) this.el.classes.push(c);
    if (!on) this.el.classes = this.el.classes.filter(x => x !== c);
    return on;
  }
  contains(c) { return this._has(c); }
}

class FakeElement {
  constructor(tag) {
    this.tagName = tag || 'DIV';
    this.children = [];
    this.classes = [];
    this._text = '';
    this.dataset = {};
    this.style = {};
    this.hidden = false;
    this.value = '';
    this._listeners = {};
    this._attrs = {};
    this._rect = { left: 0, top: 0, width: 320, height: 320 };
  }
  get textContent() { return this._text; }
  set textContent(v) { this._text = String(v); }
  get innerHTML() { return this._text; }
  set innerHTML(v) { this._text = String(v); this.children = []; }
  get className() { return this.classes.join(' '); }
  set className(v) { this.classes = String(v).split(/\s+/).filter(Boolean); }
  get classList() { return new FakeClassList(this); }
  appendChild(el) { this.children.push(el); return el; }
  querySelector(sel) {
    if (sel.startsWith('.')) {
      const parts = sel.slice(1).split('.');
      return this.children.find(ch => ch.classes && parts.every(p => ch.classes.includes(p))) || null;
    }
    return null;
  }
  closest(sel) {
    if (sel === '.square') return this.classes.includes('square') ? this : null;
    return null;
  }
  addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); }
  dispatch(type, ev) { (this._listeners[type] || []).forEach(fn => fn(ev || {})); }
  click() { this.dispatch('click', { target: this }); }
  setAttribute() {}
  getBoundingClientRect() { return { ...this._rect }; }
  select() { this.selected = true; }
  setAttribute(name, value) { (this._attrs = this._attrs || {})[name] = value; }
  getAttribute(name) { return (this._attrs && this._attrs[name]) || null; }
}

const idMap = new Map();
function makeEl(id) { const el = new FakeElement('div'); el.id = id; idMap.set(id, el); return el; }

const replaceStateCalls = [];
global.document = {
  readyState: 'complete',
  getElementById: id => idMap.get(id) || null,
  createElement: tag => new FakeElement(tag),
  createElementNS: () => new FakeElement('svg'),
  execCommand: () => true,
  addEventListener: () => {},
};

const IDs = ['status', 'connectionLabel', 'toast', 'board', 'board-wrap', 'hint', 'shareRow',
  'shareLink', 'movesList', 'promotionOverlay', 'promotionTitle', 'resignBtn', 'roomInput',
  'joinBtn', 'copyBtn', 'newGameBtn', 'flipBtn', 'hotseatBtn'];
IDs.forEach(makeEl);

global.addEventListener = () => {};
global.removeEventListener = () => {};
global.history = { replaceState: (s, t, url) => replaceStateCalls.push(url) };
global.location = { origin: 'https://xuanxian-chen.github.io', pathname: '/chess-online/', search: '' };
global.window = global;
class FakeWebSocket {
  constructor(url) { this.url = url; this.readyState = 0; this.sent = []; FakeWebSocket.instances.push(this); }
  send(data) { this.sent.push(JSON.parse(data)); }
  close() { this.readyState = 3; }
  simulateOpen() { this.readyState = 1; this.onopen && this.onopen(); }
  simulateMessage(msg) { this.onmessage && this.onmessage({ data: JSON.stringify(msg) }); }
  simulateClose() { this.readyState = 3; this.onclose && this.onclose(); }
}
global.WebSocket = FakeWebSocket;
FakeWebSocket.instances = [];

window.ChessLogic = require('../chess-logic.js');
const E = window.ChessLogic;

/* ------------------------------------------------------------------ */
/* Run game.js                                                         */
/* ------------------------------------------------------------------ */

require('../game.js');

const $ = id => idMap.get(id);
const assertEq = (a, b, msg) => assert.strictEqual(a, b, msg);
const hasClass = (el, c) => el.classes.includes(c);
const squareAt = (bi) => $('board').children.find(sq => +sq.dataset.square === bi);

/* ------------------------------------------------------------------ */
/* Tests                                                               */
/* ------------------------------------------------------------------ */

// 1. Board starts empty; connection label is "connecting…"
assertEq($('board').children.length, 0, 'board empty before join');
assertEq($('connectionLabel').textContent, 'connecting…');

// 2. WebSocket opened → join message sent
{
  const ws = FakeWebSocket.instances[0];
  ws.simulateOpen();
  assertEq($('connectionLabel').textContent, 'online');
  assertEq(ws.sent.length, 1);
  assertEq(ws.sent[0].type, 'join');
}

// 3. Server sends "room" → game state loads, share link set, white to move
{
  const ws = FakeWebSocket.instances[0];
  ws.simulateMessage({ type: 'room', room: 'abc12345', color: 'w' });
  assertEq($('shareLink').value, 'https://xuanxian-chen.github.io/chess-online/?room=abc12345');
  assertEq(replaceStateCalls[replaceStateCalls.length - 1], '?room=abc12345');
  assertEq($('board').children.length, 64, 'board rendered');
  assertEq($('status').textContent, 'Your turn — make a move.');
  const pawn = squareAt(12).querySelector('.piece');
  assert(pawn, 'white pawn on e2 rendered');
  assertEq(pawn.children[0].classes.filter(c => c.startsWith('pc-')).length, 1, 'white piece class on use element');
  // Coordinate labels: rank numbers on the left column, file letters on the bottom row
  assertEq(squareAt(56).querySelector('.coord.rank-label').textContent, '8', 'rank label 8 on left column');
  assertEq(squareAt(0).querySelector('.coord.rank-label').textContent, '1', 'rank label 1 on left column');
  assertEq(squareAt(63).querySelector('.coord.file-label').textContent, 'h', 'file label h on bottom row');
  assertEq(squareAt(56).querySelector('.coord.file-label').textContent, 'a', 'file label a on bottom row');
}

// 4. Tap a piece → selects it, legal targets highlighted
{
  const boardEl = $('board');
  const sq12 = squareAt(12);
  assert(!hasClass(sq12, 'selected'));
  boardEl.dispatch('pointerdown', { target: sq12, clientX: 10, clientY: 10 });
  boardEl.dispatch('pointerup', { clientX: 10, clientY: 10 });
  assert(hasClass(sq12, 'selected'), 'piece selected after tap');
  assert(hasClass(squareAt(28), 'legal-target'), 'e4 has legal target');
  assert(hasClass(squareAt(20), 'legal-target'), 'e3 has legal target');
}

// 5. Attempt move e2-e4 → move sent to server
{
  window.ChessGame.attemptMove(12, 28);
  const ws = FakeWebSocket.instances[0];
  const moveMsg = ws.sent[ws.sent.length - 1];
  assertEq(moveMsg.type, 'move');
  assertEq(moveMsg.from, 12);
  assertEq(moveMsg.to, 28);
}

// 6. Server broadcasts state after the move → board updated
{
  const s1 = E.applyMove(E.initialState(), E.validateMove(E.initialState(), 12, 28).move);
  FakeWebSocket.instances[0].simulateMessage({ type: 'state', room: 'abc12345', state: s1, turn: 'b', players: 2 });
  assert(squareAt(28).querySelector('.piece'), 'pawn e4 visible');
  assertEq(squareAt(12).querySelector('.piece'), null, 'e2 empty');
  assertEq($('status').textContent, 'Waiting for your opponent…');
  const s2 = E.applyMove(s1, E.validateMove(s1, 52, 36).move);
  FakeWebSocket.instances[0].simulateMessage({ type: 'state', room: 'abc12345', state: s2, turn: 'w', players: 2 });
  assert(squareAt(36).querySelector('.piece'), 'black pawn on e5 visible');
  assertEq($('status').textContent, 'Your turn — make a move.');
}

// 7. Checkmate → status text
{
  const mate = E.parseFEN('k7/8/1Q6/8/8/8/8/R7 b - - 0 1');
  FakeWebSocket.instances[0].simulateMessage({ type: 'state', room: 'abc12345', state: mate, turn: 'b', players: 2, status: { status: 'checkmate', loser: 'b', winner: 'w' } });
  assertEq($('status').textContent, 'Checkmate — you win!');
  window.ChessGame.attemptMove(48, 56); // illegal — must not send
  assertEq(FakeWebSocket.instances[0].sent.length, 2, 'no move sent after checkmate');
}

// 8. Promotion flow → overlay, then rook chosen and sent with promo
{
  const promoFen = E.parseFEN('4k3/P7/8/8/8/8/8/4K3 w - - 0 1');
  FakeWebSocket.instances[0].simulateMessage({ type: 'state', room: 'abc12345', state: promoFen, turn: 'w', players: 2 });
  window.ChessGame.attemptMove(48, 56);
  assert(!$('promotionOverlay').hidden, 'promotion overlay shown');
  const promoBtn = { dataset: { piece: 'r' }, closest: () => promoBtn };
  $('promotionOverlay').dispatch('click', { target: promoBtn });
  assert($('promotionOverlay').hidden, 'promotion overlay hidden after choice');
  const ws = FakeWebSocket.instances[0];
  const msg = ws.sent[ws.sent.length - 1];
  assertEq(msg.type, 'move');
  assertEq(msg.from, 48);
  assertEq(msg.to, 56);
  assertEq(msg.promo, 'r');
}

// 9. Hot-seat mode (New Game in idle mode)
{
  const before = FakeWebSocket.instances[0].sent.length;
  $('hotseatBtn').click();
  assertEq($('status').textContent, 'White to move — hot-seat, no server needed.');
  window.ChessGame.attemptMove(12, 28);
  assertEq($('status').textContent, 'Black to move — hot-seat, no server needed.');
  assert(squareAt(28).querySelector('.piece'), 'hot-seat pawn moved');
  assertEq(FakeWebSocket.instances[0].sent.length, before, 'no moves sent in hot-seat');
  assertEq($('movesList').children.length, 1, 'move log has one entry');
  assertEq($('movesList').children[0].textContent, 'e2–e4');
}

// 10. Flip board → top-left child is h8 (63)
{
  assertEq($('board').children[0].dataset.square, '0', 'not flipped: top-left is a1');
  $('flipBtn').click();
  assertEq($('board').children[0].dataset.square, '63', 'flipped: top-left is h8');
  assertEq($('board').children.length, 64);
}

// 11. Join by code
{
  const ws = FakeWebSocket.instances[0];
  $('roomInput').value = 'ABC12345';
  $('joinBtn').click();
  const msg = ws.sent[ws.sent.length - 1];
  assertEq(msg.type, 'join');
  assertEq(msg.room, 'abc12345');
}

// 12. Simulate reconnect join as Black → board auto-flips
{
  FakeWebSocket.instances[0].simulateMessage({ type: 'room', room: 'zzz12345', color: 'b' });
  assertEq($('shareLink').value, 'https://xuanxian-chen.github.io/chess-online/?room=zzz12345');
  assertEq($('board').children[0].dataset.square, '63', 'black sees the board flipped');
}

// 13. Error toast
{
  FakeWebSocket.instances[0].simulateMessage({ type: 'error', message: 'Illegal move.' });
  assert($('toast').textContent.includes('Illegal move.'), 'toast shown');
}

console.log('client smoke tests passed');
process.exit(0);
