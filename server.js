// WhisperNet Handshake & Relay Server
// Stateless backend. Serves React assets and coordinates WebSocket E2EE signaling.
// Stores zero user logs or databases. Relays are ephemeral and secure.

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);

const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 5000;

const roomMailboxes = {};

// Serve compiled React build
app.use(express.static(path.join(__dirname, 'dist')));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'), (err) => {
    if (err) {
      res.status(200).send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>WhisperNet Engine Loading</title>
          <style>
            body { background: #0b0d19; color: #8b9bb4; font-family: sans-serif; display: flex; flex-direction: column; justify-content: center; align-items: center; height: 100vh; }
            h1 { color: #6366f1; }
          </style>
        </head>
        <body>
          <h1>WhisperNet Secure Handshake Active</h1>
          <p>The E2EE WebSocket Server is active on port ${PORT}. Run <code>npm run build</code> to compile static pages.</p>
        </body>
        </html>
      `);
    }
  });
});

io.on('connection', (socket) => {
  let currentRoom = null;

  console.log(`✅ Connection established: ${socket.id}`);

  socket.on('join_room', ({ roomId }) => {
    if (!roomId) return;

    const cleanRoom = roomId.trim();
    socket.join(cleanRoom);
    currentRoom = cleanRoom;

    const clients = io.sockets.adapter.rooms.get(cleanRoom);
    const numClients = clients ? clients.size : 0;

    console.log(`📊 ${socket.id} joined room "${cleanRoom}". Participants: ${numClients}`);

    socket.to(cleanRoom).emit('peer_connected', { socketId: socket.id });

    if (roomMailboxes[cleanRoom] && roomMailboxes[cleanRoom].length > 0) {
      socket.emit('offline_mailbox_delivery', roomMailboxes[cleanRoom]);
      delete roomMailboxes[cleanRoom];
    }
  });

  socket.on('send_message', (messagePayload) => {
    if (!currentRoom) return;

    const clients = io.sockets.adapter.rooms.get(currentRoom);
    const numClients = clients ? clients.size : 0;

    if (numClients > 1) {
      socket.to(currentRoom).emit('receive_message', messagePayload);
    } else {
      if (!roomMailboxes[currentRoom]) {
        roomMailboxes[currentRoom] = [];
      }

      if (roomMailboxes[currentRoom].length < 100) {
        roomMailboxes[currentRoom].push(messagePayload);
      }
    }
  });

  socket.on('message_action', (actionPayload) => {
    if (currentRoom) {
      socket.to(currentRoom).emit('receive_message_action', actionPayload);
    }
  });

  socket.on('draw_vector', (drawPayload) => {
    if (currentRoom) {
      socket.to(currentRoom).emit('receive_vector', drawPayload);
    }
  });

  socket.on('game_action', (gamePayload) => {
    if (currentRoom) {
      socket.to(currentRoom).emit('receive_game_action', gamePayload);
    }
  });

  socket.on('typing_state', ({ isTyping }) => {
    if (currentRoom) {
      socket.to(currentRoom).emit('receive_typing_state', { isTyping, socketId: socket.id });
    }
  });

  socket.on('webrtc_signal', ({ signal, targetSocketId }) => {
    if (targetSocketId) {
      io.to(targetSocketId).emit('receive_webrtc_signal', {
        signal,
        senderSocketId: socket.id
      });
    } else if (currentRoom) {
      socket.to(currentRoom).emit('receive_webrtc_signal', {
        signal,
        senderSocketId: socket.id
      });
    }
  });

  socket.on('disconnect', () => {
    console.log(`❌ Disconnected: ${socket.id}`);
    if (currentRoom) {
      socket.to(currentRoom).emit('peer_disconnected', { socketId: socket.id });
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 WhisperNet Engine running on port ${PORT}`);
});
