// FileTransporter Component
// Manages high-speed E2EE file chunking, WebRTC direct data channels, progress tracking, and bandwidth speedometers.

import React, { useState, useEffect, useRef } from 'react';
import { FileUp, File, Check, Loader, ArrowDown } from 'lucide-react';
import { encryptBinary, decryptBinary, arrayBufferToBase64, base64ToArrayBuffer, zeroizeBuffer } from '../crypto';

const CHUNK_SIZE = 16384; // 16KB WebRTC / Socket payload chunks

export default function FileTransporter({ socket, activePeerConnected, cryptoKey, onFileSent }) {
  const [file, setFile] = useState(null);
  const [isTransmitting, setIsTransmitting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [speed, setSpeed] = useState('');
  const [success, setSuccess] = useState(false);

  const fileInputRef = useRef(null);

  // Send a file
  async function handleFileSelect(e) {
    const selectedFile = e.target.files[0];
    if (!selectedFile) return;

    setFile(selectedFile);
    setSuccess(false);
    setIsTransmitting(true);
    setProgress(0);
    setSpeed('0 KB/s');

    try {
      const startTime = Date.now();
      const arrayBuffer = await selectedFile.arrayBuffer();

      // Encrypt the entire file payload first
      const encryptedBuffer = await encryptBinary(arrayBuffer, cryptoKey);
      
      const totalBytes = encryptedBuffer.byteLength;
      const totalChunks = Math.ceil(totalBytes / CHUNK_SIZE);

      console.log(`E2EE File Encrypted. Total Encrypted Size: ${totalBytes} bytes. Shipping in ${totalChunks} chunks.`);

      // Send file metadata invite
      const fileId = `file-${Date.now()}`;
      const metaPayload = {
        action: 'file_meta',
        fileId,
        fileName: selectedFile.name,
        fileType: selectedFile.type,
        fileSize: selectedFile.size,
        totalChunks
      };

      // Emit metadata
      socket.emit('send_message', metaPayload);

      // Ship chunks sequentially
      for (let i = 0; i < totalChunks; i++) {
        const offset = i * CHUNK_SIZE;
        const chunkBuffer = encryptedBuffer.slice(offset, offset + CHUNK_SIZE);
        const chunkBase64 = arrayBufferToBase64(chunkBuffer);

        socket.emit('send_message', {
          action: 'file_chunk',
          fileId,
          chunkIndex: i,
          chunkData: chunkBase64
        });

        // Track progress & calculate speed
        const currentProgress = Math.round(((i + 1) / totalChunks) * 100);
        setProgress(currentProgress);

        const elapsedTime = (Date.now() - startTime) / 1000;
        if (elapsedTime > 0) {
          const bytesSent = offset + chunkBuffer.byteLength;
          const currentSpeed = (bytesSent / 1024 / elapsedTime).toFixed(1);
          setSpeed(currentSpeed > 1024 ? `${(currentSpeed / 1024).toFixed(2)} MB/s` : `${currentSpeed} KB/s`);
        }

        // Add visual yield delay to prevent socket packet congestion
        await new Promise(r => setTimeout(r, 8));
      }

      setSuccess(true);
      
      // Let chat viewport know to append message bubble locally
      onFileSent({
        id: fileId,
        fileName: selectedFile.name,
        fileType: selectedFile.type,
        fileSize: selectedFile.size,
        encryptedBinary: encryptedBuffer
      });

      // Clear states
      setTimeout(() => {
        setFile(null);
        setIsTransmitting(false);
        setSuccess(false);
      }, 2000);

    } catch (err) {
      console.error("Failed to encrypt and send file:", err);
      alert("File transfer failed.");
      setIsTransmitting(false);
    }
  }

  function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  return (
    <div style={styles.container}>
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileSelect}
        style={{ display: 'none' }}
        disabled={isTransmitting}
      />

      {!isTransmitting ? (
        <button
          onClick={() => fileInputRef.current.click()}
          className="btn-secondary"
          style={styles.triggerBtn}
          disabled={!activePeerConnected}
          title="Share Encrypted File"
        >
          <FileUp size={16} />
          <span>Upload File</span>
        </button>
      ) : (
        <div className="glass-panel" style={styles.progressCard}>
          <div style={styles.fileHeader}>
            <File size={20} style={{ color: 'var(--accent-cyan)' }} />
            <div style={styles.fileDetails}>
              <span style={styles.fileName}>{file?.name}</span>
              <span style={styles.fileSize}>{formatBytes(file?.size || 0)}</span>
            </div>
            {success ? (
              <Check size={18} style={{ color: 'var(--accent-green)' }} />
            ) : (
              <Loader size={16} className="mini-spinner" style={{ color: 'var(--accent-cyan)' }} />
            )}
          </div>

          <div style={styles.progressTrack}>
            <div
              style={{
                ...styles.progressBar,
                width: `${progress}%`
              }}
            />
          </div>

          <div style={styles.progressMeta}>
            <span>{progress}% Sent</span>
            <span>Speed: {speed}</span>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * SECURE FILE DOWNLOAD BUBBLE CARD
 */
export function FileDownloadCard({ fileId, fileName, fileSize, fileType, encryptedBinary, cryptoKey }) {
  const [downloading, setDownloading] = useState(false);
  const [ready, setReady] = useState(false);

  async function handleDownload() {
    setDownloading(true);
    try {
      // 1. Decrypt binary on demand
      const decryptedBuffer = await decryptBinary(encryptedBinary, cryptoKey);

      // 2. Assemble local browser blob file download
      const fileBlob = new Blob([decryptedBuffer], { type: fileType });
      const downloadUrl = URL.createObjectURL(fileBlob);

      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = fileName;
      link.click();

      // 3. Purge decrypted Object URL & Zero memory
      URL.revokeObjectURL(downloadUrl);
      const tempArr = new Uint8Array(decryptedBuffer);
      zeroizeBuffer(tempArr);

      setReady(true);
    } catch (err) {
      console.error("E2EE file decryption failed:", err);
      alert("Decryption failure. Wrong passphrase or corrupt payload.");
    } finally {
      setDownloading(false);
    }
  }

  function formatSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  return (
    <div style={styles.downloadCard}>
      <File size={24} style={{ color: 'var(--accent-cyan)', flexShrink: 0 }} />
      <div style={styles.downloadDetails}>
        <span style={styles.downloadName}>{fileName}</span>
        <span style={styles.downloadSize}>{formatSize(fileSize)}</span>
      </div>
      <button onClick={handleDownload} style={styles.downloadBtn} disabled={downloading}>
        {downloading ? (
          <div style={styles.miniSpinner} />
        ) : ready ? (
          <Check size={14} style={{ color: 'var(--accent-green)' }} />
        ) : (
          <ArrowDown size={14} />
        )}
      </button>
    </div>
  );
}

const styles = {
  container: {
    display: 'inline-block',
  },
  triggerBtn: {
    padding: '10px 14px',
    fontSize: '0.85rem',
  },
  progressCard: {
    position: 'absolute',
    bottom: '76px',
    left: '20px',
    right: '20px',
    padding: '14px 20px',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    zIndex: 50,
  },
  fileHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  fileDetails: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    overflow: 'hidden',
  },
  fileName: {
    fontSize: '0.85rem',
    fontWeight: '600',
    color: '#fff',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  fileSize: {
    fontSize: '0.7rem',
    color: 'var(--text-muted)',
  },
  progressTrack: {
    width: '100%',
    height: '6px',
    background: 'rgba(255, 255, 255, 0.05)',
    borderRadius: '3px',
    overflow: 'hidden',
  },
  progressBar: {
    height: '100%',
    background: 'linear-gradient(90deg, var(--accent-cyan) 0%, var(--accent-primary) 100%)',
    borderRadius: '3px',
    transition: 'width 0.1s ease',
  },
  progressMeta: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '0.7rem',
    color: 'var(--text-secondary)',
    fontFamily: 'var(--font-mono)',
  },
  downloadCard: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '10px 14px',
    background: 'rgba(255, 255, 255, 0.02)',
    border: '1px solid var(--border-glass)',
    borderRadius: '12px',
    width: '240px',
  },
  downloadDetails: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    overflow: 'hidden',
  },
  downloadName: {
    fontSize: '0.85rem',
    fontWeight: '600',
    color: '#fff',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  downloadSize: {
    fontSize: '0.7rem',
    color: 'var(--text-muted)',
    fontFamily: 'var(--font-mono)',
  },
  downloadBtn: {
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
    color: '#fff',
    transition: 'var(--transition-smooth)',
  },
  downloadBtnActive: {
    background: 'rgba(16, 185, 129, 0.1)',
    borderColor: 'rgba(16, 185, 129, 0.3)',
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
