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

// Ephemeral in-memory mailbox for offline queuing.
// Structures: roomMailbox[roomId] = [ { id, sender, type, content, timestamp, ... }, ... ]
// Purged immediately upon retrieval by the recipient.
const roomMailboxes = {};

// Serve compiled static assets from the React dist folder (if compiled)
app.use(express.static(path.join(__dirname, 'dist')));

// Fallback all routes to Index.html for SPA routing
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'), (err) => {
    if (err) {
      // If client is not compiled yet, serve a friendly development loader page
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
          <p>The E2EE WebSocket Server is active on port ${PORT}. Run dev client, or run <code>npm run build</code> to compile static pages.</p>
        </body>
        </html>
      `);
    }
  });
});

io.on('connection', (socket) => {
  let currentRoom = null;

  console.log(`Connection established: Socket ID ${socket.id}`);

  // User request to connect and join an E2EE Room ID
  socket.on('join_room', ({ roomId }) => {
    socket.join(roomId);
    currentRoom = roomId;

    const clients = io.sockets.adapter.rooms.get(roomId);
    const numClients = clients ? clients.size : 0;
    
    console.log(`Socket ${socket.id} joined room: ${roomId}. Total participants in room: ${numClients}`);

    // Notify other users in the room that a peer has connected (for WebRTC negotiations)
    socket.to(roomId).emit('peer_connected', { socketId: socket.id });

    // Send any queued offline E2EE messages to the newly connected client
    if (roomMailboxes[roomId] && roomMailboxes[roomId].length > 0) {
      console.log(`Delivering ${roomMailboxes[roomId].length} queued encrypted payloads to socket ${socket.id}`);
      socket.emit('offline_mailbox_delivery', roomMailboxes[roomId]);
      
      // Zero out the queue once delivered (ephemeral delivery)
      delete roomMailboxes[roomId];
    }
  });

  // Relay E2EE message payloads (texts, custom actions, reactions, voice)
  socket.on('send_message', (messagePayload) => {
    if (!currentRoom) return;

    const clients = io.sockets.adapter.rooms.get(currentRoom);
    const numClients = clients ? clients.size : 0;

    if (numClients > 1) {
      // Direct relay if participant is actively connected in room
      socket.to(currentRoom).emit('receive_message', messagePayload);
    } else {
      // Store in ephemeral mailbox if participant is offline
      if (!roomMailboxes[currentRoom]) {
        roomMailboxes[currentRoom] = [];
      }
      // Keep queue small (e.g. limit to last 100 encrypted notifications for stability)
      if (roomMailboxes[currentRoom].length < 100) {
        roomMailboxes[currentRoom].push(messagePayload);
        console.log(`Queued E2EE payload for offline recipient in room: ${currentRoom}`);
      }
    }
  });

  // Relay message modifications (edit, delete, unsend updates)
  socket.on('message_action', (actionPayload) => {
    if (currentRoom) {
      socket.to(currentRoom).emit('receive_message_action', actionPayload);
    }
  });

  // Relay real-time E2EE shared whiteboard vector coordinates
  socket.on('draw_vector', (drawPayload) => {
    if (currentRoom) {
      socket.to(currentRoom).emit('receive_vector', drawPayload);
    }
  });

  // Relay real-time E2EE multiplayer game packets (moves, rock-paper-scissors turns)
  socket.on('game_action', (gamePayload) => {
    if (currentRoom) {
      socket.to(currentRoom).emit('receive_game_action', gamePayload);
    }
  });

  // Relay real-time E2EE typing indicator alerts
  socket.on('typing_state', ({ isTyping }) => {
    if (currentRoom) {
      socket.to(currentRoom).emit('receive_typing_state', { isTyping, socketId: socket.id });
    }
  });

  // WebRTC Audio/Video signaling relays (SDP Offers, SDP Answers, ICE Candidates)
  socket.on('webrtc_signal', ({ signal, targetSocketId }) => {
    if (targetSocketId) {
      // Send signal to targeted peer
      io.to(targetSocketId).emit('receive_webrtc_signal', { signal, senderSocketId: socket.id });
    } else if (currentRoom) {
      // Broadcast to room if no target socket is defined (fallback)
      socket.to(currentRoom).emit('receive_webrtc_signal', { signal, senderSocketId: socket.id });
    }
  });

  socket.on('disconnect', () => {
    console.log(`Socket disconnected: ${socket.id}`);
    if (currentRoom) {
      socket.to(currentRoom).emit('peer_disconnected', { socketId: socket.id });
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`WhisperNet Handshake Engine active at http://0.0.0.0:${PORT}`);
});
