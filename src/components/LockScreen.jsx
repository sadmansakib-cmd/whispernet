// LockScreen Component
// Prompts user for Master Password. Handles cryptographic login and duress panic codes.
// Features premium glassmorphism and Commander Sadman creator badges.

import React, { useState, useEffect } from 'react';
import { Shield, Lock, Trash2, ArrowRight } from 'lucide-react';
import { deriveKey, encryptText, decryptText, generateSalt } from '../crypto';
import { getSetting, saveSetting, panicWipeDatabase } from '../db';

export default function LockScreen({ onUnlock }) {
  const [isSetup, setIsSetup] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [panicCode, setPanicCode] = useState('');
  
  const [inputPassword, setInputPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    checkDatabaseState();
  }, []);

  async function checkDatabaseState() {
    try {
      const verificationRecord = await getSetting('login_verification');
      if (!verificationRecord) {
        setIsSetup(true); // No password set, direct to setup
      }
    } catch (err) {
      console.error("Failed to read login status:", err);
    }
  }

  // Handle Master Password Registration
  async function handleSetup(e) {
    e.preventDefault();
    setError('');
    
    if (password.length < 6) {
      setError('Master Password must be at least 6 characters.');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setIsLoading(true);
    try {
      // 1. Generate unique salts for the local device
      const masterSalt = generateSalt();
      await saveSetting('master_salt', masterSalt);

      // 2. Derive cryptographic key
      const key = await deriveKey(password, masterSalt);

      // 3. Create login verification token
      // We encrypt a constant text. If we can decrypt it later, the password is correct.
      const ciphertext = await encryptText("WHISPERNET_VERIFIED", key);
      await saveSetting('login_verification', ciphertext);

      // 4. Save panic duress password if provided
      if (panicCode.trim()) {
        await saveSetting('panic_code_hashed', panicCode.trim());
      }

      onUnlock(key, password);
    } catch (err) {
      setError('Failed to configure E2EE database.');
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  }

  // Handle Secure Login / Decryption
  async function handleLogin(e) {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      // 1. Check Duress/Panic Password first!
      const duressCode = await getSetting('panic_code_hashed');
      if (duressCode && inputPassword === duressCode) {
        // duress triggered! Perform immediate data zeroization.
        await panicWipeDatabase();
        window.location.replace("https://www.google.com"); // Redirection to decoy
        return;
      }

      // 2. Standard Login
      const masterSalt = await getSetting('master_salt');
      const verificationRecord = await getSetting('login_verification');

      if (!masterSalt || !verificationRecord) {
        setError('Database corrupted. Wipe required.');
        setIsLoading(false);
        return;
      }

      // Derive key from input password
      const testKey = await deriveKey(inputPassword, masterSalt);

      // Attempt to decrypt the verification constant
      const decrypted = await decryptText(verificationRecord, testKey);

      if (decrypted === "WHISPERNET_VERIFIED") {
        onUnlock(testKey, inputPassword);
      } else {
        setError('Incorrect Master Password.');
      }
    } catch (err) {
      setError('Access Denied. Incorrect password.');
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div style={styles.container}>
      <div className="glass-panel" style={styles.panel}>
        
        {/* Creator Credit Badge */}
        <div style={styles.header}>
          <div className="sadman-creator-badge">
            <Shield size={12} style={{ color: 'var(--accent-cyan)' }} />
            Engine Design: <span>Commander Sadman</span>
          </div>
        </div>

        <div style={styles.titleWrapper}>
          <h1 style={styles.title}>WhisperNet</h1>
          <p style={styles.subtitle}>Zero-Knowledge Crypto-Relay</p>
        </div>

        {isSetup ? (
          // Registration Form
          <form onSubmit={handleSetup} style={styles.form}>
            <div style={styles.infoBox}>
              <Shield size={16} style={{ color: 'var(--accent-cyan)', marginRight: 8 }} />
              <span>Create your offline E2EE Master Password. There is no cloud recovery.</span>
            </div>

            <div style={styles.inputGroup}>
              <label style={styles.label}>Set Master Password</label>
              <div style={styles.inputWrapper}>
                <Lock size={16} style={styles.inputIcon} />
                <input
                  type="password"
                  className="glass-input"
                  style={styles.input}
                  placeholder="Minimum 6 characters"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={isLoading}
                  required
                />
              </div>
            </div>

            <div style={styles.inputGroup}>
              <label style={styles.label}>Confirm Password</label>
              <div style={styles.inputWrapper}>
                <Lock size={16} style={styles.inputIcon} />
                <input
                  type="password"
                  className="glass-input"
                  style={styles.input}
                  placeholder="Repeat Master Password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  disabled={isLoading}
                  required
                />
              </div>
            </div>

            <div style={styles.inputGroup}>
              <label style={styles.label}>Panic Password (Optional Duress Action)</label>
              <div style={styles.inputWrapper}>
                <Trash2 size={16} style={{ ...styles.inputIcon, color: 'var(--accent-danger)' }} />
                <input
                  type="text"
                  className="glass-input"
                  style={styles.input}
                  placeholder="e.g. WIPE123 (Wipes DB if entered at login)"
                  value={panicCode}
                  onChange={(e) => setPanicCode(e.target.value)}
                  disabled={isLoading}
                />
              </div>
            </div>

            {error && <div style={styles.error}>{error}</div>}

            <button type="submit" className="btn-primary" style={styles.button} disabled={isLoading}>
              {isLoading ? 'Creating Secure Engine...' : 'Initialize Secure Workspace'}
              <ArrowRight size={16} />
            </button>
          </form>
        ) : (
          // Login Form
          <form onSubmit={handleLogin} style={styles.form}>
            <div style={styles.inputGroup}>
              <label style={styles.label}>Enter Master Password</label>
              <div style={styles.inputWrapper}>
                <Lock size={16} style={styles.inputIcon} />
                <input
                  type="password"
                  className="glass-input"
                  style={styles.input}
                  placeholder="Decrypt Local Storage..."
                  value={inputPassword}
                  onChange={(e) => setInputPassword(e.target.value)}
                  disabled={isLoading}
                  autoFocus
                  required
                />
              </div>
            </div>

            {error && <div style={styles.error}>{error}</div>}

            <button type="submit" className="btn-primary" style={styles.button} disabled={isLoading}>
              {isLoading ? 'Decrypting Vault...' : 'Unlock Secure Vault'}
              <ArrowRight size={16} />
            </button>

            <div style={styles.wipeHelper}>
              <p>Under duress? Enter your Panic Password to instantly delete all local data.</p>
            </div>
          </form>
        )}
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
    background: 'radial-gradient(circle at center, hsl(225, 20%, 10%) 0%, hsl(225, 30%, 4%) 100%)',
    padding: '20px',
  },
  panel: {
    width: '100%',
    maxWidth: '440px',
    padding: '40px',
    animation: 'slide-up 0.5s ease-out forwards',
  },
  header: {
    display: 'flex',
    justifyContent: 'center',
    marginBottom: '24px',
  },
  titleWrapper: {
    textAlign: 'center',
    marginBottom: '32px',
  },
  title: {
    fontFamily: 'var(--font-sans)',
    fontSize: '2.5rem',
    fontWeight: '800',
    letterSpacing: '-0.02em',
    color: '#fff',
    textShadow: '0 0 20px rgba(99, 102, 241, 0.2)',
  },
  subtitle: {
    fontSize: '0.9rem',
    color: 'var(--accent-cyan)',
    fontFamily: 'var(--font-mono)',
    marginTop: '4px',
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '20px',
  },
  infoBox: {
    display: 'flex',
    alignItems: 'center',
    padding: '12px',
    background: 'rgba(6, 182, 212, 0.05)',
    border: '1px solid rgba(6, 182, 212, 0.15)',
    borderRadius: '8px',
    fontSize: '0.8rem',
    color: 'var(--text-secondary)',
    lineHeight: '1.4',
  },
  inputGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  label: {
    fontSize: '0.85rem',
    fontWeight: '500',
    color: 'var(--text-secondary)',
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
    paddingLeft: '44px',
  },
  button: {
    marginTop: '8px',
    width: '100%',
  },
  error: {
    color: 'var(--accent-danger)',
    fontSize: '0.85rem',
    textAlign: 'center',
    background: 'rgba(239, 68, 68, 0.08)',
    border: '1px solid rgba(239, 68, 68, 0.2)',
    padding: '10px',
    borderRadius: '8px',
  },
  wipeHelper: {
    textAlign: 'center',
    fontSize: '0.75rem',
    color: 'var(--text-muted)',
    marginTop: '16px',
    lineHeight: '1.4',
  }
};
