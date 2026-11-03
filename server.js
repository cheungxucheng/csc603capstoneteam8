const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const port = process.env.PORT || 3000;
const publicDir = path.join(__dirname, 'public');

// Demo data only. Replace these stores with a database and vector store later.
const documents = [
  { id: 'doc-1', name: 'Biology 101 notes', chunks: 12, status: 'Ready' },
  { id: 'doc-2', name: 'Cell structure study guide', chunks: 8, status: 'Ready' }
];

const sessions = [
  { id: 'session-1', title: 'Cell membranes & transport', time: 'Today', icon: '▣' },
  { id: 'session-2', title: 'Photosynthesis review', time: 'Yesterday', icon: '✦' },
  { id: 'session-3', title: 'Enzyme kinetics practice', time: 'Oct 28', icon: '◒' }
];

function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); } catch (error) { reject(error); }
    });
    req.on('error', reject);
  });
}

async function handleApi(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/api/health') return json(res, 200, { ok: true, service: 'study-spark-api' });
  if (req.method === 'GET' && url.pathname === '/api/sessions') return json(res, 200, { sessions });
  if (req.method === 'GET' && url.pathname === '/api/documents') return json(res, 200, { documents });
  if (req.method === 'GET' && url.pathname === '/api/progress') {
    return json(res, 200, { streak: 7, questions: 48, mastery: 72, strengths: ['Cell biology', 'Scientific reasoning'], focus: 'Membrane transport' });
  }
  if (req.method === 'POST' && url.pathname === '/api/chat') {
    const body = await parseBody(req);
    const prompt = String(body.message || '').trim();
    if (!prompt) return json(res, 400, { error: 'message is required' });

    // RAG-shaped stub: retrieve matching passages, then send the context to an LLM.
    const retrievedPassages = documents.map(doc => ({ documentId: doc.id, document: doc.name, score: 0.86, text: 'Demo passage: the cell membrane is selectively permeable and transport can be passive or active.' }));
    return json(res, 200, {
      answer: `Here is a useful way to think about it: start by identifying the key process in “${prompt}”. Then connect it to the evidence in your course notes. For a stronger answer, explain what changes, why it changes, and use one concrete example.\n\nTry this next: explain the idea in two sentences, and I’ll give you feedback.`,
      citations: retrievedPassages.slice(0, 2),
      followUp: 'Would you like a quick example or a practice question?',
      demo: true
    });
  }
  if (req.method === 'POST' && url.pathname === '/api/documents') {
    const body = await parseBody(req);
    const name = String(body.name || 'Untitled course material');
    const document = { id: `doc-${documents.length + 1}`, name, chunks: 0, status: 'Processing' };
    documents.push(document);
    return json(res, 202, { document, message: 'Ingestion stub accepted. Chunking and embedding would run here.' });
  }
  return json(res, 404, { error: 'Not found' });
}

function serveStatic(req, res, url) {
  const requested = url.pathname === '/' ? '/index.html' : url.pathname;
  const filePath = path.normalize(path.join(publicDir, requested));
  if (!filePath.startsWith(publicDir)) return json(res, 403, { error: 'Forbidden' });
  fs.readFile(filePath, (error, content) => {
    if (error) return json(res, 404, { error: 'Not found' });
    const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml' };
    res.writeHead(200, { 'Content-Type': `${types[path.extname(filePath)] || 'application/octet-stream'}; charset=utf-8` });
    res.end(content);
  });
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    serveStatic(req, res, url);
  } catch (error) {
    json(res, 500, { error: 'Unexpected server error', detail: error.message });
  }
}).listen(port, () => console.log(`Study Spark running at http://localhost:${port}`));
