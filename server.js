const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;
app.use(express.static("public"));

const rooms = new Map();
const publicQueue = [];
const MAX_BOARD = 24;
const randomCode = () => crypto.randomBytes(3).toString("hex").toUpperCase();
const shuffle = a => [...a].sort(() => Math.random() - 0.5);
const boardForRoom = () => shuffle(Array.from({length: 1025}, (_, i) => i + 1)).slice(0, MAX_BOARD).sort((a,b)=>a-b);

function cleanPlayer(p) {
  return { id: p.id, name: p.name, ready: p.ready, connected: p.connected };
}
function roomState(room) {
  return {
    code: room.code, mode: room.mode, boardIds: room.boardIds,
    players: room.players.map(cleanPlayer),
    phase: room.phase, turn: room.turn,
    pendingQuestion: room.pendingQuestion ? {
      from: room.pendingQuestion.from,
      question: room.pendingQuestion.question,
      label: room.pendingQuestion.label
    } : null,
    message: room.message || ""
  };
}
function sendState(room) {
  room.players.forEach(p => io.to(p.id).emit("room-state", roomState(room)));
}
function sendNotice(room, text) {
  room.players.forEach(p => io.to(p.id).emit("notice", text));
}
function startRoom(room) {
  if (room.players.length === 2 && room.players.every(p => p.ready && p.secret)) {
    room.phase = "playing";
    room.turn = room.players[0].id;
    room.message = "¡Partida iniciada! " + room.players[0].name + " empieza.";
    sendNotice(room, room.message);
    sendState(room);
  }
}
function leaveQueue(socketId) {
  const i = publicQueue.findIndex(x => x.id === socketId);
  if (i >= 0) publicQueue.splice(i, 1);
}
function removePlayer(socket) {
  leaveQueue(socket.id);
  for (const [code, room] of rooms) {
    const index = room.players.findIndex(p => p.id === socket.id);
    if (index !== -1) {
      const wasPlaying = room.phase === "playing";
      room.players.splice(index, 1);
      if (room.players.length === 0) rooms.delete(code);
      else {
        room.phase = "waiting";
        room.turn = null;
        room.pendingQuestion = null;
        sendNotice(room, wasPlaying ? "El otro jugador se desconectó. La sala volvió a la espera." : "El otro jugador salió de la sala.");
        sendState(room);
      }
      break;
    }
  }
}
function findRoomBySocket(id) {
  for (const room of rooms.values()) if (room.players.some(p => p.id === id)) return room;
  return null;
}
function playerIn(room, id) { return room.players.find(p => p.id === id); }

io.on("connection", socket => {
  socket.on("create-room", ({name}) => {
    removePlayer(socket);
    const code = randomCode();
    const player = {id: socket.id, name: String(name || "Jugador 1").slice(0,20), ready:false, connected:true, secret:null};
    const room = {code, mode:"private", boardIds:boardForRoom(), players:[player], phase:"waiting", turn:null, pendingQuestion:null, message:"Esperando a otro jugador…"};
    rooms.set(code, room);
    socket.join(code);
    socket.emit("room-created", {code});
    sendState(room);
  });

  socket.on("join-room", ({code, name}) => {
    const key = String(code || "").trim().toUpperCase();
    const room = rooms.get(key);
    if (!room) return socket.emit("error-message", "No existe esa sala. Revisá el código.");
    if (room.players.length >= 2) return socket.emit("error-message", "La sala está completa.");
    if (room.players.some(p => p.id === socket.id)) return socket.emit("error-message", "Ya estás en esta sala.");
    removePlayer(socket);
    room.mode = "private";
    room.players.push({id:socket.id, name:String(name || "Jugador 2").slice(0,20), ready:false, connected:true, secret:null});
    socket.join(key);
    room.message = "Ambos jugadores conectados. Elegí tu Pokémon secreto.";
    sendState(room);
    sendNotice(room, room.message);
  });

  socket.on("find-public-game", ({name}) => {
    removePlayer(socket);
    const me = {id:socket.id, name:String(name || "Entrenador").slice(0,20), ready:false, connected:true, secret:null};
    while (publicQueue.length) {
      const opponent = publicQueue.shift();
      if (opponent.id === socket.id || !io.sockets.sockets.has(opponent.id)) continue;
      const code = randomCode();
      const room = {code, mode:"public", boardIds:boardForRoom(), players:[opponent, me], phase:"waiting", turn:null, pendingQuestion:null, message:"Rival encontrado. Elegí tu Pokémon secreto."};
      rooms.set(code, room);
      io.sockets.sockets.get(opponent.id).join(code);
      socket.join(code);
      io.to(opponent.id).emit("match-found", {code});
      socket.emit("match-found", {code});
      sendState(room);
      return;
    }
    publicQueue.push(me);
    socket.emit("queue-status", "Buscando rival… Te avisaremos cuando alguien se una.");
  });
  socket.on("cancel-public-search", () => {
    leaveQueue(socket.id);
    socket.emit("queue-status", "Búsqueda cancelada.");
  });

  socket.on("choose-secret", ({id, pokemon}) => {
    const room = findRoomBySocket(socket.id);
    if (!room || room.phase !== "waiting") return;
    const player = playerIn(room, socket.id);
    if (!player || !room.boardIds.includes(Number(id))) return socket.emit("error-message", "Elegí un Pokémon del tablero.");
    player.secret = {
      id:Number(id), name:String(pokemon?.name || "Pokémon"),
      types:Array.isArray(pokemon?.types) ? pokemon.types : [],
      gen:Number(pokemon?.gen || 1),
      evolves:!!pokemon?.evolves, legendary:!!pokemon?.legendary
    };
    player.ready = true;
    socket.emit("secret-confirmed", {id:Number(id)});
    if (room.players.length < 2) {
      socket.emit("notice", "Pokémon secreto elegido. Esperá a que se conecte tu rival.");
    } else {
      sendNotice(room, player.name + " ya eligió su Pokémon secreto.");
    }
    startRoom(room);
    sendState(room);
  });

  socket.on("ask-question", ({question, label}) => {
    const room = findRoomBySocket(socket.id);
    if (!room || room.phase !== "playing" || room.turn !== socket.id || room.pendingQuestion) return;
    const asker = playerIn(room, socket.id);
    const opponent = room.players.find(p => p.id !== socket.id);
    if (!asker || !opponent || !opponent.secret) return;
    room.pendingQuestion = {from:socket.id, question:String(question), label:String(label || "Pregunta")};
    io.to(opponent.id).emit("incoming-question", {from:asker.name, question:String(question), label:String(label || "Pregunta")});
    socket.emit("notice", "Pregunta enviada. Esperá la respuesta del rival.");
    sendState(room);
  });

  socket.on("answer-question", ({answer}) => {
    const room = findRoomBySocket(socket.id);
    if (!room || room.phase !== "playing" || !room.pendingQuestion) return;
    const opponent = playerIn(room, socket.id);
    const asker = playerIn(room, room.pendingQuestion.from);
    if (!opponent || !asker || opponent.id === asker.id) return;
    const ans = !!answer;
    io.to(asker.id).emit("question-answer", {answer:ans, label:room.pendingQuestion.label, by:opponent.name});
    io.to(opponent.id).emit("notice", "Respuesta enviada. Ahora le toca preguntar a tu rival.");
    room.turn = opponent.id;
    room.pendingQuestion = null;
    sendState(room);
  });

  socket.on("make-guess", ({id}) => {
    const room = findRoomBySocket(socket.id);
    if (!room || room.phase !== "playing" || room.turn !== socket.id || room.pendingQuestion) return;
    const player = playerIn(room, socket.id);
    const opponent = room.players.find(p => p.id !== socket.id);
    if (!player || !opponent || !opponent.secret) return;
    if (Number(id) === opponent.secret.id) {
      room.phase = "finished";
      room.winner = socket.id;
      sendNotice(room, "¡" + player.name + " descubrió el Pokémon secreto y ganó!");
      room.players.forEach(p => io.to(p.id).emit("game-over", {
        winner:player.name, won:p.id===socket.id, secret:opponent.secret
      }));
    } else {
      socket.emit("guess-result", {correct:false, id:Number(id)});
      room.turn = opponent.id;
      sendNotice(room, player.name + " falló su intento. Ahora le toca a " + opponent.name + ".");
      sendState(room);
    }
  });

  socket.on("chat-message", ({text}) => {
    const room = findRoomBySocket(socket.id);
    if (!room) return;
    const p = playerIn(room, socket.id);
    const msg = String(text || "").trim().slice(0,240);
    if (!msg || !p) return;
    room.players.forEach(player => io.to(player.id).emit("chat-message", {name:p.name, text:msg, own:player.id===socket.id}));
  });

  socket.on("play-again", () => {
    const room = findRoomBySocket(socket.id);
    if (!room || room.players.length !== 2) return;
    room.boardIds = boardForRoom();
    room.players.forEach(p => {p.secret=null;p.ready=false;});
    room.phase = "waiting"; room.turn=null; room.pendingQuestion=null; room.message="Nueva partida: elegí tu Pokémon secreto.";
    sendNotice(room, room.message); sendState(room);
  });

  socket.on("disconnect", () => removePlayer(socket));
});

server.listen(PORT, () => console.log(`PokéImpostor Online en http://localhost:${PORT}`));
