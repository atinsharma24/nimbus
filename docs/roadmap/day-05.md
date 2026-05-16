# Day 05 — Generator + File Parsers

## Context

Days 03–04 built the retrieval half of the pipeline: chunks can be stored, queried by vector similarity, and reranked. Day 05 completes the two remaining RAG-core components: the Generator (which streams the LLM response) and the File Parsers (which extract raw text from uploaded documents). After today, every interface defined in `interfaces.ts` has a concrete implementation.

---

## [AGENT TASKS]

### Stage 5: `packages/rag-core/src/generator.ts` — GroqGenerator

**Concept:** The Generator is the final stage of the query pipeline. It receives the original user query and the top-K reranked chunks, builds a prompt that injects the chunk text as context, calls the Groq LLM, and returns the response as a `ReadableStream` suitable for SSE (Server-Sent Events). The LLM generates its answer based on the retrieved context — this is the "Generation" in RAG.

**Pattern:** Implements the `Generator` interface. Strategy Pattern: `AnthropicGenerator` is a drop-in swap. Both return `ReadableStream`.

**Dependency to add:**  
```bash
pnpm --filter @nimbus/rag-core add groq-sdk
```
- **What it solves:** Official Groq SDK with typed streaming support.
- **Why not raw fetch?** Groq SDK handles auth headers, streaming protocol, and retry logic.

**ContextBuilder (inline function, not a separate class):**  
Before calling the LLM, build the prompt:
```typescript
function buildPrompt(query: string, chunks: RetrievedChunk[]): string {
  const context = chunks
    .map((c, i) => `[Context ${i + 1}]\n${c.content}`)
    .join('\n\n---\n\n');
  return `You are a helpful assistant. Answer the question using ONLY the context provided below.
If the answer is not in the context, say "I don't have enough information to answer that."

CONTEXT:
${context}

QUESTION: ${query}

ANSWER:`;
}
```

> **[INTERVIEW ANCHOR]** Constraining the LLM to "ONLY the context provided" reduces hallucination — the model cannot use its parametric knowledge to fill gaps. This is the core value proposition of RAG over vanilla LLM chat.

**Streaming pattern:**
```typescript
const stream = await groq.chat.completions.create({
  model: GROQ_CHAT_MODEL,
  messages: [{ role: 'user', content: prompt }],
  stream: true,
  max_tokens: options?.maxTokens ?? 1024,
  temperature: options?.temperature ?? 0.1,
});

// Convert Groq async iterable → ReadableStream (Web Streams API)
const readableStream = new ReadableStream({
  async start(controller) {
    for await (const chunk of stream) {
      const text = chunk.choices[0]?.delta?.content ?? '';
      if (text) controller.enqueue(new TextEncoder().encode(`data: ${text}\n\n`));
    }
    controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
    controller.close();
  },
});
```

> **[INTERVIEW ANCHOR]** SSE (Server-Sent Events) format: each event is `data: <content>\n\n`. The client reads this with `EventSource` or `response.body.getReader()`. Unlike WebSockets, SSE is unidirectional (server → client) and HTTP/1.1 compatible — correct for chat streaming.

**Latency guard:** `console.time('[generator] groq stream first-token')` — flag if > 600ms.

**Test file: `packages/rag-core/__tests__/generator.test.ts`**

Mock `groq-sdk` with `vi.mock`. Test cases:
1. Returns `Result<ReadableStream>` with `ok: true` on success
2. Mocked Groq stream produces a chunk with text → the ReadableStream emits `data: <text>\n\n`
3. Groq API throws → returns `Result.error` with `ok: false`

---

### File Parsers: `packages/rag-core/src/parsers.ts`

**Concept:** Before chunking, raw file bytes must be converted to plain text. Different MIME types require different extraction strategies. A router dispatches to the correct parser based on `mimeType`.

**Three parsers (implement all three in one file):**

1. **`MarkdownParser`** — strips YAML frontmatter (between `---` delimiters) and returns body text. Zero dependencies.

2. **`PlainTextParser`** — identity transform: returns `content` as-is. For `.txt` files.

3. **`PDFParser`** — extracts text using `pdf-parse`.  
   ```bash
   pnpm --filter @nimbus/rag-core add pdf-parse
   pnpm --filter @nimbus/rag-core add -D @types/pdf-parse
   ```
   - **What it solves:** Extracts text content from PDF binary buffers.
   - **Trade-off:** `pdf-parse` doesn't handle scanned PDFs (image-only PDFs) — would need OCR (Tesseract) as an upgrade path. Document this as a comment.

**Router function signature:**
```typescript
export function parseDocument(
  content: Buffer | string,
  mimeType: string
): Result<string>
```

**Supported MIME types:**
- `text/markdown` → MarkdownParser
- `text/plain` → PlainTextParser
- `application/pdf` → PDFParser
- Unknown → `Result.error` with code `'UNSUPPORTED_MIME_TYPE'`

### Update `packages/rag-core/src/index.ts`

Export all new concrete implementations:
```typescript
export { FixedSizeChunker } from './chunker';
export { OllamaEmbedder } from './embedder';
export { PgVectorRetriever } from './retriever';
export { HeuristicReranker } from './reranker';
export { GroqGenerator } from './generator';
export { parseDocument } from './parsers';
export * from './interfaces';
```

### Verification commands:
```bash
pnpm --filter @nimbus/rag-core add groq-sdk pdf-parse
pnpm --filter @nimbus/rag-core add -D @types/pdf-parse

pnpm typecheck
# Expected: exits 0

pnpm test
# Expected: all generator + parser tests pass (all Day 01–05 tests green)
```

---

## [MY TASKS]

- [ ] **Review `generator.ts`** — trace through the `ReadableStream` construction manually. Understand why we encode each chunk as `data: <text>\n\n`.
- [ ] **Review `parsers.ts`** — understand why MIME-based routing is used instead of file extension. (Answer: file extensions can be spoofed; MIME type is set at upload time from the actual bytes.)
- [ ] **Run `pnpm test`** — confirm all tests from Days 01–05 are green
- [ ] **Groq sanity check:** In a scratch Node.js script, make one real Groq chat completion call to confirm your API key works before Day 07.

---

## Definition of Done

- [ ] `packages/rag-core/src/generator.ts` exists, implements `Generator` interface
- [ ] `packages/rag-core/src/parsers.ts` exists with `parseDocument` router + 3 parsers
- [ ] `groq-sdk` and `pdf-parse` are in `packages/rag-core/package.json`
- [ ] All 3 generator unit tests pass (with mocked Groq SDK)
- [ ] `parseDocument` correctly routes all 3 supported MIME types
- [ ] Unknown MIME type returns `Result.error` with code `'UNSUPPORTED_MIME_TYPE'`
- [ ] `packages/rag-core/src/index.ts` exports all 6 public symbols
- [ ] `pnpm typecheck` exits 0
- [ ] `pnpm test` exits 0 (all tests from Days 01–05 green)
