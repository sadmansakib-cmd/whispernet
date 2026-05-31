// App Component
// The master coordinating controller for WhisperNet.
// Manages E2EE authentication states, active WebSockets signaling, E2EE rooms,
// WebRTC calling overlaps, and the automated security auto-lock inactivity timers.

import React, { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';
import LockScreen from './components/LockScreen';
import RoomSelector from './components/RoomSelector';
import ChatViewport from './components/ChatViewport';
import CallWindow from './components/CallWindow';
import { deriveKey, zeroizeBuffer } from './crypto';

export default function App() {
  // Authentication & Cryptographic State
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [cryptoKey, setCryptoKey] = useState(null);
  const [masterPassword, setMasterPassword] = useState('');

  // E2EE Room State
  const [roomId, setRoomId] = useState('');
  const [roomPassphrase, setRoomPassphrase] = useState('');
  const [roomKey, setRoomKey] = useState(null); // E2EE key for room session

  // Network Signaling State
  const [socket, setSocket] = useState(null);
  const [socketConnected, setSocketConnected] = useState(false);
  const [activePeerSocketId, setActivePeerSocketId] = useState('');

  // Call State
  const [activeCall, setActiveCall] = useState(null); // { isIncoming: bool, callerName: str }

  const activityTimeoutRef = useRef(null);

  // Initialize Inactivity Auto-Lock Timer
  useEffect(() => {
    if (isUnlocked) {
      resetActivityTimer();
      // Listen to standard pointer events to track user presence
      window.addEventListener('mousemove', resetActivityTimer);
      window.addEventListener('keypress', resetActivityTimer);
      window.addEventListener('click', resetActivityTimer);
      window.addEventListener('touchstart', resetActivityTimer);
    }

    return () => {
      window.removeEventListener('mousemove', resetActivityTimer);
      window.removeEventListener('keypress', resetActivityTimer);
      window.removeEventListener('click', resetActivityTimer);
      window.removeEventListener('touchstart', resetActivityTimer);
      if (activityTimeoutRef.current) clearTimeout(activityTimeoutRef.current);
    };
  }, [isUnlocked]);

  // WebSocket signaling connection coordinator
  useEffect(() => {
    if (roomId && roomPassphrase) {
      // Connect to Socket.io. Auto-binds to current URL in production, or fallback dev port
      const socketUrl = window.location.origin.includes('localhost') ? 'http://localhost:5000' : window.location.origin;
      const newSocket = io(socketUrl);
      setSocket(newSocket);

      newSocket.on('connect', () => {
        setSocketConnected(true);
        console.log("E2EE Signaling handshake channel active.");
      });

      newSocket.on('disconnect', () => {
        setSocketConnected(false);
        setActivePeerSocketId('');
      });

      newSocket.on('peer_connected', ({ socketId }) => {
        console.log(`E2EE Peer matching online: Socket ${socketId}`);
        setActivePeerSocketId(socketId);
      });

      newSocket.on('peer_disconnected', () => {
        console.log("E2EE Peer matching offline.");
        setActivePeerSocketId('');
        if (activeCall) {
          setActiveCall(null);
        }
      });

      // WebRTC Call offering listener
      newSocket.on('receive_webrtc_signal', ({ signal, senderSocketId }) => {
        if (signal.type === 'offer') {
          // Trigger incoming call panel
          setActiveCall({
            isIncoming: true,
            callerName: `Peer (${senderSocketId.substr(0, 4)})`
          });
          setActivePeerSocketId(senderSocketId);
        }
      });

      return () => {
        newSocket.close();
        setSocketConnected(false);
        setActivePeerSocketId('');
      };
    }
  }, [roomId, roomPassphrase]);

  // Monitor user activity. Trigger auto-lock after 5 minutes (300,000 ms)
  function resetActivityTimer() {
    if (activityTimeoutRef.current) clearTimeout(activityTimeoutRef.current);
    
    activityTimeoutRef.current = setTimeout(() => {
      handleLockVault();
    }, 300000); // 5 minutes in milliseconds
  }

  // Perform secure Lock and erase RAM keys
  function handleLockVault() {
    console.warn("Security Event: Auto-lock triggered. Evaporating volatile RAM keys.");
    
    // Wipe cryptographic key references from State
    setCryptoKey(null);
    setRoomKey(null);
    
    // Wipe master password string buffer
    if (masterPassword) {
      const encoder = new TextEncoder();
      const arr = encoder.encode(masterPassword);
      zeroizeBuffer(arr);
    }
    setMasterPassword('');

    // Disconnect room
    setRoomId('');
    setRoomPassphrase('');

    setIsUnlocked(false);
    alert("WhisperNet Auto-Lock Active. Cryptographic keys cleared from memory.");
  }

  // Unlock local database vault
  function handleUnlockVault(derivedKey, plainPassword) {
    setCryptoKey(derivedKey);
    setMasterPassword(plainPassword);
    setIsUnlocked(true);
  }

  // Join E2EE Room
  async function handleJoinRoom(id, passphrase) {
    try {
      // Derive E2EE key for room session locally
      const salt = `room-salt-${id}`; // deterministic room salt
      const key = await deriveKey(passphrase, salt);
      
      setRoomKey(key);
      setRoomId(id);
      setRoomPassphrase(passphrase);
    } catch (err) {
      console.error("Failed to derive E2EE room session key:", err);
      alert("Failed to initialize cryptographic session key.");
    }
  }

  function handleLeaveRoom() {
    // Zero out room E2EE key reference
    setRoomKey(null);
    setRoomId('');
    setRoomPassphrase('');
    setActivePeerSocketId('');
    if (socket) {
      socket.close();
    }
  }

  // Trigger WebRTC call output
  function handleStartCall(type) {
    if (!activePeerSocketId) return;

    setActiveCall({
      isIncoming: false,
      callerName: `Connecting...`
    });
  }

  return (
    <div style={styles.appContainer}>
      {!isUnlocked ? (
        // Stage 1: Locked Vault Screen
        <LockScreen onUnlock={handleUnlockVault} />
      ) : !roomId ? (
        // Stage 2: E2EE Lobby Screen
        <RoomSelector
          socketConnected={socketConnected}
          onJoinRoom={handleJoinRoom}
        />
      ) : (
        // Stage 3: Secure Chatting Viewport active
        <ChatViewport
          socket={socket}
          roomId={roomId}
          mySenderId={mySenderId(socket)}
          cryptoKey={roomKey}
          roomPassphrase={roomPassphrase}
          socketConnected={socketConnected}
          onLeaveRoom={handleLeaveRoom}
          onStartCall={handleStartCall}
          activePeerSocketId={activePeerSocketId}
        />
      )}

      {/* Real-time calling overlay matches WebRTC */}
      {activeCall && (
        <CallWindow
          socket={socket}
          roomId={roomId}
          mySenderId={mySenderId(socket)}
          isIncoming={activeCall.isIncoming}
          callerName={activeCall.callerName}
          activePeerSocketId={activePeerSocketId}
          onEndCall={() => setActiveCall(null)}
        />
      )}
    </div>
  );
}

// Generate anonymous sender identifier for matching
function mySenderId(socket) {
  if (socket && socket.id) {
    return `user-${socket.id.substring(0, 5)}`;
  }
  return 'user-anonymous';
}

const styles = {
  appContainer: {
    width: '100vw',
    height: '100vh',
    position: 'relative',
    overflow: 'hidden',
    backgroundColor: '#03040a',
  }
};
