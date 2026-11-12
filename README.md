# OwlChemy
**Tech Stack:** React, JS, Python, SQLite / MySQL, Llama

**OwlChemy** is an intelligent AI study partner and pedagogical tutoring assistant. The frontend is a responsive, distraction-free study experience with multi-session tracking, mastery analytics, an authentication modal, and a complete Course Materials & RAG Document Manager. The backend is a lightweight Node.js server powered by a persistent SQLite database and an end-to-end Retrieval-Augmented Generation (RAG) pipeline connected to Hugging Face Llama models.

---

## What's Implemented

### 1. End-to-End RAG Pipeline (`rag.js` & `db.js`)
- **Text Extraction:** Supports Plain Text (`.txt`), Markdown (`.md`), JSON, and text-based PDFs without third-party binary dependencies.
- **Hierarchical Text Chunking:** Recursively splits materials into overlapping knowledge chunks (~450 characters, 80 character overlap) preserving paragraph structure and sentence boundaries.
- **Relational Chunk Indexing:** Every chunk is indexed in the `document_chunks` table linked to its parent document.
- **Semantic / BM25 Ranking:** Scores document chunks against student queries with term-frequency saturation, document title matching, and exact phrase boosts.
- **Course Materials Management:**
  - Ingestion UI modal to upload course files or paste lecture notes directly.
  - Chunk inspector to preview how notes are split and indexed.
  - Interactive citation badges in chat that expand to show the exact referenced excerpts.

### 2. User Authentication & Database (`db.js`)
- **Persistent SQLite Database:** Powered by Node 22 native `DatabaseSync` (`owlchemy.db`), configurable via `DATABASE_PATH`.
- **Relational Schema:**
  - `users`: Student accounts with salted `crypto.scrypt` password hashing.
  - `auth_tokens`: Bearer session tokens for secure API access.
  - `sessions`: Persistent study sessions organized by topic.
  - `documents` & `document_chunks`: Course notes and their searchable passages.
  - `chat_messages`: Full conversation history with citation metadata.
  - `user_progress`: Streak tracking, question counts, mastery %, and recommended study topics.
- **Authentication Modal:** Allows instant sign-in, account creation, and session persistence in `localStorage`.
- **Pre-Seeded Demo Account:** `jordan@example.com` / `password123` with sample Biology 101 notes.

### 3. LLM Tutoring Persona & Hugging Face Integration (`llm.js`)
- **Socratic Tutoring Persona:**
  - Grounds explanations in retrieved course excerpts.
  - Structures explanations with intuitive analogies, biological mechanisms, and concrete examples.
  - Concludes with active recall thought exercises or practice questions.
- **Hugging Face Router Integration:**
  - Configured for `meta-llama/Llama-3.2-3B-Instruct` via the OpenAI-compatible router endpoint (`https://router.huggingface.co/hf-inference/v1/chat/completions`).
  - **Graceful Fallback:** Automatically provides simulated RAG answers based on retrieved notes if `HUGGINGFACE_API_TOKEN` is not yet configured.

---

## Quick Start

### 1. Environment Setup
Copy the example environment configuration:

```bash
cp .env.example .env
```

To enable live Llama inference:
1. Create a free account at [Hugging Face](https://huggingface.co).
2. Generate an access token at [Hugging Face Tokens](https://huggingface.co/settings/tokens).
3. If using gated Llama models, visit [Llama 3.2 3B Instruct](https://huggingface.co/meta-llama/Llama-3.2-3B-Instruct) and accept the license.
4. Set `HUGGINGFACE_API_TOKEN=hf_...` in `.env`.

### 2. Start the Server

```bash
npm start
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## Demo Credentials

You can use the pre-seeded demo student account or create a new one via the modal:
- **Email:** `jordan@example.com`
- **Password:** `password123`

---

## API Reference

### Authentication
- `POST /api/auth/register` — `{ email, password, name, course }`
- `POST /api/auth/login` — `{ email, password }`
- `GET /api/auth/me` — header: `Authorization: Bearer <token>`
- `POST /api/auth/logout` — header: `Authorization: Bearer <token>`

### Course Materials & RAG
- `GET /api/documents` — list user and course materials
- `POST /api/documents` — ingest text note: `{ name, content }`
- `POST /api/documents/upload` — upload file: `{ name, filename, fileData, base64 }`
- `GET /api/documents/chunks?id=<docId>` — view passage chunks of a document
- `POST /api/documents/delete` — delete document and its chunks: `{ id }`

### Chat & Learning
- `POST /api/chat` — `{ message, sessionId }` (triggers RAG retrieval + LLM tutoring)
- `GET /api/chat/history?sessionId=<id>` — fetch session message history
- `GET /api/sessions` — user study sessions
- `POST /api/sessions` — create a new study session
- `GET /api/progress` — learning progress snapshot
