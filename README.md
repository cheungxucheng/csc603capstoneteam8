# Study Spark

A dependency-light skeleton for a teaching assistant AI. The frontend is a responsive chat experience with recent sessions, learning progress, suggested topics, and course-material context. The backend is a small Node HTTP server with demo API stubs.

## Run locally

Requires Node.js 18 or newer.

```bash
npm start
```

Open http://localhost:3000.

## API stubs

- `GET /api/health` — service health check
- `GET /api/sessions` — recent study sessions
- `GET /api/progress` — progress summary
- `GET /api/documents` — ingested document list
- `POST /api/documents` — accepts `{ "name": "..." }` and simulates ingestion
- `POST /api/chat` — accepts `{ "message": "..." }`, returns a demo answer and retrieved passage metadata

## Next implementation steps

1. Replace in-memory stores with a database and user authentication.
2. Implement upload, parsing, chunking, embedding, and vector search in the document endpoint.
3. Replace the chat stub with an LLM call that receives the retrieved passages as context.
4. Persist quiz results and calculate mastery by topic.
