const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const rag = require('./rag');

// Determine database path (defaults to owlchemy.db in project root, with backward compatibility for studyspark.db)
function resolveDbPath() {
  if (process.env.DATABASE_PATH) return process.env.DATABASE_PATH;
  const owlDb = path.join(__dirname, 'owlchemy.db');
  const legacyDb = path.join(__dirname, 'studyspark.db');
  if (fs.existsSync(owlDb)) return owlDb;
  if (fs.existsSync(legacyDb)) return legacyDb;
  return owlDb;
}

const dbPath = resolveDbPath();
const db = new DatabaseSync(dbPath);

// Enable foreign key constraints for integrity
db.exec('PRAGMA foreign_keys = ON;');

/**
 * Hash a password with random salt using scrypt
 */
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

/**
 * Verify password against stored salt:hash
 */
function verifyPassword(password, storedHash) {
  try {
    const [salt, key] = storedHash.split(':');
    if (!salt || !key) return false;
    const hash = crypto.scryptSync(password, salt, 64).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(key, 'hex'), Buffer.from(hash, 'hex'));
  } catch (err) {
    return false;
  }
}

/**
 * Initialize all database tables for OwlChemy
 */
function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      course TEXT DEFAULT 'Biology 101 · Spring',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS auth_tokens (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      time TEXT NOT NULL,
      icon TEXT DEFAULT '▣',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      chunks INTEGER DEFAULT 1,
      status TEXT DEFAULT 'Ready',
      content TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS document_chunks (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      chunk_index INTEGER NOT NULL,
      content TEXT NOT NULL,
      char_count INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE,
      user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      citations TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS user_progress (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      streak INTEGER DEFAULT 7,
      questions INTEGER DEFAULT 48,
      mastery INTEGER DEFAULT 72,
      strengths TEXT DEFAULT '["Cell biology", "Scientific reasoning"]',
      focus TEXT DEFAULT 'Membrane transport',
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  seedDemoData();
}

/**
 * Seed initial demo data for Jordan Carter & sample Biology 101 course notes
 */
function seedDemoData() {
  const existingUser = db.prepare('SELECT id FROM users WHERE email = ?').get('jordan@example.com');
  let demoUserId = 'user-demo-1';

  if (!existingUser) {
    const pwdHash = hashPassword('password123');
    db.prepare(`
      INSERT INTO users (id, email, password_hash, name, course)
      VALUES (?, ?, ?, ?, ?)
    `).run(demoUserId, 'jordan@example.com', pwdHash, 'Jordan Carter', 'Biology 101 · Spring');

    db.prepare(`
      INSERT INTO user_progress (user_id, streak, questions, mastery, strengths, focus)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      demoUserId,
      7,
      48,
      72,
      JSON.stringify(['Cell biology', 'Scientific reasoning']),
      'Membrane transport'
    );

    const insertSession = db.prepare(`
      INSERT INTO sessions (id, user_id, title, time, icon)
      VALUES (?, ?, ?, ?, ?)
    `);
    insertSession.run('session-1', demoUserId, 'Cell membranes & transport', 'Today', '▣');
    insertSession.run('session-2', demoUserId, 'Photosynthesis review', 'Yesterday', '✦');
    insertSession.run('session-3', demoUserId, 'Enzyme kinetics practice', 'Oct 28', '◒');
  } else {
    demoUserId = existingUser.id;
  }

  // Seed documents if empty
  const docCount = db.prepare('SELECT COUNT(*) as count FROM documents').get().count;
  if (docCount === 0) {
    insertDocumentWithChunks({
      id: 'doc-1',
      userId: null,
      name: 'Biology 101 notes',
      content: `Cell Membrane and Transport Mechanisms:
The plasma membrane is selectively permeable, composed of a phospholipid bilayer with hydrophilic heads facing outward and hydrophobic fatty acid tails facing inward.
Transport across the membrane can be passive or active.
Passive transport requires no cellular energy (ATP) and moves solutes down their concentration gradient (from high to low concentration).
Types of passive transport include simple diffusion (small nonpolar molecules like O2 and CO2), facilitated diffusion (using transmembrane proteins like aquaporins and ion channels), and osmosis (the net movement of water across a semipermeable membrane from low solute to high solute concentration).
Active transport requires ATP and transport proteins (such as the sodium-potassium pump, Na+/K+ ATPase) to move solutes against their electrochemical gradient.`
    });

    insertDocumentWithChunks({
      id: 'doc-2',
      userId: null,
      name: 'Cell structure study guide',
      content: `Eukaryotic Cell Structures and Organelles:
1. Nucleus: Stores genetic material (DNA) and directs cellular activity through transcription.
2. Ribosomes: Protein synthesis factories found free in cytosol or bound to rough endoplasmic reticulum.
3. Endoplasmic Reticulum: Rough ER synthesizes and folds proteins; smooth ER synthesizes lipids, metabolizes carbs, and detoxifies poisons.
4. Golgi Apparatus: Modifies, sorts, and packages proteins from the ER for secretion or intracellular delivery.
5. Mitochondria: Sites of cellular respiration, generating ATP through the Krebs cycle and oxidative phosphorylation.
6. Chloroplasts: Found in plant cells and algae, sites of photosynthesis where light energy is converted to chemical energy.`
    });

    insertDocumentWithChunks({
      id: 'doc-3',
      userId: null,
      name: 'Enzymes & Metabolism summary',
      content: `Enzymes and Reaction Kinetics:
Enzymes are biological catalysts, predominantly proteins, that accelerate chemical reactions by lowering activation energy without being consumed.
Substrates bind to the enzyme active site forming an enzyme-substrate complex via induced fit.
Factors affecting enzyme kinetics include temperature, pH, substrate concentration, and competitive/non-competitive inhibitors.`
    });
  } else {
    // Backfill chunks if document_chunks table is empty
    const chunkCount = db.prepare('SELECT COUNT(*) as count FROM document_chunks').get().count;
    if (chunkCount === 0) {
      const existingDocs = db.prepare('SELECT id, content FROM documents WHERE content IS NOT NULL').all();
      for (const d of existingDocs) {
        if (!d.content) continue;
        const chunks = rag.chunkText(d.content);
        for (const c of chunks) {
          db.prepare(`
            INSERT INTO document_chunks (id, document_id, chunk_index, content, char_count)
            VALUES (?, ?, ?, ?, ?)
          `).run(`chunk-${d.id}-${c.chunkIndex}`, d.id, c.chunkIndex, c.content, c.charCount);
        }
        db.prepare('UPDATE documents SET chunks = ? WHERE id = ?').run(chunks.length, d.id);
      }
    }
  }
}

/**
 * Internal helper to insert a document and index all of its RAG chunks
 */
function insertDocumentWithChunks({ id = null, userId = null, name, content, status = 'Ready' }) {
  const docId = id || `doc-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
  const cleanContent = rag.cleanText(content);
  const chunks = rag.chunkText(cleanContent);

  db.prepare(`
    INSERT INTO documents (id, user_id, name, chunks, status, content)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(docId, userId, name, chunks.length, status, cleanContent);

  const insertChunkStmt = db.prepare(`
    INSERT INTO document_chunks (id, document_id, chunk_index, content, char_count)
    VALUES (?, ?, ?, ?, ?)
  `);

  for (const c of chunks) {
    const chunkId = `chunk-${docId}-${c.chunkIndex}`;
    insertChunkStmt.run(chunkId, docId, c.chunkIndex, c.content, c.charCount);
  }

  return {
    id: docId,
    userId,
    name,
    chunks: chunks.length,
    status
  };
}

// User & Auth operations
function createUser({ email, password, name, course = 'Biology 101 · Spring' }) {
  const id = `user-${crypto.randomUUID()}`;
  const passwordHash = hashPassword(password);
  db.prepare(`
    INSERT INTO users (id, email, password_hash, name, course)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, email.toLowerCase().trim(), passwordHash, name.trim(), course);

  db.prepare(`
    INSERT INTO user_progress (user_id, streak, questions, mastery, strengths, focus)
    VALUES (?, 1, 0, 0, ?, ?)
  `).run(id, JSON.stringify(['Course basics']), 'Introduction & key terms');

  return { id, email: email.toLowerCase().trim(), name: name.trim(), course };
}

function findUserByEmail(email) {
  return db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase().trim());
}

function findUserById(id) {
  const user = db.prepare('SELECT id, email, name, course, created_at FROM users WHERE id = ?').get(id);
  return user || null;
}

function createAuthToken(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO auth_tokens (token, user_id) VALUES (?, ?)').run(token, userId);
  return token;
}

function findUserByToken(token) {
  if (!token) return null;
  const row = db.prepare(`
    SELECT u.id, u.email, u.name, u.course, u.created_at
    FROM auth_tokens a
    JOIN users u ON a.user_id = u.id
    WHERE a.token = ?
  `).get(token);
  return row || null;
}

function deleteAuthToken(token) {
  if (!token) return;
  db.prepare('DELETE FROM auth_tokens WHERE token = ?').run(token);
}

// Study sessions
function getSessions(userId) {
  return db.prepare(`
    SELECT id, title, time, icon, created_at
    FROM sessions
    WHERE user_id = ?
    ORDER BY created_at DESC
  `).all(userId);
}

function createSession({ userId, title, icon = '▣', time = 'Just now' }) {
  const id = `session-${Date.now()}`;
  db.prepare(`
    INSERT INTO sessions (id, user_id, title, time, icon)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, userId, title, time, icon);
  return { id, userId, title, time, icon };
}

// Course documents & materials
function getDocuments(userId = null) {
  if (userId) {
    return db.prepare(`
      SELECT id, name, chunks, status, created_at
      FROM documents
      WHERE user_id IS NULL OR user_id = ?
      ORDER BY created_at ASC
    `).all(userId);
  }
  return db.prepare(`
    SELECT id, name, chunks, status, created_at
    FROM documents
    ORDER BY created_at ASC
  `).all();
}

function createDocument({ userId = null, name, content = '', status = 'Ready' }) {
  return insertDocumentWithChunks({ userId, name, content, status });
}

function deleteDocument(docId, userId = null) {
  if (userId) {
    const doc = db.prepare('SELECT id, user_id FROM documents WHERE id = ?').get(docId);
    if (!doc || (doc.user_id && doc.user_id !== userId)) {
      return false;
    }
  }
  db.prepare('DELETE FROM documents WHERE id = ?').run(docId);
  return true;
}

function getDocumentChunks(documentId) {
  return db.prepare(`
    SELECT id, document_id, chunk_index, content, char_count
    FROM document_chunks
    WHERE document_id = ?
    ORDER BY chunk_index ASC
  `).all(documentId);
}

// User learning progress
function getProgress(userId) {
  const row = db.prepare('SELECT * FROM user_progress WHERE user_id = ?').get(userId);
  if (!row) {
    return {
      streak: 1,
      questions: 0,
      mastery: 0,
      strengths: ['Cell biology'],
      focus: 'Introduction & key terms'
    };
  }
  return {
    streak: row.streak,
    questions: row.questions,
    mastery: row.mastery,
    strengths: typeof row.strengths === 'string' ? JSON.parse(row.strengths) : row.strengths,
    focus: row.focus
  };
}

function incrementUserQuestions(userId) {
  if (!userId) return;
  db.prepare(`
    UPDATE user_progress
    SET questions = questions + 1,
        updated_at = CURRENT_TIMESTAMP
    WHERE user_id = ?
  `).run(userId);
}

// Chat messages persistence
function saveChatMessage({ id = null, sessionId = null, userId = null, role, content, citations = [] }) {
  const msgId = id || `msg-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  db.prepare(`
    INSERT INTO chat_messages (id, session_id, user_id, role, content, citations)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(msgId, sessionId, userId, role, content, JSON.stringify(citations));
  return { id: msgId, sessionId, userId, role, content, citations };
}

function getChatHistory(sessionId) {
  if (!sessionId) return [];
  const rows = db.prepare(`
    SELECT id, role, content, citations, created_at
    FROM chat_messages
    WHERE session_id = ?
    ORDER BY created_at ASC
  `).all(sessionId);
  return rows.map(r => ({
    ...r,
    citations: r.citations ? JSON.parse(r.citations) : []
  }));
}

/**
 * Retrieve passages from ingested course document chunks matching a student query.
 * Leverages the BM25-based chunk scoring engine in rag.js.
 */
function retrievePassages(query, userId = null, limit = 3) {
  // Query all candidate chunks for available documents (global + user)
  const candidateChunks = db.prepare(`
    SELECT 
      c.id,
      c.document_id AS documentId,
      d.name AS documentName,
      c.chunk_index AS chunkIndex,
      c.content
    FROM document_chunks c
    JOIN documents d ON c.document_id = d.id
    WHERE (d.user_id IS NULL OR d.user_id = ?)
  `).all(userId || '');

  // If no chunks in database, return empty
  if (!candidateChunks || candidateChunks.length === 0) {
    return [];
  }

  // Use RAG ranker to score and pick top passages
  const ranked = rag.rankPassages(query, candidateChunks, { limit, minScore: 0.15 });

  // Fallback if score threshold filtered everything out
  if (ranked.length === 0 && candidateChunks.length > 0) {
    const first = candidateChunks[0];
    return [{
      documentId: first.documentId,
      document: first.documentName,
      chunkIndex: first.chunkIndex,
      score: 0.5,
      text: first.content
    }];
  }

  return ranked;
}

// Initialize tables on load
initDatabase();

module.exports = {
  db,
  dbPath,
  hashPassword,
  verifyPassword,
  createUser,
  findUserByEmail,
  findUserById,
  createAuthToken,
  findUserByToken,
  deleteAuthToken,
  getSessions,
  createSession,
  getDocuments,
  createDocument,
  deleteDocument,
  getDocumentChunks,
  getProgress,
  incrementUserQuestions,
  saveChatMessage,
  getChatHistory,
  retrievePassages
};
