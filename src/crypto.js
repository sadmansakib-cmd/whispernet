// WhisperNet Cryptographic Core
// Designed for high-performance, hardware-accelerated E2EE client-side cryptography.
// Implements PBKDF2 for key derivation and AES-GCM-256 for symmetric encryption.

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// Helper to convert ArrayBuffer to Base64
export function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// Helper to convert Base64 to ArrayBuffer
export function base64ToArrayBuffer(base64) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

// Helper to convert hex string to ArrayBuffer (for PBKDF2 salts)
export function hexToArrayBuffer(hex) {
  if (hex.length % 2 !== 0) hex = '0' + hex;
  const numBytes = hex.length / 2;
  const byteArray = new Uint8Array(numBytes);
  for (let i = 0; i < numBytes; i++) {
    byteArray[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return byteArray.buffer;
}

// Helper to convert ArrayBuffer to hex
export function arrayBufferToHex(buffer) {
  return Array.prototype.map.call(new Uint8Array(buffer), x => ('00' + x.toString(16)).slice(-2)).join('');
}

// Generate a random cryptographic salt (hex representation)
export function generateSalt(lengthBytes = 16) {
  const salt = window.crypto.getRandomValues(new Uint8Array(lengthBytes));
  return arrayBufferToHex(salt.buffer);
}

/**
 * Derives a 256-bit AES-GCM CryptoKey from a human-readable passphrase and salt.
 * Uses PBKDF2 with SHA-256 and 100,000 iterations.
 */
export async function deriveKey(passphrase, saltHex) {
  try {
    const rawPassword = encoder.encode(passphrase);
    const saltBuffer = hexToArrayBuffer(saltHex);

    // Import the passphrase as a raw key
    const baseKey = await window.crypto.subtle.importKey(
      "raw",
      rawPassword,
      { name: "PBKDF2" },
      false,
      ["deriveKey"]
    );

    // Derive the final AES-GCM 256-bit key
    return await window.crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt: saltBuffer,
        iterations: 100000,
        hash: "SHA-256"
      },
      baseKey,
      { name: "AES-GCM", length: 256 },
      false, // Key is non-extractable from RAM for security
      ["encrypt", "decrypt"]
    );
  } catch (error) {
    console.error("Key derivation failed:", error);
    throw new Error("Failed to secure active cryptographic keys.");
  }
}

/**
 * Encrypts a plaintext string using an AES-GCM key.
 * Prepends a 12-byte random IV to the ciphertext.
 * Returns a Base64-encoded string containing both IV and ciphertext.
 */
export async function encryptText(plaintext, cryptoKey) {
  try {
    const rawPlaintext = encoder.encode(plaintext);
    const iv = window.crypto.getRandomValues(new Uint8Array(12)); // 12-byte IV for GCM

    const ciphertext = await window.crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv: iv
      },
      cryptoKey,
      rawPlaintext
    );

    // Prepend the IV to the ciphertext
    const combinedBuffer = new Uint8Array(iv.byteLength + ciphertext.byteLength);
    combinedBuffer.set(iv, 0);
    combinedBuffer.set(new Uint8Array(ciphertext), iv.byteLength);

    return arrayBufferToBase64(combinedBuffer.buffer);
  } catch (error) {
    console.error("Encryption failed:", error);
    throw new Error("Cryptographic encryption failure.");
  }
}

/**
 * Decrypts a Base64 string (IV + Ciphertext) using an AES-GCM key.
 * Returns the decrypted plaintext string.
 */
export async function decryptText(encryptedBase64, cryptoKey) {
  try {
    const combinedBuffer = new Uint8Array(base64ToArrayBuffer(encryptedBase64));

    // Extract the 12-byte IV and the ciphertext
    const iv = combinedBuffer.slice(0, 12);
    const ciphertext = combinedBuffer.slice(12);

    const decryptedBuffer = await window.crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: iv
      },
      cryptoKey,
      ciphertext.buffer
    );

    return decoder.decode(decryptedBuffer);
  } catch (error) {
    console.error("Decryption failed:", error);
    throw new Error("Failed to decrypt ciphertext. Wrong password or corrupted file.");
  }
}

/**
 * Encrypts a binary ArrayBuffer using an AES-GCM key.
 * Prepends a 12-byte IV to the ciphertext.
 * Returns an ArrayBuffer containing [IV, Ciphertext].
 */
export async function encryptBinary(arrayBuffer, cryptoKey) {
  try {
    const iv = window.crypto.getRandomValues(new Uint8Array(12));

    const ciphertext = await window.crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv: iv
      },
      cryptoKey,
      arrayBuffer
    );

    // Assemble IV and Ciphertext
    const combined = new Uint8Array(iv.byteLength + ciphertext.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(ciphertext), iv.byteLength);

    return combined.buffer;
  } catch (error) {
    console.error("Binary encryption failed:", error);
    throw new Error("Cryptographic file encryption failed.");
  }
}

/**
 * Decrypts an encrypted ArrayBuffer containing [IV, Ciphertext] using an AES-GCM key.
 * Returns the original decrypted ArrayBuffer.
 */
export async function decryptBinary(encryptedArrayBuffer, cryptoKey) {
  try {
    const combined = new Uint8Array(encryptedArrayBuffer);
    const iv = combined.slice(0, 12);
    const ciphertext = combined.slice(12);

    return await window.crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: iv
      },
      cryptoKey,
      ciphertext.buffer
    );
  } catch (error) {
    console.error("Binary decryption failed:", error);
    throw new Error("Failed to decrypt file payload.");
  }
}

// Memory zeroization utility to overwrite sensitive buffers before disposal
export function zeroizeBuffer(array) {
  if (array && array.fill) {
    array.fill(0);
  }
}
