// ChatViewport Component
// The primary messaging environment for WhisperNet.
// Supports encrypted chat logs, real-time message edits, unsends, emoji reactions,
// custom encrypted gallery wallpapers, word effects, E2EE game hubs, whiteboard panels,
// and slide-out security statistics drawers with panic wipes.

import React, { useState, useEffect, useRef } from 'react';
import { 
  Send, Shield, Video, Phone, Trash2, Edit3, Image, Settings, 
  Smile, Gamepad2, PenTool, Eye, EyeOff, Mic, X, Info, Download, AlertTriangle 
} from 'lucide-react';
import { db, deleteMessageFromDB, deleteChatFromDB, panicWipeDatabase } from '../db';
import { encryptText, decryptText, encryptBinary, decryptBinary, zeroizeBuffer } from '../crypto';
import { VoiceRecorder, VoicePlayer } from './VoiceRecorder';
import FileTransporter, { FileDownloadCard } from './FileTransporter';
import SelfDestructPlayer from './SelfDestructPlayer';
import GameZone from './GameZone';
import Whiteboard from './Whiteboard';

export default function ChatViewport({
  socket,
  roomId,
  mySenderId,
  cryptoKey,
  roomPassphrase,
  socketConnected,
  onLeaveRoom,
  onStartCall,
  activePeerSocketId
}) {
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [showEffects, setShowEffects] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [peerTyping, setPeerTyping] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  // Custom Wallpaper State
  const [wallpaperUrl, setWallpaperUrl] = useState('');
  const [wallpaperOpacity, setWallpaperOpacity] = useState(30);
  const [wallpaperBlur, setWallpaperBlur] = useState(2);
  
  // Custom Active Panels
  const [activeGamePanel, setActiveGamePanel] = useState(false);
  const [activeBoardPanel, setActiveBoardPanel] = useState(false);
  const [showVoiceRecorder, setShowVoiceRecorder] = useState(false);
  
  // Self-Destruct Viewer State
  const [activeSelfDestructMedia, setActiveSelfDestructMedia] = useState(null);

  // Reaction Drawer State
  const [activeReactionMenuMsgId, setActiveReactionMenuMsgId] = useState(null);

  // Editing Message State
  const [editingMsgId, setEditingMsgId] = useState(null);
  const [editText, setEditText] = useState('');

  // Local Ciphertext Viewer State
  const [revealedCiphertexts, setRevealedCiphertexts] = useState({}); // { msgId: true/false }

  // Particle pop anim elements
  const [triggerParticleEffect, setTriggerParticleEffect] = useState(false);

  const messagesEndRef = useRef(null);
  const typingTimeoutRef = useRef(null);

  // E2EE Setup & Messages loading
  useEffect(() => {
    loadChatMetadataAndHistory();
    setupSocketMessageListeners();

    return () => {
      if (socket) {
        socket.off('receive_message');
        socket.off('receive_message_action');
        socket.off('receive_typing_state');
        socket.off('offline_mailbox_delivery');
      }
    };
  }, [roomId, cryptoKey]);

  // Scroll to bottom on new message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, peerTyping]);

  async function loadChatMetadataAndHistory() {
    try {
      // 1. Fetch or create chat metadata
      let chat = await db.chats.get(roomId);
      if (!chat) {
        chat = {
          id: roomId,
          name: `Chat Room: ${roomId}`,
          created_at: Date.now(),
          theme: 'classic-noir',
          customWallpaperBrightness: 30,
          customWallpaperBlur: 2
        };
        await db.chats.put(chat);
      }

      // Load wallpaper configurations
      if (chat.customWallpaper) {
        try {
          const decryptedWallpaper = await decryptBinary(chat.customWallpaper, cryptoKey);
          const blob = new Blob([decryptedWallpaper], { type: 'image/jpeg' });
          const url = URL.createObjectURL(blob);
          setWallpaperUrl(url);
          setWallpaperOpacity(chat.customWallpaperBrightness || 30);
          setWallpaperBlur(chat.customWallpaperBlur || 2);
          
          // Zero memory
          const tempArr = new Uint8Array(decryptedWallpaper);
          zeroizeBuffer(tempArr);
        } catch (err) {
          console.error("Failed to decrypt custom wallpaper:", err);
        }
      }

      // 2. Fetch and E2EE decrypt local messages
      const dbMsgs = await db.messages.where({ chatId: roomId }).sortBy('timestamp');
      const decryptedMsgs = [];

      for (let msg of dbMsgs) {
        try {
          const decryptedContent = await decryptText(msg.content, cryptoKey);
          decryptedMsgs.push({
            ...msg,
            content: decryptedContent
          });
        } catch (err) {
          decryptedMsgs.push({
            ...msg,
            content: "[FAILED TO DECRYPT - WRONG PASSWORD OR CORRUPTED SESSION]"
          });
        }
      }
      setMessages(decryptedMsgs);
    } catch (err) {
      console.error("Failed to restore history:", err);
    }
  }

  function setupSocketMessageListeners() {
    if (!socket) return;

    // Join room in Socket
    socket.emit('join_room', { roomId });

    // Real-time messages relay listener
    socket.on('receive_message', async (encryptedPayload) => {
      try {
        const decryptedContent = await decryptText(encryptedPayload.content, cryptoKey);
        
        let attachmentBuffer = null;
        if (encryptedPayload.attachment) {
          // Relayed attachment blob is in Base64. Convert to ArrayBuffer
          attachmentBuffer = decryptBase64ToBuffer(encryptedPayload.attachment);
        }

        const newMsg = {
          id: encryptedPayload.id,
          chatId: roomId,
          sender: 'peer',
          type: encryptedPayload.type,
          content: decryptedContent,
          attachment: attachmentBuffer,
          attachmentName: encryptedPayload.attachmentName,
          timestamp: encryptedPayload.timestamp,
          unread: 0,
          viewOnce: encryptedPayload.viewOnce || 0,
          viewed: 0,
          expireTime: encryptedPayload.expireTime || 0
        };

        // Write E2EE encrypted blob back to local IndexedDB
        await db.messages.put({
          ...newMsg,
          content: encryptedPayload.content, // Save as encrypted ciphertext in IndexedDB
          attachment: attachmentBuffer // Save encrypted blob
        });

        // Trigger particle animation overlay if specified
        if (decryptedContent.includes('effect-particle')) {
          triggerParticles();
        }

        setMessages(prev => [...prev, newMsg]);
      } catch (err) {
        console.error("E2EE decrypt failure on incoming relay:", err);
      }
    });

    // Offline messages mailbox delivery
    socket.on('offline_mailbox_delivery', async (payloads) => {
      const deliveredMsgs = [];
      for (let payload of payloads) {
        try {
          const decrypted = await decryptText(payload.content, cryptoKey);
          let attachmentBuffer = null;
          if (payload.attachment) {
            attachmentBuffer = decryptBase64ToBuffer(payload.attachment);
          }

          const newMsg = {
            id: payload.id,
            chatId: roomId,
            sender: 'peer',
            type: payload.type,
            content: decrypted,
            attachment: attachmentBuffer,
            attachmentName: payload.attachmentName,
            timestamp: payload.timestamp,
            unread: 0,
            viewOnce: payload.viewOnce || 0,
            viewed: 0,
            expireTime: payload.expireTime || 0
          };

          await db.messages.put({
            ...newMsg,
            content: payload.content,
            attachment: attachmentBuffer
          });

          deliveredMsgs.push(newMsg);
        } catch (err) {
          console.error("Failed to decrypt delivered offline payload:", err);
        }
      }
      setMessages(prev => [...prev, ...deliveredMsgs]);
    });

    // Message edit, unsend, reactions listener
    socket.on('receive_message_action', async (action) => {
      if (action.type === 'unsend') {
        await deleteMessageFromDB(action.messageId);
        setMessages(prev => prev.filter(m => m.id !== action.messageId));
      } 
      else if (action.type === 'edit') {
        try {
          const decryptedContent = await decryptText(action.newContentEncrypted, cryptoKey);
          
          // Update DB
          const record = await db.messages.get(action.messageId);
          if (record) {
            record.content = action.newContentEncrypted;
            record.edited = 1;
            await db.messages.put(record);
          }

          // Update State
          setMessages(prev => prev.map(m => m.id === action.messageId ? {
            ...m,
            content: decryptedContent,
            edited: 1
          } : m));
        } catch (err) {
          console.error("Edit relay decryption failed:", err);
        }
      }
      else if (action.type === 'reaction') {
        const record = await db.messages.get(action.messageId);
        if (record) {
          record.reactions = action.reactionsEncrypted;
          await db.messages.put(record);
        }

        // Decrypt reactions mapping
        let decryptedReactions = {};
        if (action.reactionsEncrypted) {
          try {
            const JSONStr = await decryptText(action.reactionsEncrypted, cryptoKey);
            decryptedReactions = JSON.parse(JSONStr);
          } catch (e) {
            console.error("Failed to decrypt reactions map:", e);
          }
        }

        setMessages(prev => prev.map(m => m.id === action.messageId ? {
          ...m,
          reactionsDecrypted: decryptedReactions
        } : m));
      }
    });

    // Typing state relay indicator
    socket.on('receive_typing_state', ({ isTyping }) => {
      setPeerTyping(isTyping);
    });
  }

  // Base64 helper for offline attachments
  function decryptBase64ToBuffer(base64Str) {
    const binary = atob(base64Str);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }

  // Send standard text message with encryption
  async function handleSendMessage(e) {
    if (e) e.preventDefault();
    if (!inputText.trim()) return;

    const messageId = `msg-${Date.now()}`;
    const textToSend = inputText;
    setInputText('');

    try {
      // 1. Local E2EE encryption
      const encryptedContent = await encryptText(textToSend, cryptoKey);

      const msgPayload = {
        id: messageId,
        chatId: roomId,
        sender: 'me',
        type: 'text',
        content: textToSend, // state gets decrypted plaintext
        timestamp: Date.now(),
        unread: 0,
        viewed: 0
      };

      // 2. Save encrypted record to IndexedDB
      await db.messages.put({
        ...msgPayload,
        content: encryptedContent // Ciphertext stored in IndexedDB
      });

      // 3. Emit encrypted payload over network
      if (socket) {
        socket.emit('send_message', {
          id: messageId,
          type: 'text',
          content: encryptedContent,
          timestamp: msgPayload.timestamp
        });
      }

      setMessages(prev => [...prev, msgPayload]);
      triggerTyping(false);
    } catch (err) {
      console.error("Failed to encrypt and send text:", err);
    }
  }

  // Real-time E2EE Message Unsend (Delete for Everyone)
  async function handleUnsendMessage(messageId) {
    try {
      // Wipes from local IndexedDB
      await deleteMessageFromDB(messageId);
      
      // Notify remote peer
      if (socket) {
        socket.emit('message_action', {
          type: 'unsend',
          messageId
        });
      }

      setMessages(prev => prev.filter(m => m.id !== messageId));
    } catch (err) {
      console.error("Unsend action failed:", err);
    }
  }

  // Real-time E2EE Message Edit
  async function handleStartEdit(msg) {
    setEditingMsgId(msg.id);
    setEditText(msg.content);
  }

  async function handleSaveEdit(e) {
    e.preventDefault();
    if (!editText.trim()) return;

    try {
      const encryptedEdit = await encryptText(editText.trim(), cryptoKey);
      
      // Write locally
      const record = await db.messages.get(editingMsgId);
      if (record) {
        record.content = encryptedEdit;
        record.edited = 1;
        await db.messages.put(record);
      }

      // Notify remote peer
      if (socket) {
        socket.emit('message_action', {
          type: 'edit',
          messageId: editingMsgId,
          newContentEncrypted: encryptedEdit
        });
      }

      setMessages(prev => prev.map(m => m.id === editingMsgId ? {
        ...m,
        content: editText.trim(),
        edited: 1
      } : m));

      setEditingMsgId(null);
      setEditText('');
    } catch (err) {
      console.error("Failed to apply E2EE text edit:", err);
    }
  }

  // Real-time E2EE reactions trigger
  async function handleAddReaction(messageId, emoji) {
    try {
      const msg = messages.find(m => m.id === messageId);
      if (!msg) return;

      const currentReactions = msg.reactionsDecrypted || {};
      
      // Toggle reaction (if exists, remove it, else set it)
      if (currentReactions[mySenderId] === emoji) {
        delete currentReactions[mySenderId];
      } else {
        currentReactions[mySenderId] = emoji;
      }

      const JSONStr = JSON.stringify(currentReactions);
      const encryptedReactions = await encryptText(JSONStr, cryptoKey);

      // Save locally
      const record = await db.messages.get(messageId);
      if (record) {
        record.reactions = encryptedReactions;
        await db.messages.put(record);
      }

      // Notify peer
      if (socket) {
        socket.emit('message_action', {
          type: 'reaction',
          messageId,
          reactionsEncrypted: encryptedReactions
        });
      }

      setMessages(prev => prev.map(m => m.id === messageId ? {
        ...m,
        reactionsDecrypted: currentReactions
      } : m));

      setActiveReactionMenuMsgId(null);
    } catch (err) {
      console.error("Failed to append reaction:", err);
    }
  }

  // Custom text word effects injectors
  function applyWordEffect(effectType) {
    let tagOpen = '';
    let tagClose = '';

    if (effectType === 'scratch') {
      tagOpen = '<span class="effect-scratch">';
      tagClose = '</span>';
    } else if (effectType === 'neon') {
      tagOpen = '<span class="effect-neon">';
      tagClose = '</span>';
    } else if (effectType === 'glitch') {
      tagOpen = '<span class="effect-glitch">';
      tagClose = '</span>';
    } else if (effectType === 'particle') {
      tagOpen = '<span class="effect-particle">';
      tagClose = '</span>';
    }

    setInputText(prev => `${prev}${tagOpen}Write Here${tagClose}`);
    setShowEffects(false);
  }

  // Screen Particle generator pop effects
  function triggerParticles() {
    setTriggerParticleEffect(true);
    setTimeout(() => setTriggerParticleEffect(false), 2000);
  }

  // Secure Voice message sending
  async function handleSendVoiceMessage(arrayBuffer) {
    const messageId = `voice-${Date.now()}`;
    try {
      // 1. Encrypt voice note buffer locally
      const encryptedVoice = await encryptBinary(arrayBuffer, cryptoKey);
      
      const payloadBase64 = btoa(
        new Uint8Array(encryptedVoice).reduce((data, byte) => data + String.fromCharCode(byte), '')
      );

      // Save locally
      await db.messages.put({
        id: messageId,
        chatId: roomId,
        sender: 'me',
        type: 'voice',
        content: '[E2EE VOICE MESSAGE]',
        attachment: encryptedVoice,
        timestamp: Date.now(),
        unread: 0,
        viewed: 0
      });

      // Emit relay
      if (socket) {
        socket.emit('send_message', {
          id: messageId,
          type: 'voice',
          content: await encryptText('[E2EE VOICE MESSAGE]', cryptoKey),
          attachment: payloadBase64,
          timestamp: Date.now()
        });
      }

      setMessages(prev => [...prev, {
        id: messageId,
        chatId: roomId,
        sender: 'me',
        type: 'voice',
        content: '[E2EE VOICE MESSAGE]',
        attachment: encryptedVoice,
        timestamp: Date.now()
      }]);

      setShowVoiceRecorder(false);
    } catch (err) {
      console.error("Failed to encrypt voice note:", err);
    }
  }

  // Secure File sharing bubble completion
  async function handleFileTransporterSent(fileMeta) {
    setMessages(prev => [...prev, {
      id: fileMeta.id,
      chatId: roomId,
      sender: 'me',
      type: 'file',
      content: `[FILE: ${fileMeta.fileName}]`,
      attachment: fileMeta.encryptedBinary,
      attachmentName: fileMeta.fileName,
      timestamp: Date.now()
    }]);

    // Save locally
    await db.messages.put({
      id: fileMeta.id,
      chatId: roomId,
      sender: 'me',
      type: 'file',
      content: await encryptText(`[FILE: ${fileMeta.fileName}]`, cryptoKey),
      attachment: fileMeta.encryptedBinary,
      attachmentName: fileMeta.fileName,
      timestamp: Date.now(),
      unread: 0,
      viewed: 0
    });
  }

  // Time-Limited or View-Once secure uploads
  async function handleSendSelfDestructMedia(e) {
    const file = e.target.files[0];
    if (!file) return;

    const isVideo = file.type.startsWith('video/');
    const isImage = file.type.startsWith('image/');
    if (!isVideo && !isImage) {
      alert("Self-destruct media supports only photos or videos.");
      return;
    }

    const messageId = `burn-${Date.now()}`;
    
    // Choose mode
    const viewOnceChoice = confirm("Enable View-Once? (Click Cancel to set a 10-second Self-Destruct Timer)");

    try {
      const buffer = await file.arrayBuffer();
      const encrypted = await encryptBinary(buffer, cryptoKey);
      const payloadBase64 = btoa(
        new Uint8Array(encrypted).reduce((data, byte) => data + String.fromCharCode(byte), '')
      );

      const msg = {
        id: messageId,
        chatId: roomId,
        sender: 'me',
        type: 'media_secure',
        content: `[SECURE SELF DESTRUCT MEDIA]`,
        attachment: encrypted,
        attachmentName: file.name,
        timestamp: Date.now(),
        viewOnce: viewOnceChoice ? 1 : 0,
        expireTime: viewOnceChoice ? 0 : 10, // 10-second timer
        viewed: 0
      };

      // Save locally
      await db.messages.put({
        ...msg,
        content: await encryptText(`[SECURE SELF DESTRUCT MEDIA]`, cryptoKey)
      });

      // Emit
      if (socket) {
        socket.emit('send_message', {
          id: messageId,
          type: 'media_secure',
          content: await encryptText(`[SECURE SELF DESTRUCT MEDIA]`, cryptoKey),
          attachment: payloadBase64,
          attachmentName: file.name,
          attachmentType: file.type,
          viewOnce: viewOnceChoice ? 1 : 0,
          expireTime: viewOnceChoice ? 0 : 10,
          timestamp: Date.now()
        });
      }

      setMessages(prev => [...prev, msg]);
    } catch (err) {
      console.error("Failed to encrypt secure media:", err);
    }
  }

  // Handle media expiration callback (Wipe attachment entirely)
  async function handleMediaExpired(msgId) {
    try {
      const record = await db.messages.get(msgId);
      if (record) {
        // Zero out data bytes
        record.attachment = null;
        record.viewed = 1;
        record.content = await encryptText("[EXPIRED - BURNED FROM STORAGE]", cryptoKey);
        await db.messages.put(record);
      }

      // Update State
      setMessages(prev => prev.map(m => m.id === msgId ? {
        ...m,
        content: "[EXPIRED - BURNED FROM STORAGE]",
        attachment: null,
        viewed: 1
      } : m));
    } catch (err) {
      console.error("Failed to purge media record:", err);
    }
  }

  // Custom Encrypted Gallery Backgrounds upload
  async function handleWallpaperUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    try {
      const buffer = await file.arrayBuffer();
      // Encrypt custom image with Master Key
      const encryptedWallpaper = await encryptBinary(buffer, cryptoKey);

      // Write metadata to Chat record
      const chat = await db.chats.get(roomId);
      if (chat) {
        chat.customWallpaper = encryptedWallpaper;
        chat.customWallpaperBrightness = wallpaperOpacity;
        chat.customWallpaperBlur = wallpaperBlur;
        await db.chats.put(chat);
      }

      // Revoke old URL if exists
      if (wallpaperUrl) URL.revokeObjectURL(wallpaperUrl);

      const blob = new Blob([buffer], { type: 'image/jpeg' });
      const url = URL.createObjectURL(blob);
      setWallpaperUrl(url);

    } catch (err) {
      console.error("Failed to encrypt background:", err);
      alert("Failed to secure background photo.");
    }
  }

  async function handleWallpaperSliderUpdate(type, value) {
    if (type === 'brightness') {
      setWallpaperOpacity(value);
    } else {
      setWallpaperBlur(value);
    }

    const chat = await db.chats.get(roomId);
    if (chat) {
      chat.customWallpaperBrightness = type === 'brightness' ? value : wallpaperOpacity;
      chat.customWallpaperBlur = type === 'blur' ? value : wallpaperBlur;
      await db.chats.put(chat);
    }
  }

  // Typing alert handler
  function triggerTyping(typingState) {
    setIsTyping(typingState);
    if (socket) {
      socket.emit('typing_state', { isTyping: typingState });
    }
  }

  function handleTextInputChange(e) {
    setInputText(e.target.value);
    
    if (!isTyping) {
      triggerTyping(true);
    }

    // Reset typing timeout
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      triggerTyping(false);
    }, 2000);
  }

  // Toggle local database Ciphertext view
  function toggleCiphertextViewer(msgId) {
    setRevealedCiphertexts(prev => ({
      ...prev,
      [msgId]: !prev[msgId]
    }));
  }

  // HTML content renderer for word effects
  function renderMessageText(htmlContent) {
    return <span dangerouslySetInnerHTML={{ __html: htmlContent }} />;
  }

  // Secure full purger button
  async function handlePanicWipe() {
    if (confirm("Duress Wiping will PERMANENTLY erase all cryptographic database contents locally. Are you sure?")) {
      await panicWipeDatabase();
      window.location.replace("https://www.google.com");
    }
  }

  return (
    <div style={styles.chatFrame}>
      
      {/* Dynamic Background Custom Wallpaper with brightness/blur masks */}
      {wallpaperUrl && (
        <div
          className="custom-wallpaper-overlay"
          style={{
            backgroundImage: `url(${wallpaperUrl})`,
            opacity: wallpaperOpacity / 100,
            filter: `blur(${wallpaperBlur}px)`
          }}
        />
      )}

      {/* Particle popping animations overlay node */}
      {triggerParticleEffect && (
        <div style={styles.particlesOverlay}>
          {[...Array(20)].map((_, i) => (
            <div
              key={i}
              className="particle"
              style={{
                backgroundColor: i % 2 === 0 ? 'var(--accent-cyber)' : 'var(--accent-cyan)',
                left: '50%',
                top: '50%',
                '--dx': `${(Math.random() - 0.5) * 400}px`,
                '--dy': `${(Math.random() - 0.5) * 400}px`,
                width: `${Math.random() * 12 + 6}px`,
                height: `${Math.random() * 12 + 6}px`,
                animationDelay: `${Math.random() * 0.2}s`
              }}
            />
          ))}
          <div style={styles.particleMessage}>💖 PARTICLE ENCRYPTED EXPLOSION! 💖</div>
        </div>
      )}

      {/* TOP HEADER STATUS PANEL */}
      <div style={styles.header}>
        <div style={styles.headerL}>
          <div style={styles.roomBadge}>
            <Shield size={14} style={{ color: 'var(--accent-cyan)' }} />
            <span style={styles.roomTitle}>whisper://{roomId}</span>
          </div>
          <div style={styles.connectionStatus}>
            {socketConnected ? (
              <span style={{ color: 'var(--accent-green)', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span style={styles.statusDotOnline} /> E2EE Handshake Connected
              </span>
            ) : (
              <span style={{ color: 'var(--accent-danger)', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span style={styles.statusDotOffline} /> Blind Relay Searching...
              </span>
            )}
          </div>
        </div>

        <div style={styles.headerR}>
          {/* Mini gamezone & board buttons */}
          <button onClick={() => setActiveGamePanel(true)} className="btn-secondary" style={styles.headIconBtn} title="Launch Games">
            <Gamepad2 size={16} />
          </button>
          <button onClick={() => setActiveBoardPanel(true)} className="btn-secondary" style={styles.headIconBtn} title="Launch Whiteboard">
            <PenTool size={16} />
          </button>

          {/* WebRTC Video call triggers */}
          <button onClick={() => onStartCall('video')} className="btn-secondary" style={styles.headIconBtn} title="Voice Call" disabled={!activePeerSocketId}>
            <Phone size={16} />
          </button>
          <button onClick={() => onStartCall('video')} className="btn-secondary" style={styles.headIconBtn} title="Video Call" disabled={!activePeerSocketId}>
            <Video size={16} />
          </button>

          <button onClick={() => setShowSettings(!showSettings)} className="btn-secondary" style={styles.headIconBtn} title="Secure Panel">
            <Settings size={16} />
          </button>
        </div>
      </div>

      {/* MESSAGES VIEWPORT CONTAINER */}
      <div style={styles.messagesViewport}>
        {messages.map((msg) => {
          const isMe = msg.sender === 'me';
          const isExpired = msg.content === "[EXPIRED - BURNED FROM STORAGE]";
          const isRevealedCiphertext = revealedCiphertexts[msg.id];

          return (
            <div key={msg.id} style={{ ...styles.msgRow, justifyContent: isMe ? 'flex-end' : 'flex-start' }}>
              
              {/* Message Bubble wrapper */}
              <div style={styles.msgBubbleWrapper}>
                
                {/* Floating Reaction triggers menu on hover overlay */}
                <div style={styles.bubbleActionMenu}>
                  <button onClick={() => handleStartEdit(msg)} title="Edit Message"><Edit3 size={10} /></button>
                  <button onClick={() => handleUnsendMessage(msg.id)} title="Unsend (Purge Peer)"><Trash2 size={10} /></button>
                  <button onClick={() => setActiveReactionMenuMsgId(activeReactionMenuMsgId === msg.id ? null : msg.id)} title="React"><Smile size={10} /></button>
                </div>

                {activeReactionMenuMsgId === msg.id && (
                  <div className="glass-panel" style={styles.reactionDrawer}>
                    {['❤️', '👍', '😂', '😮', '😢', '🔥'].map(emoji => (
                      <button key={emoji} onClick={() => handleAddReaction(msg.id, emoji)} style={styles.reactionIcon}>{emoji}</button>
                    ))}
                  </div>
                )}

                {/* Primary Bubble */}
                <div
                  className="glass-panel"
                  style={{
                    ...styles.msgBubble,
                    background: isMe ? 'linear-gradient(135deg, rgba(99,102,241,0.2) 0%, rgba(79,70,229,0.15) 100%)' : 'rgba(255,255,255,0.02)',
                    borderColor: isMe ? 'var(--border-active)' : 'var(--border-glass)',
                  }}
                >
                  
                  {/* Ciphertext inspector button */}
                  <button onClick={() => toggleCiphertextViewer(msg.id)} style={styles.ciphertextToggle} title="View encrypted IndexedDB ciphertext">
                    <Info size={10} />
                  </button>

                  {/* Render content based on message type */}
                  {isRevealedCiphertext ? (
                    // Ciphertext inspector panel
                    <div style={styles.ciphertextPanel}>
                      <span style={styles.cipherLabel}>IndexedDB Encrypted Payload (Base64 AES-GCM):</span>
                      <code style={styles.cipherCode}>{msg.id.startsWith('msg-') ? '[Ciphertext block]' : '[Binary Encrypted Blob]'}</code>
                    </div>
                  ) : msg.type === 'text' ? (
                    <div style={styles.msgContentText}>{renderMessageText(msg.content)}</div>
                  ) : msg.type === 'voice' ? (
                    <VoicePlayer encryptedBinary={msg.attachment} cryptoKey={cryptoKey} />
                  ) : msg.type === 'file' ? (
                    <FileDownloadCard
                      fileId={msg.id}
                      fileName={msg.attachmentName}
                      fileSize={msg.fileSize || 50000}
                      fileType={msg.fileType || 'application/octet-stream'}
                      encryptedBinary={msg.attachment}
                      cryptoKey={cryptoKey}
                    />
                  ) : msg.type === 'media_secure' ? (
                    isExpired ? (
                      <div style={{ ...styles.msgContentText, color: 'var(--text-muted)', fontStyle: 'italic' }}>
                        💥 Secure Media Vaporized.
                      </div>
                    ) : (
                      <button
                        onClick={() => setActiveSelfDestructMedia(msg)}
                        className="btn-primary"
                        style={styles.mediaSecureBtn}
                      >
                        <Eye size={14} /> Open Secure Media {msg.viewOnce ? '(View Once)' : `(${msg.expireTime}s)`}
                      </button>
                    )
                  ) : (
                    <div style={styles.msgContentText}>{msg.content}</div>
                  )}

                  {/* Reaction Badges display */}
                  {msg.reactionsDecrypted && Object.keys(msg.reactionsDecrypted).length > 0 && (
                    <div style={styles.reactionsBadgeRow}>
                      {Object.entries(msg.reactionsDecrypted).map(([user, emoji]) => (
                        <div key={user} style={styles.reactionBadge} title={`Reactions by: ${user}`}>{emoji}</div>
                      ))}
                    </div>
                  )}

                </div>

                {/* Sub Metadata (timestamp, read status) */}
                <div style={{ ...styles.msgTimeRow, justifyContent: isMe ? 'flex-end' : 'flex-start' }}>
                  <span>{new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  {msg.edited === 1 && <span style={styles.editedTag}>• Edited</span>}
                </div>

              </div>

            </div>
          );
        })}

        {/* Real-time typing indicators */}
        {peerTyping && (
          <div style={styles.typingIndicatorRow}>
            <div className="glass-panel" style={styles.typingIndicator}>
              <div className="mini-spinner" style={styles.typingSpinner} />
              <span>Partner is typing securely...</span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* CHAT INPUT AREA FOOTER */}
      <div style={styles.inputArea}>
        
        {/* Floating Effects panels dropdown */}
        {showEffects && (
          <div className="glass-panel" style={styles.effectsPopup}>
            <div style={styles.effectsHeader}>Text Special Effects</div>
            <button onClick={() => applyWordEffect('scratch')} style={styles.effectBtn}>🔒 Scratch Card Reveal</button>
            <button onClick={() => applyWordEffect('neon')} style={styles.effectBtn}>⚡ Neon Pulsar Text</button>
            <button onClick={() => applyWordEffect('glitch')} style={styles.effectBtn}>👾 Digital Glitch</button>
            <button onClick={() => applyWordEffect('particle')} style={styles.effectBtn}>✨ Particle Pop Trigger</button>
          </div>
        )}

        {/* Floating voice note panels */}
        {showVoiceRecorder ? (
          <VoiceRecorder
            onSendVoice={handleSendVoiceMessage}
            onCancel={() => setShowVoiceRecorder(false)}
          />
        ) : editingMsgId ? (
          // Message Edit active form
          <form onSubmit={handleSaveEdit} style={styles.inputForm}>
            <input
              type="text"
              className="glass-input"
              style={styles.textInput}
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              required
            />
            <button type="submit" className="btn-primary" style={styles.inputBtn}>Save</button>
            <button type="button" onClick={() => setEditingMsgId(null)} className="btn-secondary" style={styles.inputBtn}>Cancel</button>
          </form>
        ) : (
          // Main text entry form
          <form onSubmit={handleSendMessage} style={styles.inputForm}>
            
            {/* E2EE File Upload buttons */}
            <div style={styles.inputAddons}>
              
              <button
                type="button"
                onClick={() => setShowEffects(!showEffects)}
                style={{ ...styles.addonBtn, color: showEffects ? 'var(--accent-cyan)' : 'var(--text-secondary)' }}
                title="Apply custom Word Effects"
              >
                <Smile size={18} />
              </button>

              <FileTransporter
                socket={socket}
                activePeerConnected={!!activePeerSocketId}
                cryptoKey={cryptoKey}
                onFileSent={handleFileTransporterSent}
              />

              <label style={styles.addonBtnLabel} title="Send E2EE Self-Destructing Photo/Video">
                <Eye size={18} style={{ cursor: 'pointer', color: 'var(--accent-cyber)' }} />
                <input
                  type="file"
                  onChange={handleSendSelfDestructMedia}
                  style={{ display: 'none' }}
                  accept="image/*,video/*"
                />
              </label>

              <button
                type="button"
                onClick={() => setShowVoiceRecorder(true)}
                style={styles.addonBtn}
                title="Send E2EE Voice Message"
              >
                <Mic size={18} />
              </button>

            </div>

            <input
              type="text"
              className="glass-input"
              style={styles.textInput}
              placeholder="E2EE encrypted transmission bubble..."
              value={inputText}
              onChange={handleTextInputChange}
            />

            <button type="submit" className="btn-primary" style={styles.sendBtn}>
              <Send size={16} />
            </button>
          </form>
        )}
      </div>

      {/* SLIDE-OUT DASHBOARD DETAILS DRAWER */}
      {showSettings && (
        <div className="glass-panel" style={styles.settingsDrawer}>
          <div style={styles.drawerHeader}>
            <span style={styles.drawerTitle}>WhisperNet Secure Hub</span>
            <button onClick={() => setShowSettings(false)} style={styles.closeBtn}><X size={16} /></button>
          </div>

          <div style={styles.drawerBody}>
            
            {/* Cryptographic Statistics */}
            <div style={styles.secGroup}>
              <h4 style={styles.secTitle}>E2EE Cryptography Engine</h4>
              <div style={styles.statsPanel}>
                <div style={styles.statRow}><span>Algorithm</span><strong>AES-GCM-256</strong></div>
                <div style={styles.statRow}><span>Key Deriv.</span><strong>PBKDF2 SHA-256</strong></div>
                <div style={styles.statRow}><span>PBKDF2 Iter.</span><strong>100,000 rounds</strong></div>
                <div style={styles.statRow}><span>Key Extraction</span><strong>Disabled (Volatile RAM)</strong></div>
                <div style={styles.statRow}><span>Local DB</span><strong>IndexedDB (Dexie)</strong></div>
              </div>
            </div>

            {/* Custom Wallpapers Upload Section */}
            <div style={styles.secGroup}>
              <h4 style={styles.secTitle}>Custom Gallery Wallpapers</h4>
              <div style={styles.customWallpaperCard}>
                <p style={styles.wallpaperDesc}>Select a photo from your gallery to set as background. Highly private—saved E2EE locally in IndexedDB.</p>
                <label className="btn-secondary" style={styles.wallpaperInputLabel}>
                  <Image size={14} /> Upload Custom Photo
                  <input
                    type="file"
                    onChange={handleWallpaperUpload}
                    style={{ display: 'none' }}
                    accept="image/*"
                  />
                </label>

                {wallpaperUrl && (
                  <div style={styles.slidersList}>
                    <div style={styles.sliderGroup}>
                      <span style={styles.sliderLabel}>Brightness: {wallpaperOpacity}%</span>
                      <input
                        type="range"
                        min="5"
                        max="80"
                        value={wallpaperOpacity}
                        onChange={(e) => handleWallpaperSliderUpdate('brightness', parseInt(e.target.value))}
                        style={styles.slider}
                      />
                    </div>
                    <div style={styles.sliderGroup}>
                      <span style={styles.sliderLabel}>Blur: {wallpaperBlur}px</span>
                      <input
                        type="range"
                        min="0"
                        max="10"
                        value={wallpaperBlur}
                        onChange={(e) => handleWallpaperSliderUpdate('blur', parseInt(e.target.value))}
                        style={styles.slider}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Duress Panic triggers */}
            <div style={styles.secGroup}>
              <h4 style={{ ...styles.secTitle, color: 'var(--accent-danger)' }}>
                <AlertTriangle size={14} style={{ marginRight: 6 }} /> Panic Duress Purge
              </h4>
              <p style={styles.panicDesc}>Entering duress? Wiping deletes all messaging tables, settings salts, and locally stored files instantly, and redirects your browser to Google.</p>
              <button onClick={handlePanicWipe} className="btn-danger" style={styles.panicBtn}>
                <Trash2 size={14} /> Panic Wipe Vault Now
              </button>
            </div>

            {/* Developer branding credits badge */}
            <div style={styles.drawerBranding}>
              <div className="sadman-creator-badge">
                E2EE Engine designed by <span>Commander Sadman</span>
              </div>
            </div>

          </div>
        </div>
      )}

      {/* E2EE MULTIPLAYER GAME PANEL MODAL */}
      {activeGamePanel && (
        <GameZone
          socket={socket}
          roomId={roomId}
          mySenderId={mySenderId}
          activePeerConnected={!!activePeerSocketId}
          onClose={() => setActiveGamePanel(false)}
        />
      )}

      {/* E2EE VECTOR WHITEBOARD MODAL */}
      {activeBoardPanel && (
        <Whiteboard
          socket={socket}
          activePeerConnected={!!activePeerSocketId}
          onClose={() => setActiveBoardPanel(false)}
        />
      )}

      {/* VIEW-ONCE & EXPIRED COUNTDOWN MODAL */}
      {activeSelfDestructMedia && (
        <SelfDestructPlayer
          messageId={activeSelfDestructMedia.id}
          fileName={activeSelfDestructMedia.attachmentName}
          fileType={activeSelfDestructMedia.fileType || 'image/jpeg'}
          encryptedBinary={activeSelfDestructMedia.attachment}
          cryptoKey={cryptoKey}
          expireTime={activeSelfDestructMedia.expireTime}
          isViewOnce={activeSelfDestructMedia.viewOnce === 1}
          onExpired={handleMediaExpired}
          onClose={() => setActiveSelfDestructMedia(null)}
        />
      )}

    </div>
  );
}

const styles = {
  chatFrame: {
    display: 'flex',
    flexDirection: 'column',
    height: '100vh',
    width: '100vw',
    position: 'relative',
    background: '#07090e',
    overflow: 'hidden',
  },
  particlesOverlay: {
    position: 'absolute',
    inset: 0,
    zIndex: 150,
    background: 'rgba(5,7,12,0.85)',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    alignItems: 'center',
    pointerEvents: 'none',
  },
  particleMessage: {
    fontFamily: 'var(--font-mono)',
    color: 'var(--accent-cyan)',
    fontSize: '1rem',
    fontWeight: 'bold',
    textShadow: '0 0 10px var(--accent-cyan)',
    marginTop: '40px',
    animation: 'slide-up 0.5s ease-out forwards',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '14px 20px',
    borderBottom: '1px solid var(--border-glass)',
    background: 'rgba(13, 17, 28, 0.5)',
    backdropFilter: 'blur(8px)',
    zIndex: 20,
  },
  headerL: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  roomBadge: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },
  roomTitle: {
    fontSize: '0.95rem',
    fontWeight: '700',
    color: '#fff',
    fontFamily: 'var(--font-mono)',
  },
  connectionStatus: {
    display: 'flex',
    alignItems: 'center',
  },
  statusDotOnline: {
    width: '6px',
    height: '6px',
    borderRadius: '50%',
    backgroundColor: 'var(--accent-green)',
    display: 'inline-block',
  },
  statusDotOffline: {
    width: '6px',
    height: '6px',
    borderRadius: '50%',
    backgroundColor: 'var(--accent-danger)',
    display: 'inline-block',
  },
  headerR: {
    display: 'flex',
    gap: '8px',
  },
  headIconBtn: {
    padding: '8px 10px',
  },
  messagesViewport: {
    flex: 1,
    padding: '24px 20px',
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: '20px',
    zIndex: 10,
  },
  msgRow: {
    display: 'flex',
    width: '100%',
  },
  msgBubbleWrapper: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    maxWidth: '75%',
    position: 'relative',
  },
  msgBubble: {
    borderRadius: '16px',
    padding: '12px 16px',
    position: 'relative',
    transition: 'var(--transition-smooth)',
  },
  ciphertextToggle: {
    position: 'absolute',
    top: '6px',
    right: '8px',
    background: 'none',
    border: 'none',
    color: 'var(--text-muted)',
    cursor: 'pointer',
    opacity: 0,
    transition: 'opacity 0.2s ease',
  },
  bubbleActionMenu: {
    position: 'absolute',
    top: '-20px',
    right: '10px',
    display: 'flex',
    gap: '8px',
    background: 'rgba(13, 17, 28, 0.9)',
    border: '1px solid var(--border-glass)',
    borderRadius: '20px',
    padding: '2px 8px',
    opacity: 0,
    transition: 'opacity 0.25s ease',
    zIndex: 30,
  },
  // Hover transitions to reveal E2EE bubbles options
  msgContentText: {
    fontSize: '0.9rem',
    lineHeight: '1.45',
    color: '#fff',
    wordBreak: 'break-word',
  },
  ciphertextPanel: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  cipherLabel: {
    fontSize: '0.65rem',
    color: 'var(--accent-cyan)',
    fontFamily: 'var(--font-mono)',
  },
  cipherCode: {
    fontFamily: 'var(--font-mono)',
    fontSize: '0.7rem',
    color: 'var(--text-muted)',
    background: 'rgba(0,0,0,0.2)',
    padding: '4px 8px',
    borderRadius: '4px',
    wordBreak: 'break-all',
  },
  mediaSecureBtn: {
    padding: '8px 14px',
    fontSize: '0.8rem',
    background: 'linear-gradient(135deg, var(--accent-cyber) 0%, hsl(325, 75%, 45%) 100%)',
    boxShadow: '0 4px 12px rgba(236, 72, 153, 0.25)',
  },
  reactionDrawer: {
    position: 'absolute',
    top: '-32px',
    right: '0',
    display: 'flex',
    gap: '6px',
    padding: '4px 8px',
    borderRadius: '20px',
    zIndex: 100,
    animation: 'slide-up 0.15s ease-out forwards',
  },
  reactionIcon: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: '0.95rem',
    transition: 'transform 0.1s ease',
  },
  reactionsBadgeRow: {
    display: 'flex',
    gap: '4px',
    position: 'absolute',
    bottom: '-12px',
    right: '12px',
  },
  reactionBadge: {
    background: '#0f111a',
    border: '1px solid var(--border-glass)',
    borderRadius: '50%',
    width: '20px',
    height: '20px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '0.75rem',
    boxShadow: '0 2px 5px rgba(0,0,0,0.3)',
  },
  msgTimeRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '0.65rem',
    color: 'var(--text-muted)',
    fontFamily: 'var(--font-mono)',
    padding: '0 4px',
  },
  editedTag: {
    color: 'var(--accent-cyan)',
  },
  typingIndicatorRow: {
    display: 'flex',
    width: '100%',
  },
  typingIndicator: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '8px 14px',
    borderRadius: '20px',
    fontSize: '0.75rem',
    color: 'var(--text-secondary)',
  },
  typingSpinner: {
    width: '10px',
    height: '10px',
    border: '2px solid rgba(255, 255, 255, 0.1)',
    borderTopColor: 'var(--accent-cyan)',
    borderRadius: '50%',
    animation: 'scratch-shim 1s infinite linear',
  },
  inputArea: {
    padding: '16px 20px',
    borderTop: '1px solid var(--border-glass)',
    background: 'rgba(13, 17, 28, 0.5)',
    backdropFilter: 'blur(8px)',
    zIndex: 20,
    position: 'relative',
  },
  effectsPopup: {
    position: 'absolute',
    bottom: '76px',
    left: '20px',
    width: '200px',
    padding: '8px',
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    zIndex: 100,
    animation: 'slide-up 0.25s ease-out forwards',
  },
  effectsHeader: {
    fontSize: '0.7rem',
    color: 'var(--text-muted)',
    fontWeight: '700',
    fontFamily: 'var(--font-mono)',
    padding: '4px 6px 8px 6px',
    borderBottom: '1px solid var(--border-glass)',
    marginBottom: '4px',
  },
  effectBtn: {
    background: 'none',
    border: 'none',
    color: 'var(--text-secondary)',
    fontSize: '0.75rem',
    textAlign: 'left',
    padding: '8px',
    cursor: 'pointer',
    borderRadius: '6px',
    transition: 'var(--transition-smooth)',
  },
  inputForm: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    width: '100%',
  },
  inputAddons: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
  },
  addonBtn: {
    background: 'rgba(255, 255, 255, 0.03)',
    border: '1px solid var(--border-glass)',
    borderRadius: '50%',
    width: '36px',
    height: '36px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'var(--text-secondary)',
    cursor: 'pointer',
    transition: 'var(--transition-smooth)',
  },
  addonBtnLabel: {
    background: 'rgba(255, 255, 255, 0.03)',
    border: '1px solid var(--border-glass)',
    borderRadius: '50%',
    width: '36px',
    height: '36px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  textInput: {
    flex: 1,
    height: '38px',
    fontSize: '0.85rem',
  },
  sendBtn: {
    height: '38px',
    padding: '0 18px',
  },
  settingsDrawer: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    width: '340px',
    zIndex: 100,
    borderTopRightRadius: 0,
    borderBottomRightRadius: 0,
    display: 'flex',
    flexDirection: 'column',
    animation: 'slide-in-right 0.3s cubic-bezier(0.4, 0, 0.2, 1) forwards',
  },
  drawerHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '20px',
    borderBottom: '1px solid var(--border-glass)',
  },
  drawerTitle: {
    fontSize: '1rem',
    fontWeight: '700',
    color: '#fff',
  },
  drawerBody: {
    flex: 1,
    overflowY: 'auto',
    padding: '20px',
    display: 'flex',
    flexDirection: 'column',
    gap: '24px',
  },
  secGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  secTitle: {
    fontSize: '0.8rem',
    fontWeight: '700',
    color: 'var(--text-secondary)',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    display: 'flex',
    alignItems: 'center',
  },
  statsPanel: {
    background: 'rgba(0,0,0,0.2)',
    border: '1px solid var(--border-glass)',
    borderRadius: '10px',
    padding: '12px 14px',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  statRow: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '0.75rem',
    fontFamily: 'var(--font-mono)',
  },
  customWallpaperCard: {
    background: 'rgba(255, 255, 255, 0.01)',
    border: '1px solid var(--border-glass)',
    borderRadius: '10px',
    padding: '14px',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  wallpaperDesc: {
    fontSize: '0.75rem',
    color: 'var(--text-muted)',
    lineHeight: '1.4',
  },
  wallpaperInputLabel: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '6px',
    fontSize: '0.75rem',
    padding: '8px 12px',
    cursor: 'pointer',
  },
  slidersList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    borderTop: '1px solid var(--border-glass)',
    paddingTop: '10px',
  },
  sliderGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  sliderLabel: {
    fontSize: '0.7rem',
    color: 'var(--text-secondary)',
  },
  slider: {
    width: '100%',
    cursor: 'pointer',
  },
  panicDesc: {
    fontSize: '0.75rem',
    color: 'var(--text-muted)',
    lineHeight: '1.45',
  },
  panicBtn: {
    width: '100%',
    padding: '10px',
    fontSize: '0.8rem',
  },
  drawerBranding: {
    display: 'flex',
    justifyContent: 'center',
    marginTop: '12px',
  }
};
