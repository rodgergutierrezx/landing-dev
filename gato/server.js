const path = require("path");
const http = require("http");
const express = require("express");
const { Server } = require("socket.io");

const PORT = process.env.PORT || 3000;
const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, "public")));

const LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
];

let waiting = null; // socket esperando rival
const games = new Map(); // id de partida -> partida
let nextId = 1;

function cleanName(name) {
  const n = String(name ?? "").replace(/\s+/g, " ").trim().slice(0, 20);
  return n || "Anónimo";
}

function findWinner(board) {
  for (const line of LINES) {
    const [a, b, c] = line;
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return { winner: board[a], line };
    }
  }
  return null;
}

function publicState(game) {
  return {
    board: game.board,
    turn: game.turn,
    names: { X: game.players.X.data.name, O: game.players.O.data.name },
    winner: game.winner,
    line: game.line,
    draw: game.draw,
    scores: {
      X: game.scores[game.players.X.id],
      O: game.scores[game.players.O.id],
    },
  };
}

// Reparte 'X' y 'O' al azar y empieza una ronda nueva. La X siempre abre.
function startRound(game) {
  const pair = [game.players.X, game.players.O];
  if (Math.random() < 0.5) pair.reverse();
  game.players = { X: pair[0], O: pair[1] };
  game.board = Array(9).fill(null);
  game.turn = "X";
  game.winner = null;
  game.line = null;
  game.draw = false;
  game.rematch = new Set();

  for (const symbol of ["X", "O"]) {
    const s = game.players[symbol];
    s.data.symbol = symbol;
    s.emit("start", { you: symbol, ...publicState(game) });
  }
}

function createGame(a, b) {
  const id = `partida-${nextId++}`;
  const game = { id, players: { X: a, O: b }, scores: { [a.id]: 0, [b.id]: 0 } };
  games.set(id, game);
  for (const s of [a, b]) {
    s.data.gameId = id;
    s.join(id);
  }
  startRound(game);
}

function leaveGame(socket, reason) {
  const game = games.get(socket.data.gameId);
  if (!game) return;
  games.delete(game.id);
  for (const s of Object.values(game.players)) {
    s.leave(game.id);
    s.data.gameId = null;
    s.data.symbol = null;
    if (s.id !== socket.id) s.emit("opponent-left", { reason });
  }
}

io.on("connection", (socket) => {
  socket.on("join", ({ name } = {}) => {
    if (socket.data.gameId) leaveGame(socket, "left");
    socket.data.name = cleanName(name);

    if (waiting && waiting.id !== socket.id && waiting.connected) {
      const rival = waiting;
      waiting = null;
      createGame(rival, socket);
    } else {
      waiting = socket;
      socket.emit("waiting");
    }
  });

  socket.on("move", ({ index } = {}) => {
    const game = games.get(socket.data.gameId);
    if (!game || game.winner || game.draw) return;
    const symbol = socket.data.symbol;
    if (game.turn !== symbol) return socket.emit("not-your-turn");
    if (!Number.isInteger(index) || index < 0 || index > 8 || game.board[index]) return;

    game.board[index] = symbol;
    const result = findWinner(game.board);
    if (result) {
      game.winner = result.winner;
      game.line = result.line;
      game.scores[socket.id] += 1;
    } else if (game.board.every(Boolean)) {
      game.draw = true;
    } else {
      game.turn = symbol === "X" ? "O" : "X";
    }
    io.to(game.id).emit("state", { lastMove: index, ...publicState(game) });
  });

  socket.on("rematch", () => {
    const game = games.get(socket.data.gameId);
    if (!game || !(game.winner || game.draw)) return;
    game.rematch.add(socket.id);
    socket.to(game.id).emit("rematch-requested");
    if (game.rematch.size === 2) startRound(game);
  });

  socket.on("leave", () => {
    if (waiting && waiting.id === socket.id) waiting = null;
    leaveGame(socket, "left");
  });

  socket.on("disconnect", () => {
    if (waiting && waiting.id === socket.id) waiting = null;
    leaveGame(socket, "disconnected");
  });
});

server.listen(PORT, () => {
  console.log(`Juego del gato en http://localhost:${PORT}`);
});
