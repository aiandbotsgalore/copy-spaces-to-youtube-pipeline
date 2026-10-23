# SpacePipe Studio redesign: handoff

## Brief
Redesign the UI for "SpacePipe Studio", an audio pipeline dashboard: ingest live X Spaces, transcripts, clips, podcast feeds.
- **Hard rules:** no helper text or instructional copy. Hierarchy, icons and state should explain themselves. Tooltips (`title`) are allowed.
- **Style:** dark and dense, like a DAW or a DevOps console.
  - Background `#0B0F17`, cards `#131B2E`, rows `#0f1626`, borders `#1E293B`.
  - Status colors: cyan `#22d3ee`, emerald `#34d399`, amber `#fbbf24`, pink `#f472b6`, live red `#f43f5e`.
  - Primary is an accent var pair `--a0`/`--a1`; Tweaks recolor it.
- Source codebase: `copy-spaces-to-youtube-pipeline`, mounted locally. The main view is `components/TranscriptPanel.tsx`.

## Files
- `SpacePipe Transcripts.dc.html` is the main deliverable. It's a single Design Component holding every view.
- `SpacePipe Transcripts v1.dc.html` is a backup taken before the v2 features.
- Fonts: IBM Plex Sans and JetBrains Mono. Inline styles only.

## Tweaks (props)
- `accent`: Indigo, Ember or Aurora.
- `density`: Compact, Default or Roomy (zoom).
- `atmosphere`: Flat, Nebula or Grid.

## Views
`state.view` takes one of these keys:
- `t` Transcripts
- `m` Montage
- `b` Best Clips
- `c` Copilot
- `cc` Command Center
- `i` Ingest
- `l` Library
- `v` Voices
- `ps` Settings

## Transcripts

### Layout
- **Episode list:** All, Ready and Audio filter chips with counts (864, 702, 162). The coloured dots double as a legend. Cards show the host handle, date, runtime and a status dot.
- **Live episode:** the live entry (E[12], Night Shift) is pinned at the top.
- **Narrow widths:** below 1120px (adjusted for zoom), the list becomes a drawer, opened by the ☰ button beside the title.

### Header and player
- **Header:** host, date and runtime pill, then Cache, Speakers (27 → Voice Profiles) and Export ▾. Export holds Publish preview, Copy, .txt, .json and Source Space.
- **Waveform:** height clamps to the viewport. Suggested-clip bands (scored) sit on top; clicking a band selects that turn. Below it runs a speaker lane: segments are coloured per turn, grow on hover with a tooltip, seek on click, and dim when filtered out.
- **Transport:** −15s, play, +15s. A clock toggle reveals the ±0.1s sync controls. A LIVE chip shows on live episodes.

### Transcript pane
- **Pane header:** find-in-episode with a hit count, speaker filter chips, and a follow-playhead toggle.
- **Rows:**
  - Fixed grid: time, speaker badge, text (68ch max), Add to Reel on hover.
  - Every word is clickable to seek.
  - In the active row, words already spoken are brighter.
  - Search hits are highlighted.
  - Rows alternate with a subtle stripe.
- **Follow vs free scroll:** scrolling by wheel switches to free scroll, and a playhead pill appears to jump back.
- **Selection:** drag across words (`ss`/`se` = turnIdx*1000 + wordIdx). A floating bar shows the range and duration, with Clip (adds to the Reel), Ask (sends to Copilot with the quote attached), Copy and clear.

### Other states
- **Global search:** opens a results overlay grouped by episode. Clicking a hit opens that episode at the timestamp, with find-in-episode pre-filled.
- **Queued episodes:** a stage stepper (Fetch → Transcribe → Diarize → Index), queue position, ETA and Prioritize.
- **Live episodes:** `state.live` ticks every second and a new turn lands every 6s (the `LP` pool). The LIVE chip jumps to the live edge.
- **Reel tray:** pinned to the bottom of the inspector. The Reel popover anchors to whichever trigger opened it (`reelFrom`).

### Overlays
- **Shortcuts:** opened with `?`. Shortcuts: Space, ←/→ (1s), ⇧←/→ (15s), `,`/`.` (sync), F (follow), Esc (close or clear).
- **Publish preview:** feed visibility, cover-art placeholder, meta line, chapters taken from turns (click to seek), Copy RSS and Publish.

## Other views
- **Copilot:** attached-context chips (Episode, Selection, Reel), each toggleable; the selection chip can be removed. A quote card shows the attached selection. Suggestions change with the context. Replies carry timestamp ref chips that jump back to the transcript, or to the Best Clips and Command Center views.
- **Pipeline Settings:** six sections.
  - Ingest: auto-record, watched-host chips you can add or remove, concurrency, format.
  - Strict Mode.
  - Transcription.
  - Clips: auto-suggest, min score, max length.
  - Publishing.
  - Storage: cache retention, which drives the disk bar; keep raw recordings.
- **Montage, Best Clips, Command Center, Ingest, Library, Voices:** unchanged from v1. All checked at 924×540.

## Known gaps (design)
- Search results reuse the shared placeholder transcript, so snippets repeat across episodes.
- No real audio, and all data is placeholder.
- When Pipeline Settings is expanded, the sidebar nav scrolls at short heights.

---

# Integration plan

This part maps the design onto the real app (`copy-spaces-to-youtube-pipeline`). Give Claude Code one phase at a time: paste that phase, and keep `SpacePipe Transcripts.dc.html` open as the visual reference (copy it to `docs/design/` in the repo).

**Status labels**
- **Ready:** the data or function exists today.
- **Derive:** it can be computed client-side from existing data.
- **Missing:** the pipeline or backend has to produce something new.

## What the app is today
- **Stack:** Vite, React 19, Tailwind v4 and lucide-react. There's no app server; Vite middleware provides `/api/fetch-asset`, `/api/upload-asset`, `/api/montage/direct` (Director and Copilot) and the audio proxy.
- **Data:** everything comes from GitHub Releases plus static JSON in `public/transcripts/`:
  - `transcripts_summary_index.json`: the episode list (`EpisodeSummary`).
  - `episodes/{tag}.json`: `{ release_id, release_tag, title, published_at, audio_url, segments: [{start, end, speaker, text, words?}] }`.
  - `transcription_status.json`: queue counts and `next_in_queue[]`.
  - Clips come from `public/clips/clips_catalog.json` and the `*_clips.json` release assets (`ClipItem`: `start_seconds`, `end_seconds`, `viral_score`).
- **Contexts:**
  - `PlayerContext`: `play`, `seek`, `skip`, `togglePlay`, `currentTime`, `duration`. It binds global keys: Space, ←/→ for ±15s, and M.
  - `MontageContext`: `addClip(MontageClipItem)`. This is the Reel.
  - `CopilotContext`: `contextPayload` and `sendMessage`; messages carry `matches: TranscriptMatch[]`.
  - `ConfigContext`: `EnhancedConfig`, saved in localStorage.
- **TranscriptPanel.tsx is 4,366 lines.** It holds the loaders (`fetchSummaryIndex`, `getEpisodeSegments`), the parsing (`parseTranscriptData` → `ParsedUtterance[]`), word timing (`getUtteranceWords`, which interpolates words when `words` is absent), search (`utils/searchWorker`), speaker renames, cache and exports.

## Phase 0: the date glitch (S)
- Fix `TranscriptPanel.tsx` around line 2542, in the sidebar card row `flex items-center gap-2 mt-1 flex-wrap`:
  - Add `whitespace-nowrap` to the date `<span>` on line 2543.
  - Change the row to `flex-nowrap min-w-0`.
- Apply the same fix to the header meta row around line 3751: add `whitespace-nowrap` to the date span on line 3752.

## Phase 1: foundation (M)
1. **Design tokens:** add them to `index.css` under `@theme`:
   - Surfaces: `--color-bg: #0B0F17`, `--color-card: #131B2E`, `--color-row: #0f1626`, `--color-line: #1E293B`.
   - Status: cyan `#22d3ee`, emerald `#34d399`, amber `#fbbf24`, pink `#f472b6`, live `#f43f5e`.
   - Accent: `--color-a0` and `--color-a1`.
2. **Fonts:** load IBM Plex Sans and JetBrains Mono in `index.html`, and set them as `--font-sans` and `--font-mono`.
3. **Move pure logic out of TranscriptPanel** into `utils/transcriptData.ts`:
   - the loaders, `parseTranscriptData`, `getUtteranceWords`, `formatSeconds`, `getSpeakerTheme` and the speaker color maps.
   - Change no behaviour in this step.
4. **Split the view into `components/transcript/`.** Each file takes props only; the state stays in `TranscriptPanel`:
   - `EpisodeList.tsx` (and `EpisodeDrawer` below 1120px)
   - `EpisodeHeader.tsx`, `ExportMenu.tsx`
   - `Waveform.tsx`, `SpeakerLane.tsx`, `ClipBands.tsx`, `Transport.tsx`
   - `TranscriptPane.tsx`, `TranscriptRow.tsx`, `SelectionBar.tsx`
   - `GlobalSearchOverlay.tsx`, `ShortcutsOverlay.tsx`, `PublishPreview.tsx`, `QueuedEpisode.tsx`
5. **Nav:** in `App.tsx`, map the design's view keys to `Panel` values:
   - `t` → `transcripts`
   - `m` → `montage`
   - `b` → `clips`
   - `c` → `ai-copilot`
   - `cc` → `dashboard`
   - `i` → `submit-space`
   - `l` → `library`
   - `v` → `voice-profiles`
   - `ps` → `config`

## Phase 2: Transcripts core, with no backend changes (L)

**Episode list**
- **List:** `effectiveReleases` (Ready).
- **Filter chips:**
  - All, Ready (a transcript asset or segments are present) and Audio (mp3 only). Counts come from the list (Derive).
- **Status dot:**
  - Ready → emerald.
  - Audio → slate.
  - Tag listed in `transcription_status.next_in_queue` → amber (Ready).
  - Live → Missing (see Phase 6).
- **Date:** `getEpisodeRecordedDate(release).displayDate` (Ready).
- **Runtime:** use `transcriptMetadata.audioDurationSec` or the last segment's `end` (Derive). The list needs it before the transcript loads, so add `duration_sec` to the summary index (Missing).
- **Host handle:** Missing. Add `host_handle` to the summary index (yt-dlp `uploader_id`). Hide it when absent.

**Header**
- **Title:** `release.name` (Ready).
- **Cache:** the existing `handleToggleCacheCurrentAudio` (Ready).
- **Speakers:** `speakerStats.length` (Ready). Clicking it navigates to `voice-profiles`.
- **Export ▾:**
  - Copy, .txt and .json use the existing export handlers (Ready).
  - Source Space: take the URL from `release.body` (check the format).
  - Publish preview: Phase 4.

**Player**
- **Playhead:** `usePlayer().currentTime`; clicking calls `seek(t)` (Ready).
- **Transport:** `skip(±15)` and `togglePlay` (Ready).
- **±0.1s sync:** the existing `timeOffsetSec` and `audioSeekOffsetSec` (Ready).
- **Speaker lane:** one segment per utterance (`startSec`, `endSec`, `speaker`), coloured with `getSpeakerTheme`, dimmed when its speaker is filtered out (Derive).
- **Waveform:** peaks are Missing.
  - Until they exist, render the speaker lane at full waveform height.
  - Don't decode in the browser: a 2-hour mp3 decodes to roughly 1.3 GB of PCM.

**Transcript pane**
- **Rows:** `utterances` in a fixed grid: time, speaker badge (fixed width), text (max 68ch), Add to Reel on hover. Add to Reel calls the existing `handleAddTurnToMontage` (Ready).
- **Active row:** binary-search `utterances` for `startSec ≤ currentTime + offset < endSec` (Derive). Auto-scroll it into view only while follow is on.
  - Use `container.scrollTo`, not `scrollIntoView`.
  - A wheel event sets follow to off and shows the playhead pill.
- **Word seek:** `getUtteranceWords(u)`, then `seek(word.start)` (Ready). The sample episode JSON has no `words`, so the timings are interpolated and roughly right. For exact timings, see Phase 6.
- **Find in episode:** the existing `evaluateTurnMatch` and `highlightTranscriptMatches` (Ready).
- **Speaker chips:** `speakerStats` (Ready).

## Phase 3: cross-view features (M)
- **Drag selection (`SelectionBar`):** track `{turnIdx, wordIdx}` anchors on pointerdown and pointermove over the word spans. All three actions are Ready:
  - **Clip:** `addClip({ speaker, quote: joined words, startSec: firstWord.start, endSec: lastWord.end, sourceTitle, sourceTag, audioUrl })`.
  - **Ask:** `copilot.setContextPayload(p => ({ ...p, selectedText }))`, then navigate to `ai-copilot`.
  - **Copy:** `navigator.clipboard.writeText`.
- **Suggested-clip bands:**
  - Move `ClipsPanel.loadClips` into `utils/clipCatalog.ts` so both panels share it.
  - Filter by `release_tag`, and draw `start_seconds` to `end_seconds` with opacity set by `viral_score`. Clicking a band seeks and selects that span (Ready).
- **Copilot context chips:** each chip maps 1:1 onto `CopilotContextPayload`:
  - Episode → `currentEpisode`
  - Selection → `selectedText`
  - Reel → `activeMontageClips`
  - Toggling a chip omits that field through `sendMessage(content, override)`.
  - The quote card renders `selectedText`.
- **Copilot timestamp chips:** take them from `message.matches[]` (`episode_id`, `start_timestamp`, `formatted_time`). Clicking one runs the existing `LOAD_EPISODE` and `PLAY_AUDIO` actions (Ready).
- **Reel tray and popover:** `useMontage().clips` (Ready). The popover anchors to its trigger; keep a `reelFrom` ref.

## Phase 4: overlays (M)
- **Global search:** reskin the existing `searchScope === 'all'` view and `workerSearchResults` as an overlay, grouped by `release_tag` (Ready). Clicking a hit:
  - calls `setSelectedId(release_id)` and `seek(segment.start)`;
  - pre-fills find-in-episode with the query.
- **Shortcuts:** `PlayerContext` already binds Space, ←/→ (15s) and M. Change it to match the design:
  - ←/→ = 1s, ⇧←/→ = 15s. Keep M.
  - Register F, `,`/`.`, `?` and Esc in `TranscriptPanel` only while it's mounted.
  - Skip all of them when focus is in an input or textarea.
- **Publish preview:** build it from `RSSPreview.tsx` (feed URL `https://{owner}.github.io/{repo}/podcast.xml`).
  - Chapters: derive them from the turns for the preview.
  - The Publish button: Missing. The workflow builds the feed today, so the button would trigger the workflow through the existing `utils/github` helpers.

## Phase 5: Pipeline Settings (M)
Add the new fields to `EnhancedConfig` with defaults in `DEFAULT_CONFIG`. Each field falls into one of three groups.

**Ready (already in `EnhancedConfig`)**
- `enableTranscription`, `enableScheduledMonitoring`, `scheduledCron`, `platforms` and `batchUrls`.
- `podcastTitle`, `podcastDescription`, `authorName`, `email`, `imageUrl` and the artwork.
- The Slack and Discord webhooks, for publishing notifications.

**Client-only (new fields; they work immediately)**
- Clips: min score and max length, which filter the bands and Best Clips.
- Storage: cache retention, applied through `getAllCachedAudioKeys` and `removeCachedAudio`.
- The disk bar: `navigator.storage.estimate()`.

**Pipeline (new fields; they only work once written into `utils/templates.ts` and the workflow is redeployed through `DeployWizard`)**
- Watched hosts, concurrency, format and Strict Mode.
- Transcription model and language, and keep-raw.
- Auto-suggest for clips.

## Phase 6: pipeline outputs (the Missing items)
These go in the ingest and transcription scripts in the repo (the Python side, `scripts/` and `.github/workflows`):
1. **Summary index fields:** add `duration_sec` and `host_handle` to each entry in `transcripts_summary_index.json`.
2. **Peaks:** write `{tag}_peaks.json` (about 2 values per second, int8 or 0–255, roughly 15 KB per hour) as a release asset or under `public/transcripts/peaks/`. ffmpeg or `audiowaveform` can generate them. Load them through `/api/fetch-asset`.
3. **Word timings:** have the transcriber output word-level timestamps into `segments[].words`. The `UtteranceWord` type and `getUtteranceWords` already prefer real timings when they're present.
4. **Queue stages:** for each queued tag, add `stage` (fetch, transcribe, diarize or index), `stage_started_at` and `position` to `transcription_status.json`.
   - ETA: the average time per stage across past runs.
   - Prioritize: either a `workflow_dispatch` input, or a commit that reorders `space_queue.txt` through the GitHub API.
5. **Chapters:** generate `podcast:chapters` JSON in the workflow, so published feeds carry the chapters shown in the preview.

## Phase 7: live episodes (L, optional)
Today the pipeline downloads a Space after it ends, so nothing streams live. Live mode needs two things:
- A recorder that runs during the Space.
- Incremental transcription that writes partial segments to `live/{tag}.json` (poll it every 5–10s), or pushes them over SSE from a small local server.

Until that exists, hide the live pin, the LIVE chip and the live-edge jump whenever no live source is present. The design handles their absence cleanly.

## Other views
Montage, Best Clips, Command Center, Ingest, Library and Voices are restyles only, onto `MontageStudio`, `ClipsPanel`, `DashboardOverview`, `SubmitSpacePanel`, `LibraryPanel` and `VoiceProfileLibrary`. None of them needs new data. Do them after Phase 2, one per pass.
