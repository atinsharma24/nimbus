# Day 08 — Frontend + E2E Latency Verification

## Context

Day 07 exposed the full pipeline as HTTP endpoints. The API is functional and testable with curl. Day 08 builds the user interface that makes the system tangible — a document upload dashboard and a chat interface. It also closes the loop on the 800ms latency SLA by measuring the full E2E latency under realistic conditions.

This is the final day. After Day 08, Project Nimbus v1.0 is complete.

---

## [AGENT TASKS]

### Design System: `apps/web/app/globals.css`

Replace the default Next.js styles with a Nimbus design system. Use Tailwind CSS (already installed). Key tokens:

```css
/* Color palette: dark slate background, cyan accent */
--color-bg: #0f1117;
--color-surface: #1a1d27;
--color-border: #2a2d3a;
--color-text: #e2e8f0;
--color-text-muted: #64748b;
--color-accent: #06b6d4;   /* cyan-500 */
--color-success: #10b981;  /* emerald-500 */
--color-error: #ef4444;    /* red-500 */
```

---

### Component 1: `apps/web/app/components/upload-zone.tsx`

**Responsibility:** Drag-and-drop file upload area. Client Component (`'use client'`).

**Behavior:**
- Accepts drag-over visual feedback (border changes color)
- Accepts file picker via click
- On file select: shows filename + size + status indicator
- Calls `POST /api/documents` with `multipart/form-data`
- Shows three states: idle, uploading (spinner), success (checkmark + "Processing…"), error (message)

**Key states:**
```typescript
type UploadState = 'idle' | 'uploading' | 'success' | 'error';
```

> **Design note:** The success state shows "Processing…" not "Done" — because the document status is `pending` at response time. The user understands indexing takes a moment.

---

### Component 2: `apps/web/app/components/document-list.tsx`

**Responsibility:** Lists all uploaded documents with their current status. Server Component (reads from `GET /api/documents` on render). Refreshes every 5s using `router.refresh()` from a small Client Component wrapper.

**Status badge colors:**
- `pending` → gray
- `processing` → yellow + pulsing dot
- `indexed` → green
- `failed` → red

---

### Component 3: `apps/web/app/components/chat-window.tsx`

**Responsibility:** Conversational UI. Client Component (`'use client'`).

**Message types:**
```typescript
interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  isStreaming?: boolean;
}
```

**Streaming implementation:**
```typescript
const response = await fetch('/api/chat', {
  method: 'POST',
  body: JSON.stringify({ query }),
  headers: { 'Content-Type': 'application/json' },
});

const reader = response.body!.getReader();
const decoder = new TextDecoder();

while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  const text = decoder.decode(value);
  // Parse SSE: "data: <text>\n\n" → extract text
  const lines = text.split('\n');
  for (const line of lines) {
    if (line.startsWith('data: ') && line !== 'data: [DONE]') {
      const token = line.slice(6);
      setMessages(prev => /* append token to last assistant message */);
    }
  }
}
```

> **[INTERVIEW ANCHOR]** `response.body.getReader()` uses the Web Streams API (WHATWG standard). It returns a `ReadableStreamDefaultReader`. This works in Next.js App Router because Server Components and Route Handlers use the Web Streams API, not Node.js streams.

---

### Main Page: `apps/web/app/page.tsx`

**Layout:** Two-panel design:
- **Left panel (⅓ width):** Upload zone on top, document list below
- **Right panel (⅔ width):** Chat window

```
┌─────────────────────────────────────────────────────────────┐
│  📁 Upload Zone                    │                        │
│  ┌────────────────────────────┐   │  💬 Chat Window        │
│  │  Drop files here           │   │                        │
│  └────────────────────────────┘   │  ┌──────────────────┐  │
│                                   │  │ User: ...        │  │
│  📋 Document List                 │  │ AI: (streaming)  │  │
│  • report.pdf       ✅ indexed    │  └──────────────────┘  │
│  • notes.md         ⏳ processing │                        │
└───────────────────────────────────┴────────────────────────┘
```

---

### E2E Latency Verification

**Add a `X-Pipeline-Latency-Ms` response header to `POST /api/chat`:**

```typescript
// In apps/web/app/api/chat/route.ts
const start = Date.now();
const result = await queryPipeline(query);
const latencyMs = Date.now() - start;

return new Response(result.value, {
  headers: {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Pipeline-Latency-Ms': String(latencyMs),  // ← add this
  },
});
```

**Verification script (run in browser DevTools console):**
```javascript
const res = await fetch('/api/chat', {
  method: 'POST',
  body: JSON.stringify({ query: 'What is this document about?' }),
  headers: { 'Content-Type': 'application/json' }
});
console.log('E2E latency:', res.headers.get('X-Pipeline-Latency-Ms'), 'ms');
// Target: < 800ms
```

---

### Verification commands:
```bash
pnpm dev
# Open http://localhost:3000
```

Manual verification flow:
1. Drag a `.md` file onto the upload zone
2. Watch status in document list: `pending → processing → indexed`
3. Type a question about the document in the chat window
4. Observe streaming response tokens arriving character by character
5. Open DevTools → Network → chat request → check `X-Pipeline-Latency-Ms` header

---

## [MY TASKS]

- [ ] **Run `pnpm dev`** and open http://localhost:3000
- [ ] **Upload a real document** (your own markdown notes, a PDF, etc.)
- [ ] **Ask a question** that should be answerable from the document
- [ ] **Verify the LLM answer is grounded** in the document content (not hallucinated)
- [ ] **Check latency header** in DevTools — is it under 800ms?
- [ ] **Test error cases:**
  - Upload a `.xlsx` file → expect 415 error message in upload zone
  - Ask a question before any documents are indexed → expect "I don't have enough information"
- [ ] **Mobile responsiveness check:** Resize browser to 375px width — does the layout stack gracefully?

---

## Definition of Done

- [ ] `apps/web/app/page.tsx` renders two-panel layout with upload zone, document list, and chat window
- [ ] `upload-zone.tsx` handles drag-and-drop and shows all 4 states (idle/uploading/success/error)
- [ ] `document-list.tsx` shows live status with color-coded badges
- [ ] `chat-window.tsx` streams tokens in real time (not buffered)
- [ ] `X-Pipeline-Latency-Ms` header present on chat API responses
- [ ] E2E latency < 800ms for a simple query on a small document
- [ ] `pnpm typecheck` exits 0
- [ ] `pnpm build` exits 0 (no build errors)
- [ ] All user flows work: upload → index → chat → answer
- [ ] Upload of unsupported MIME type shows error (doesn't crash)

---

## 🎉 Project Nimbus v1.0 — Complete

After Day 08, you can:
- Explain every file in the repo from memory
- Describe the Strategy Pattern, Repository Pattern, Result Monad, and Hexagonal Architecture without notes
- Walk an interviewer through the latency budget and why each stage is bounded
- Extend the system: swap `OllamaEmbedder` → `OpenAIEmbedder`, or `HeuristicReranker` → `CrossEncoderReranker`, without touching any other file

**Stretch goals (post-v1.0):**
- [ ] Add `CrossEncoderReranker` using a Hugging Face model via `@xenova/transformers`
- [ ] Add hybrid search: `HybridRetriever` combining pgvector ANN + PostgreSQL full-text search (BM25)
- [ ] Add Playwright E2E tests for the upload and chat flows
- [ ] Deploy to Vercel + Neon (serverless PostgreSQL with pgvector support)
