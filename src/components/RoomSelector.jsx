// RoomSelector Component
// Manages E2EE Room initialization, E2EE passphrase entry, join QR codes, and cached room history.
// Features Commander Sadman branding footer.

import React, { useState, useEffect } from 'react';
import { LogIn, Key, Wifi, WifiOff, List, Plus, Copy, Check, QrCode } from 'lucide-react';
import QRCode from 'qrcode';
import { db } from '../db';

export default function RoomSelector({ socketConnected, onJoinRoom }) {
  const [roomId, setRoomId] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [cachedChats, setCachedChats] = useState([]);
  const [qrCodeUrl, setQrCodeUrl] = useState('');
  const [showQr, setShowQr] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    loadCachedChats();
    // Parse query params for auto-filling Room IDs (e.g. from QR scan)
    const params = new URLSearchParams(window.location.search);
    const queryRoomId = params.get('roomId');
    if (queryRoomId) {
      setRoomId(queryRoomId);
    }
  }, []);

  // Recalculate QR Code when roomId changes
  useEffect(() => {
    if (roomId.trim()) {
      generateJoinQr();
    } else {
      setQrCodeUrl('');
    }
  }, [roomId]);

  async function loadCachedChats() {
    try {
      const chats = await db.chats.orderBy('created_at').reverse().toArray();
      setCachedChats(chats);
    } catch (err) {
      console.error("Failed to load local chats:", err);
    }
  }

  // Generate join QR code
  async function generateJoinQr() {
    try {
      const joinUrl = `${window.location.origin}${window.location.pathname}?roomId=${encodeURIComponent(roomId.trim())}`;
      const url = await QRCode.toDataURL(joinUrl, {
        color: {
          dark: '#06b6d4', // Cyan neon
          light: '#0b0d19'  // Dark background
        },
        margin: 2
      });
      setQrCodeUrl(url);
    } catch (err) {
      console.error("QR generation failed:", err);
    }
  }

  function handleRandomRoomId() {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let result = 'room-';
    for (let i = 0; i < 8; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    setRoomId(result);
  }

  function handleJoin(e) {
    if (e) e.preventDefault();
    setError('');

    if (!roomId.trim()) {
      setError('Room ID is required.');
      return;
    }
    if (!passphrase.trim()) {
      setError('Room Passphrase is required.');
      return;
    }

    onJoinRoom(roomId.trim(), passphrase.trim());
  }

  function handleCopyLink() {
    const joinUrl = `${window.location.origin}${window.location.pathname}?roomId=${encodeURIComponent(roomId.trim())}`;
    navigator.clipboard.writeText(joinUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div style={styles.container}>
      <div className="glass-panel bg-grid" style={styles.panel}>
        
        {/* Connection Status Header */}
        <div style={styles.statusBar}>
          <div style={styles.statusIndicator}>
            {socketConnected ? (
              <>
                <Wifi size={14} style={{ color: 'var(--accent-green)' }} />
                <span style={{ color: 'var(--accent-green)' }}>Handshake Server Connected</span>
              </>
            ) : (
              <>
                <WifiOff size={14} style={{ color: 'var(--accent-danger)' }} />
                <span style={{ color: 'var(--accent-danger)' }}>Reconnecting to Handshake...</span>
              </>
            )}
          </div>
        </div>

        <div style={styles.titleWrapper}>
          <h2 style={styles.title}>Secure E2EE Room Setup</h2>
          <p style={styles.subtitle}>Derived keys are never sent to the network.</p>
        </div>

        <form onSubmit={handleJoin} style={styles.form}>
          <div style={styles.inputGroup}>
            <div style={styles.labelRow}>
              <label style={styles.label}>Room ID (Handshake Identifier)</label>
              <button type="button" onClick={handleRandomRoomId} style={styles.textBtn}>
                <Plus size={12} /> Generate Random
              </button>
            </div>
            <div style={styles.inputWrapper}>
              <input
                type="text"
                className="glass-input"
                style={styles.input}
                placeholder="e.g. secure-room-99"
                value={roomId}
                onChange={(e) => setRoomId(e.target.value)}
                required
              />
            </div>
          </div>

          <div style={styles.inputGroup}>
            <label style={styles.label}>Room Passphrase (E2EE Shared Secret)</label>
            <div style={styles.inputWrapper}>
              <Key size={16} style={styles.inputIcon} />
              <input
                type="password"
                className="glass-input"
                style={{ ...styles.input, paddingLeft: '44px' }}
                placeholder="Must be identical on both devices"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                required
              />
            </div>
          </div>

          {/* E2EE QR and Link Share panel */}
          {roomId.trim() && (
            <div style={styles.sharePanel}>
              <div style={styles.shareActions}>
                <button type="button" onClick={handleCopyLink} className="btn-secondary" style={styles.shareBtn}>
                  {copied ? <Check size={14} style={{ color: 'var(--accent-green)' }} /> : <Copy size={14} />}
                  {copied ? 'Link Copied!' : 'Copy Invitation Link'}
                </button>
                {qrCodeUrl && (
                  <button type="button" onClick={() => setShowQr(!showQr)} className="btn-secondary" style={styles.qrToggle}>
                    <QrCode size={14} />
                    {showQr ? 'Hide QR' : 'Show QR'}
                  </button>
                )}
              </div>

              {showQr && qrCodeUrl && (
                <div style={styles.qrContainer}>
                  <p style={styles.qrText}>Scan this QR code with your mobile device to join instantly:</p>
                  <img src={qrCodeUrl} alt="Join Room QR" style={styles.qrImage} />
                </div>
              )}
            </div>
          )}

          {error && <div style={styles.error}>{error}</div>}

          <button type="submit" className="btn-primary" style={styles.joinBtn}>
            <LogIn size={16} /> Join Cryptographic Room
          </button>
        </form>

        {/* Local Decrypted Cached Chat History */}
        {cachedChats.length > 0 && (
          <div style={styles.historySection}>
            <h3 style={styles.historyTitle}>
              <List size={14} style={{ marginRight: 6 }} />
              Local Encrypted History
            </h3>
            <div style={styles.historyList}>
              {cachedChats.map((chat) => (
                <div key={chat.id} style={styles.historyItem}>
                  <div style={styles.historyInfo}>
                    <span style={styles.historyName}>{chat.name}</span>
                    <span style={styles.historyId}>ID: {chat.id}</span>
                  </div>
                  <button
                    type="button"
                    className="btn-secondary"
                    style={styles.historyBtn}
                    onClick={() => {
                      setRoomId(chat.id);
                      setPassphrase(''); // Force enter passphrase for E2EE decryption
                    }}
                  >
                    Load Room
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Creator Branding Footer */}
        <div style={styles.footer}>
          <div className="sadman-creator-badge">
            WhisperNet v1.0 • Authorized Deployment • Created by <span>Commander Sadman</span>
          </div>
        </div>

      </div>
    </div>
  );
}

const styles = {
  container: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    height: '100vh',
    width: '100vw',
    background: 'radial-gradient(circle at center, hsl(225, 20%, 8%) 0%, hsl(225, 25%, 3%) 100%)',
    padding: '20px',
  },
  panel: {
    width: '100%',
    maxWidth: '520px',
    padding: '36px',
    animation: 'slide-up 0.5s ease-out forwards',
  },
  statusBar: {
    display: 'flex',
    justifyContent: 'center',
    marginBottom: '20px',
  },
  statusIndicator: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '0.75rem',
    background: 'rgba(255, 255, 255, 0.02)',
    border: '1px solid var(--border-glass)',
    padding: '6px 14px',
    borderRadius: '20px',
    fontFamily: 'var(--font-mono)',
  },
  titleWrapper: {
    textAlign: 'center',
    marginBottom: '28px',
  },
  title: {
    fontSize: '1.6rem',
    fontWeight: '700',
    color: '#fff',
    letterSpacing: '-0.01em',
  },
  subtitle: {
    fontSize: '0.85rem',
    color: 'var(--text-secondary)',
    marginTop: '6px',
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '18px',
  },
  inputGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  labelRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  label: {
    fontSize: '0.8rem',
    fontWeight: '600',
    color: 'var(--text-secondary)',
  },
  textBtn: {
    background: 'none',
    border: 'none',
    color: 'var(--accent-cyan)',
    fontSize: '0.75rem',
    fontWeight: '600',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
  },
  inputWrapper: {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
  },
  inputIcon: {
    position: 'absolute',
    left: '14px',
    color: 'var(--text-muted)',
  },
  input: {
    width: '100%',
  },
  sharePanel: {
    background: 'rgba(255, 255, 255, 0.02)',
    border: '1px solid var(--border-glass)',
    borderRadius: '10px',
    padding: '14px',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  shareActions: {
    display: 'flex',
    gap: '10px',
  },
  shareBtn: {
    flex: 1,
    fontSize: '0.8rem',
  },
  qrToggle: {
    fontSize: '0.8rem',
    padding: '10px 14px',
  },
  qrContainer: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    borderTop: '1px solid var(--border-glass)',
    paddingTop: '14px',
    animation: 'slide-up 0.3s ease-out forwards',
  },
  qrText: {
    fontSize: '0.75rem',
    color: 'var(--text-secondary)',
    textAlign: 'center',
    marginBottom: '10px',
  },
  qrImage: {
    width: '140px',
    height: '140px',
    borderRadius: '8px',
    border: '2px solid rgba(6, 182, 212, 0.2)',
  },
  joinBtn: {
    width: '100%',
    marginTop: '6px',
  },
  error: {
    color: 'var(--accent-danger)',
    fontSize: '0.8rem',
    textAlign: 'center',
    background: 'rgba(239, 68, 68, 0.05)',
    border: '1px solid rgba(239, 68, 68, 0.15)',
    padding: '8px',
    borderRadius: '8px',
  },
  historySection: {
    marginTop: '28px',
    borderTop: '1px solid var(--border-glass)',
    paddingTop: '20px',
  },
  historyTitle: {
    fontSize: '0.85rem',
    fontWeight: '700',
    color: 'var(--text-secondary)',
    display: 'flex',
    alignItems: 'center',
    marginBottom: '12px',
  },
  historyList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    maxHeight: '140px',
    overflowY: 'auto',
  },
  historyItem: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '10px 14px',
    background: 'rgba(255, 255, 255, 0.01)',
    border: '1px solid var(--border-glass)',
    borderRadius: '8px',
  },
  historyInfo: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
  },
  historyName: {
    fontSize: '0.85rem',
    fontWeight: '600',
    color: '#fff',
  },
  historyId: {
    fontSize: '0.7rem',
    color: 'var(--text-muted)',
    fontFamily: 'var(--font-mono)',
  },
  historyBtn: {
    padding: '6px 12px',
    fontSize: '0.75rem',
  },
  footer: {
    display: 'flex',
    justifyContent: 'center',
    marginTop: '28px',
  }
};
