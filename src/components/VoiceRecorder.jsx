// VoiceRecorder & VoicePlayer Components
// Implements recording, E2EE binary encryption triggers, and custom wave-animated audio players.

import React, { useState, useEffect, useRef } from 'react';
import { Mic, Square, Trash2, Send, Play, Pause, Volume2 } from 'lucide-react';
import { decryptBinary, zeroizeBuffer } from '../crypto';

/**
 * VOICE RECORDER - Recording panel
 */
export function VoiceRecorder({ onSendVoice, onCancel }) {
  const [isRecording, setIsRecording] = useState(false);
  const [recordTime, setRecordTime] = useState(0);
  
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const timerRef = useRef(null);

  useEffect(() => {
    return () => {
      stopTimer();
    };
  }, []);

  async function startRecording() {
    audioChunksRef.current = [];
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        
        // Convert Blob to ArrayBuffer for cryptography
        const arrayBuffer = await audioBlob.arrayBuffer();
        
        // Pass to parent E2EE sending engine
        onSendVoice(arrayBuffer);

        // Turn off mic tracks
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
      setRecordTime(0);
      startTimer();
    } catch (err) {
      console.error("Microphone access denied:", err);
      alert("Could not access microphone. Verify hardware permissions.");
      onCancel();
    }
  }

  function stopRecording() {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      stopTimer();
    }
  }

  function startTimer() {
    timerRef.current = setInterval(() => {
      setRecordTime(prev => {
        if (prev >= 120) { // Limit to 2 minutes max
          stopRecording();
          return 120;
        }
        return prev + 1;
      });
    }, 1000);
  }

  function stopTimer() {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  function formatTime(seconds) {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }

  function handleDiscard() {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      // Discard recorded tracks
      mediaRecorderRef.current.onstop = null;
    }
    stopTimer();
    onCancel();
  }

  return (
    <div style={styles.recorderPanel}>
      {!isRecording ? (
        <button onClick={startRecording} className="btn-primary" style={styles.recordTrigger}>
          <Mic size={16} /> Tap to Record Secure Audio
        </button>
      ) : (
        <div style={styles.recordingRow}>
          {/* Animated visualizer dot */}
          <div style={styles.visualizerGroup}>
            <div style={styles.pulseDot} />
            <span style={styles.timeLabel}>{formatTime(recordTime)} / 02:00</span>
          </div>

          <div style={styles.recorderActions}>
            <button onClick={handleDiscard} style={styles.discardBtn}>
              <Trash2 size={16} />
            </button>
            <button onClick={stopRecording} className="btn-danger" style={styles.stopBtn}>
              <Square size={14} /> Send Note
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * CUSTOM SECURE DECRYPTED VOICE PLAYER
 */
export function VoicePlayer({ encryptedBinary, cryptoKey }) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [decryptedUrl, setDecryptedUrl] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const audioRef = useRef(null);
  const animationRef = useRef(null);

  // Clean up Object URL on unmount to prevent leaks
  useEffect(() => {
    return () => {
      if (decryptedUrl) {
        URL.revokeObjectURL(decryptedUrl);
      }
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [decryptedUrl]);

  async function handlePlayToggle() {
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
      cancelAnimationFrame(animationRef.current);
      return;
    }

    // Decrypt on demand (volatile decryption)
    if (!decryptedUrl) {
      setIsLoading(true);
      try {
        const decryptedBuffer = await decryptBinary(encryptedBinary, cryptoKey);
        const audioBlob = new Blob([decryptedBuffer], { type: 'audio/webm' });
        const url = URL.createObjectURL(audioBlob);
        setDecryptedUrl(url);

        // Zero out decrypted local buffer copy immediately
        const tempArr = new Uint8Array(decryptedBuffer);
        zeroizeBuffer(tempArr);

        // Wait for audio node to load
        setTimeout(() => {
          if (audioRef.current) {
            audioRef.current.play();
            setIsPlaying(true);
            updateProgress();
          }
        }, 100);
      } catch (err) {
        console.error("Voice decryption failed:", err);
        alert("E2EE decrypt failure.");
      } finally {
        setIsLoading(false);
      }
    } else {
      audioRef.current.play();
      setIsPlaying(true);
      updateProgress();
    }
  }

  function updateProgress() {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime);
      if (audioRef.current.duration) {
        setDuration(audioRef.current.duration);
      }
      
      if (!audioRef.current.paused && !audioRef.current.ended) {
        animationRef.current = requestAnimationFrame(updateProgress);
      } else {
        setIsPlaying(false);
      }
    }
  }

  function handleLoadedMetadata() {
    if (audioRef.current) {
      setDuration(audioRef.current.duration);
    }
  }

  function handleTimeUpdate() {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime);
    }
  }

  function handleAudioEnded() {
    setIsPlaying(false);
    setCurrentTime(0);
    cancelAnimationFrame(animationRef.current);
  }

  function formatDuration(sec) {
    if (isNaN(sec)) return "0:00";
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }

  return (
    <div style={styles.playerCard}>
      {decryptedUrl && (
        <audio
          ref={audioRef}
          src={decryptedUrl}
          onLoadedMetadata={handleLoadedMetadata}
          onTimeUpdate={handleTimeUpdate}
          onEnded={handleAudioEnded}
          style={{ display: 'none' }}
        />
      )}

      <button onClick={handlePlayToggle} style={styles.playBtn} disabled={isLoading}>
        {isLoading ? (
          <div style={styles.miniSpinner} />
        ) : isPlaying ? (
          <Pause size={14} style={{ color: 'var(--accent-cyan)' }} />
        ) : (
          <Play size={14} style={{ color: '#fff' }} />
        )}
      </button>

      <div style={styles.waveGroup}>
        {/* Real-time moving wave simulator */}
        <div style={styles.waveBarContainer}>
          {[3, 7, 5, 8, 12, 9, 6, 8, 11, 4, 6, 9, 7, 5, 3].map((height, i) => (
            <div
              key={i}
              style={{
                ...styles.waveBar,
                height: `${height + (isPlaying ? Math.sin(currentTime * 10 + i) * 4 : 0)}px`,
                backgroundColor: isPlaying && currentTime / duration > i / 15 ? 
                  'var(--accent-cyan)' : 'var(--text-muted)'
              }}
            />
          ))}
        </div>
        
        <div style={styles.durationRow}>
          <span>{formatDuration(currentTime)}</span>
          <span>{formatDuration(duration)}</span>
        </div>
      </div>
    </div>
  );
}

const styles = {
  recorderPanel: {
    display: 'flex',
    alignItems: 'center',
    width: '100%',
    padding: '4px',
    animation: 'slide-up 0.2s ease-out forwards',
  },
  recordTrigger: {
    width: '100%',
    padding: '10px 14px',
    fontSize: '0.85rem',
  },
  recordingRow: {
    width: '100%',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    background: 'rgba(239, 68, 68, 0.04)',
    border: '1px solid rgba(239, 68, 68, 0.15)',
    borderRadius: '10px',
    padding: '6px 12px',
  },
  visualizerGroup: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  pulseDot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    backgroundColor: 'var(--accent-danger)',
    boxShadow: '0 0 10px var(--accent-danger)',
    animation: 'pulse-ring-red 1.2s infinite',
  },
  timeLabel: {
    fontSize: '0.8rem',
    color: 'var(--text-secondary)',
    fontFamily: 'var(--font-mono)',
  },
  recorderActions: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
  },
  discardBtn: {
    background: 'none',
    border: 'none',
    color: 'var(--text-muted)',
    cursor: 'pointer',
    padding: '6px',
    transition: 'var(--transition-smooth)',
  },
  stopBtn: {
    padding: '8px 14px',
    fontSize: '0.8rem',
  },
  playerCard: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '10px 14px',
    background: 'rgba(255, 255, 255, 0.02)',
    border: '1px solid var(--border-glass)',
    borderRadius: '12px',
    width: '240px',
  },
  playBtn: {
    background: 'rgba(255, 255, 255, 0.04)',
    border: '1px solid var(--border-glass)',
    borderRadius: '50%',
    width: '32px',
    height: '32px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    flexShrink: 0,
  },
  waveGroup: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  waveBarContainer: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: '20px',
  },
  waveBar: {
    width: '2px',
    borderRadius: '1px',
    transition: 'height 0.1s ease',
  },
  durationRow: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '0.65rem',
    color: 'var(--text-muted)',
    fontFamily: 'var(--font-mono)',
  },
  miniSpinner: {
    width: '12px',
    height: '12px',
    border: '2px solid rgba(255, 255, 255, 0.2)',
    borderTopColor: 'var(--accent-cyan)',
    borderRadius: '50%',
    animation: 'scratch-shim 1s infinite linear',
  }
};
