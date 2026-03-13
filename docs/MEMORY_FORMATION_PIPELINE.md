# Memory Formation Pipeline — Technical Design

## 1. Problem Statement

Memorix currently has two write paths:

- **Explicit** (`memorix_store`): Agent structures data manually → quality depends on agent prompt
- **Implicit** (hooks): Auto-captures tool use → `buildObservation()` does template-based title/entity generation, no semantic understanding

Both paths share the same **Compact on Write** step, which only does deduplication (ADD/UPDATE/NONE), not **memory formation** — it doesn't extract facts, resolve entities, assess knowledge value, or form stable long-term representations.

**Result**: Memory quality is capped by the weakest link (usually the caller), and the system accumulates process noise alongside reusable knowledge.

## 2. Design Goals

1. **System-level quality floor**: Even without LLM, every memory should be structurally sound
2. **Dual-mode**: Rules-based baseline (free) + LLM-powered premium (with API key)
3. **No new tools**: Formation is internal processing, not a new MCP tool
4. **Non-breaking**: Existing `memorix_store` schema unchanged; Formation is a middleware layer
5. **Measurable**: Each stage produces metrics that feed into future eval

## 3. Architecture Overview

```
                    ┌─────────────────────────────────────────────┐
                    │            Memory Formation Pipeline         │
                    │                                             │
  memorix_store ──► │  ┌──────────┐  ┌──────────┐  ┌──────────┐  │
                    │  │  Stage 1  │  │  Stage 2  │  │  Stage 3  │  │ ──► storeObservation()
  hooks ──────────► │  │  Extract  ├─►│  Resolve  ├─►│ Evaluate  │  │
                    │  │          │  │          │  │          │  │
                    │  └──────────┘  └──────────┘  └──────────┘  │
                    │                                             │
                    │  Runs BEFORE compact-on-write               │
                    └─────────────────────────────────────────────┘
```

## 4. Stage Definitions

### Stage 1: Extract (Fact Extraction + Normalization)

**Input**: Raw `{ title, narrative, facts, entityName, type }` from caller  
**Output**: Enriched `{ title, narrative, facts, entityName, type }` with system-extracted data

#### Rules-based mode (no LLM):
- **Fact extraction**: Parse narrative for key-value patterns (`X: Y`, `X = Y`, `X → Y`), error messages, version numbers, file paths, URLs
- **Title normalization**: If title is generic ("Updated file.ts", "Session activity"), generate a more descriptive title from first meaningful sentence of narrative
- **Entity resolution**: If entityName is a raw filename ("file-lock"), try to resolve to a more meaningful entity by checking existing entity names in the Knowledge Graph
- **Type inference**: If type seems wrong (e.g., agent says "discovery" but content contains error stack trace), suggest correction

#### LLM mode:
- Single LLM call: "Extract the 3-5 most important atomic facts from this content. Suggest a canonical entity name. Verify the observation type."
- Merge LLM-extracted facts with caller-provided facts (dedup by semantic overlap)

### Stage 2: Resolve (Entity Resolution + Memory Consolidation)

**Input**: Enriched observation from Stage 1  
**Output**: Resolution decision: `{ action: 'new' | 'merge' | 'evolve', targetId?: number }`

This replaces the current "Compact on Write" step with a richer model:

#### Resolution types:
- **new**: Truly new knowledge, no related existing memory → proceed to store
- **merge**: Same topic as existing memory, combine → UPDATE existing
- **evolve**: Existing memory is outdated, new one supersedes → UPDATE with rewrite
- **discard**: Process noise, not reusable knowledge → skip storage

#### Rules-based mode:
- Search existing memories (same as current compact search)
- Compare entity names (exact match, substring match, shared file paths)
- Score: similarity × entity_overlap × recency_weight
- Decision thresholds: merge (>0.75), evolve (>0.60 + contradiction detected), discard (duplicate >0.85)

#### LLM mode:
- Enhanced version of current `compactOnWrite()` prompt, but with explicit instructions for entity resolution and evolution detection

### Stage 3: Evaluate (Knowledge Value Assessment)

**Input**: Observation + resolution decision  
**Output**: `{ valueScore: 0-1, valueCategory: 'core' | 'contextual' | 'ephemeral', reason: string }`

This is the **new layer** that doesn't exist today. It answers: "Is this worth storing as long-term memory?"

#### Rules-based scoring:
```
score = base_type_weight
      + fact_density_bonus        (facts.length / narrative.length)
      + specificity_bonus         (has file paths, version numbers, error codes)
      + causal_bonus              (has "because", "therefore", "due to")
      - generic_penalty           (title matches LOW_QUALITY_PATTERNS)
      - noise_penalty             (narrative is mostly tool output, not knowledge)
```

#### Value categories:
- **core** (score >= 0.7): Architecture decisions, gotchas, problem-solutions with root cause → store with high importance
- **contextual** (0.4 <= score < 0.7): File changes, command results with context → store with normal importance
- **ephemeral** (score < 0.4): Process logs, trivial changes → discard or store with auto-decay flag

#### LLM mode:
- Ask LLM: "Rate this memory's long-term value (0-1) and classify as core/contextual/ephemeral. Explain why."

## 5. Object Model

```typescript
/** The intermediate representation produced by the Formation Pipeline */
interface FormedMemory {
  // Original input (may be enriched)
  entityName: string;
  type: ObservationType;
  title: string;
  narrative: string;
  facts: string[];
  
  // Formation metadata
  formation: {
    /** Facts extracted by the system (not provided by caller) */
    extractedFacts: string[];
    /** Entity resolved from Knowledge Graph, or null */
    resolvedEntity: string | null;
    /** Whether title was auto-improved */
    titleImproved: boolean;
    /** Whether type was auto-corrected */
    typeCorrected: boolean;
  };
  
  // Resolution decision
  resolution: {
    action: 'new' | 'merge' | 'evolve' | 'discard';
    targetId?: number;
    reason: string;
  };
  
  // Value assessment
  value: {
    score: number;        // 0-1
    category: 'core' | 'contextual' | 'ephemeral';
    reason: string;
  };
  
  // Pipeline metadata
  pipeline: {
    mode: 'rules' | 'llm';
    durationMs: number;
    stagesCompleted: number;
  };
}
```

## 6. Integration Points

### Where it plugs in:

**Current flow** (memorix_store in server.ts):
```
Input → Compact on Write → LLM Compression → storeObservation() → Graph
```

**New flow**:
```
Input → Formation Pipeline (Extract → Resolve → Evaluate) → storeObservation() → Graph
```

- Formation Pipeline **replaces** Compact on Write (absorbs its functionality into Stage 2)
- Formation Pipeline **replaces** LLM Narrative Compression (moves it into Stage 1)
- `storeObservation()` remains unchanged

**For hooks** (handler.ts):
```
Current: normalizeHookInput → classifyTool → buildObservation → storeObservation
New:     normalizeHookInput → classifyTool → buildObservation → Formation Pipeline → storeObservation
```

### New file structure:
```
src/memory/
  formation/
    index.ts          # Pipeline orchestrator: runFormation(input) → FormedMemory
    extract.ts        # Stage 1: Fact extraction + normalization
    resolve.ts        # Stage 2: Entity resolution + consolidation (absorbs compact)
    evaluate.ts       # Stage 3: Knowledge value assessment
    types.ts          # FormedMemory, stage interfaces
```

## 7. Migration Strategy

1. **Phase A**: Build Formation Pipeline as a standalone module with unit tests
2. **Phase B**: Wire into `memorix_store` (server.ts), replacing compact-on-write
3. **Phase C**: Wire into hooks (handler.ts), replacing `buildObservation()`'s template logic
4. **Phase D**: Add pipeline metrics to dashboard

Each phase is independently shippable and testable.

## 8. Rules-based Quality Guarantees (No LLM)

Even without LLM, the pipeline should:

| Aspect | Current | After Formation |
|--------|---------|----------------|
| Fact extraction | None (caller-provided only) | Regex-based key-value, error, path extraction |
| Entity resolution | Caller-provided entityName | Match against existing KG entities |
| Title quality | "Updated file.ts" from hooks | First meaningful sentence extraction |
| Noise filtering | `significanceFilter` (pattern matching) | Value score with multi-factor assessment |
| Dedup | Similarity threshold only | Similarity + entity overlap + contradiction detection |

## 9. LLM Quality Uplift

With LLM, each stage gets a single-call enhancement:

| Stage | LLM Enhancement |
|-------|----------------|
| Extract | 3-5 atomic facts + entity suggestion + type verification |
| Resolve | Semantic similarity + contradiction detection + rewrite |
| Evaluate | Value assessment with explanation |

**Key design choice**: Each stage makes **at most 1 LLM call**. Total pipeline = max 3 LLM calls per store operation. In practice, Stage 2 and 3 can share a call, so typical = 2 calls.

## 10. Success Metrics (for future Eval)

- **Fact density**: avg facts per observation (before vs after)
- **Title quality**: % of non-generic titles
- **Entity coherence**: % of observations linked to existing KG entities
- **Noise rejection rate**: % of ephemeral content discarded
- **Duplicate reduction**: observation count growth rate (lower = better)
- **LLM uplift delta**: quality scores with vs without LLM
