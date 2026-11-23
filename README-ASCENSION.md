# SpacePipe Ascension API & Copilot Action Architecture

## Overview
The **Ascension API** is SpacePipe Studio's hardened backend infrastructure and security gateway connecting the AI Copilot to system capabilities: deep GraphRAG introspection and mutation, sandboxed filesystem execution, direct neural voice/avatar generation, GitHub Actions YAML injection, live SSE telemetry streaming, and a multi-tier operator kill switch.

---

## Architecture & Security Tiers

All actions dispatched by the Copilot pass through a unified three-tier security and authorization model:

| Tier | Authorization Policy | Action Hooks & Capabilities |
| :--- | :--- | :--- |
| **Tier 0** | Immediate Execution (Read-Only / Streaming) | `STREAM_LIVE_LOGS`, `READ_FILE`, `INTROSPECT_NODE_LINKAGE`, `REVEAL_VECTOR_EMBEDDINGS`, `FETCH_RAW_AUDIO`, `GET_SERVER_LOGS` |
| **Tier 1** | Auto-Apply Allowed (State mutations with undo snapshots) | `MUTATE_KNOWLEDGE_GRAPH`, `WRITE_FILE`, `SYNTHESIZE_VOX`, `RENDER_AVATAR_DIRECT`, `CLONE_VOICE_PROFILE`, `SYNC_CRON`, `SEND_DISCORD_MESSAGE`, `SEND_SLACK_MESSAGE` |
| **Tier 2** | Explicit Confirmation Required (Typed human confirmation + justification) | `EXECUTE_BASH_COMMAND`, `WRITE_WORKFLOW_FILE`, `TOGGLE_KILL_SWITCH` |

---

## Security Guardrails & Enforcements

1. **Path Traversal Defense**:
   * Reads (`POST /api/ascension/fs/read`) are strictly constrained to `./data/`, `./public/`, `./docs/`, and `.github/workflows/`.
   * Writes (`POST /api/ascension/fs/write`) are strictly constrained to `./data/` and `.github/workflows/`.
   * Any path containing `..`, absolute escapes, or targeting `.env*`, `id_rsa`, or credentials files is immediately rejected with HTTP 403.
2. **Secret Leak Prevention**:
   * All written files and workflow templates are scanned with regex patterns for sensitive credentials (`github_token`, `ghp_`, `API_KEY`, `Bearer`, `password:`, `token =`).
   * Hardcoded credentials are rejected with HTTP 400. Standard GitHub Actions secrets expressions (e.g. `${{ secrets.GITHUB_TOKEN }}`) remain fully permitted.
3. **Sandboxed Command Execution Allowlist**:
   * `EXECUTE_BASH_COMMAND` (`POST /api/ascension/fs/exec`) executes strictly through `child_process.spawnSync` without shell invocation.
   * **Allowlist**: `ls`, `dir`, `cat`, `ffprobe`, `ffmpeg` (probe only), `sha256sum`, `stat`, `du`, `df`, `wc`.
   * Metacharacters (`;`, `&&`, `||`, `|`, `$()`, backticks, `>`, `<`) and unauthorized programs (`rm`, `eval`, `sudo`, `curl`, `wget`, `bash`, `powershell`) trigger immediate rejection.
   * Execution timeout: 15 seconds. CWD: sandboxed `./data/`.
4. **Operator Kill Switch**:
   * Levels: `resume` (normal full operation), `pause` (Tier 1 & 2 locked to read-only; Tier 0 remains active), `permanent` (all non-Tier-0 mutations permanently forbidden with HTTP 403).
   * State persisted to `./data/audit/kill_switch_state.json`.
5. **Audit Trail**:
   * Every non-Tier-0 invocation automatically logs to `./data/audit/wizard_audit.jsonl` with hashed IP address, user identity, redacted parameters, timestamp, and result status.

---

## API Reference & Endpoints

### 1. GraphRAG Deep Introspection & Mutation

#### `POST /api/ascension/graph/introspect` (Tier 0)
Traverses the knowledge graph topology around an episode or query without keyword limitations.
* **Request**:
  ```json
  {
    "query": "eviction fundraiser",
    "episodeTag": "AQ-0118"
  }
  ```
* **Response**:
  ```json
  {
    "ok": true,
    "stats": { "totalNodes": 120, "totalEdges": 85, "matchedPairings": 4 },
    "pairings": [ ... ],
    "nodes": [ ... ],
    "edges": [ ... ]
  }
  ```

#### `POST /api/ascension/graph/mutate` (Tier 1)
Forges graph nodes, adds contradiction edges, reloads episodes, or purges corrupted vectors.
* **Request**:
  ```json
  {
    "type": "add_node",
    "episodeTag": "AQ-0118",
    "nodeData": {
      "id": "node_eviction_fundraiser",
      "label": "Eviction Fundraiser Organization",
      "speaker": "Logan Black",
      "type": "event"
    }
  }
  ```
* **Response**: Emits `spacepipe:graph-mutated` SSE event and returns updated graph stats.

#### `POST /api/ascension/graph/query-embeddings` (Tier 0)
Performs vector similarity search over the indexed transcript and statement corpus.
* **Request**:
  ```json
  {
    "text": "statements regarding NDA collection",
    "topK": 5
  }
  ```

---

### 2. Sandboxed Filesystem Commands

#### `POST /api/ascension/fs/read` (Tier 0)
Reads sandboxed text or binary file contents.
* **Request**:
  ```json
  {
    "path": "data/notes.txt",
    "encoding": "utf8"
  }
  ```

#### `POST /api/ascension/fs/write` (Tier 1)
Writes text or base64 data to permitted directories (`./data/` or `.github/workflows/`).
* **Request**:
  ```json
  {
    "path": "data/research_summary.txt",
    "content": "Verified timeline findings..."
  }
  ```

#### `POST /api/ascension/fs/exec` (Tier 2)
Executes allowlisted system utility commands inside `./data/`.
* **Request**:
  ```json
  {
    "command": "ls",
    "args": ["-la"],
    "reason": "Verify rendered output files in data directory"
  }
  ```

---

### 3. Audio & Video Synthesis

#### `POST /api/ascension/vox/synthesize` (Tier 1)
Directly calls VoxCPM-2 speech synthesis without confirmation barriers.
* **Request**:
  ```json
  {
    "text": "The timeline of disclosures begins in early 2026.",
    "voiceId": "Logan",
    "speed": 1.0
  }
  ```

#### `POST /api/ascension/avatar/render` (Tier 1)
Directly calls LivePortrait neural video render.
* **Request**:
  ```json
  {
    "audioUrl": "/output/vox_take_01.wav",
    "avatarId": "avatar_angela"
  }
  ```

#### `POST /api/ascension/voice/clone` (Tier 1)
Deep-copies an enrolled 192-dimensional ECAPA voice fingerprint.
* **Request**:
  ```json
  {
    "sourceProfileId": "Logan",
    "name": "Logan_Reference_Clone"
  }
  ```

---

### 4. Workflow & Cron Management

#### `POST /api/ascension/workflow/write` (Tier 2)
Writes validated GitHub Actions workflow YAML files into `.github/workflows/`.
* **Request**:
  ```json
  {
    "filename": "monitor.yml",
    "content": "name: Pipeline Monitor\non:\n  schedule:\n    - cron: '0 */4 * * *'\njobs:\n  check:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo OK\n",
    "commitMessage": "ci(workflow): install automated monitor cron"
  }
  ```

#### `POST /api/ascension/pipeline/cron-sync` (Tier 1)
Compares and synchronizes cron expressions between `config.json` and `.github/workflows/auto_detect_spaces.yml`.
* **Request**:
  ```json
  {
    "action": "sync",
    "direction": "config_to_workflow"
  }
  ```

---

### 5. Telemetry & Proactive Notification

#### `GET /api/ascension/logs/stream` (SSE, Tier 0)
Streams real-time server events, workflow logs, and mutation signals (`text/event-stream`).

#### `POST /api/ascension/notify/discord` & `POST /api/ascension/notify/slack` (Tier 1)
Sends notifications to configured webhooks. Destination URLs are resolved server-side from configuration to prevent SSRF vulnerabilities.

---

### 6. Audit Trail & Kill Switch

#### `POST /api/ascension/audit/log` (Tier 0/1)
Appends an entry to `./data/audit/wizard_audit.jsonl`.

#### `GET` / `POST` / `DELETE /api/ascension/kill-switch` (Tier 0 / Tier 2)
Queries or adjusts the safeguard operating state (`resume`, `pause`, `permanent`).
* **Request**:
  ```json
  {
    "level": "pause",
    "reason": "Scheduled maintenance"
  }
  ```
