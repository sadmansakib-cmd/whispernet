// CallWindow Component
// Coordinates E2EE WebRTC audio and video calling.
// Renders active video grids, local CSS video filters, and custom real-time Canvas voice waves.

import React, { useState, useEffect, useRef } from 'react';
import { PhoneOff, Video, VideoOff, Mic, MicOff, Shield, Monitor } from 'lucide-react';

export default function CallWindow({
  socket,
  roomId,
  mySenderId,
  isIncoming,
  callerName,
  onEndCall,
  activePeerSocketId
}) {
  const [callState, setCallState] = useState(isIncoming ? 'incoming' : 'dialing'); // 'dialing' | 'incoming' | 'connecting' | 'active' | 'ended'
  const [videoEnabled, setVideoEnabled] = useState(true);
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [selectedFilter, setSelectedFilter] = useState('none'); // 'none' | 'cyber' | 'noir' | 'sepia' | 'matrix' | 'blur'

  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const canvasRef = useRef(null);

  const pcRef = useRef(null); // RTCPeerConnection
  const localStreamRef = useRef(null);
  const audioCtxRef = useRef(null);
  const analyserRef = useRef(null);
  const canvasAnimRef = useRef(null);

  // WebRTC ICE Configuration (Stun servers)
  const rtcConfig = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ]
  };

  useEffect(() => {
    // Acquire local media streams
    initializeLocalStream();

    return () => {
      endWebRtcConnection();
    };
  }, []);

  // WebRTC Signal Listener
  useEffect(() => {
    if (!socket) return;

    function handleReceiveSignal({ signal, senderSocketId }) {
      console.log("Call received signaling handshake:", signal.type);
      if (signal.type === 'offer' && callState === 'incoming') {
        // Prepare to answer offer
        setCallState('connecting');
        acceptOfferAndAnswer(signal.sdp, senderSocketId);
      } else if (signal.type === 'answer' && pcRef.current) {
        setCallState('active');
        pcRef.current.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: signal.sdp }));
      } else if (signal.type === 'candidate' && pcRef.current) {
        pcRef.current.addIceCandidate(new RTCIceCandidate(signal.candidate)).catch(err => {
          console.error("Error adding ICE candidate:", err);
        });
      } else if (signal.type === 'end_call') {
        setCallState('ended');
        setTimeout(onEndCall, 1500);
      }
    }

    socket.on('receive_webrtc_signal', handleReceiveSignal);
    return () => {
      socket.off('receive_webrtc_signal', handleReceiveSignal);
    };
  }, [socket, callState]);

  async function initializeLocalStream() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      localStreamRef.current = stream;
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }

      // Initialize soundwave visualizer
      setupAudioVisualizer(stream);

      if (!isIncoming) {
        // Initiating call: create offer
        setCallState('connecting');
        initializePeerConnection(activePeerSocketId);
      }
    } catch (err) {
      console.error("Failed to fetch camera/mic stream:", err);
      alert("WhisperNet requires camera and microphone permissions to initialize call tunnels.");
      onEndCall();
    }
  }

  function initializePeerConnection(targetSocketId) {
    const pc = new RTCPeerConnection(rtcConfig);
    pcRef.current = pc;

    // Attach local stream tracks
    localStreamRef.current.getTracks().forEach(track => {
      pc.addTrack(track, localStreamRef.current);
    });

    pc.ontrack = (event) => {
      console.log("Remote track acquired!");
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = event.streams[0];
        setCallState('active');
      }
    };

    pc.onicecandidate = (event) => {
      if (event.candidate && socket) {
        socket.emit('webrtc_signal', {
          targetSocketId,
          signal: { type: 'candidate', candidate: event.candidate }
        });
      }
    };

    // Create SDP Offer
    pc.createOffer().then(offer => {
      return pc.setLocalDescription(offer).then(() => {
        socket.emit('webrtc_signal', {
          targetSocketId,
          signal: { type: 'offer', sdp: offer.sdp }
        });
      });
    }).catch(err => {
      console.error("Offer creation failed:", err);
    });
  }

  async function acceptOfferAndAnswer(sdp, senderSocketId) {
    const pc = new RTCPeerConnection(rtcConfig);
    pcRef.current = pc;

    localStreamRef.current.getTracks().forEach(track => {
      pc.addTrack(track, localStreamRef.current);
    });

    pc.ontrack = (event) => {
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = event.streams[0];
        setCallState('active');
      }
    };

    pc.onicecandidate = (event) => {
      if (event.candidate && socket) {
        socket.emit('webrtc_signal', {
          targetSocketId: senderSocketId,
          signal: { type: 'candidate', candidate: event.candidate }
        });
      }
    };

    try {
      await pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp }));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      socket.emit('webrtc_signal', {
        targetSocketId: senderSocketId,
        signal: { type: 'answer', sdp: answer.sdp }
      });
    } catch (err) {
      console.error("SDP Answer creation failed:", err);
    }
  }

  // Real-time Canvas soundwave visualizer
  function setupAudioVisualizer(stream) {
    const canvas = canvasRef.current;
    if (!canvas) return;

    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      const audioCtx = new AudioContext();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 64;

      source.connect(analyser);
      audioCtxRef.current = audioCtx;
      analyserRef.current = analyser;

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      const ctx = canvas.getContext('2d');

      canvas.width = 160;
      canvas.height = 60;

      function renderWave() {
        if (!analyserRef.current || !canvas) return;

        analyserRef.current.getByteFrequencyData(dataArray);
        ctx.fillStyle = 'rgba(11, 13, 25, 0.2)'; // semi-clear slate overlay
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        const barWidth = (canvas.width / bufferLength) * 1.5;
        let barHeight;
        let x = 0;

        for (let i = 0; i < bufferLength; i++) {
          barHeight = dataArray[i] / 4;
          // Linear glowing gradient
          ctx.fillStyle = `hsl(${180 + i * 4}, 100%, 50%)`;
          ctx.fillRect(x, canvas.height - barHeight, barWidth - 2, barHeight);
          x += barWidth;
        }

        canvasAnimRef.current = requestAnimationFrame(renderWave);
      }

      renderWave();
    } catch (err) {
      console.error("Audio visualizer failed:", err);
    }
  }

  function toggleVideo() {
    if (localStreamRef.current) {
      const videoTrack = localStreamRef.current.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setVideoEnabled(videoTrack.enabled);
      }
    }
  }

  function toggleAudio() {
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setAudioEnabled(audioTrack.enabled);
      }
    }
  }

  function handleEndCall() {
    if (socket && activePeerSocketId) {
      socket.emit('webrtc_signal', {
        targetSocketId: activePeerSocketId,
        signal: { type: 'end_call' }
      });
    }
    setCallState('ended');
    setTimeout(onEndCall, 1000);
  }

  function endWebRtcConnection() {
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close();
      audioCtxRef.current = null;
    }
    if (canvasAnimRef.current) {
      cancelAnimationFrame(canvasAnimRef.current);
    }
  }

  // Get inline CSS filter classes based on choice
  function getFilterStyle(filter) {
    switch (filter) {
      case 'cyber': return { filter: 'hue-rotate(280deg) saturate(2.4) contrast(1.1)' };
      case 'noir': return { filter: 'grayscale(1) contrast(1.3) brightness(0.95)' };
      case 'sepia': return { filter: 'sepia(0.85) contrast(1.05) brightness(1.02)' };
      case 'matrix': return { filter: 'hue-rotate(60deg) saturate(1.8) contrast(1.4) brightness(0.8)' };
      case 'blur': return { filter: 'blur(10px)' };
      default: return {};
    }
  }

  return (
    <div style={styles.overlay}>
      <div className="glass-panel" style={styles.container}>
        
        {/* Call Header */}
        <div style={styles.header}>
          <div style={styles.peerInfo}>
            <div style={styles.secureBadge}>
              <Shield size={12} style={{ color: 'var(--accent-cyan)' }} />
              <span>E2EE Media Tunnel</span>
            </div>
            <span style={styles.peerName}>Call with Partner</span>
          </div>
          
          {/* Audio canvas overlay */}
          <canvas ref={canvasRef} style={styles.waveCanvas} />
        </div>

        {/* Video stream grids */}
        <div style={styles.videoGrid}>
          
          {/* Main Remote stream (or status) */}
          <div style={styles.remoteWrapper}>
            {callState === 'active' ? (
              <video
                ref={remoteVideoRef}
                autoPlay
                style={{ ...styles.remoteVideo, ...getFilterStyle(selectedFilter) }}
              />
            ) : (
              <div style={styles.callingOverlay}>
                <div className="pulse-dot" style={callState === 'ended' ? styles.endedDot : styles.activeDot} />
                <span style={styles.callingText}>
                  {callState === 'dialing' && 'Ringing partner...'}
                  {callState === 'incoming' && 'Incoming Call...'}
                  {callState === 'connecting' && 'Negotiating direct E2EE WebRTC tunnel...'}
                  {callState === 'ended' && 'Call Terminated.'}
                </span>
              </div>
            )}
          </div>

          {/* Mirrored Local Stream */}
          {callState !== 'ended' && (
            <div style={styles.localWrapper}>
              <video
                ref={localVideoRef}
                autoPlay
                muted
                style={{ ...styles.localVideo, ...getFilterStyle(selectedFilter) }}
              />
            </div>
          )}

        </div>

        {/* Call Panel Control bar */}
        <div style={styles.controlBar}>
          
          {/* Camera Filters dropdown selectors */}
          <div style={styles.filterGroup}>
            <span style={styles.filterLabel}>Video FX:</span>
            <select
              value={selectedFilter}
              onChange={(e) => setSelectedFilter(e.target.value)}
              className="glass-input"
              style={styles.filterSelect}
            >
              <option value="none">Normal</option>
              <option value="cyber">Cyberpunk</option>
              <option value="noir">Noir Grayscale</option>
              <option value="sepia">Vintage Sepia</option>
              <option value="matrix">Matrix Green</option>
              <option value="blur">Background Blur</option>
            </select>
          </div>

          {/* Action buttons */}
          <div style={styles.btnRow}>
            <button
              onClick={toggleVideo}
              style={{
                ...styles.controlBtn,
                backgroundColor: videoEnabled ? 'rgba(255, 255, 255, 0.05)' : 'var(--accent-danger)'
              }}
            >
              {videoEnabled ? <Video size={16} /> : <VideoOff size={16} />}
            </button>

            <button
              onClick={toggleAudio}
              style={{
                ...styles.controlBtn,
                backgroundColor: audioEnabled ? 'rgba(255, 255, 255, 0.05)' : 'var(--accent-danger)'
              }}
            >
              {audioEnabled ? <Mic size={16} /> : <MicOff size={16} />}
            </button>

            <button onClick={handleEndCall} className="btn-danger" style={styles.endCallBtn}>
              <PhoneOff size={16} />
            </button>
          </div>

        </div>

      </div>
    </div>
  );
}

const styles = {
  overlay: {
    position: 'absolute',
    inset: 0,
    background: 'rgba(3, 4, 10, 0.98)',
    zIndex: 150,
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    padding: '24px',
    borderRadius: 'var(--border-radius-lg)',
  },
  container: {
    width: '100%',
    height: '100%',
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
    background: 'rgba(255, 255, 255, 0.01)',
  },
  peerInfo: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  secureBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    fontSize: '0.65rem',
    textTransform: 'uppercase',
    color: 'var(--accent-cyan)',
    fontFamily: 'var(--font-mono)',
    fontWeight: 'bold',
  },
  peerName: {
    fontSize: '1rem',
    fontWeight: '700',
    color: '#fff',
  },
  waveCanvas: {
    width: '120px',
    height: '40px',
    borderRadius: '6px',
    background: '#0b0d19',
    border: '1px solid var(--border-glass)',
  },
  videoGrid: {
    flex: 1,
    position: 'relative',
    background: '#04050a',
    overflow: 'hidden',
  },
  remoteWrapper: {
    width: '100%',
    height: '100%',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
  },
  remoteVideo: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    transition: 'filter 0.3s ease',
  },
  callingOverlay: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '16px',
    padding: '40px',
    textAlign: 'center',
  },
  activeDot: {
    width: '24px',
    height: '24px',
    borderRadius: '50%',
    backgroundColor: 'var(--accent-primary)',
    animation: 'pulse-glow 1.5s infinite',
  },
  endedDot: {
    width: '24px',
    height: '24px',
    borderRadius: '50%',
    backgroundColor: 'var(--accent-danger)',
  },
  callingText: {
    fontSize: '0.85rem',
    color: 'var(--text-secondary)',
    lineHeight: '1.5',
    maxWidth: '320px',
  },
  localWrapper: {
    position: 'absolute',
    bottom: '20px',
    right: '20px',
    width: '120px',
    height: '180px',
    borderRadius: '10px',
    overflow: 'hidden',
    border: '2px solid rgba(255, 255, 255, 0.15)',
    boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
    zIndex: 10,
    background: '#0b0d19',
  },
  localVideo: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    transform: 'scaleX(-1)', // Mirrored local feed
    transition: 'filter 0.3s ease',
  },
  controlBar: {
    padding: '16px 20px',
    borderTop: '1px solid var(--border-glass)',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: '16px',
    background: 'rgba(255, 255, 255, 0.01)',
  },
  filterGroup: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  filterLabel: {
    fontSize: '0.75rem',
    fontWeight: '600',
    color: 'var(--text-secondary)',
  },
  filterSelect: {
    padding: '6px 12px',
    fontSize: '0.75rem',
  },
  btnRow: {
    display: 'flex',
    gap: '12px',
  },
  controlBtn: {
    border: '1px solid var(--border-glass)',
    color: '#fff',
    borderRadius: '50%',
    width: '38px',
    height: '38px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    transition: 'var(--transition-smooth)',
  },
  endCallBtn: {
    borderRadius: '50%',
    width: '38px',
    height: '38px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
  }
};
