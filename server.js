const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

// Load environment variables from .env file if present
function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    try {
      const content = fs.readFileSync(envPath, 'utf8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx !== -1) {
          const key = trimmed.slice(0, eqIdx).trim();
          let val = trimmed.slice(eqIdx + 1).trim();
          if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
          }
          if (process.env[key] === undefined) {
            process.env[key] = val;
          }
        }
      }
    } catch (err) {
      console.warn('Could not read .env file:', err.message);
    }
  }
}
loadEnv();

// Import database, RAG pipeline, and LLM services
const db = require('./db');
const rag = require('./rag');
const { generateOwlChemyResponse } = require('./llm');

const port = process.env.PORT || 3000;
const publicDir = path.join(__dirname, 'public');

function json(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS'
  });
  res.end(JSON.stringify(data));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      // Safeguard against gigantic uploads (15MB limit)
      if (body.length > 15 * 1024 * 1024) {
        req.destroy();
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(new Error('Invalid JSON payload'));
      }
    });
    req.on('error', reject);
  });
}

/**
 * Extract authenticated user from Authorization header (Bearer token)
 */
function getAuthUser(req) {
  const authHeader = req.headers['authorization'] || '';
  if (authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    if (token) {
      const user = db.findUserByToken(token);
      if (user) return { user, token };
    }
  }
  return { user: null, token: null };
}

async function handleApi(req, res, url) {
  // CORS Preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS'
    });
    return res.end();
  }

  const { user, token } = getAuthUser(req);
  const fallbackDemoUser = db.findUserByEmail('jordan@example.com');
  const activeUser = user || fallbackDemoUser;

  // --------------------------------------------------------------------------
  // Health check
  // --------------------------------------------------------------------------
  if (req.method === 'GET' && url.pathname === '/api/health') {
    return json(res, 200, {
      ok: true,
      service: 'owlchemy-api',
      database: 'sqlite-connected',
      authenticated: !!user
    });
  }

  // --------------------------------------------------------------------------
  // User Authentication Endpoints
  // --------------------------------------------------------------------------
  
  // Register a new user
  if (req.method === 'POST' && url.pathname === '/api/auth/register') {
    const body = await parseBody(req);
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    const name = String(body.name || '').trim();
    const course = String(body.course || 'Biology 101 · Spring').trim();

    if (!email || !password || !name) {
      return json(res, 400, { error: 'Name, email, and password are required' });
    }
    if (password.length < 6) {
      return json(res, 400, { error: 'Password must be at least 6 characters long' });
    }

    const existing = db.findUserByEmail(email);
    if (existing) {
      return json(res, 409, { error: 'An account with this email already exists' });
    }

    try {
      const newUser = db.createUser({ email, password, name, course });
      const authToken = db.createAuthToken(newUser.id);
      return json(res, 201, {
        ok: true,
        user: { id: newUser.id, email: newUser.email, name: newUser.name, course: newUser.course },
        token: authToken
      });
    } catch (err) {
      return json(res, 500, { error: 'Could not create user account', detail: err.message });
    }
  }

  // Log in existing user
  if (req.method === 'POST' && url.pathname === '/api/auth/login') {
    const body = await parseBody(req);
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');

    if (!email || !password) {
      return json(res, 400, { error: 'Email and password are required' });
    }

    const userRecord = db.findUserByEmail(email);
    if (!userRecord || !db.verifyPassword(password, userRecord.password_hash)) {
      return json(res, 401, { error: 'Invalid email or password' });
    }

    const authToken = db.createAuthToken(userRecord.id);
    return json(res, 200, {
      ok: true,
      user: {
        id: userRecord.id,
        email: userRecord.email,
        name: userRecord.name,
        course: userRecord.course
      },
      token: authToken
    });
  }

  // Get current authenticated user profile
  if (req.method === 'GET' && url.pathname === '/api/auth/me') {
    if (!user) {
      return json(res, 401, { error: 'Not authenticated', user: null });
    }
    return json(res, 200, { ok: true, user });
  }

  // Log out current user
  if (req.method === 'POST' && url.pathname === '/api/auth/logout') {
    if (token) {
      db.deleteAuthToken(token);
    }
    return json(res, 200, { ok: true, message: 'Logged out successfully' });
  }

  // --------------------------------------------------------------------------
  // Study Sessions (Database-backed)
  // --------------------------------------------------------------------------
  if (req.method === 'GET' && url.pathname === '/api/sessions') {
    const sessions = db.getSessions(activeUser.id);
    return json(res, 200, { sessions });
  }

  if (req.method === 'POST' && url.pathname === '/api/sessions') {
    const body = await parseBody(req);
    const title = String(body.title || 'Untitled session').trim();
    const icon = String(body.icon || '▣');
    const newSession = db.createSession({ userId: activeUser.id, title, icon });
    return json(res, 201, { session: newSession });
  }

  // --------------------------------------------------------------------------
  // Course Materials & RAG Document Ingestion
  // --------------------------------------------------------------------------
  if (req.method === 'GET' && url.pathname === '/api/documents') {
    const documents = db.getDocuments(activeUser.id);
    return json(res, 200, { documents });
  }

  // View chunks of a specific document
  if (req.method === 'GET' && url.pathname === '/api/documents/chunks') {
    const docId = url.searchParams.get('id');
    if (!docId) return json(res, 400, { error: 'Document id is required' });
    const chunks = db.getDocumentChunks(docId);
    return json(res, 200, { chunks });
  }

  // Add document by direct text or note
  if (req.method === 'POST' && url.pathname === '/api/documents') {
    const body = await parseBody(req);
    const name = String(body.name || 'Untitled course material').trim();
    const rawContent = String(body.content || '').trim();

    if (!rawContent) {
      return json(res, 400, { error: 'Document content is required' });
    }

    const document = db.createDocument({
      userId: activeUser.id,
      name,
      content: rawContent,
      status: 'Ready'
    });

    return json(res, 201, {
      document,
      message: `Successfully ingested "${name}" and generated ${document.chunks} searchable passage chunks.`
    });
  }

  // Upload document file (Text, Markdown, or PDF encoded as base64 or string)
  if (req.method === 'POST' && url.pathname === '/api/documents/upload') {
    const body = await parseBody(req);
    const filename = String(body.filename || body.name || 'Course note.txt').trim();
    const fileData = body.fileData || body.content || '';

    let extractedText = '';
    if (body.base64) {
      const buffer = Buffer.from(fileData, 'base64');
      extractedText = rag.extractText(buffer, filename);
    } else {
      extractedText = rag.extractText(fileData, filename);
    }

    if (!extractedText || extractedText.length < 15) {
      return json(res, 400, {
        error: 'Could not extract readable text from the uploaded file. Please verify the file contains readable text.'
      });
    }

    const document = db.createDocument({
      userId: activeUser.id,
      name: filename.replace(/\.[^/.]+$/, ''), // remove file extension for cleaner title
      content: extractedText,
      status: 'Ready'
    });

    return json(res, 201, {
      ok: true,
      document,
      message: `Extracted ${extractedText.length} characters into ${document.chunks} RAG knowledge chunks.`
    });
  }

  // Delete a document
  if ((req.method === 'DELETE' && url.pathname === '/api/documents') || (req.method === 'POST' && url.pathname === '/api/documents/delete')) {
    const body = req.method === 'POST' ? await parseBody(req) : {};
    const docId = url.searchParams.get('id') || body.id;
    if (!docId) return json(res, 400, { error: 'Document id is required' });

    const success = db.deleteDocument(docId, activeUser.id);
    if (!success) {
      return json(res, 403, { error: 'Could not delete document or permission denied' });
    }
    return json(res, 200, { ok: true, message: 'Document and its chunks deleted successfully' });
  }

  // --------------------------------------------------------------------------
  // Progress Snapshot (Database-backed)
  // --------------------------------------------------------------------------
  if (req.method === 'GET' && url.pathname === '/api/progress') {
    const progress = db.getProgress(activeUser.id);
    return json(res, 200, progress);
  }

  // --------------------------------------------------------------------------
  // Chat History
  // --------------------------------------------------------------------------
  if (req.method === 'GET' && url.pathname === '/api/chat/history') {
    const sessionId = url.searchParams.get('sessionId');
    const messages = db.getChatHistory(sessionId);
    return json(res, 200, { messages });
  }

  // --------------------------------------------------------------------------
  // Chat Endpoint — LLM Generation with Retrieved Passages
  // --------------------------------------------------------------------------
  if (req.method === 'POST' && url.pathname === '/api/chat') {
    const body = await parseBody(req);
    const prompt = String(body.message || '').trim();
    const sessionId = body.sessionId || null;

    if (!prompt) {
      return json(res, 400, { error: 'message is required' });
    }

    // 1. Retrieve relevant passages from the RAG chunks database
    const retrievedPassages = db.retrievePassages(prompt, activeUser.id, 3);

    // 2. Fetch recent conversation history if a sessionId is specified
    let conversationHistory = [];
    if (sessionId) {
      conversationHistory = db.getChatHistory(sessionId);
    }

    // 3. Save student question to chat history
    db.saveChatMessage({
      sessionId,
      userId: activeUser.id,
      role: 'user',
      content: prompt
    });

    // 4. Generate answer via Hugging Face Inference API (or fallback simulator)
    const llmResponse = await generateOwlChemyResponse({
      message: prompt,
      retrievedPassages,
      conversationHistory
    });

    // 5. Save assistant reply to chat history
    db.saveChatMessage({
      sessionId,
      userId: activeUser.id,
      role: 'assistant',
      content: llmResponse.answer,
      citations: llmResponse.citations
    });

    // 6. Track student activity in database
    db.incrementUserQuestions(activeUser.id);

    return json(res, 200, llmResponse);
  }

  return json(res, 404, { error: 'Not found' });
}

function serveStatic(req, res, url) {
  const requested = url.pathname === '/' ? '/index.html' : url.pathname;
  const filePath = path.normalize(path.join(publicDir, requested));
  if (!filePath.startsWith(publicDir)) return json(res, 403, { error: 'Forbidden' });
  fs.readFile(filePath, (error, content) => {
    if (error) return json(res, 404, { error: 'Not found' });
    const types = {
      '.html': 'text/html',
      '.css': 'text/css',
      '.js': 'text/javascript',
      '.svg': 'image/svg+xml',
      '.json': 'application/json'
    };
    res.writeHead(200, { 'Content-Type': `${types[path.extname(filePath)] || 'application/octet-stream'}; charset=utf-8` });
    res.end(content);
  });
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname.startsWith('/api/')) {
      return await handleApi(req, res, url);
    }
    serveStatic(req, res, url);
  } catch (error) {
    console.error('API Error:', error);
    json(res, 500, { error: 'Unexpected server error', detail: error.message });
  }
}).listen(port, () => {
  console.log(`OwlChemy server running at http://localhost:${port}`);
  console.log(`Database connected via SQLite (${db.dbPath})`);
});
