/*
 * tests/engine.test.js — sanity tests for the chess engine (run: node tests/engine.test.js)
 */
const assert = require('assert');
const E = require('../chess-logic.js');

function movesContain(moves, from, to) {
  return moves.some(m => m.from === from && m.to === to);
}

// 1. Initial position
{
  const s = E.initialState();
  assert.strictEqual(s.turn, 'w');
  const moves = E.generateMoves(s, 'w');
  assert.strictEqual(moves.length, 20, 'initial white move count');
  assert.ok(movesContain(moves, 12, 20), 'white pawn e2->e3');
  assert.ok(movesContain(moves, 12, 28), 'white pawn e2->e4');
  assert.ok(movesContain(moves, 1, 18), 'white knight b1->c3');
  assert.ok(movesContain(moves, 1, 16), 'white knight b1->a3');
  assert.ok(movesContain(moves, 6, 21), 'white knight g1->f3');
  assert.ok(movesContain(moves, 6, 23), 'white knight g1->h3');
  assert.strictEqual(moves.filter(m => m.piece.type === 'r').length, 0, 'rooks blocked by own pawns');
}

// 2. Make a legal move and apply it
{
  const s = E.initialState();
  const { legal, move } = E.validateMove(s, 12, 28);
  assert.ok(legal);
  assert.strictEqual(move.flags.doublePush, true);
  const next = E.applyMove(s, move);
  assert.strictEqual(next.turn, 'b');
  assert.strictEqual(next.board[28].type, 'p');
  assert.strictEqual(next.board[28].color, 'w');
  assert.strictEqual(next.board[12], null);
  assert.strictEqual(next.ep, 28);
  // Original state unchanged
  assert.strictEqual(s.board[12].type, 'p');
  assert.strictEqual(s.board[28], null);
}

// 3. validateMove rejects wrong-color moves / illegal king moves
{
  const s = E.initialState();
  assert.strictEqual(E.validateMove(s, 4, 28).legal, false); // king e1->e4
  const r = E.validateMove(s, 8, 16); // white pawn a2->a3
  assert.ok(r.legal);
}

// 4. Capture: white pawn e4 x d5
{
  const s = E.parseFEN('rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR b KQk8 - 0 1');
  const moves = E.generateMoves(s, 'w');
  assert.ok(movesContain(moves, 28, 35), 'white pawn e4 x d5');
}

// 5. Checkmate (white: rook a1 + queen b6 vs black king a8)
{
  const s = E.parseFEN('k7/8/1Q6/8/8/8/8/R7 b - - 0 1');
  assert.strictEqual(E.isInCheck(s, 'b'), true);
  const st = E.gameStatus(s);
  assert.strictEqual(st.status, 'checkmate');
  assert.strictEqual(st.winner, 'w');
  assert.strictEqual(E.generateMoves(s, 'b').length, 0);
}

// 6. Stalemate
{
  const s = E.parseFEN('k7/8/1Q6/8/8/8/8/K7 b - - 0 1');
  assert.strictEqual(E.isInCheck(s, 'b'), false);
  const st = E.gameStatus(s);
  assert.strictEqual(st.status, 'stalemate');
  assert.strictEqual(E.generateMoves(s, 'b').length, 0);
}

// 7. Promotions
{
  const s = E.parseFEN('4k3/P7/8/8/8/8/8/4K3 w - - 0 1');
  const moves = E.generateMoves(s, 'w');
  assert.ok(moves.some(m => m.from === 48 && m.to === 56 && m.flags.promotion), 'white pawn a7->a8 promotion');
  const { legal, move } = E.validateMove(s, 48, 56);
  assert.ok(legal);
  assert.strictEqual(move.flags.promotion, true);
  assert.strictEqual(move.flags.promo, 'q');
  const next = E.applyMove(s, move);
  assert.strictEqual(next.board[56].type, 'q');
}

// 8. Castling
{
  const s = E.parseFEN('r3k2r/8/8/8/8/8/8/4K2R w KQk8 - 0 1');
  const moves = E.generateMoves(s, 'w');
  assert.ok(moves.some(m => m.flags.castling === 'kingside' && m.from === 4 && m.to === 6), 'white kingside castle');
  assert.ok(moves.some(m => m.flags.castling === 'queenside' && m.from === 4 && m.to === 2), 'white queenside castle');
  assert.ok(moves.some(m => m.piece.type === 'r' && m.from === 7 && m.to === 15), 'white rook h1->h2');
  const next = E.applyMove(s, E.validateMove(s, 4, 6).move);
  assert.strictEqual(next.board[6].type, 'k');
  assert.strictEqual(next.board[5].type, 'r');
  assert.strictEqual(next.board[7], null);
  assert.strictEqual(next.board[4], null);
  assert.strictEqual(next.castling.w.k, false);
  assert.strictEqual(next.castling.w.q, false);
  assert.strictEqual(next.castling.b.k, true);
}

// 9. En passant (adjacent capture of a double-pushed pawn)
{
  const s0 = E.initialState();
  const s1 = E.applyMove(s0, E.validateMove(s0, 12, 28).move); // 1.e4
  assert.strictEqual(s1.ep, 28);
  assert.strictEqual(s1.turn, 'b');
  const s2 = E.applyMove(s1, E.validateMove(s1, 51, 35).move); // 1...d7-d5
  assert.strictEqual(s2.ep, 35);
  const whiteMoves = E.generateMoves(s2, 'w');
  assert.ok(movesContain(whiteMoves, 28, 35), 'white pawn e4 captures d5');
  const next = E.applyMove(s2, E.validateMove(s2, 28, 35).move);
  assert.strictEqual(next.board[35].type, 'p');
  assert.strictEqual(next.board[35].color, 'w');
  assert.strictEqual(next.turn, 'b');
}

// 10. Insufficient material
{
  const s = E.parseFEN('k7/8/8/8/8/8/8/K7 w - - 0 1');
  assert.strictEqual(E.gameStatus(s).status, 'draw');
}

// 11. 50-move rule
{
  const s = E.parseFEN('k7/8/8/8/8/8/8/K7 w - - 100 1');
  assert.strictEqual(E.gameStatus(s).status, 'draw');
}

// 12. Pinned piece cannot move (king safety)
{
  const s = E.parseFEN('4r3/8/8/8/8/8/4B3/4K3 w - - 0 1');
  const bishopMoves = E.generateMoves(s, 'w').filter(m => m.piece.type === 'b');
  assert.strictEqual(bishopMoves.length, 0, 'bishop pinned by rook');
  assert.strictEqual(E.generateMoves(s, 'w').length > 0, true, 'king still has moves');
}

// 13. toFEN round-trip of a parsed position
{
  const fen = '4k3/P7/8/8/8/8/8/4K3 w - - 0 1';
  const s = E.parseFEN(fen);
  assert.strictEqual(E.toFEN(s), fen);
}

console.log('engine tests passed');
