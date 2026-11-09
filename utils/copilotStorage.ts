import type { CopilotMessage, CopilotAction } from './copilotTypes';

export interface PinnedContextItem {
  id: string;
  type: 'episode' | 'speaker' | 'script' | 'reel';
  title: string;
  detail?: string;
  addedAt?: number;
}

export interface CopilotSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: CopilotMessage[];
  actionHistory: CopilotAction[];
  pinnedContexts?: PinnedContextItem[];
  isWidgetSession?: boolean;
}

const DB_NAME = 'spacepipe_copilot_db';
const DB_VERSION = 1;
const STORE_NAME = 'sessions';
const LEGACY_STORAGE_KEY = 'spacepipe_copilot_messages_v1';
export const ACTIVE_SESSION_ID_KEY = 'spacepipe_copilot_active_session_id';
export const WIDGET_SESSION_ID = 'widget_quick_chat';
export const DEFAULT_SESSION_ID = 'session_primary';

export const INITIAL_WELCOME_MESSAGE: CopilotMessage = {
  id: 'welcome_1',
  role: 'assistant',
  content: `👋 **Welcome to the SpacePipe AI Studio & Copilot!**

I am your **Executive Audio Producer & Pipeline Assistant**.

Here are some things I can do for you right now:
* ⚡ **"Soundbite Hunter"**: Scan any transcript for the highest-energy rants, debates, or viral quotes.
* 🍿 **"The Debate Duel"**: Reorder your montage clips into an escalating clash with a mic-drop resolution.
* ✂️ **"Word-Perfect Trimming"**: Tighten In/Out points to remove filler words and dead air.
* 🩺 **"Diagnose Pipeline"**: Audit your GitHub Actions YAML and cron settings with 1-click auto-fixes.

How can I help with your episodes or pipeline today?`,
  timestamp: Date.now(),
};

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      reject(new Error('IndexedDB not supported'));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Loads all sessions from IndexedDB. If none exist, initializes primary session
 * and migrates any legacy localStorage messages.
 */
export async function loadAllSessions(): Promise<CopilotSession[]> {
  try {
    const db = await openDB();
    const sessions = await new Promise<CopilotSession[]>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });

    if (sessions.length > 0) {
      // Ensure widget session exists
      if (!sessions.some(s => s.id === WIDGET_SESSION_ID)) {
        const widgetSession: CopilotSession = {
          id: WIDGET_SESSION_ID,
          title: 'Quick Widget Chat',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          messages: [
            {
              id: 'widget_welcome',
              role: 'assistant',
              content: '👋 **Quick Copilot Widget Active!** Ask questions about this tab or anything in your pipeline.',
              timestamp: Date.now(),
            },
          ],
          actionHistory: [],
          isWidgetSession: true,
        };
        await saveSession(widgetSession);
        sessions.unshift(widgetSession);
      }
      return sessions;
    }

    // First time init: Check legacy localStorage migration
    let migratedMessages: CopilotMessage[] = [INITIAL_WELCOME_MESSAGE];
    try {
      const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
      if (legacy) {
        const parsed = JSON.parse(legacy);
        if (Array.isArray(parsed) && parsed.length > 0) {
          migratedMessages = parsed;
        }
        localStorage.removeItem(LEGACY_STORAGE_KEY);
      }
    } catch {
      // ignore
    }

    const initialPrimary: CopilotSession = {
      id: DEFAULT_SESSION_ID,
      title: 'Session 1',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: migratedMessages,
      actionHistory: [],
      pinnedContexts: [],
    };

    const initialWidget: CopilotSession = {
      id: WIDGET_SESSION_ID,
      title: 'Quick Widget Chat',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: [
        {
          id: 'widget_welcome',
          role: 'assistant',
          content: '👋 **Quick Copilot Widget Active!** Ask questions about this tab or anything in your pipeline.',
          timestamp: Date.now(),
        },
      ],
      actionHistory: [],
      isWidgetSession: true,
    };

    await saveSession(initialPrimary);
    await saveSession(initialWidget);
    return [initialWidget, initialPrimary];
  } catch (err) {
    console.warn('[copilotStorage] Fallback to in-memory/localStorage session:', err);
    return [
      {
        id: WIDGET_SESSION_ID,
        title: 'Quick Widget Chat',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messages: [],
        actionHistory: [],
        isWidgetSession: true,
      },
      {
        id: DEFAULT_SESSION_ID,
        title: 'Session 1',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messages: [INITIAL_WELCOME_MESSAGE],
        actionHistory: [],
      },
    ];
  }
}

export async function saveSession(session: CopilotSession): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(session);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn('[copilotStorage] Failed to save session to IndexedDB:', err);
  }
}

export async function deleteSessionFromDB(id: string): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn('[copilotStorage] Failed to delete session from IndexedDB:', err);
  }
}

export function exportSessionToMarkdown(session: CopilotSession): string {
  const lines: string[] = [
    `# SpacePipe Copilot Session: ${session.title}`,
    `*Created: ${new Date(session.createdAt).toLocaleString()}*`,
    `*Exported: ${new Date().toLocaleString()}*`,
    `\n---\n`,
  ];

  if (session.pinnedContexts && session.pinnedContexts.length > 0) {
    lines.push(`## Pinned Contexts`);
    session.pinnedContexts.forEach(c => {
      lines.push(`- **[${c.type.toUpperCase()}]** ${c.title}${c.detail ? `: ${c.detail}` : ''}`);
    });
    lines.push(`\n---\n`);
  }

  lines.push(`## Conversation History\n`);

  for (const m of session.messages) {
    const speaker = m.role === 'user' ? '🧑 **User**' : '🤖 **Copilot**';
    const time = new Date(m.timestamp).toLocaleTimeString();
    lines.push(`### ${speaker} *(${time})*`);
    lines.push(m.content);

    if (m.matches && m.matches.length > 0) {
      lines.push(`\n#### Referenced Transcript Quotes:`);
      for (const match of m.matches) {
        lines.push(`> **[${match.formatted_time || match.start_timestamp}] ${match.speaker}** in *${match.episode_title}*:`);
        lines.push(`> "${match.snippet.replace(/\n/g, ' ')}"`);
        lines.push('');
      }
    }

    if (m.actions && m.actions.length > 0) {
      lines.push(`\n#### Proposed / Executed Actions:`);
      for (const a of m.actions) {
        lines.push(`* **[${a.action}]** (${a.status || 'pending'}): ${a.explanation}`);
      }
    }

    lines.push('\n---\n');
  }

  return lines.join('\n');
}
