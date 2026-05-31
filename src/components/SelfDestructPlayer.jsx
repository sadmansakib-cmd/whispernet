// SelfDestructPlayer Component
// Implements view-once and time-limited secure photo/video rendering.
// Incorporates screenshot deterrence, circular SVG timer progress rings, and automatic storage purging.

import React, { useState, useEffect, useRef } from 'react';
import { Eye, EyeOff, Lock, X } from 'lucide-react';
import { decryptBinary, zeroizeBuffer } from '../crypto';

export default function SelfDestructPlayer({
  messageId,
  fileName,
  fileType,
  encryptedBinary,
  cryptoKey,
  expireTime, // e.g. 5, 10, or 30 (seconds), or 0 for View-Once
  isViewOnce,
  onExpired,
  onClose
}) {
  const [decryptedUrl, setDecryptedUrl] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [timeLeft, setTimeLeft] = useState(expireTime || 0);

  const timerRef = useRef(null);
  const audioDecryptedRef = useRef(null);

  useEffect(() => {
    return () => {
      purgeMemory();
    };
  }, []);

  function purgeMemory() {
    if (timerRef.current) {
      clearInterval(timerRef.current);
    }
    if (decryptedUrl) {
      URL.revokeObjectURL(decryptedUrl);
      setDecryptedUrl('');
    }
  }

  // Decrypt media when user clicks 'Reveal' (Strict Decrypt-on-Trigger)
  async function handleReveal() {
    setIsLoading(true);
    try {
      const decryptedBuffer = await decryptBinary(encryptedBinary, cryptoKey);
      
      const fileBlob = new Blob([decryptedBuffer], { type: fileType });
      const url = URL.createObjectURL(fileBlob);
      setDecryptedUrl(url);

      // Instantly zero out decrypted RAM copy buffer
      const tempArr = new Uint8Array(decryptedBuffer);
      zeroizeBuffer(tempArr);

      setRevealed(true);

      // Trigger countdown timer if time-limited
      if (expireTime > 0) {
        setTimeLeft(expireTime);
        startCountdown();
      }
    } catch (err) {
      console.error("Self-destruct media decryption failed:", err);
      alert("Failed to decrypt secure media payload.");
      onClose();
    } finally {
      setIsLoading(false);
    }
  }

  function startCountdown() {
    timerRef.current = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timerRef.current);
          handleSelfDestruct();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }

  // Purge the file and trigger expiration database update
  function handleSelfDestruct() {
    purgeMemory();
    onExpired(messageId); // Call parent to wipe database record attachments
    onClose();
  }

  function handleManualClose() {
    // If it was View-Once, closing it immediately self-destructs the file!
    if (isViewOnce && revealed) {
      handleSelfDestruct();
    } else {
      purgeMemory();
      onClose();
    }
  }

  // Circle SVG percentage math for timer indicator
  const radius = 16;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = expireTime > 0 ? 
    circumference - (timeLeft / expireTime) * circumference : 0;

  return (
    <div style={styles.overlay} onContextMenu={(e) => e.preventDefault()}>
      <div className="glass-panel" style={styles.modal}>
        
        {/* Header */}
        <div style={styles.header}>
          <span style={styles.title}>
            {isViewOnce ? 'View-Once Vault' : `Time-Limited Burner (${timeLeft}s)`}
          </span>
          <button onClick={handleManualClose} style={styles.closeBtn} disabled={isLoading}>
            <X size={16} />
          </button>
        </div>

        {/* Viewport content */}
        <div style={styles.viewport}>
          
          {/* Screenshot Deterrence Floating Overlay */}
          {revealed && (
            <div style={styles.watermark}>
              WHISPERNET SECURITY SHIELD • E2EE SESSION
            </div>
          )}

          {!revealed ? (
            <div style={styles.unrevealedContainer}>
              <div style={styles.iconCircle}>
                <Lock size={32} style={{ color: 'var(--accent-cyan)' }} />
              </div>
              <h3 style={styles.unrevealedTitle}>Secure Encrypted Media</h3>
              <p style={styles.unrevealedDesc}>
                {isViewOnce ? 
                  "This photo/video is set to VIEW ONCE. Closing or leaving will delete it forever." :
                  `This media will automatically self-destruct ${expireTime} seconds after opening.`
                }
              </p>
              <button onClick={handleReveal} className="btn-primary" style={styles.revealBtn} disabled={isLoading}>
                {isLoading ? 'Decrypting Secure Frame...' : 'Decrypt & Reveal Media'}
                <Eye size={16} />
              </button>
            </div>
          ) : (
            <div style={styles.mediaContainer}>
              {fileType.startsWith('image/') ? (
                <img
                  src={decryptedUrl}
                  alt="Secure Encrypted payload"
                  style={styles.image}
                  draggable="false"
                />
              ) : fileType.startsWith('video/') ? (
                <video
                  src={decryptedUrl}
                  autoPlay
                  controls
                  controlsList="nodownload noremoteplayback"
                  style={styles.video}
                  disablePictureInPicture
                />
              ) : (
                <div style={styles.unsupported}>Unsupported media viewer format</div>
              )}
            </div>
          )}
        </div>

        {/* Action / Timer Footer */}
        {revealed && (
          <div style={styles.footer}>
            {expireTime > 0 ? (
              <div style={styles.timerGroup}>
                <svg width="40" height="40" style={styles.svgCircle}>
                  <circle
                    cx="20"
                    cy="20"
                    r={radius}
                    stroke="rgba(255,255,255,0.06)"
                    strokeWidth="3"
                    fill="transparent"
                  />
                  <circle
                    cx="20"
                    cy="20"
                    r={radius}
                    stroke="var(--accent-cyber)"
                    strokeWidth="3"
                    fill="transparent"
                    strokeDasharray={circumference}
                    strokeDashoffset={strokeDashoffset}
                    strokeLinecap="round"
                    style={{ transition: 'stroke-dashoffset 1s linear' }}
                  />
                </svg>
                <span style={styles.timerText}>{timeLeft}s left</span>
              </div>
            ) : (
              <button onClick={handleSelfDestruct} className="btn-danger" style={styles.burnBtn}>
                <EyeOff size={14} /> Close & Self-Destruct Now
              </button>
            )}
          </div>
        )}

      </div>
    </div>
  );
}

const styles = {
  overlay: {
    position: 'absolute',
    inset: 0,
    background: 'rgba(3, 4, 10, 0.98)',
    zIndex: 200,
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    padding: '24px',
    borderRadius: 'var(--border-radius-lg)',
    userSelect: 'none',
  },
  modal: {
    width: '100%',
    maxWidth: '560px',
    height: '100%',
    maxHeight: '620px',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottom: '1px solid var(--border-glass)',
    padding: '16px 20px',
  },
  title: {
    fontSize: '0.95rem',
    fontWeight: '700',
    color: '#fff',
    fontFamily: 'var(--font-sans)',
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    color: 'var(--text-muted)',
    cursor: 'pointer',
    padding: '4px',
  },
  viewport: {
    flex: 1,
    position: 'relative',
    background: '#04050a',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  watermark: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%) rotate(-30deg)',
    fontFamily: 'var(--font-mono)',
    fontSize: '12px',
    color: 'rgba(255, 255, 255, 0.04)',
    pointerEvents: 'none',
    letterSpacing: '4px',
    whiteSpace: 'nowrap',
    zIndex: 10,
    width: '120%',
    textAlign: 'center',
  },
  unrevealedContainer: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    textAlign: 'center',
    padding: '40px',
    gap: '16px',
    maxWidth: '360px',
  },
  iconCircle: {
    width: '64px',
    height: '64px',
    borderRadius: '50%',
    background: 'rgba(6, 182, 212, 0.05)',
    border: '1px solid rgba(6, 182, 212, 0.2)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  unrevealedTitle: {
    fontSize: '1.2rem',
    color: '#fff',
    fontWeight: '700',
  },
  unrevealedDesc: {
    fontSize: '0.8rem',
    color: 'var(--text-secondary)',
    lineHeight: '1.5',
  },
  revealBtn: {
    marginTop: '12px',
    padding: '12px 20px',
    fontSize: '0.85rem',
  },
  mediaContainer: {
    width: '100%',
    height: '100%',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
  },
  image: {
    maxWidth: '100%',
    maxHeight: '100%',
    objectFit: 'contain',
    pointerEvents: 'none', // Prevents dragging/saving image
  },
  video: {
    maxWidth: '100%',
    maxHeight: '100%',
    objectFit: 'contain',
  },
  unsupported: {
    color: 'var(--text-muted)',
    fontSize: '0.85rem',
  },
  footer: {
    padding: '16px 20px',
    borderTop: '1px solid var(--border-glass)',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    background: 'rgba(255, 255, 255, 0.01)',
  },
  timerGroup: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
  },
  svgCircle: {
    transform: 'rotate(-90deg)',
  },
  timerText: {
    fontSize: '0.9rem',
    fontFamily: 'var(--font-mono)',
    fontWeight: 'bold',
    color: 'var(--accent-cyber)',
  },
  burnBtn: {
    width: '100%',
  }
};
