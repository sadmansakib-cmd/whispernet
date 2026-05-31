// Whiteboard Component
// Renders an E2EE shared sketchboard vector pad. Both users draw in real-time.
// Synchronizes brush colors, lines, and clear commands over WebSockets.

import React, { useRef, useState, useEffect } from 'react';
import { Edit2, Eraser, Trash2, X, Download } from 'lucide-react';

export default function Whiteboard({ socket, activePeerConnected, onClose }) {
  const canvasRef = useRef(null);
  const contextRef = useRef(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [brushColor, setBrushColor] = useState('var(--accent-cyan)');
  const [brushSize, setBrushSize] = useState(4);
  const [activeTool, setActiveTool] = useState('draw'); // 'draw' | 'erase'

  const lastCoords = useRef({ x: 0, y: 0 });

  useEffect(() => {
    initCanvas();
    setupSocketListeners();
    
    // Resize handler to maintain scale
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      if (socket) {
        socket.off('receive_vector');
      }
    };
  }, []);

  function initCanvas() {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Get parent bounds
    const rect = canvas.parentElement.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height || 400;

    const context = canvas.getContext('2d');
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.strokeStyle = brushColor;
    context.lineWidth = brushSize;
    contextRef.current = context;

    // Fill with slate background initially
    context.fillStyle = '#0b0d19';
    context.fillRect(0, 0, canvas.width, canvas.height);
  }

  function setupSocketListeners() {
    if (!socket) return;

    socket.on('receive_vector', (data) => {
      if (data.action === 'draw') {
        drawSegmentOnCanvas(data.x0, data.y0, data.x1, data.y1, data.color, data.width);
      } else if (data.action === 'clear') {
        clearCanvasLocal();
      }
    });
  }

  function handleResize() {
    // Preserve current content before resize
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = canvas.width;
    tempCanvas.height = canvas.height;
    const tempCtx = tempCanvas.getContext('2d');
    tempCtx.drawImage(canvas, 0, 0);

    const rect = canvas.parentElement.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height || 400;

    const context = canvas.getContext('2d');
    context.lineCap = 'round';
    context.lineJoin = 'round';
    contextRef.current = context;
    
    // Redraw previous content
    context.fillStyle = '#0b0d19';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(tempCanvas, 0, 0);
  }

  // Draw segment local & emit
  function drawSegmentOnCanvas(x0, y0, x1, y1, color, width) {
    const ctx = contextRef.current;
    if (!ctx) return;

    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    ctx.restore();
  }

  function startDrawing({ nativeEvent }) {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const { offsetX, offsetY } = getEventCoordinates(nativeEvent, canvas);
    
    setIsDrawing(true);
    lastCoords.current = { x: offsetX, y: offsetY };
  }

  function draw({ nativeEvent }) {
    if (!isDrawing) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const { offsetX, offsetY } = getEventCoordinates(nativeEvent, canvas);
    const x0 = lastCoords.current.x;
    const y0 = lastCoords.current.y;
    const x1 = offsetX;
    const y1 = offsetY;

    const currentStrokeColor = activeTool === 'erase' ? '#0b0d19' : brushColor;
    const currentStrokeSize = activeTool === 'erase' ? 24 : brushSize;

    // Draw locally
    drawSegmentOnCanvas(x0, y0, x1, y1, currentStrokeColor, currentStrokeSize);

    // Emit via WebSocket to partner
    if (socket && activePeerConnected) {
      socket.emit('draw_vector', {
        action: 'draw',
        x0, y0, x1, y1,
        color: currentStrokeColor,
        width: currentStrokeSize
      });
    }

    lastCoords.current = { x: x1, y: y1 };
  }

  function stopDrawing() {
    setIsDrawing(false);
  }

  function getEventCoordinates(e, canvas) {
    // Touch support fallback
    if (e.touches && e.touches.length > 0) {
      const rect = canvas.getBoundingClientRect();
      return {
        offsetX: e.touches[0].clientX - rect.left,
        offsetY: e.touches[0].clientY - rect.top
      };
    }
    return {
      offsetX: e.offsetX,
      offsetY: e.offsetY
    };
  }

  function clearCanvasLocal() {
    const canvas = canvasRef.current;
    const ctx = contextRef.current;
    if (!canvas || !ctx) return;

    ctx.fillStyle = '#0b0d19';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  function handleClear() {
    clearCanvasLocal();
    if (socket && activePeerConnected) {
      socket.emit('draw_vector', { action: 'clear' });
    }
  }

  function downloadCanvasImage() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const link = document.createElement('a');
    link.download = `whispernet-whiteboard-${Date.now()}.png`;
    link.href = canvas.toDataURL();
    link.click();
  }

  return (
    <div className="glass-panel" style={styles.modalOverlay}>
      <div style={styles.modalContent}>
        
        {/* Header */}
        <div style={styles.header}>
          <div style={styles.titleGroup}>
            <span style={styles.title}>Secure E2EE Shared Whiteboard</span>
            {!activePeerConnected && (
              <span style={styles.offlineText}>• Offline Mode</span>
            )}
          </div>
          <div style={styles.headerActions}>
            <button onClick={downloadCanvasImage} style={styles.headerBtn} title="Download Doodle">
              <Download size={14} />
            </button>
            <button onClick={onClose} style={styles.closeBtn}>
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Board viewport wrapper */}
        <div style={styles.canvasContainer}>
          <canvas
            ref={canvasRef}
            onMouseDown={startDrawing}
            onMouseMove={draw}
            onMouseUp={stopDrawing}
            onMouseLeave={stopDrawing}
            onTouchStart={startDrawing}
            onTouchMove={draw}
            onTouchEnd={stopDrawing}
            style={styles.canvas}
          />
        </div>

        {/* Toolbar Controls */}
        <div style={styles.toolbar}>
          
          {/* Tools */}
          <div style={styles.toolSection}>
            <button
              onClick={() => setActiveTool('draw')}
              style={{
                ...styles.toolBtn,
                ...(activeTool === 'draw' ? styles.toolBtnActive : {})
              }}
              title="Draw Brush"
            >
              <Edit2 size={16} />
            </button>
            <button
              onClick={() => setActiveTool('erase')}
              style={{
                ...styles.toolBtn,
                ...(activeTool === 'erase' ? styles.toolBtnActive : {})
              }}
              title="Board Eraser"
            >
              <Eraser size={16} />
            </button>
          </div>

          {/* Separation */}
          <div style={styles.divider}></div>

          {/* Palette Colors (only if drawing) */}
          {activeTool === 'draw' && (
            <div style={styles.colorPalette}>
              {['var(--accent-cyan)', 'var(--accent-cyber)', 'var(--accent-green)', '#a855f7', '#ffffff'].map((color) => (
                <button
                  key={color}
                  onClick={() => setBrushColor(color)}
                  style={{
                    ...styles.colorCircle,
                    backgroundColor: color,
                    transform: brushColor === color ? 'scale(1.2)' : 'scale(1)',
                    border: brushColor === color ? '2px solid #fff' : '1px solid rgba(255, 255, 255, 0.2)'
                  }}
                />
              ))}
            </div>
          )}

          {/* Brush Sizes */}
          <div style={styles.sizeSelection}>
            {[2, 4, 8, 16].map((size) => (
              <button
                key={size}
                onClick={() => setBrushSize(size)}
                style={{
                  ...styles.sizeBtn,
                  color: brushSize === size ? 'var(--accent-cyan)' : 'var(--text-secondary)',
                  fontWeight: brushSize === size ? 'bold' : 'normal'
                }}
              >
                {size}px
              </button>
            ))}
          </div>

          {/* Clear Database button */}
          <button onClick={handleClear} className="btn-danger" style={styles.clearBtn} title="Purge Whiteboard">
            <Trash2 size={14} /> Clear
          </button>

        </div>

      </div>
    </div>
  );
}

const styles = {
  modalOverlay: {
    position: 'absolute',
    inset: 0,
    background: 'rgba(5, 7, 15, 0.95)',
    zIndex: 100,
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    padding: '24px',
    borderRadius: 'var(--border-radius-lg)',
  },
  modalContent: {
    width: '100%',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottom: '1px solid var(--border-glass)',
    paddingBottom: '12px',
  },
  titleGroup: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  title: {
    fontSize: '1rem',
    fontWeight: '700',
    color: '#fff',
  },
  offlineText: {
    fontSize: '0.75rem',
    color: 'var(--text-muted)',
    fontFamily: 'var(--font-mono)',
  },
  headerActions: {
    display: 'flex',
    gap: '12px',
    alignItems: 'center',
  },
  headerBtn: {
    background: 'rgba(255, 255, 255, 0.03)',
    border: '1px solid var(--border-glass)',
    borderRadius: '6px',
    padding: '6px',
    color: 'var(--text-secondary)',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    transition: 'var(--transition-smooth)',
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    color: 'var(--text-muted)',
    cursor: 'pointer',
    padding: '4px',
  },
  canvasContainer: {
    flex: 1,
    width: '100%',
    minHeight: '260px',
    borderRadius: 'var(--border-radius-md)',
    overflow: 'hidden',
    border: '1px solid var(--border-glass)',
    position: 'relative',
    background: '#0b0d19',
  },
  canvas: {
    width: '100%',
    height: '100%',
    display: 'block',
    cursor: 'crosshair',
    touchAction: 'none', // Prevents screen scroll while drawing on touch devices
  },
  toolbar: {
    background: 'rgba(255, 255, 255, 0.02)',
    border: '1px solid var(--border-glass)',
    borderRadius: '12px',
    padding: '12px 16px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: '12px',
  },
  toolSection: {
    display: 'flex',
    gap: '8px',
  },
  toolBtn: {
    background: 'rgba(255, 255, 255, 0.03)',
    border: '1px solid var(--border-glass)',
    padding: '8px',
    borderRadius: '8px',
    color: 'var(--text-secondary)',
    cursor: 'pointer',
    transition: 'var(--transition-smooth)',
  },
  toolBtnActive: {
    background: 'var(--accent-primary)',
    borderColor: 'var(--accent-primary)',
    color: '#fff',
  },
  divider: {
    width: '1px',
    height: '24px',
    background: 'var(--border-glass)',
  },
  colorPalette: {
    display: 'flex',
    gap: '8px',
  },
  colorCircle: {
    width: '20px',
    height: '20px',
    borderRadius: '50%',
    cursor: 'pointer',
    padding: 0,
    outline: 'none',
    transition: 'transform 0.15s ease',
  },
  sizeSelection: {
    display: 'flex',
    gap: '8px',
  },
  sizeBtn: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: '0.75rem',
    fontFamily: 'var(--font-mono)',
  },
  clearBtn: {
    padding: '8px 14px',
    fontSize: '0.8rem',
  }
};
