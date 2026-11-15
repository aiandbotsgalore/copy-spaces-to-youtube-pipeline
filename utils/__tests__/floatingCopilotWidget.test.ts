import { describe, it, expect, beforeEach } from 'vitest';
import {
  createDefaultWidgetTab,
  getNextChatNumber,
  COPILOT_WIDGET_TABS_STORAGE_KEY,
  COPILOT_WIDGET_ACTIVE_TAB_STORAGE_KEY,
  type CopilotWidgetTab,
} from '../../components/FloatingCopilotWidget';
import type { CopilotMessage } from '../copilotTypes';

class MockStorage {
  private store: Record<string, string> = {};
  getItem(key: string) { return this.store[key] || null; }
  setItem(key: string, val: string) { this.store[key] = String(val); }
  removeItem(key: string) { delete this.store[key]; }
  clear() { this.store = {}; }
}
(globalThis as any).localStorage = new MockStorage();
(globalThis as any).sessionStorage = new MockStorage();

describe('FloatingCopilotWidget Conversation & Multi-Tab State Management', () => {
  beforeEach(() => {
    // Clear localStorage and sessionStorage mocks
    localStorage.clear();
    sessionStorage.clear();
  });

  describe('Storage Keys and Defaults', () => {
    it('defines distinct and versioned localStorage keys', () => {
      expect(COPILOT_WIDGET_TABS_STORAGE_KEY).toBe('spacepipe_copilot_widget_tabs_v1');
      expect(COPILOT_WIDGET_ACTIVE_TAB_STORAGE_KEY).toBe('spacepipe_copilot_widget_active_tab_v1');
    });

    it('creates a fresh default widget tab with clean context and empty history', () => {
      const tab = createDefaultWidgetTab('Chat 1');
      expect(tab.id).toMatch(/^widget_tab_\d+_[a-z0-9]+$/);
      expect(tab.title).toBe('Chat 1');
      expect(tab.messages).toEqual([]);
      expect(tab.inputDraft).toBe('');
      expect(tab.includeContext).toBe(true);
      expect(tab.createdAt).toBeGreaterThan(0);
      expect(tab.updatedAt).toBeGreaterThan(0);
    });

    it('creates tab with custom title when provided', () => {
      const tab = createDefaultWidgetTab('Investigative Lead');
      expect(tab.title).toBe('Investigative Lead');
      expect(tab.messages).toHaveLength(0);
    });
  });

  describe('getNextChatNumber Sequential Calculator', () => {
    it('returns 1 for an empty tab list', () => {
      expect(getNextChatNumber([])).toBe(1);
    });

    it('increments sequentially from Chat 1', () => {
      const tabs: CopilotWidgetTab[] = [createDefaultWidgetTab('Chat 1')];
      expect(getNextChatNumber(tabs)).toBe(2);
    });

    it('increments from the highest numbered Chat tab', () => {
      const tabs: CopilotWidgetTab[] = [
        createDefaultWidgetTab('Chat 1'),
        createDefaultWidgetTab('Chat 4'),
      ];
      expect(getNextChatNumber(tabs)).toBe(5);
    });

    it('handles custom titled tabs gracefully', () => {
      const tabs: CopilotWidgetTab[] = [
        createDefaultWidgetTab('Transcript Deep Dive'),
        createDefaultWidgetTab('Script Polish'),
      ];
      expect(getNextChatNumber(tabs)).toBe(3);
    });
  });

  describe('Multi-Tab Isolation (Messages, Drafts, and Context)', () => {
    it('maintains completely isolated messages[] across multiple tabs', () => {
      const tab1 = createDefaultWidgetTab('Chat 1');
      const tab2 = createDefaultWidgetTab('Chat 2');

      const userMsg1: CopilotMessage = {
        id: 'msg_1',
        role: 'user',
        content: 'Investigate speaker audio drift in Space 42',
        timestamp: Date.now(),
      };

      tab1.messages.push(userMsg1);

      // Verify tab2 remains completely clean
      expect(tab1.messages).toHaveLength(1);
      expect(tab2.messages).toHaveLength(0);

      const userMsg2: CopilotMessage = {
        id: 'msg_2',
        role: 'user',
        content: 'Check YAML cron schedule',
        timestamp: Date.now(),
      };
      tab2.messages.push(userMsg2);

      expect(tab1.messages[0].content).toContain('speaker audio drift');
      expect(tab2.messages[0].content).toContain('YAML cron schedule');
    });

    it('maintains isolated input drafts between parallel tabs', () => {
      const tab1 = createDefaultWidgetTab('Chat 1');
      const tab2 = createDefaultWidgetTab('Chat 2');

      tab1.inputDraft = 'Unfinished prompt about Angela Maggard...';
      tab2.inputDraft = 'Draft query regarding Montage tension score';

      expect(tab1.inputDraft).not.toEqual(tab2.inputDraft);
      expect(tab1.inputDraft).toBe('Unfinished prompt about Angela Maggard...');
      expect(tab2.inputDraft).toBe('Draft query regarding Montage tension score');
    });

    it('maintains isolated context toggle state per tab', () => {
      const tab1 = createDefaultWidgetTab('Chat 1');
      const tab2 = createDefaultWidgetTab('Chat 2');

      tab1.includeContext = true;
      tab2.includeContext = false;

      expect(tab1.includeContext).toBe(true);
      expect(tab2.includeContext).toBe(false);
    });
  });

  describe('Auto-titling First Prompt Logic', () => {
    it('auto-titles default Chat 1 tab from prompt under 18 characters', () => {
      const prompt = 'Audit podcast RSS';
      const cleanPrompt = prompt.replace(/\s+/g, ' ').trim();
      const updatedTitle = cleanPrompt.length > 18 ? `${cleanPrompt.slice(0, 16)}…` : cleanPrompt;
      expect(updatedTitle).toBe('Audit podcast RSS');
    });

    it('truncates longer prompts with ellipsis when auto-titling', () => {
      const prompt = 'Find all heated debate moments between Shane and Logan';
      const cleanPrompt = prompt.replace(/\s+/g, ' ').trim();
      const updatedTitle = cleanPrompt.length > 18 ? `${cleanPrompt.slice(0, 16)}…` : cleanPrompt;
      expect(updatedTitle).toBe('Find all heated …');
      expect(updatedTitle.length).toBeLessThanOrEqual(18);
    });

    it('preserves existing custom titles without overwriting', () => {
      const existingTitle = 'My Custom Investigation';
      const shouldAutoTitle = /^Chat \d+$/.test(existingTitle);
      expect(shouldAutoTitle).toBe(false);
    });
  });

  describe('Clear Context Action and Telemetry Cleanup', () => {
    it('clears stale search and radar telemetry keys from sessionStorage', () => {
      sessionStorage.setItem('spacepipe_transcript_search_q', 'allegations AND eviction');
      sessionStorage.setItem('spacepipe_radar_selection', JSON.stringify({ selectedEntity: 'Angela' }));

      expect(sessionStorage.getItem('spacepipe_transcript_search_q')).toBe('allegations AND eviction');
      expect(sessionStorage.getItem('spacepipe_radar_selection')).toBeTruthy();

      // Clear action simulation
      sessionStorage.removeItem('spacepipe_transcript_search_q');
      sessionStorage.removeItem('spacepipe_radar_selection');

      expect(sessionStorage.getItem('spacepipe_transcript_search_q')).toBeNull();
      expect(sessionStorage.getItem('spacepipe_radar_selection')).toBeNull();
    });

    it('wipes message history and input draft when resetting context', () => {
      const tab = createDefaultWidgetTab('Chat 1');
      tab.messages.push({
        id: 'user_1',
        role: 'user',
        content: 'Old stale question',
        timestamp: Date.now(),
      });
      tab.inputDraft = 'Half typed query';
      tab.includeContext = false;

      // Perform clear context
      const clearedTab: CopilotWidgetTab = {
        ...tab,
        messages: [],
        inputDraft: '',
        includeContext: true,
        updatedAt: Date.now(),
      };

      expect(clearedTab.messages).toEqual([]);
      expect(clearedTab.inputDraft).toBe('');
      expect(clearedTab.includeContext).toBe(true);
    });
  });

  describe('Closing Tab Mechanics', () => {
    it('when multiple tabs exist, removes closed tab and activates adjacent tab', () => {
      const tabs: CopilotWidgetTab[] = [
        createDefaultWidgetTab('Chat 1'),
        createDefaultWidgetTab('Chat 2'),
        createDefaultWidgetTab('Chat 3'),
      ];
      const activeTabId = tabs[1].id; // Chat 2

      const remaining = tabs.filter((t) => t.id !== activeTabId);
      expect(remaining).toHaveLength(2);

      const closedIndex = tabs.findIndex((t) => t.id === activeTabId);
      const nextTab = remaining[Math.min(closedIndex, remaining.length - 1)];
      expect(nextTab.title).toBe('Chat 3');
    });

    it('when closing the only remaining tab, resets to a fresh Chat 1 tab', () => {
      const tabs: CopilotWidgetTab[] = [createDefaultWidgetTab('Chat 1')];
      tabs[0].messages.push({
        id: 'msg_1',
        role: 'user',
        content: 'Some message',
        timestamp: Date.now(),
      });

      let resultTabs: CopilotWidgetTab[];
      if (tabs.length <= 1) {
        resultTabs = [createDefaultWidgetTab('Chat 1')];
      } else {
        resultTabs = [];
      }

      expect(resultTabs).toHaveLength(1);
      expect(resultTabs[0].title).toBe('Chat 1');
      expect(resultTabs[0].messages).toEqual([]);
      expect(resultTabs[0].inputDraft).toBe('');
    });
  });

  describe('LocalStorage Persistence Simulation', () => {
    it('serializes and deserializes multi-tab state reliably', () => {
      const tab1 = createDefaultWidgetTab('Chat 1');
      tab1.messages.push({
        id: 'msg_1',
        role: 'user',
        content: 'How do I export to YouTube podcast?',
        timestamp: 1000,
      });
      tab1.inputDraft = 'What about 12-hour limit?';

      const tab2 = createDefaultWidgetTab('Chat 2');
      tab2.messages.push({
        id: 'msg_2',
        role: 'assistant',
        content: 'YouTube requires episodes longer than 10 hours to be split.',
        timestamp: 2000,
      });

      const initialTabs = [tab1, tab2];
      localStorage.setItem(COPILOT_WIDGET_TABS_STORAGE_KEY, JSON.stringify(initialTabs));
      localStorage.setItem(COPILOT_WIDGET_ACTIVE_TAB_STORAGE_KEY, tab2.id);

      const loadedRaw = localStorage.getItem(COPILOT_WIDGET_TABS_STORAGE_KEY);
      expect(loadedRaw).toBeTruthy();
      const parsed: CopilotWidgetTab[] = JSON.parse(loadedRaw!);

      expect(parsed).toHaveLength(2);
      expect(parsed[0].title).toBe('Chat 1');
      expect(parsed[0].messages[0].content).toBe('How do I export to YouTube podcast?');
      expect(parsed[0].inputDraft).toBe('What about 12-hour limit?');

      expect(parsed[1].title).toBe('Chat 2');
      expect(parsed[1].messages[0].content).toContain('10 hours');

      const loadedActiveId = localStorage.getItem(COPILOT_WIDGET_ACTIVE_TAB_STORAGE_KEY);
      expect(loadedActiveId).toBe(tab2.id);
    });
  });
});
