const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Determine database path (defaults to studyspark.db in the project root)
const dbPath = process.env.DATABASE_PATH || path.join(__dirname, 'studyspark.db');
const db = new DatabaseSync(dbPath);

// Enable foreign key constraints and WAL journal mode for performance
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
 * Initialize all database tables
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
 * Seed initial demo data for Jordan Carter (the initial profile)
 */
function seedDemoData() {
  const existingUser = db.prepare('SELECT id FROM users WHERE email = ?').get('jordan@example.com');
  if (!existingUser) {
    const demoUserId = 'user-demo-1';
    const pwdHash = hashPassword('password123');
    db.prepare(`
      INSERT INTO users (id, email, password_hash, name, course)
      VALUES (?, ?, ?, ?, ?)
    `).run(demoUserId, 'jordan@example.com', pwdHash, 'Jordan Carter', 'Biology 101 · Spring');

    // Seed progress for demo user
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

    // Seed sessions for demo user
    const insertSession = db.prepare(`
      INSERT INTO sessions (id, user_id, title, time, icon)
      VALUES (?, ?, ?, ?, ?)
    `);
    insertSession.run('session-1', demoUserId, 'Cell membranes & transport', 'Today', '▣');
    insertSession.run('session-2', demoUserId, 'Photosynthesis review', 'Yesterday', '✦');
    insertSession.run('session-3', demoUserId, 'Enzyme kinetics practice', 'Oct 28', '◒');
  }

  // Seed documents if empty
  const docCount = db.prepare('SELECT COUNT(*) as count FROM documents').get().count;
  if (docCount === 0) {
    const insertDoc = db.prepare(`
      INSERT INTO documents (id, user_id, name, chunks, status, content)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    insertDoc.run(
      'doc-1',
      null,
      'Biology 101 notes',
      12,
      'Ready',
      `Cell Membrane and Transport Mechanisms:
The plasma membrane is selectively permeable, composed of a phospholipid bilayer with hydrophilic heads facing outward and hydrophobic fatty acid tails facing inward.
Transport across the membrane can be passive or active.
Passive transport requires no cellular energy (ATP) and moves solutes down their concentration gradient (from high to low concentration).
Types of passive transport include simple diffusion (small nonpolar molecules like O2 and CO2), facilitated diffusion (using transmembrane proteins like aquaporins and ion channels), and osmosis (the net movement of water across a semipermeable membrane from low solute to high solute concentration).
Active transport requires ATP and transport proteins (such as the sodium-potassium pump, Na+/K+ ATPase) to move solutes against their electrochemical gradient.`
    );

    insertDoc.run(
      'doc-2',
      null,
      'Cell structure study guide',
      8,
      'Ready',
      `Eukaryotic Cell Structures and Organelles:
1. Nucleus: Stores genetic material (DNA) and directs cellular activity through transcription.
2. Ribosomes: Protein synthesis factories found free in cytosol or bound to rough endoplasmic reticulum.
3. Endoplasmic Reticulum: Rough ER synthesizes and folds proteins; smooth ER synthesizes lipids, metabolizes carbs, and detoxifies poisons.
4. Golgi Apparatus: Modifies, sorts, and packages proteins from the ER for secretion or intracellular delivery.
5. Mitochondria: Sites of cellular respiration, generating ATP through the Krebs cycle and oxidative phosphorylation.
6. Chloroplasts: Found in plant cells and algae, sites of photosynthesis where light energy is converted to chemical energy.`
    );

    insertDoc.run(
      'doc-3',
      null,
      'Enzymes & Metabolism summary',
      6,
      'Ready',
      `Enzymes and Reaction Kinetics:
Enzymes are biological catalysts, predominantly proteins, that accelerate chemical reactions by lowering activation energy without being consumed.
Substrates bind to the enzyme active site forming an enzyme-substrate complex via induced fit.
Factors affecting enzyme kinetics include temperature, pH, substrate concentration, and competitive/non-competitive inhibitors.`
    );
  }
}

// User & Auth operations
function createUser({ email, password, name, course = 'Biology 101 · Spring' }) {
  const id = `user-${crypto.randomUUID()}`;
  const passwordHash = hashPassword(password);
  db.prepare(`
    INSERT INTO users (id, email, password_hash, name, course)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, email.toLowerCase().trim(), passwordHash, name.trim(), course);

  // Initialize progress record
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

function createDocument({ userId = null, name, content = '', chunks = 1, status = 'Ready' }) {
  const id = `doc-${Date.now()}`;
  db.prepare(`
    INSERT INTO documents (id, user_id, name, chunks, status, content)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, userId, name, chunks, status, content);
  return { id, userId, name, chunks, status };
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
 * Retrieve passages from ingested documents matching a student question query.
 * Breaks stored document content into logical paragraphs/passages and ranks them
 * by keyword overlap score.
 * 
 * NOTE FOR FUTURE EXPANSION:
 * This retriever provides the interface where you can replace lexical keyword
 * ranking with dense vector embeddings 
 * (HuggingFace sentence-transformers, pgvector, or Chromadb/Faiss).
 */
function retrievePassages(query, userId = null, limit = 3) {
  const docs = db.prepare(`
    SELECT id, name, content
    FROM documents
    WHERE (user_id IS NULL OR user_id = ?) AND content IS NOT NULL
  `).all(userId || '');

  const terms = query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 2 && !['what', 'how', 'why', 'can', 'you', 'explain', 'tell', 'about', 'the', 'and', 'for', 'with'].includes(t));

  const allPassages = [];

  for (const doc of docs) {
    if (!doc.content) continue;
    // Split document into paragraphs/passages
    const paragraphs = doc.content
      .split(/\n\s*\n|\n(?=[0-9]+\.|\bTypes\b|\bFactors\b)/)
      .map(p => p.trim())
      .filter(p => p.length > 20);

    for (const para of paragraphs) {
      const lower = para.toLowerCase();
      let matchCount = 0;
      for (const term of terms) {
        if (lower.includes(term)) {
          matchCount++;
        }
      }

      // Calculate simple relevance score
      const score = terms.length > 0 ? Number((matchCount / terms.length).toFixed(2)) : 0.5;

      allPassages.push({
        documentId: doc.id,
        document: doc.name,
        score: Math.max(score, 0.4), // Base baseline score for relevant material
        text: para
      });
    }
  }

  // Sort by score descending
  allPassages.sort((a, b) => b.score - a.score);

  // Return top matches, or fallback default passages if query has low overlap
  const results = allPassages.slice(0, limit);
  if (results.length === 0 && docs.length > 0) {
    return [
      {
        documentId: docs[0].id,
        document: docs[0].name,
        score: 0.75,
        text: docs[0].content.slice(0, 250) + '...'
      }
    ];
  }

  return results;
}

// Initialize tables on load
initDatabase();

module.exports = {
  db,
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
  getProgress,
  incrementUserQuestions,
  saveChatMessage,
  getChatHistory,
  retrievePassages
};
