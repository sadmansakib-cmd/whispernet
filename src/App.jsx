import React, { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';
import LockScreen from './components/LockScreen';
import RoomSelector from './components/RoomSelector';
import ChatViewport from './components/ChatViewport';
import CallWindow from './components/CallWindow';
import { deriveKey, zeroizeBuffer } from './crypto';

export default function App() {

  const [isUnlocked, setIsUnlocked] = useState(false);
  const [cryptoKey, setCryptoKey] = useState(null);
  const [masterPassword, setMasterPassword] = useState('');

  const [roomId, setRoomId] = useState('');
  const [roomPassphrase, setRoomPassphrase] = useState('');
  const [roomKey, setRoomKey] = useState(null);

  const [socket, setSocket] = useState(null);
  const [socketConnected, setSocketConnected] = useState(false);
  const [activePeerSocketId, setActivePeerSocketId] = useState('');

  const [activeCall, setActiveCall] = useState(null);

  const activityTimeoutRef = useRef(null);

  useEffect(() => {
    if (isUnlocked) {
      resetActivityTimer();
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

  useEffect(() => {
    if (roomId && roomPassphrase) {

      const socketUrl =
        window.location.origin.includes('localhost')
          ? 'http://localhost:5000'
          : window.location.origin;

      const newSocket = io(socketUrl, { transports: ['websocket'] });

      setSocket(newSocket);

      newSocket.on('connect', () => {
        setSocketConnected(true);
        console.log("✅ E2EE Signaling connected");

        // 🔥 CRITICAL FIX: actually join room
        newSocket.emit('join_room', { roomId });
      });

      newSocket.on('disconnect', () => {
        setSocketConnected(false);
        setActivePeerSocketId('');
      });

      newSocket.on('peer_connected', ({ socketId }) => {
        setActivePeerSocketId(socketId);
      });

      newSocket.on('peer_disconnected', () => {
        setActivePeerSocketId('');
        if (activeCall) setActiveCall(null);
      });

      newSocket.on('receive_webrtc_signal', ({ signal, senderSocketId }) => {
        if (signal.type === 'offer') {
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

  function resetActivityTimer() {
    if (activityTimeoutRef.current) clearTimeout(activityTimeoutRef.current);

    activityTimeoutRef.current = setTimeout(() => {
      handleLockVault();
    }, 300000);
  }

  function handleLockVault() {
    setCryptoKey(null);
    setRoomKey(null);

    if (masterPassword) {
      const encoder = new TextEncoder();
      const arr = encoder.encode(masterPassword);
      zeroizeBuffer(arr);
    }

    setMasterPassword('');
    setRoomId('');
    setRoomPassphrase('');
    setIsUnlocked(false);
  }

  function handleUnlockVault(derivedKey, plainPassword) {
    setCryptoKey(derivedKey);
    setMasterPassword(plainPassword);
    setIsUnlocked(true);
  }

  async function handleJoinRoom(id, passphrase) {
    try {
      const salt = `room-salt-${id}`;
      const key = await deriveKey(passphrase, salt);

      setRoomKey(key);
      setRoomId(id);
      setRoomPassphrase(passphrase);
    } catch (err) {
      alert("Failed to initialize cryptographic session key.");
    }
  }

  function handleLeaveRoom() {
    setRoomKey(null);
    setRoomId('');
    setRoomPassphrase('');
    setActivePeerSocketId('');
    if (socket) socket.close();
  }

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
        <LockScreen onUnlock={handleUnlockVault} />
      ) : !roomId ? (
        <RoomSelector
          socketConnected={socketConnected}
          onJoinRoom={handleJoinRoom}
        />
      ) : (
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
