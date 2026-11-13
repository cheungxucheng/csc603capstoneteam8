/**
 * ============================================================================
 * OwlChemy — Document RAG Pipeline (Extraction, Chunking, & Retrieval)
 * ============================================================================
 * 
 * Provides end-to-end processing for course study materials:
 * 1. Text extraction from plain text (.txt, .md, .json, .csv) and PDF documents.
 * 2. Recursive hierarchical text chunking with configurable overlap.
 * 3. BM25 / TF-IDF relevance scoring for semantic passage retrieval.
 * ============================================================================
 */

const zlib = require('zlib');

// Common English stopwords to ignore during keyword scoring
const STOPWORDS = new Set([
  'a', 'about', 'above', 'after', 'again', 'against', 'all', 'am', 'an', 'and',
  'any', 'are', 'aren', 'arent', 'as', 'at', 'be', 'because', 'been', 'before',
  'being', 'below', 'between', 'both', 'but', 'by', 'can', 'cannot', 'could',
  'did', 'do', 'does', 'doing', 'down', 'during', 'each', 'few', 'for', 'from',
  'further', 'had', 'has', 'have', 'having', 'he', 'her', 'here', 'hers',
  'herself', 'him', 'himself', 'his', 'how', 'i', 'if', 'in', 'into', 'is',
  'isn', 'it', 'its', 'itself', 'just', 'me', 'more', 'most', 'my', 'myself',
  'no', 'nor', 'not', 'now', 'of', 'off', 'on', 'once', 'only', 'or', 'other',
  'our', 'ours', 'ourselves', 'out', 'over', 'own', 'same', 'she', 'should',
  'so', 'some', 'such', 'than', 'that', 'the', 'their', 'theirs', 'them',
  'themselves', 'then', 'there', 'these', 'they', 'this', 'those', 'through',
  'to', 'too', 'under', 'until', 'up', 'very', 'was', 'wasn', 'we', 'were',
  'what', 'when', 'where', 'which', 'while', 'who', 'whom', 'why', 'with',
  'would', 'you', 'your', 'yours', 'yourself', 'yourselves', 'tell', 'explain',
  'help', 'give', 'know', 'can'
]);

/**
 * Extract plain text from uploaded buffer or string.
 * Supports .txt, .md, .markdown, .json, .csv, and text-based PDFs.
 * 
 * @param {Buffer|string} input - Raw file data
 * @param {string} filename - Original file name for format detection
 * @returns {string} Extracted clean text
 */
function extractText(input, filename = '') {
  if (!input) return '';

  const ext = (filename.split('.').pop() || '').toLowerCase();

  // If buffer is already a UTF-8 string or text file
  if (typeof input === 'string') {
    return cleanText(input);
  }

  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input);

  // Handle PDF format
  if (ext === 'pdf' || (buffer.length > 4 && buffer.slice(0, 4).toString() === '%PDF')) {
    return extractTextFromPdfBuffer(buffer);
  }

  // Default: interpret buffer as UTF-8 text
  try {
    return cleanText(buffer.toString('utf8'));
  } catch (_) {
    return cleanText(buffer.toString('latin1'));
  }
}

/**
 * Lightweight, zero-dependency PDF stream text extractor.
 * Extracts textual content from PDF streams (both uncompressed and FlateDecode).
 */
function extractTextFromPdfBuffer(buffer) {
  const textChunks = [];
  const bin = buffer.toString('binary');

  // Regex to match PDF content streams: /Filter /FlateDecode ... stream ... endstream
  const streamRegex = /stream[\r\n]+([\s\S]*?)endstream/g;
  let match;

  while ((match = streamRegex.exec(bin)) !== null) {
    const rawStream = match[1];
    const streamBuffer = Buffer.from(rawStream, 'binary');

    // Attempt to decompress FlateDecode stream
    let decompressed = '';
    try {
      decompressed = zlib.inflateSync(streamBuffer).toString('latin1');
    } catch (_) {
      try {
        decompressed = zlib.inflateRawSync(streamBuffer).toString('latin1');
      } catch (_) {
        decompressed = rawStream; // Might be uncompressed
      }
    }

    // Extract text commands: (Text) Tj, [(T) 10 (ext)] TJ, ' or "
    // Match string literals inside parentheses
    const textCommandRegex = /\(([\s\S]*?)\)\s*(?:Tj|'|")/g;
    let textMatch;
    while ((textMatch = textCommandRegex.exec(decompressed)) !== null) {
      const decoded = textMatch[1]
        .replace(/\\([()\\])/g, '$1')
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '\r')
        .replace(/\\t/g, '\t');
      if (decoded.trim()) textChunks.push(decoded);
    }

    // Match array text commands: [(text1) 20 (text2)] TJ
    const arrayCommandRegex = /\[([\s\S]*?)\]\s*TJ/g;
    let arrayMatch;
    while ((arrayMatch = arrayCommandRegex.exec(decompressed)) !== null) {
      const inner = arrayMatch[1];
      const partRegex = /\(([\s\S]*?)\)/g;
      let part;
      let line = '';
      while ((part = partRegex.exec(inner)) !== null) {
        line += part[1].replace(/\\([()\\])/g, '$1');
      }
      if (line.trim()) textChunks.push(line);
    }
  }

  const combined = textChunks.join(' ');
  // If stream extraction found text, return it
  if (combined.trim().length > 30) {
    return cleanText(combined);
  }

  // Fallback: search for printable text strings in raw buffer
  const printable = bin.replace(/[^\x20-\x7E\n\r\t]/g, ' ');
  return cleanText(printable);
}

/**
 * Normalize whitespace and remove non-printable control characters
 */
function cleanText(text) {
  if (!text) return '';
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // remove non-printable control chars
    .replace(/[ \t]+/g, ' ')                           // collapse repeated inline spaces
    .replace(/\n{3,}/g, '\n\n')                        // maximum 2 consecutive newlines
    .trim();
}

/**
 * Recursive character text chunking with overlap.
 * 
 * Splits hierarchically:
 * 1. Double newlines (paragraphs)
 * 2. Single newlines (lines)
 * 3. Sentence boundaries (. ? !)
 * 4. Word spaces
 * 
 * @param {string} text - Raw input text
 * @param {Object} [options]
 * @param {number} [options.chunkSize=450] - Target character count per chunk
 * @param {number} [options.chunkOverlap=80] - Number of overlapping characters
 * @returns {Array<{chunkIndex: number, content: string, charCount: number, tokenEstimate: number}>}
 */
function chunkText(text, { chunkSize = 450, chunkOverlap = 80 } = {}) {
  const cleaned = cleanText(text);
  if (!cleaned) return [];

  // If text is shorter than chunk size, return single chunk
  if (cleaned.length <= chunkSize) {
    return [{
      chunkIndex: 0,
      content: cleaned,
      charCount: cleaned.length,
      tokenEstimate: Math.ceil(cleaned.length / 4)
    }];
  }

  // Split into natural segments (paragraphs and sentences)
  const rawSegments = cleaned
    .split(/\n\n+/)
    .flatMap(para => {
      if (para.length <= chunkSize) return [para.trim()];
      // Split large paragraph into sentences
      return para
        .split(/(?<=[.?!])\s+/)
        .map(s => s.trim())
        .filter(Boolean);
    })
    .filter(Boolean);

  const chunks = [];
  let currentChunk = '';
  let chunkIndex = 0;

  for (let i = 0; i < rawSegments.length; i++) {
    const segment = rawSegments[i];

    if (!currentChunk) {
      currentChunk = segment;
      continue;
    }

    // Check if adding the next segment exceeds chunkSize
    if (currentChunk.length + 1 + segment.length <= chunkSize) {
      currentChunk += ' ' + segment;
    } else {
      // Finalize current chunk
      chunks.push({
        chunkIndex: chunkIndex++,
        content: currentChunk.trim(),
        charCount: currentChunk.trim().length,
        tokenEstimate: Math.ceil(currentChunk.trim().length / 4)
      });

      // Compute overlap text from tail of previous chunk
      let overlap = '';
      if (chunkOverlap > 0 && currentChunk.length > chunkOverlap) {
        overlap = currentChunk.slice(-chunkOverlap);
        // Trim to nearest word boundary
        const spaceIdx = overlap.indexOf(' ');
        if (spaceIdx > 0 && spaceIdx < overlap.length - 10) {
          overlap = overlap.slice(spaceIdx + 1);
        }
      }

      currentChunk = overlap ? (overlap + ' ' + segment).trim() : segment;
    }
  }

  // Push remaining text
  if (currentChunk.trim().length > 0) {
    chunks.push({
      chunkIndex: chunkIndex++,
      content: currentChunk.trim(),
      charCount: currentChunk.trim().length,
      tokenEstimate: Math.ceil(currentChunk.trim().length / 4)
    });
  }

  return chunks;
}

/**
 * Tokenize a text string into normalized lowercase keyword tokens
 */
function tokenize(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 2 && !STOPWORDS.has(t));
}

/**
 * Calculate relevance score between a student query and a candidate document chunk.
 * Uses BM25-inspired term frequency saturation, title matching boost, and exact phrase bonus.
 * 
 * @param {string} query - Student question
 * @param {string} chunkContent - Chunk body text
 * @param {string} [docTitle=''] - Name of parent document
 * @returns {number} Score between 0.0 and 1.0
 */
function scoreChunk(query, chunkContent, docTitle = '') {
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return 0.3; // Default baseline score

  const chunkTokens = tokenize(chunkContent);
  const titleTokens = tokenize(docTitle);

  // Term frequencies in chunk
  const tfMap = new Map();
  for (const t of chunkTokens) {
    tfMap.set(t, (tfMap.get(t) || 0) + 1);
  }

  let totalScore = 0;
  let matchesCount = 0;

  for (const token of queryTokens) {
    const tf = tfMap.get(token) || 0;
    if (tf > 0) {
      matchesCount++;
      // BM25 term frequency saturation: (tf * 2.5) / (tf + 1.5)
      const saturatedTf = (tf * 2.5) / (tf + 1.5);
      totalScore += saturatedTf;
    }

    // Boost if term appears in document title
    if (titleTokens.includes(token)) {
      totalScore += 1.2;
    }
  }

  // Exact phrase bonus if query is 2+ words
  const cleanQ = query.toLowerCase().trim();
  const cleanContent = chunkContent.toLowerCase();
  if (cleanQ.length > 8 && cleanContent.includes(cleanQ)) {
    totalScore += 2.5;
  }

  // Percentage of query terms matched
  const termCoverage = matchesCount / queryTokens.length;

  // Normalized final confidence score (0.0 to 1.0)
  const normalized = Math.min(1.0, (totalScore / (queryTokens.length * 2.0)) * 0.7 + termCoverage * 0.3);
  return Number(normalized.toFixed(2));
}

/**
 * Rank candidate chunks for a query and return top scored passages with metadata
 * 
 * @param {string} query - Student query
 * @param {Array<{id: string, documentId: string, documentName: string, chunkIndex: number, content: string}>} chunks
 * @param {Object} [options]
 * @param {number} [options.limit=3]
 * @param {number} [options.minScore=0.15]
 * @returns {Array<{documentId: string, document: string, chunkIndex: number, score: number, text: string}>}
 */
function rankPassages(query, chunks, { limit = 3, minScore = 0.15 } = {}) {
  if (!Array.isArray(chunks) || chunks.length === 0) return [];

  const scored = chunks.map(chunk => {
    const score = scoreChunk(query, chunk.content, chunk.documentName || '');
    return {
      documentId: chunk.documentId,
      document: chunk.documentName || 'Course material',
      chunkIndex: chunk.chunkIndex,
      score,
      text: chunk.content
    };
  });

  // Sort descending by score
  scored.sort((a, b) => b.score - a.score);

  // Return top unique passages above minimum score
  const results = [];
  const seenContent = new Set();

  for (const item of scored) {
    if (item.score < minScore && results.length > 0) break;
    // Avoid nearly identical consecutive chunks
    const prefix = item.text.slice(0, 60);
    if (seenContent.has(prefix)) continue;
    seenContent.add(prefix);

    results.push(item);
    if (results.length >= limit) break;
  }

  return results;
}

module.exports = {
  extractText,
  chunkText,
  tokenize,
  scoreChunk,
  rankPassages,
  cleanText
};
