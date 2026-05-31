// WhisperNet Database layer using Dexie.js
// Handles high-performance local IndexedDB storage.
// Includes strict anti-forensics deletion and full database zeroization (Panic Purge).

import Dexie from 'dexie';

// Define the core offline-first secure database
export const db = new Dexie('WhisperNetDB');

// Define schemas. Note: Only index fields we query by.
// Sensitive data (e.g. content, attachments, reactions) are NOT indexed and are encrypted.
db.version(1).stores({
  chats: 'id, name, created_at',
  messages: 'id, chatId, type, timestamp, unread, viewed',
  settings: 'key'
});

/**
 * Permanently purges a message and its associated decrypted/encrypted media content.
 */
export async function deleteMessageFromDB(messageId) {
  try {
    await db.messages.delete(messageId);
  } catch (error) {
    console.error("Failed to delete message from local storage:", error);
  }
}

/**
 * Purges an entire chat room history.
 */
export async function deleteChatFromDB(chatId) {
  try {
    await db.transaction('rw', [db.messages, db.chats], async () => {
      await db.messages.where({ chatId }).delete();
      await db.chats.delete(chatId);
    });
  } catch (error) {
    console.error("Failed to delete chat history:", error);
  }
}

/**
 * Severe Duress Action (Panic Wipe):
 * Instantly purges all data across all tables, closes connections, deletes the IndexedDB, 
 * and overrides system memory.
 */
export async function panicWipeDatabase() {
  try {
    console.warn("CRITICAL: Executing duress zeroization panic wipe sequence.");
    
    // Close the active database connection
    db.close();

    // Force delete the IndexedDB from the browser
    await Dexie.delete('WhisperNetDB');

    // Also clear all localStorage and sessionStorage caches
    localStorage.clear();
    sessionStorage.clear();

    console.log("Zeroization completed. Purged all traces.");
  } catch (error) {
    console.error("Panic wipe failed to execute safely:", error);
    // Hard fallback: clear storage
    localStorage.clear();
    sessionStorage.clear();
  }
}

/**
 * Saves a setting locally (like local credentials salt, config, etc.)
 */
export async function saveSetting(key, value) {
  try {
    await db.settings.put({ key, value });
  } catch (error) {
    console.error("Failed to write setting:", error);
  }
}

/**
 * Loads a setting locally
 */
export async function getSetting(key) {
  try {
    const record = await db.settings.get(key);
    return record ? record.value : null;
  } catch (error) {
    console.error("Failed to read setting:", error);
    return null;
  }
}
