# sangyi-tui Feature Enhancement Plan

## Project Overview

| Attribute | Detail |
|-----------|--------|
| **Name** | sangyi-tui |
| **URL** | https://sangyi-tui.vercel.app |
| **Stack** | Vanilla JS + DuckDB WASM + Vercel Edge API + Anthropic SDK |
| **Design** | Apple glassmorphism dark mode |
| **Differentiator** | Zero backend state, 32 agents catalog, client-side multi-agent orchestration, SQL-queryable local data |

## Current Features (Completed)

- **SSE Streaming Chat**: Multi-turn conversation with markdown rendering, tool call display
- **DuckDB WASM + IndexedDB**: 10-table schema with full persistence across sessions
- **Workspace Management**: Multi-workspace support, inline rename, per-workspace system prompts
- **Agent/Skill/Guide Catalogs**: 32 agents, 16 skills, 7 guides with toggle switches
- **Agent Teams UI**: Create teams, add members, task CRUD with drag-and-drop
- **@Mention Autocomplete**: Fuzzy search with keyboard navigation
- **Cost Tracking**: Token usage badge with composable system prompts

## Incomplete Features

These features have partial implementation (CSS/DB/modules exist) but are not wired up:

| Feature | What Exists | What's Missing |
|---------|-------------|----------------|
| Delete Workspace | HTML button, CSS styles, `deleteWorkspace()` in db.js | Click event listener in app.js |
| Model Selector | CSS `.model-select-list/item`, API `ALLOWED_MODELS`, DB `workspaces.model` column | Badge click → modal → updateWorkspace flow |
| @Mention Routing | Complete `mentions.js` with `extractMentionedAgent()` | Not imported in app.js, no agent system prompt injection |
| Agent Team Execution | Complete `teams.js` (528 lines) | Not imported in app.js, no "Run Team" button |

## Recommended Enhancements

### 1. Delete Workspace Button

| Attribute | Detail |
|-----------|--------|
| **Complexity** | XS (~15 min) |
| **Rationale** | Basic UX requirement; all backend logic already exists |
| **Dependencies** | None |

**Implementation Approach:**
- Add click event listener to existing delete button in `app.js`
- Show confirmation modal before deletion
- Call existing `deleteWorkspace(id)` from `db.js` (cascade deletes conversations, messages, etc.)
- Switch to another workspace or create default after deletion

**Key Files:**
- `app.js` - Add click listener + confirm dialog

---

### 2. Model Selector Modal

| Attribute | Detail |
|-----------|--------|
| **Complexity** | XS-S (~30 min to 1 hr) |
| **Rationale** | Allows users to switch between Claude models per workspace |
| **Dependencies** | None |

**Implementation Approach:**
- Wire existing model badge click to open modal overlay
- Populate modal with models from `ALLOWED_MODELS` list
- On selection, call `updateWorkspace()` to persist model choice
- Update badge text to reflect selected model
- Pass selected model in API request body

**Key Files:**
- `app.js` - Badge click handler, modal open/close, model selection logic

---

### 3. @Mention → Agent Routing

| Attribute | Detail |
|-----------|--------|
| **Complexity** | S (~1-2 hr) |
| **Rationale** | Core multi-agent feature; lets users direct messages to specific agents |
| **Dependencies** | None (mentions.js is complete) |

**Implementation Approach:**
- Import `mentions.js` in `app.js`
- In `sendChatMessage()`, call `extractMentionedAgent()` to detect @mentions
- Inject mentioned agent's `system_prompt` into the API call
- Display agent icon + name on response bubble using existing CSS `.message-subagent`
- Handle multiple mentions (pick primary or chain)

**Key Files:**
- `app.js` - Import mentions module, integrate with chat send flow

---

### 4. Agent Team Execution ★ Key Differentiator

| Attribute | Detail |
|-----------|--------|
| **Complexity** | M-L (~3-4 hr) |
| **Rationale** | Biggest differentiator - client-side multi-agent orchestration with parallel execution |
| **Dependencies** | Feature 3 (agent-labeled bubble pattern reuse) |

**Implementation Approach:**
- Import `teams.js` in `app.js`
- Add "Run Team" button to team panel header
- On click, iterate assigned tasks and fire parallel API calls (one per agent)
- Each API call uses the assigned agent's system prompt
- Stream responses into agent-labeled bubbles (reuse subagent bubble CSS)
- Auto-update task status: `pending` → `in_progress` → `completed`
- Show aggregate progress indicator

**Key Files:**
- `app.js` - Import teams module, add run button handler
- `teams.js` - Add `runTeam()` function for parallel execution

---

### 5. DuckDB SQL Console ★ Architecture Differentiator

| Attribute | Detail |
|-----------|--------|
| **Complexity** | S-M (~1.5-2 hr) |
| **Rationale** | Showcases "all data is SQL-queryable in the browser" architecture story |
| **Dependencies** | None |

**Implementation Approach:**
- Add `Cmd+K` keyboard shortcut listener in `app.js`
- Open modal with SQL input textarea and results area
- Execute queries via existing `conn.query(sql)` DuckDB connection
- Render Arrow results as HTML table
- Include preset query buttons (e.g., "All Messages", "Token Usage", "Agent Stats")
- Add syntax highlighting for SQL input (optional)

**Key Files:**
- `app.js` - Cmd+K listener, modal management, query execution
- `style.css` - Table styling for query results

---

## Implementation Order

```
Phase 1 (Parallel - Quick Wins):
├── Feature 1: Delete Workspace Button  [XS]
└── Feature 2: Model Selector Modal     [XS-S]

Phase 2 (Parallel):
├── Feature 3: @Mention Agent Routing   [S]
└── Feature 5: DuckDB SQL Console       [S-M]

Phase 3 (Sequential - depends on Phase 2):
└── Feature 4: Agent Team Execution     [M-L]
```

**Total Estimated Time**: ~7-10 hours

## Agent Teams Strategy

```
Team: tui-enhancement

Parallel Group A (Phase 1):
├── Agent 1 (fe-vercel-agent): Fix delete workspace + model selector
│   Scope: app.js event handlers, modal logic
│   Complexity: XS combined
│
└── Agent 2 (lang-typescript-expert): Integrate @mention routing
    Scope: app.js + mentions.js integration
    Complexity: S

Parallel Group B (Phase 2):
├── Agent 3 (general-purpose): Integrate team execution
│   Scope: app.js + teams.js integration, runTeam()
│   Complexity: M-L
│
└── Agent 4 (general-purpose): Build DuckDB SQL console
    Scope: app.js Cmd+K handler, modal, table rendering
    Complexity: S-M
```

### Critical Constraint: CSS↔JS Class Name Contract

When spawning parallel agents that touch both CSS and JS, define class names upfront:

| Element | Class Name |
|---------|------------|
| User message | `.message-user` |
| Agent response bubble | `.message-subagent` |
| Delete button | `.workspace-delete-btn` |
| Model badge | `.model-badge` |
| SQL console modal | `.sql-console-modal` |
| SQL result table | `.sql-result-table` |

## Demo Script

1. **Create workspace** → rename it → show model selector
2. **@mention an agent** → show routed response with agent label
3. **Create a team** → assign tasks → click "Run Team" → watch parallel responses
4. **Open SQL console** (Cmd+K) → query messages table → show local data power
5. **Delete workspace** → confirm → clean removal
