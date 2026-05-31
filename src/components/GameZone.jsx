// GameZone Component
// Integrates real-time, peer-to-peer multiplayer E2EE mini-games inside the chat interface.
// Supported Games: Tic-Tac-Toe and Rock-Paper-Scissors.

import React, { useState, useEffect } from 'react';
import { Gamepad2, X, Circle, HelpCircle, Trophy, RotateCcw } from 'lucide-react';

export default function GameZone({ socket, roomId, mySenderId, activePeerConnected, onClose }) {
  const [activeGame, setActiveGame] = useState(null); // 'tictactoe' | 'rps' | null
  
  // Tic-Tac-Toe State
  const [tttBoard, setTttBoard] = useState(Array(9).fill(null));
  const [tttTurn, setTttTurn] = useState(''); // senderId of whose turn it is
  const [tttSymbol, setTttSymbol] = useState(''); // 'X' or 'O'
  const [tttScores, setTttScores] = useState({ X: 0, O: 0 });
  const [tttWinner, setTttWinner] = useState(null);

  // Rock-Paper-Scissors State
  const [rpsMyChoice, setRpsMyChoice] = useState(null);
  const [rpsPeerChoice, setRpsPeerChoice] = useState(null);
  const [rpsResult, setRpsResult] = useState(''); // 'win' | 'lose' | 'draw' | ''
  const [rpsScore, setRpsScore] = useState({ wins: 0, losses: 0 });

  // Listen to game packets from socket
  useEffect(() => {
    if (!socket) return;

    function handleReceiveGameAction(action) {
      if (action.gameType === 'tictactoe') {
        handleTttAction(action);
      } else if (action.gameType === 'rps') {
        handleRpsAction(action);
      }
    }

    socket.on('receive_game_action', handleReceiveGameAction);
    return () => {
      socket.off('receive_game_action', handleReceiveGameAction);
    };
  }, [socket, activeGame, tttBoard, tttTurn, rpsMyChoice]);

  // Initialize a new game & invite peer
  function startTtt() {
    setActiveGame('tictactoe');
    setTttBoard(Array(9).fill(null));
    setTttWinner(null);
    
    // The initiator is X, and gets first move
    setTttSymbol('X');
    setTttTurn(mySenderId);

    // Send init packet
    socket.emit('game_action', {
      gameType: 'tictactoe',
      action: 'init',
      initiatorId: mySenderId
    });
  }

  function startRps() {
    setActiveGame('rps');
    setRpsMyChoice(null);
    setRpsPeerChoice(null);
    setRpsResult('');
    
    socket.emit('game_action', {
      gameType: 'rps',
      action: 'init'
    });
  }

  // TIC-TAC-TOE Logic
  function handleTttAction(data) {
    if (data.action === 'init') {
      setActiveGame('tictactoe');
      setTttBoard(Array(9).fill(null));
      setTttWinner(null);
      // Recipient is O
      setTttSymbol('O');
      setTttTurn(data.initiatorId); // initiator moves first
    } 
    else if (data.action === 'move') {
      const newBoard = [...tttBoard];
      newBoard[data.index] = data.symbol;
      setTttBoard(newBoard);
      
      // Toggle active turn
      setTttTurn(mySenderId);

      // Check results
      checkTttWinner(newBoard);
    } 
    else if (data.action === 'reset') {
      setTttBoard(Array(9).fill(null));
      setTttWinner(null);
      setTttTurn(data.turn);
    }
  }

  function checkTttWinner(board) {
    const lines = [
      [0, 1, 2], [3, 4, 5], [6, 7, 8], // Horizontal
      [0, 3, 6], [1, 4, 7], [2, 5, 8], // Vertical
      [0, 4, 8], [2, 4, 6]             // Diagonal
    ];

    for (let i = 0; i < lines.length; i++) {
      const [a, b, c] = lines[i];
      if (board[a] && board[a] === board[b] && board[a] === board[c]) {
        setTttWinner(board[a]);
        // Update scores
        setTttScores(prev => ({
          ...prev,
          [board[a]]: prev[board[a]] + 1
        }));
        return board[a];
      }
    }

    if (board.every(cell => cell !== null)) {
      setTttWinner('draw');
      return 'draw';
    }

    return null;
  }

  function handleTttCellClick(index) {
    if (tttBoard[index] || tttWinner || tttTurn !== mySenderId || !activePeerConnected) return;

    const newBoard = [...tttBoard];
    newBoard[index] = tttSymbol;
    setTttBoard(newBoard);

    // Swap turn
    setTttTurn(''); // temporarily wait

    socket.emit('game_action', {
      gameType: 'tictactoe',
      action: 'move',
      index: index,
      symbol: tttSymbol
    });

    const result = checkTttWinner(newBoard);
    if (!result) {
      // Let signaling relay swap turn for the recipient
    }
  }

  function resetTtt() {
    setTttBoard(Array(9).fill(null));
    setTttWinner(null);
    // Winner gets next first turn, or initiator
    const nextTurn = tttWinner && tttWinner !== 'draw' ? 
      (tttWinner === tttSymbol ? mySenderId : 'peer') : mySenderId;

    setTttTurn(nextTurn);
    socket.emit('game_action', {
      gameType: 'tictactoe',
      action: 'reset',
      turn: nextTurn === mySenderId ? 'peer' : mySenderId
    });
  }

  // ROCK-PAPER-SCIESSORS Logic
  function handleRpsAction(data) {
    if (data.action === 'init') {
      setActiveGame('rps');
      setRpsMyChoice(null);
      setRpsPeerChoice(null);
      setRpsResult('');
    } 
    else if (data.action === 'submit') {
      setRpsPeerChoice(data.choice);
      if (rpsMyChoice) {
        evaluateRps(rpsMyChoice, data.choice);
      }
    }
    else if (data.action === 'reset') {
      setRpsMyChoice(null);
      setRpsPeerChoice(null);
      setRpsResult('');
    }
  }

  function handleRpsChoice(choice) {
    if (rpsMyChoice || !activePeerConnected) return;
    setRpsMyChoice(choice);

    socket.emit('game_action', {
      gameType: 'rps',
      action: 'submit',
      choice: choice
    });

    if (rpsPeerChoice) {
      evaluateRps(choice, rpsPeerChoice);
    }
  }

  function evaluateRps(my, peer) {
    if (my === peer) {
      setRpsResult('draw');
    } else if (
      (my === 'rock' && peer === 'scissors') ||
      (my === 'paper' && peer === 'rock') ||
      (my === 'scissors' && peer === 'paper')
    ) {
      setRpsResult('win');
      setRpsScore(prev => ({ ...prev, wins: prev.wins + 1 }));
    } else {
      setRpsResult('lose');
      setRpsScore(prev => ({ ...prev, losses: prev.losses + 1 }));
    }
  }

  function resetRps() {
    setRpsMyChoice(null);
    setRpsPeerChoice(null);
    setRpsResult('');
    socket.emit('game_action', {
      gameType: 'rps',
      action: 'reset'
    });
  }

  return (
    <div className="glass-panel" style={styles.modalOverlay}>
      <div style={styles.modalContent}>
        
        {/* Header */}
        <div style={styles.header}>
          <div style={styles.titleGroup}>
            <Gamepad2 size={20} style={{ color: 'var(--accent-cyan)' }} />
            <span style={styles.title}>WhisperNet GameZone</span>
          </div>
          <button onClick={onClose} style={styles.closeBtn}>
            <X size={16} />
          </button>
        </div>

        {/* Invite alert */}
        {!activePeerConnected && (
          <div style={styles.warning}>
            Waiting for a friend to connect to this E2EE Room to play multiplayer...
          </div>
        )}

        {activeGame === null ? (
          // Main Menu Selection
          <div style={styles.menu}>
            <h3 style={styles.menuTitle}>Choose a Multiplayer E2EE Game</h3>
            <div style={styles.menuGrid}>
              
              <button 
                onClick={startTtt} 
                className="btn-secondary" 
                style={styles.gameCard}
                disabled={!activePeerConnected}
              >
                <div style={styles.gameCardIcon}>
                  <X size={24} style={{ color: 'var(--accent-cyber)', marginRight: 4 }} />
                  <Circle size={20} style={{ color: 'var(--accent-cyan)' }} />
                </div>
                <span style={styles.gameCardTitle}>Tic-Tac-Toe</span>
                <span style={styles.gameCardDesc}>Turn-based classic grid battle.</span>
              </button>

              <button 
                onClick={startRps} 
                className="btn-secondary" 
                style={styles.gameCard}
                disabled={!activePeerConnected}
              >
                <div style={styles.gameCardText}>✊ ✋ ✌️</div>
                <span style={styles.gameCardTitle}>Rock-Paper-Scissors</span>
                <span style={styles.gameCardDesc}>Simultaneous reveal showdown.</span>
              </button>

            </div>
          </div>
        ) : activeGame === 'tictactoe' ? (
          // Tic-Tac-Toe Engine UI
          <div style={styles.gameContainer}>
            <div style={styles.gameHeader}>
              <h3 style={styles.gameName}>Tic-Tac-Toe</h3>
              <div style={styles.scoreboard}>
                <span style={{ color: 'var(--accent-cyber)' }}>X ({tttSymbol === 'X' ? 'You' : 'Peer'}): {tttScores.X}</span>
                <span style={{ color: 'var(--accent-cyan)' }}>O ({tttSymbol === 'O' ? 'You' : 'Peer'}): {tttScores.O}</span>
              </div>
            </div>

            {/* Board */}
            <div style={styles.tttGrid}>
              {tttBoard.map((cell, index) => (
                <button
                  key={index}
                  onClick={() => handleTttCellClick(index)}
                  style={styles.tttCell}
                  disabled={tttBoard[index] || tttWinner || tttTurn !== mySenderId}
                >
                  {cell === 'X' && <X size={36} style={{ color: 'var(--accent-cyber)' }} />}
                  {cell === 'O' && <Circle size={30} style={{ color: 'var(--accent-cyan)' }} />}
                </button>
              ))}
            </div>

            {/* Turn Indicators & Actions */}
            <div style={styles.gameFooter}>
              {tttWinner ? (
                <div style={styles.winnerDisplay}>
                  <Trophy size={18} style={{ color: 'gold', marginRight: 6 }} />
                  <span>
                    {tttWinner === 'draw' ? "It's a draw!" : tttWinner === tttSymbol ? "You Won!" : "Partner Won!"}
                  </span>
                  <button onClick={resetTtt} className="btn-primary" style={styles.resetBtn}>
                    <RotateCcw size={14} /> Play Again
                  </button>
                </div>
              ) : (
                <div style={styles.turnIndicator}>
                  {tttTurn === mySenderId ? (
                    <span style={{ color: 'var(--accent-cyan)' }}>Your Turn! Select a cell.</span>
                  ) : (
                    <span style={{ color: 'var(--text-muted)' }}>Waiting for partner's move...</span>
                  )}
                </div>
              )}
            </div>
          </div>
        ) : (
          // Rock-Paper-Scissors Engine UI
          <div style={styles.gameContainer}>
            <div style={styles.gameHeader}>
              <h3 style={styles.gameName}>Rock-Paper-Scissors</h3>
              <div style={styles.scoreboard}>
                <span style={{ color: 'var(--accent-green)' }}>Wins: {rpsScore.wins}</span>
                <span style={{ color: 'var(--accent-danger)' }}>Losses: {rpsScore.losses}</span>
              </div>
            </div>

            {/* Choices */}
            <div style={styles.rpsChoices}>
              {!rpsMyChoice ? (
                <>
                  <button onClick={() => handleRpsChoice('rock')} style={styles.rpsBtn}>✊<br/><span style={styles.rpsBtnLabel}>Rock</span></button>
                  <button onClick={() => handleRpsChoice('paper')} style={styles.rpsBtn}>✋<br/><span style={styles.rpsBtnLabel}>Paper</span></button>
                  <button onClick={() => handleRpsChoice('scissors')} style={styles.rpsBtn}>✌️<br/><span style={styles.rpsBtnLabel}>Scissors</span></button>
                </>
              ) : (
                <div style={styles.rpsReveal}>
                  <div style={styles.revealBox}>
                    <span style={styles.revealLabel}>You Chose</span>
                    <span style={styles.revealEmoji}>
                      {rpsMyChoice === 'rock' ? '✊' : rpsMyChoice === 'paper' ? '✋' : '✌️'}
                    </span>
                  </div>
                  
                  <div style={styles.revealVs}>VS</div>

                  <div style={styles.revealBox}>
                    <span style={styles.revealLabel}>Partner Chose</span>
                    <span style={styles.revealEmoji}>
                      {!rpsPeerChoice ? <HelpCircle size={40} style={{ color: 'var(--text-muted)' }} /> : 
                       rpsResult ? (rpsPeerChoice === 'rock' ? '✊' : rpsPeerChoice === 'paper' ? '✋' : '✌️') : '❓'}
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Results Display */}
            <div style={styles.gameFooter}>
              {rpsResult ? (
                <div style={styles.winnerDisplay}>
                  <Trophy size={18} style={{ color: 'gold', marginRight: 6 }} />
                  <span style={{ textTransform: 'capitalize', fontWeight: 'bold' }}>
                    {rpsResult === 'draw' ? "It's a draw!" : rpsResult === 'win' ? "Victory is Yours!" : "Defeat!"}
                  </span>
                  <button onClick={resetRps} className="btn-primary" style={styles.resetBtn}>
                    <RotateCcw size={14} /> Play Again
                  </button>
                </div>
              ) : rpsMyChoice ? (
                <span style={{ color: 'var(--text-muted)' }}>Waiting for partner's choice...</span>
              ) : (
                <span style={{ color: 'var(--accent-cyan)' }}>Choose your weapon!</span>
              )}
            </div>
          </div>
        )}

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
    maxWidth: '440px',
    display: 'flex',
    flexDirection: 'column',
    gap: '20px',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottom: '1px solid var(--border-glass)',
    paddingBottom: '14px',
  },
  titleGroup: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  title: {
    fontSize: '1.1rem',
    fontWeight: '700',
    color: '#fff',
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    color: 'var(--text-muted)',
    cursor: 'pointer',
    padding: '4px',
  },
  warning: {
    background: 'rgba(245, 158, 11, 0.08)',
    border: '1px solid rgba(245, 158, 11, 0.2)',
    borderRadius: '8px',
    padding: '10px',
    fontSize: '0.8rem',
    color: 'hsl(38, 92%, 50%)',
    textAlign: 'center',
    lineHeight: '1.4',
  },
  menu: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
    textAlign: 'center',
  },
  menuTitle: {
    fontSize: '0.95rem',
    color: 'var(--text-secondary)',
    fontWeight: '500',
  },
  menuGrid: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  gameCard: {
    width: '100%',
    padding: '20px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    textAlign: 'center',
    borderRadius: '12px',
  },
  gameCardIcon: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: '12px',
  },
  gameCardText: {
    fontSize: '1.8rem',
    marginBottom: '12px',
  },
  gameCardTitle: {
    fontSize: '1rem',
    fontWeight: '700',
    color: '#fff',
    marginBottom: '4px',
  },
  gameCardDesc: {
    fontSize: '0.75rem',
    color: 'var(--text-muted)',
  },
  gameContainer: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '20px',
  },
  gameHeader: {
    width: '100%',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  gameName: {
    fontSize: '1.1rem',
    color: '#fff',
    fontWeight: '700',
  },
  scoreboard: {
    display: 'flex',
    gap: '12px',
    fontSize: '0.8rem',
    fontFamily: 'var(--font-mono)',
  },
  tttGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: '10px',
    width: '260px',
    height: '260px',
  },
  tttCell: {
    background: 'rgba(255, 255, 255, 0.02)',
    border: '1px solid var(--border-glass)',
    borderRadius: '10px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'var(--transition-smooth)',
  },
  gameFooter: {
    minHeight: '40px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
  winnerDisplay: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    fontSize: '0.95rem',
    color: '#fff',
    background: 'rgba(99, 102, 241, 0.1)',
    border: '1px solid var(--border-active)',
    padding: '8px 16px',
    borderRadius: '30px',
    animation: 'slide-up 0.3s ease-out forwards',
  },
  resetBtn: {
    padding: '6px 12px',
    fontSize: '0.75rem',
    marginLeft: '6px',
  },
  turnIndicator: {
    fontSize: '0.85rem',
    fontFamily: 'var(--font-mono)',
  },
  rpsChoices: {
    display: 'flex',
    justifyContent: 'center',
    gap: '14px',
    width: '100%',
    padding: '20px 0',
  },
  rpsBtn: {
    background: 'rgba(255, 255, 255, 0.02)',
    border: '1px solid var(--border-glass)',
    borderRadius: '12px',
    padding: '16px 20px',
    fontSize: '2rem',
    cursor: 'pointer',
    transition: 'var(--transition-smooth)',
    color: '#fff',
    flex: 1,
    maxWidth: '90px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '4px',
  },
  rpsBtnLabel: {
    fontSize: '0.75rem',
    fontWeight: '600',
    color: 'var(--text-secondary)',
  },
  rpsReveal: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    maxWidth: '320px',
    animation: 'slide-up 0.3s ease-out forwards',
  },
  revealBox: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '8px',
    flex: 1,
  },
  revealLabel: {
    fontSize: '0.75rem',
    color: 'var(--text-muted)',
  },
  revealEmoji: {
    fontSize: '2.5rem',
  },
  revealVs: {
    fontSize: '1.2rem',
    fontWeight: '800',
    fontFamily: 'var(--font-mono)',
    color: 'var(--accent-cyber)',
  }
};
