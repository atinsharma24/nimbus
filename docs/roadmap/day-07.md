# Day 07 — API Routes

## Context

Day 06 proved the pipeline works end-to-end in isolation. Day 07 exposes it over HTTP — two Route Handlers that the frontend (and any external client) can call. After today, the frontend becomes a thin client; all intelligence lives in the API layer.

This day is architecturally important: the API routes are the boundary where `Result<T>` errors are converted to HTTP status codes. Route handlers are the ONLY place where we throw (or return non-200 responses). Business logic never touches HTTP.

---

## [AGENT TASKS]

### Route 1: `POST /api/documents`

**File:** `apps/web/app/api/documents/route.ts`

**Responsibility:** Accept a multipart form upload, create a document record, run the ingestion pipeline asynchronously, return document metadata.

**Concept:** This route implements the "fire and forget" pattern — it creates the document row (status=`pending`), immediately responds 202 Accepted, then triggers ingestion in the background. The client polls or uses the document list to see when status becomes `indexed`.

> **[INTERVIEW ANCHOR]** HTTP 202 Accepted vs. 201 Created: Use 202 when the work is not yet complete at response time. Use 201 when the resource is fully created. Returning 201 here would be wrong — the document isn't indexed yet when we respond.

**Request shape (multipart/form-data):**
```
file: File
```

**Response shape (202):**
```typescript
interface UploadResponse {
  documentId: string;
  filename: string;
  status: 'pending';
}
```

**Zod schema for request validation (rules.md §3.6):**
```typescript
// Validate file size and MIME type
const SUPPORTED_MIME_TYPES = ['text/markdown', 'text/plain', 'application/pdf'] as const;
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
```

**Implementation pattern:**
```typescript
export async function POST(request: Request): Promise<Response> {
  // 1. Parse multipart form
  // 2. Validate file (size, MIME type) with Zod
  //    → 400 if invalid
  // 3. createDocument({ filename, mimeType, status: 'pending' })
  //    → 500 if DB error
  // 4. Fire ingestDocument() WITHOUT await (background)
  //    → catch errors and updateDocumentStatus(id, 'failed') inside the background task
  // 5. Return 202 with { documentId, filename, status: 'pending' }
}
```

**Error handling contract:**  
- File too large → 413 Payload Too Large
- Unsupported MIME type → 415 Unsupported Media Type
- DB error → 500 Internal Server Error (never expose raw DB error to client)

---

### Route 2: `POST /api/chat`

**File:** `apps/web/app/api/chat/route.ts`

**Responsibility:** Accept a query, run the query pipeline, stream the LLM response as SSE.

**Request shape (JSON body):**
```typescript
const chatRequestSchema = z.object({
  query: z.string().min(1, 'Query cannot be empty').max(2000),
});
```

**Response:** SSE stream — `Content-Type: text/event-stream`

**Implementation pattern:**
```typescript
export async function POST(request: Request): Promise<Response> {
  // 1. Parse JSON body
  // 2. Validate with chatRequestSchema
  //    → 400 if invalid
  // 3. const result = await queryPipeline(query)
  //    → 500 if pipeline fails
  // 4. Return streaming Response:
  return new Response(result.value, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
```

> **[INTERVIEW ANCHOR]** The `Cache-Control: no-cache` header is essential for SSE — without it, intermediary proxies may buffer the entire response before forwarding it to the client, defeating streaming. This is a common production bug.

---

### Route 3: `GET /api/documents`

**File:** `apps/web/app/api/documents/route.ts` (add `GET` export to same file)

**Responsibility:** Return all documents for the dashboard document list.

**Response shape:**
```typescript
interface DocumentListResponse {
  documents: Array<{
    id: string;
    filename: string;
    status: string;
    createdAt: string;
  }>;
}
```

---

### Add Zod to the web app (if not already installed):
```bash
pnpm --filter @nimbus/web add zod
```

### Verification commands:
```bash
pnpm dev
# Then in another terminal:

# Test document upload
curl -X POST http://localhost:3000/api/documents \
  -F "file=@/path/to/test.md;type=text/markdown"
# Expected: { "documentId": "...", "filename": "test.md", "status": "pending" }

# Test chat (after a document is indexed)
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"query": "What is this document about?"}' \
  --no-buffer
# Expected: streaming SSE events: data: The document... data: [DONE]

# Test document list
curl http://localhost:3000/api/documents
# Expected: { "documents": [...] }
```

---

## [MY TASKS]

- [ ] **Run `pnpm dev`** and keep it running during verification
- [ ] **Run all three curl commands** above and confirm expected output
- [ ] **Check Adminer** after upload: document status should transition `pending → processing → indexed`
- [ ] **Review the SSE stream in a browser:**  
  Open browser DevTools → Network tab → filter XHR/Fetch → make a chat request → observe streaming response
- [ ] **Review the two route files** — understand why `ingestDocument` is called without `await`

---

## Definition of Done

- [ ] `apps/web/app/api/documents/route.ts` exports `GET` and `POST` handlers
- [ ] `apps/web/app/api/chat/route.ts` exports `POST` handler
- [ ] All request shapes validated with Zod (rules.md §3.6)
- [ ] `POST /api/documents` returns 202 Accepted
- [ ] `POST /api/chat` returns `text/event-stream` response
- [ ] Correct HTTP error codes: 400, 413, 415, 500 (never raw DB errors exposed)
- [ ] `Cache-Control: no-cache` header on SSE response
- [ ] `pnpm typecheck` exits 0
- [ ] All three curl commands return expected output
- [ ] Document status transitions from `pending` to `indexed` in DB (verified via Adminer)
