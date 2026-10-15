import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadDeadLetterQueue,
  saveDeadLetterQueue,
  addToDeadLetterQueue,
  removeFromDeadLetterQueue,
  loadHealedRunIds,
  markRunHealed
} from '../storage';
import { DeadLetterJob, WorkflowRun } from '../../types';

class MockStorage {
  private store: Record<string, string> = {};
  getItem(key: string) { return this.store[key] || null; }
  setItem(key: string, val: string) { this.store[key] = String(val); }
  removeItem(key: string) { delete this.store[key]; }
  clear() { this.store = {}; }
}
(globalThis as any).localStorage = new MockStorage();

describe('Voice Profile Enrollment & Workflow Remediation System', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe('Dead-Letter Queue (DLQ) Management', () => {
    it('returns empty array when DLQ is empty', () => {
      expect(loadDeadLetterQueue()).toEqual([]);
    });

    it('adds and persists a quarantined enrollment job to DLQ', () => {
      const job: DeadLetterJob = {
        id: 'dlq_voice_101',
        workflow: 'Enroll Voice Profile',
        runId: 101,
        speakerName: 'Angela',
        audioUrl: 'https://example.com/angela.wav',
        failedAt: Date.now(),
        attempts: 3,
        rootCause: 'Audio pre-flight rejection: failed format or no continuous active speech (VAD < 1.0s)',
        logUrl: 'https://github.com/test/repo/actions/runs/101',
        status: 'quarantined',
      };

      addToDeadLetterQueue(job);
      const dlq = loadDeadLetterQueue();
      expect(dlq).toHaveLength(1);
      expect(dlq[0].speakerName).toBe('Angela');
      expect(dlq[0].rootCause).toContain('VAD < 1.0s');
      expect(dlq[0].status).toBe('quarantined');
    });

    it('replaces an existing job if same ID is re-quarantined', () => {
      const job1: DeadLetterJob = {
        id: 'dlq_voice_202',
        workflow: 'Enroll Voice Profile',
        speakerName: 'Logan',
        failedAt: 1000,
        attempts: 1,
        rootCause: 'Initial timeout',
        status: 'quarantined',
      };
      const job2: DeadLetterJob = {
        ...job1,
        attempts: 3,
        rootCause: 'Transient API/Model download failure: HuggingFace/SpeechBrain unreachable after 3 backoffs',
      };

      addToDeadLetterQueue(job1);
      addToDeadLetterQueue(job2);

      const dlq = loadDeadLetterQueue();
      expect(dlq).toHaveLength(1);
      expect(dlq[0].attempts).toBe(3);
      expect(dlq[0].rootCause).toContain('SpeechBrain unreachable');
    });

    it('removes a job from DLQ upon successful healing or dismissal', () => {
      const job: DeadLetterJob = {
        id: 'dlq_voice_303',
        workflow: 'Enroll Voice Profile',
        speakerName: 'Rick Doty',
        failedAt: Date.now(),
        attempts: 3,
        rootCause: 'Low SNR or silent audio: no usable speech vector computed',
        status: 'quarantined',
      };

      addToDeadLetterQueue(job);
      expect(loadDeadLetterQueue()).toHaveLength(1);

      removeFromDeadLetterQueue('dlq_voice_303');
      expect(loadDeadLetterQueue()).toHaveLength(0);
    });
  });

  describe('Healed Run Tracking & UI Auto-Clear', () => {
    it('returns empty array when no healed runs recorded', () => {
      expect(loadHealedRunIds()).toEqual([]);
    });

    it('records healed run ID without duplicates', () => {
      markRunHealed(999);
      markRunHealed(999);
      expect(loadHealedRunIds()).toEqual([999]);

      markRunHealed(1000);
      expect(loadHealedRunIds()).toEqual([999, 1000]);
    });

    it('auto-clears failed runs when marked healed or when newer success exists', () => {
      const mockRuns: WorkflowRun[] = [
        {
          id: 501,
          name: 'Enroll Voice Profile',
          status: 'completed',
          conclusion: 'failure',
          created_at: '2026-10-14T10:00:00Z',
          updated_at: '2026-10-14T10:01:00Z',
          html_url: 'https://github.com/runs/501',
          path: '.github/workflows/enroll_voice.yml',
          head_commit: null,
        },
        {
          id: 502,
          name: 'Enroll Voice Profile',
          status: 'completed',
          conclusion: 'success',
          created_at: '2026-10-14T10:05:00Z',
          updated_at: '2026-10-14T10:06:00Z',
          html_url: 'https://github.com/runs/502',
          path: '.github/workflows/enroll_voice.yml',
          head_commit: null,
        },
      ];

      // Simulated auto-clear filtering logic matching PipelineHealthWidget
      const healedRunIds = loadHealedRunIds();
      const failedRuns = mockRuns.filter(r => r.conclusion === 'failure');
      const unacknowledged = failedRuns.filter(r => {
        if (healedRunIds.includes(r.id)) return false;
        const newerSuccess = mockRuns.find(
          other => other.name === r.name && other.conclusion === 'success' && new Date(other.created_at) > new Date(r.created_at)
        );
        if (newerSuccess) {
          markRunHealed(r.id);
          return false;
        }
        return true;
      });

      // Failed run 501 was succeeded by 502, so it is auto-cleared!
      expect(unacknowledged).toHaveLength(0);
      expect(loadHealedRunIds()).toContain(501);
    });

    it('keeps failed run unacknowledged if no subsequent success exists and not marked healed', () => {
      const mockRuns: WorkflowRun[] = [
        {
          id: 601,
          name: 'Enroll Voice Profile',
          status: 'completed',
          conclusion: 'failure',
          created_at: '2026-10-14T12:00:00Z',
          updated_at: '2026-10-14T12:01:00Z',
          html_url: 'https://github.com/runs/601',
          path: '.github/workflows/enroll_voice.yml',
          head_commit: null,
        },
      ];

      const healedRunIds = loadHealedRunIds();
      const failedRuns = mockRuns.filter(r => r.conclusion === 'failure');
      const unacknowledged = failedRuns.filter(r => {
        if (healedRunIds.includes(r.id)) return false;
        const newerSuccess = mockRuns.find(
          other => other.name === r.name && other.conclusion === 'success' && new Date(other.created_at) > new Date(r.created_at)
        );
        if (newerSuccess) {
          markRunHealed(r.id);
          return false;
        }
        return true;
      });

      expect(unacknowledged).toHaveLength(1);
      expect(unacknowledged[0].id).toBe(601);
    });
  });
});
