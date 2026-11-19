/*
 * chess-logic.js — a compact, complete chess engine.
 *
 * Shared by the browser client (window.ChessLogic) and the Node server (module.exports).
 *
 * Board: flat array of 64 squares.  index = file + rank * 8, file 0..7 = a..h,
 * rank 0..7 = rank 1..8.   Piece: { type: 'p'|'n'|'b'|'r'|'q'|'k', color: 'w'|'b' } or null.
 * State: { board, turn: 'w'|'b',
 *          castling: { w: {k, q}, b: {k, q} },
 *          ep: number|null, halfmove: number, fullmove: number }
 */
(function (root, factory) {
  const engine = factory();
  if (typeof module === 'object' && module.exports) module.exports = engine;
  else root.ChessLogic = engine;
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const FILES = 'abcdefgh';
  const PROMOTIONS = ['q', 'r', 'b', 'n'];

  const KNIGHT_MOVES = [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-2, 1], [-1, -2]];
  const KING_MOVES = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  const BISHOP_DIRS = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
  const ROOK_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const ALL_DIRS = BISHOP_DIRS.concat(ROOK_DIRS);

  function inBounds(sq) { return sq >= 0 && sq < 64; }
  function step(sq, df, dr) {
    const file = sq % 8, rank = Math.floor(sq / 8);
    const nf = file + df, nr = rank + dr;
    if (nf < 0 || nf > 7 || nr < 0 || nr > 7) return null;
    return nf + nr * 8;
  }
  function other(color) { return color === 'w' ? 'b' : 'w'; }
  function kingSquare(board, color) {
    for (let s = 0; s < 64; s++) {
      const p = board[s];
      if (p && p.type === 'k' && p.color === color) return s;
    }
    return null;
  }

  function createState() {
    const board = new Array(64).fill(null);
    const back = ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'];
    for (let f = 0; f < 8; f++) {
      board[0 * 8 + f] = { type: back[f], color: 'w' };
      board[1 * 8 + f] = { type: 'p', color: 'w' };
      board[6 * 8 + f] = { type: 'p', color: 'b' };
      board[7 * 8 + f] = { type: back[f], color: 'b' };
    }
    board[4] = { type: 'k', color: 'w' };
    board[60] = { type: 'k', color: 'b' };
    return {
      board: board,
      turn: 'w',
      castling: { w: { k: true, q: true }, b: { k: true, q: true } },
      ep: null,
      halfmove: 0,
      fullmove: 1
    };
  }

  function isAttacked(board, sq, byColor) {
    const up = byColor === 'w' ? 1 : -1;
    for (let s = 0; s < 64; s++) {
      const p = board[s];
      if (!p || p.color !== byColor) continue;
      if (p.type === 'p') {
        if (step(s, -1, up) === sq || step(s, 1, up) === sq) return true;
      } else if (p.type === 'n') {
        for (const [df, dr] of KNIGHT_MOVES) if (step(s, df, dr) === sq) return true;
      } else if (p.type === 'k') {
        for (const [df, dr] of KING_MOVES) if (step(s, df, dr) === sq) return true;
      } else {
        const dirs = p.type === 'b' ? BISHOP_DIRS : (p.type === 'r' ? ROOK_DIRS : ALL_DIRS);
        if (slidesTo(board, s, sq, dirs)) return true;
      }
    }
    return false;
  }

  function slidesTo(board, from, target, dirs) {
    for (const [df, dr] of dirs) {
      for (let s = step(from, df, dr); s !== null; s = step(s, df, dr)) {
        if (s === target) return true;
        if (board[s]) break;
      }
    }
    return false;
  }

  function pushMove(state, color, from, to, moves, extra) {
    const board = state.board;
    const p = board[from];
    const flags = Object.assign({ capture: board[to] !== null }, extra || {});
    moves.push({ from: from, to: to, piece: { type: p.type, color: p.color }, flags: flags });
  }

  function pushMoveIfFree(state, color, from, to, moves) {
    if (to === null) return;
    const t = state.board[to];
    if (!t || t.color !== color) pushMove(state, color, from, to, moves, {});
  }

  function genPawnMoves(state, color, from, moves) {
    const board = state.board;
    const up = color === 'w' ? 1 : -1;
    const to1 = step(from, 0, up);
    if (to1 === null) return;
    const onBackRank = (sq) => color === 'w' ? Math.floor(sq / 8) === 7 : Math.floor(sq / 8) === 0;
    if (board[to1] === null) {
      pushMove(state, color, from, to1, moves, onBackRank(to1) ? { promotion: true } : {});
      const to2 = step(from, 0, 2 * up);
      if (Math.floor(from / 8) === (color === 'w' ? 1 : 6) && to2 !== null && board[to2] === null) {
        pushMove(state, color, from, to2, moves, { doublePush: true });
      }
    }
    for (const [df, dr] of [[-1, up], [1, up]]) {
      const to = step(from, df, dr);
      if (to === null) continue;
      const t = board[to];
      if (t && t.color !== color) {
        pushMove(state, color, from, to, moves, onBackRank(to) ? { promotion: true } : {});
      }
      // En passant is covered by ordinary adjacent captures: after a double push
      // the pawn on the neighbour-adjacent square is an enemy pawn and is capturable.
    }
  }

  function genCastlingMoves(state, color, moves) {
    const board = state.board;
    const opp = other(color);
    const kingHome = color === 'w' ? 4 : 60;
    if (color === 'w') {
      if (state.castling.w.k) {
        // king e1->g1(6), rook h1(7)->f1(5)
        if (board[6] === null && board[5] === null && !isAttacked(board, 6, opp) && !isAttacked(board, 5, opp)) {
          moves.push({ from: kingHome, to: 6, piece: { type: 'k', color: 'w' }, flags: { castling: 'kingside' } });
        }
      }
      if (state.castling.w.q) {
        // king e1(4)->c1(2), rook a1(0)->b1(1)
        if (board[2] === null && board[3] === null && !isAttacked(board, 2, opp) && !isAttacked(board, 3, opp)) {
          moves.push({ from: kingHome, to: 2, piece: { type: 'k', color: 'w' }, flags: { castling: 'queenside' } });
        }
      }
    } else {
      if (state.castling.b.k) {
        // king e8(60)->g8(62), rook h8(63)->f8(61)
        if (board[62] === null && board[61] === null && !isAttacked(board, 62, opp) && !isAttacked(board, 61, opp)) {
          moves.push({ from: kingHome, to: 62, piece: { type: 'k', color: 'b' }, flags: { castling: 'kingside' } });
        }
      }
      if (state.castling.b.q) {
        // king e8(60)->c8(58), rook a8(56)->b8(59)
        if (board[58] === null && board[59] === null && !isAttacked(board, 58, opp) && !isAttacked(board, 59, opp)) {
          moves.push({ from: kingHome, to: 58, piece: { type: 'k', color: 'b' }, flags: { castling: 'queenside' } });
        }
      }
    }
  }

  function generateMoves(state, color) {
    color = color || state.turn;
    const moves = [];
    const board = state.board;
    for (let from = 0; from < 64; from++) {
      const p = board[from];
      if (!p || p.color !== color) continue;
      switch (p.type) {
        case 'p':
          genPawnMoves(state, color, from, moves);
          break;
        case 'n':
          for (const [df, dr] of KNIGHT_MOVES) pushMoveIfFree(state, color, from, step(from, df, dr), moves);
          break;
        case 'b':
        case 'r':
        case 'q': {
          const dirs = p.type === 'b' ? BISHOP_DIRS : (p.type === 'r' ? ROOK_DIRS : ALL_DIRS);
          for (const [df, dr] of dirs) {
            for (let s = step(from, df, dr); s !== null; s = step(s, df, dr)) {
              const t = board[s];
              if (!t) { pushMove(state, color, from, s, moves, {}); continue; }
              if (t.color !== color) pushMove(state, color, from, s, moves, {});
              break;
            }
          }
          break;
        }
        case 'k':
          for (const [df, dr] of KING_MOVES) pushMoveIfFree(state, color, from, step(from, df, dr), moves);
          genCastlingMoves(state, color, moves);
          break;
      }
    }
    // Mark promotion moves: pawn landing on back rank.
    return moves.filter(m => isLegal(state, m));
  }

  function isLegal(state, move) {
    const target = state.board[move.to];
    if (target && target.type === 'k') return false; // kings are never capturable
    const next = applyMove(state, move);
    return !isAttacked(next.board, kingSquare(next.board, state.turn), other(state.turn));
  }

  function applyMove(state, move) {
    const board = state.board.map(p => (p ? { type: p.type, color: p.color } : null));
    const mover = state.turn;
    const p = board[move.from];
    const captured = board[move.to] !== null;
    board[move.to] = p;
    board[move.from] = null;
    if (move.flags.promotion) {
      p.type = move.flags.promo || 'q';
    }
    if (move.flags.castling) {
      const kingside = move.flags.castling === 'kingside';
      const rookFrom = mover === 'w' ? (kingside ? 7 : 0) : (kingside ? 63 : 56);
      const rookTo = kingside ? move.to - 1 : move.to + 1;
      const rook = board[rookFrom];
      board[rookFrom] = null;
      board[rookTo] = rook;
    }
    const castling = {
      w: { k: state.castling.w.k, q: state.castling.w.q },
      b: { k: state.castling.b.k, q: state.castling.b.q }
    };
    if (p.type === 'k') {
      castling[mover].k = false;
      castling[mover].q = false;
    } else if (p.type === 'r') {
      if (mover === 'w') {
        if (move.from === 0) castling.w.q = false;
        if (move.from === 7) castling.w.k = false;
      } else {
        if (move.from === 56) castling.b.q = false;
        if (move.from === 63) castling.b.k = false;
      }
    }
    const isDoublePush = p.type === 'p' && Math.abs(move.to - move.from) === 16;
    const halfmove = (p.type === 'p' || captured) ? 0 : state.halfmove + 1;
    const fullmove = mover === 'b' ? state.fullmove + 1 : state.fullmove;
    return {
      board: board,
      turn: other(mover),
      castling: castling,
      ep: isDoublePush ? move.to : null,
      halfmove: halfmove,
      fullmove: fullmove
    };
  }

  function validateMove(state, from, to, promo) {
    const color = state.turn;
    const p = state.board[from];
    if (!p || p.color !== color) return { legal: false, reason: 'not your turn' };
    const moves = generateMoves(state, color);
    for (const m of moves) {
      if (m.from !== from || m.to !== to) continue;
      if (m.flags.promotion) {
        if (promo === undefined || promo === null) {
          return { legal: true, move: { from: from, to: to, piece: p, flags: { promotion: true, promo: 'q', capture: m.flags.capture } } };
        }
        if (!PROMOTIONS.includes(promo)) return { legal: false, reason: 'invalid promotion' };
        return { legal: true, move: { from: from, to: to, piece: p, flags: { promotion: true, promo: promo, capture: m.flags.capture } } };
      }
      return { legal: true, move: m };
    }
    return { legal: false, reason: 'illegal move' };
  }

  function isInCheck(state, color) {
    color = color || state.turn;
    const king = kingSquare(state.board, color);
    return king !== null && isAttacked(state.board, king, other(color));
  }

  function isInsufficientMaterial(board) {
    const others = board.filter(p => p && p.type !== 'k');
    if (others.length === 0) return true;
    if (others.length === 1) {
      const p = others[0];
      return p.type === 'b' || p.type === 'n';
    }
    return false;
  }

  function gameStatus(state) {
    const color = state.turn;
    const moves = generateMoves(state, color);
    if (moves.length === 0) {
      if (isInCheck(state, color)) return { status: 'checkmate', loser: color, winner: other(color) };
      return { status: 'stalemate' };
    }
    if (isInsufficientMaterial(state.board)) return { status: 'draw', reason: 'insufficient material' };
    if (state.halfmove >= 100) return { status: 'draw', reason: '50-move rule' };
    return { status: null };
  }

  function squareName(sq) {
    return FILES[sq % 8] + (Math.floor(sq / 8) + 1);
  }
  function squareFromName(name) {
    const file = FILES.indexOf(name[0]);
    const rank = parseInt(name[1], 10);
    return file + (rank - 1) * 8;
  }

  function toFEN(state) {
    const rows = [];
    for (let r = 7; r >= 0; r--) {
      let empty = 0, row = '';
      for (let f = 0; f < 8; f++) {
        const p = state.board[f + r * 8];
        if (p) {
          if (empty) { row += empty; empty = 0; }
          row += p.color === 'w' ? p.type.toUpperCase() : p.type;
        } else empty++;
      }
      if (empty) row += empty;
      rows.push(row);
    }
    const castling = (state.castling.w.k ? 'K' : '') + (state.castling.w.q ? 'Q' : '') +
      (state.castling.b.k ? 'k' : '') + (state.castling.b.q ? 'q' : '');
    const castlingStr = castling.trim() === '' ? '-' : castling;
    const ep = state.ep === null ? '-' : squareName(state.ep);
    return rows.join('/') + ' ' + state.turn + ' ' + castlingStr + ' ' + ep + ' ' +
      state.halfmove + ' ' + state.fullmove;
  }

  function parseFEN(fen) {
    const parts = String(fen).trim().split(/\s+/);
    const rows = parts[0].split('/');
    const board = new Array(64).fill(null);
    for (let r = 0; r < 8; r++) {
      const row = rows[7 - r];
      let f = 0;
      for (const ch of row) {
        if (ch >= '1' && ch <= '8') { f += parseInt(ch, 10); continue; }
        const color = ch >= 'A' && ch <= 'Z' ? 'w' : 'b';
        board[f + r * 8] = { type: ch.toLowerCase(), color: color };
        f++;
      }
    }
    const castlingStr = (parts[2] || '-');
    const castling = { w: { k: false, q: false }, b: { k: false, q: false } };
    if (castlingStr !== '-') {
      for (const ch of castlingStr) {
        if (ch === 'K') castling.w.k = true;
        else if (ch === 'Q') castling.w.q = true;
        else if (ch === 'k') castling.b.k = true;
        else if (ch === 'q') castling.b.q = true;
      }
    }
    const epStr = parts[3] || '-';
    return {
      board: board,
      turn: parts[1] || 'w',
      castling: castling,
      ep: epStr === '-' ? null : squareFromName(epStr),
      halfmove: parseInt(parts[4] || '0', 10),
      fullmove: parseInt(parts[5] || '1', 10)
    };
  }

  return {
    createState: createState,
    initialState: createState,
    generateMoves: generateMoves,
    validateMove: validateMove,
    applyMove: applyMove,
    isInCheck: isInCheck,
    gameStatus: gameStatus,
    isInsufficientMaterial: isInsufficientMaterial,
    toFEN: toFEN,
    parseFEN: parseFEN,
    squareName: squareName,
    squareFromName: squareFromName,
    isAttacked: isAttacked
  };
}));
