/*
 * game.js — client for the online chess game (https://xuanxian-chen.github.io/chess-online/).
 *
 * - Renders the 8x8 board with pieces as inline SVG (both orientations).
 * - Touch, tap and drag interaction (phone-friendly).
 * - Real-time two-player multiplayer over WebSocket to the game server.
 * - Hot-seat fallback (two players on one device) when the server is unreachable.
 * - Board auto-flips for the second player so everyone sees their own pieces at the bottom.
 */
(function () {
  'use strict';
  if (typeof window === 'undefined') return;

  const ENGINE = window.ChessLogic;
  if (!ENGINE) { console.error('chess-logic.js failed to load'); return; }

  // Game server (hosted on the Codespace; see README.md).
  const WS_URL = 'wss://redesigned-palm-tree-v6wvq5pgjrq73jvj-7878.app.github.dev';
  const FILES = 'abcdefgh';

  const $ = id => document.getElementById(id);

  let mode = 'idle';               // 'idle' | 'multi' | 'hotseat'
  let ws = null;
  let room = null;
  let myColor = null;
  let state = null;
  let flipped = false;
  let selected = -1;
  let legalTargets = new Set();
  let isGameOver = false;
  let pendingPromotion = null;
  let dragging = false;
  let dragFrom = -1;
  let dragEl = null;
  let press = null;
  let reconnectTimer = null;
  let toastTimer = null;
  let offlineAttempts = 0;
  let moveLog = [];

  /* ------------------------------------------------------------------ */
  /* Helpers                                                            */
  /* ------------------------------------------------------------------ */

  function send(socket, msg) {
    if (socket && socket.readyState === 1) socket.send(JSON.stringify(msg));
  }

  function toast(msg) {
    const el = $('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
  }

  function setConnection(label, online) {
    const el = $('connectionLabel');
    el.textContent = label;
    el.classList.toggle('online', !!online);
  }

  function displayIndex(bi) {
    if (flipped) return (7 - bi % 8) + (7 - Math.floor(bi / 8)) * 8;
    return bi;
  }

  /* ------------------------------------------------------------------ */
  /* Rendering                                                          */
  /* ------------------------------------------------------------------ */

  function pieceEl(p) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.className = 'piece';
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', '#sym-' + p.type + '-' + (p.color === 'w' ? 'white' : 'black'));
    use.setAttribute('xlink:href', use.getAttribute('href'));
    use.classList.add('pc-' + (p.color === 'w' ? 'white' : 'black'));
    svg.appendChild(use);
    return svg;
  }

  function renderBoard() {
    const boardEl = $('board');
    boardEl.innerHTML = '';
    for (let dr = 0; dr < 8; dr++) {
      for (let df = 0; df < 8; df++) {
        const bi = flipped ? (7 - df) + (7 - dr) * 8 : df + dr * 8;
        const square = document.createElement('div');
        square.className = 'square' + ((df + dr) % 2 ? ' light' : ' dark');
        square.dataset.square = String(bi);
        if (df === 0) {
          const label = document.createElement('span');
          label.className = 'coord rank-label';
          label.textContent = String(Math.floor(bi / 8) + 1);
          square.appendChild(label);
        }
        if (dr === 7) {
          const label = document.createElement('span');
          label.className = 'coord file-label';
          label.textContent = FILES[df];
          square.appendChild(label);
        }
        const p = state ? state.board[bi] : null;
        if (p) square.appendChild(pieceEl(p));
        boardEl.appendChild(square);
      }
    }
    highlightAll();
  }

  function highlightAll() {
    for (const square of $('board').children) {
      const bi = +square.dataset.square;
      square.classList.toggle('selected', bi === selected);
      square.classList.toggle('legal-target', legalTargets.has(bi));
    }
  }

  function updateLegalTargets() {
    legalTargets = new Set();
    if (!state || isGameOver || !state.board) return;
    const activeColor = mode === 'hotseat' ? state.turn : myColor;
    if (selected >= 0 && state.board[selected] && state.board[selected].color === activeColor) {
      legalTargets = new Set(ENGINE.generateMoves(state, activeColor).map(m => m.to));
    }
    highlightAll();
  }

  /* ------------------------------------------------------------------ */
  /* Status                                                             */
  /* ------------------------------------------------------------------ */

  function updateStatus() {
    const el = $('status');
    if (!state) {
      el.textContent = mode === 'multi' && room ? 'Waiting for the game to start…' :
        'Online chess — create a game or start a hot-seat game.';
      return;
    }
    const status = ENGINE.gameStatus(state);
    if (status.status === 'checkmate') {
      el.textContent = !myColor ? 'Checkmate!' :
        (status.winner === myColor ? 'Checkmate — you win!' : 'Checkmate — you lose!');
    } else if (status.status === 'stalemate') {
      el.textContent = 'Stalemate — it’s a draw.';
    } else if (status.status === 'draw') {
      el.textContent = 'Draw — ' + (status.reason || 'the game ended in a draw.');
    } else if (mode === 'hotseat') {
      el.textContent = (state.turn === 'w' ? 'White' : 'Black') + ' to move — hot-seat, no server needed.';
    } else if (myColor) {
      if (ENGINE.isInCheck(state, state.turn)) {
        el.textContent = state.turn === myColor ? 'Check!' : 'Your opponent is in check.';
      } else if (state.turn === myColor) {
        el.textContent = 'Your turn — make a move.';
      } else {
        el.textContent = 'Waiting for your opponent…';
      }
    } else if (room) {
      el.textContent = (state.turn === 'w' ? 'White' : 'Black') + ' to move.';
    } else {
      el.textContent = 'Waiting for your opponent…';
    }
  }

  function updateMovesList() {
    const ul = $('movesList');
    ul.innerHTML = '';
    moveLog.slice(-12).reverse().forEach(m => {
      const li = document.createElement('li');
      li.textContent = ENGINE.squareName(m.from) + '–' + ENGINE.squareName(m.to);
      ul.appendChild(li);
    });
  }

  function showHint(visible) {
    const h = $('hint');
    h.classList.toggle('show', visible);
    h.textContent = visible ?
      'Tap a piece to select it, then tap the board to move it. Drag pieces to move them.' : '';
  }

  /* ------------------------------------------------------------------ */
  /* Networking (multiplayer)                                           */
  /* ------------------------------------------------------------------ */

  function connect() {
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    try {
      const w = new WebSocket(WS_URL);
      ws = w;
      setConnection('connecting…', false);
      w.onopen = () => {
        ws = w;
        offlineAttempts = 0;
        setConnection('online', true);
        send(w, room ? { type: 'join', room: room } : { type: 'join' });
      };
      w.onmessage = ev => {
        try { handleMessage(JSON.parse(ev.data)); } catch (err) { console.error(err); }
      };
      w.onclose = () => {
        if (ws !== w) return;
        ws = null;
        setConnection('reconnecting…', false);
        reconnectTimer = setTimeout(connect, 2000);
        scheduleHotseatFallback();
      };
      w.onerror = () => {};
    } catch (err) {
      ws = null;
      setConnection('offline', false);
      reconnectTimer = setTimeout(connect, 2000);
    }
  }

  function scheduleHotseatFallback() {
    offlineAttempts++;
    if (mode === 'idle' && !room && offlineAttempts >= 3) {
      startHotseat();
      toast('The online server is not reachable — hot-seat mode started on this device. ' +
        'Open the link on another device to play two-player online once it is back.');
    }
  }

  function handleMessage(msg) {
    switch (msg.type) {
      case 'room': {
        room = msg.room;
        myColor = msg.color;
        mode = 'multi';
        state = ENGINE.createState();
        // The second player (Black) sees the board flipped so their pieces start at the bottom.
        if (myColor === 'b') flipped = true;
        history.replaceState({}, '', '?room=' + room);
        selected = -1; moveLog = [];
        isGameOver = false;
        renderBoard(); updateLegalTargets(); updateStatus(); updateMovesList();
        updateSharePanel(true); showHint(false);
        $('resignBtn').hidden = false;
        break;
      }
      case 'state': {
        if (room && msg.room && msg.room !== room) break; // stale state from another room
        mode = 'multi';
        state = msg.state;
        selected = -1;
        legalTargets = new Set();
        isGameOver = !!(msg.status && msg.status.status);
        renderBoard(); updateLegalTargets(); updateStatus(); updateMovesList(); showHint(false);
        break;
      }
      case 'resigned': {
        isGameOver = true;
        toast((msg.loser === myColor ? 'You ' : 'Your opponent ') +
          'resigned — ' + (msg.winner === myColor ? 'you win!' : 'you lose'));
        break;
      }
      case 'error': {
        toast(msg.message || 'Error.');
        break;
      }
      case 'welcome':
      case 'pong':
        break;
      default:
        break;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Moves                                                              */
  /* ------------------------------------------------------------------ */

  function attemptMove(from, to) {
    if (!state || isGameOver || from < 0 || to < 0) return;
    const { legal, move, reason } = ENGINE.validateMove(state, from, to);
    if (!legal) { toast(reason || 'Illegal move.'); selected = -1; updateLegalTargets(); return; }
    selected = -1;
    if (move.flags.promotion) { showPromotionOverlay(move.piece.color, move.from, move.to); return; }
    if (mode === 'multi' && room) send(ws, { type: 'move', from: move.from, to: move.to, promo: move.flags.promo });
    else applyMoveLocal(move);
  }

  function applyMoveLocal(move) {
    state = ENGINE.applyMove(state, move);
    selected = -1;
    moveLog.push({ from: move.from, to: move.to });
    renderBoard(); updateLegalTargets(); updateStatus(); updateMovesList(); showHint(false);
  }

  function showPromotionOverlay(color, from, to) {
    pendingPromotion = { from: from, to: to };
    $('promotionTitle').textContent = (color === 'w' ? 'White' : 'Black') + ' pawn promotes. Choose:';
    $('promotionOverlay').hidden = false;
  }

  function onPromotionChosen(promo) {
    const p = pendingPromotion;
    pendingPromotion = null;
    $('promotionOverlay').hidden = true;
    if (!p) return;
    const { legal, move, reason } = ENGINE.validateMove(state, p.from, p.to, promo);
    if (!legal) { toast(reason || 'Invalid promotion.'); return; }
    if (mode === 'multi' && room) send(ws, { type: 'move', from: move.from, to: move.to, promo: move.flags.promo || promo });
    else applyMoveLocal(move);
  }

  /* ------------------------------------------------------------------ */
  /* Board interaction (tap, drag, drop)                                */
  /* ------------------------------------------------------------------ */

  function squareAtPoint(x, y) {
    const rect = $('board').getBoundingClientRect();
    if (rect.width <= 0) return -1;
    const col = Math.floor((x - rect.left) / (rect.width / 8));
    const row = Math.floor((y - rect.top) / (rect.height / 8));
    if (col < 0 || col > 7 || row < 0 || row > 7) return -1;
    const f = flipped ? 7 - col : col;
    const r = flipped ? 7 - row : row;
    return f + r * 8;
  }

  function startDrag(bi, ev) {
    dragging = true;
    dragFrom = bi;
    press.moved = false;
    const square = $('board').children[displayIndex(bi)];
    const piece = square ? square.querySelector('.piece') : null;
    if (piece) {
      dragEl = piece;
      dragEl.classList.add('dragging');
      const r = dragEl.getBoundingClientRect();
      dragEl.style.transform = `translate(${ev.clientX - r.width / 2}px, ${ev.clientY - r.height / 2}px)`;
    }
  }

  function moveDrag(x, y) {
    if (dragEl && press) {
      const r = dragEl.getBoundingClientRect();
      dragEl.style.transform = `translate(${x - r.width / 2}px, ${y - r.height / 2}px)`;
      if (Math.abs(x - press.x) > 8 || Math.abs(y - press.y) > 8) press.moved = true;
    }
  }

  function onPointerUp(ev) {
    const p = press;
    press = null;
    if (!p) return;
    const wasMoved = !!p.moved;
    const target = squareAtPoint(ev.clientX, ev.clientY);
    const from = dragFrom;
    if (dragging) {
      if (dragEl) { dragEl.classList.remove('dragging'); dragEl.style.transform = ''; }
      dragEl = null; dragging = false;
    }
    const wasSelected = selected === from;
    selected = -1; updateLegalTargets();
    if (from < 0) return;
    if (!wasMoved) {
      // Tap: select the piece, or deselect when tapping the selected piece.
      const piece = state ? state.board[from] : null;
      if (piece) {
        selected = wasSelected ? -1 : from;
        updateLegalTargets();
      }
      return;
    }
    if (target >= 0 && target !== from) attemptMove(from, target);
  }

  function bindBoardEvents() {
    const boardEl = $('board');
    boardEl.addEventListener('pointerdown', ev => {
      const square = ev.target.closest ? ev.target.closest('.square') : null;
      if (!square) return;
      const bi = +square.dataset.square;
      const piece = state ? state.board[bi] : null;
      press = { x: ev.clientX, y: ev.clientY, bi: bi, moved: false };
      const turnOk = mode === 'multi' ? (myColor && state && state.turn === myColor) : true;
      if (piece && turnOk) startDrag(bi, ev);
    });
    // Track moves anywhere on the page so drag-and-drop works at the edges of the board.
    boardEl.addEventListener('pointerup', ev => { if (press) onPointerUp(ev); });
    window.addEventListener('pointermove', ev => { if (dragging && press) moveDrag(ev.clientX, ev.clientY); });
    window.addEventListener('pointerup', ev => { if (press) onPointerUp(ev); });
    boardEl.addEventListener('contextmenu', ev => ev.preventDefault());
  }

  /* ------------------------------------------------------------------ */
  /* Room / share / controls                                             */
  /* ------------------------------------------------------------------ */

  function updateSharePanel(visible) {
    const row = $('shareRow');
    if (!visible || !room) { row.hidden = true; return; }
    row.hidden = false;
    $('shareLink').value = location.origin + location.pathname + '?room=' + room;
  }

  function joinByCode(code) {
    const c = String(code).trim().toLowerCase().slice(0, 8);
    if (!/^[a-z0-9]{1,8}$/.test(c)) { toast('Enter a valid room code.'); return; }
    if (mode === 'multi' && room) { toast('You are already in a game — use New Game first.'); return; }
    room = c;
    if (ws && ws.readyState === 1) send(ws, { type: 'join', room: c });
  }

  function startHotseat() {
    mode = 'hotseat';
    myColor = null;
    room = null;
    state = ENGINE.createState();
    history.replaceState({}, '', location.pathname);
    selected = -1; moveLog = [];
    isGameOver = false;
    renderBoard(); updateLegalTargets(); updateStatus(); updateMovesList();
    updateSharePanel(false); showHint(false);
    $('resignBtn').hidden = true;
  }

  function bindControls() {
    $('newGameBtn').addEventListener('click', () => {
      if (mode === 'multi') {
        if (room) send(ws, { type: 'new_game' });
        else send(ws, { type: 'join' });
      } else {
        startHotseat();
      }
    });
    $('flipBtn').addEventListener('click', () => { flipped = !flipped; renderBoard(); });
    $('hotseatBtn').addEventListener('click', () => startHotseat());
    $('resignBtn').addEventListener('click', () => send(ws, { type: 'resign' }));
    $('roomInput').addEventListener('keydown', ev => { if (ev.key === 'Enter') joinByCode($('roomInput').value); });
    $('joinBtn').addEventListener('click', () => joinByCode($('roomInput').value));
    $('copyBtn').addEventListener('click', copyShareLink);
    $('promotionOverlay').addEventListener('click', ev => {
      const btn = ev.target.closest ? ev.target.closest('.promo-btn') : null;
      if (btn) onPromotionChosen(btn.dataset.piece);
    });
  }

  function copyShareLink() {
    const link = $('shareLink').value;
    const notify = () => {
      $('copyBtn').textContent = 'Copied!';
      setTimeout(() => { $('copyBtn').textContent = 'Copy'; }, 1500);
    };
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      navigator.clipboard.writeText(link).then(notify).catch(() => fallbackCopy(link, notify));
    } else fallbackCopy(link, notify);
  }

  function fallbackCopy(text, notify) {
    const input = $('shareLink');
    input.select();
    try { document.execCommand('copy'); } catch (e) { /* ignore */ }
    notify();
  }

  /* ------------------------------------------------------------------ */
  /* Init                                                               */
  /* ------------------------------------------------------------------ */

  function init() {
    bindControls();
    bindBoardEvents();
    updateStatus();
    showHint(true);
    connect();
    // Keep the game server tunnel warm so two players can always reach it.
    setInterval(() => { if (ws && ws.readyState === 1) send(ws, { type: 'ping' }); }, 20000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.ChessGame = { attemptMove, onPromotionChosen };
})();
