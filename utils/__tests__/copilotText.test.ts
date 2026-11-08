import { describe, it, expect } from 'vitest';
import { sanitizeCopilotText, formatTimestamp, parseTimestampSec } from '../copilotText';

describe('copilotText', () => {
  describe('sanitizeCopilotText', () => {
    it('strips standard fenced action blocks', () => {
      const input = `Here is the analysis:
\`\`\`action
{
  "action": "CREATE_CLIP",
  "params": { "title": "Great clip" }
}
\`\`\`
Hope this helps!`;
      const cleaned = sanitizeCopilotText(input);
      expect(cleaned).not.toContain('CREATE_CLIP');
      expect(cleaned).toContain('Here is the analysis:');
      expect(cleaned).toContain('Hope this helps!');
    });

    it('strips json-fenced action blocks with nested params', () => {
      const input = `Diagnosing:
\`\`\`json
{
  "action": "ENQUEUE_SPACE",
  "params": {
    "spaceUrl": "https://x.com/i/spaces/1vylmgmJadRMzE",
    "queueType": "priority"
  },
  "explanation": "Retry failed space"
}
\`\`\`
Ready to retry.`;
      const cleaned = sanitizeCopilotText(input);
      expect(cleaned).not.toContain('ENQUEUE_SPACE');
      expect(cleaned).not.toContain('1vylmgmJadRMzE');
      expect(cleaned).toContain('Diagnosing:');
      expect(cleaned).toContain('Ready to retry.');
    });

    it('strips xml <action> blocks', () => {
      const input = `Updating settings:
<action>
{
  "action": "UPDATE_CONFIG",
  "params": { "enableTranscription": true }
}
</action>
Settings saved.`;
      const cleaned = sanitizeCopilotText(input);
      expect(cleaned).not.toContain('<action>');
      expect(cleaned).not.toContain('UPDATE_CONFIG');
      expect(cleaned).toContain('Updating settings:');
      expect(cleaned).toContain('Settings saved.');
    });

    it('strips balanced unfenced action objects with nested braces without touching text', () => {
      const input = `Checking pipeline:
{
  "action": "GET_RUN_JOBS",
  "params": {
    "runId": 42418412595,
    "details": { "verbose": true }
  },
  "explanation": "Inspecting jobs"
}
Here are the findings from the log.`;
      const cleaned = sanitizeCopilotText(input);
      expect(cleaned).not.toContain('GET_RUN_JOBS');
      expect(cleaned).not.toContain('42418412595');
      expect(cleaned).toContain('Checking pipeline:');
      expect(cleaned).toContain('Here are the findings from the log.');
    });

    it('strips leaked orphan action JSON fragments from screenshots', () => {
      const leakedScreenshotInput = `  "title": "Retry of failed ingest (Run #220)"
  },
  "explanation": "Retrying failed ingest of Space after initial pipeline failure."
}

3. **Monitor the next batch** — if the same URLs fail again, it's a systematic upstream issue.

---

**Summary:** The pipeline is largely healthy, but the double ingest failure is the key issue.`;

      const cleaned = sanitizeCopilotText(leakedScreenshotInput);
      expect(cleaned).not.toContain('"title": "Retry of failed ingest');
      expect(cleaned).not.toContain('"explanation": "Retrying failed ingest');
      expect(cleaned).toContain('3. **Monitor the next batch** — if the same URLs fail again');
      expect(cleaned).toContain('**Summary:** The pipeline is largely healthy');
    });

    it('preserves legitimate non-action code blocks', () => {
      const input = `Here is how you use curl:
\`\`\`bash
curl -H "Authorization: Bearer token" https://api.github.com/user
\`\`\`
Make sure to replace token.`;
      const cleaned = sanitizeCopilotText(input);
      expect(cleaned).toContain('```bash');
      expect(cleaned).toContain('curl -H');
      expect(cleaned).toContain('Make sure to replace token.');
    });
  });

  describe('formatTimestamp and parseTimestampSec', () => {
    it('formats seconds into MM:SS and HH:MM:SS', () => {
      expect(formatTimestamp(75)).toBe('1:15');
      expect(formatTimestamp(605)).toBe('10:05');
      expect(formatTimestamp(3665)).toBe('1:01:05');
    });

    it('parses timestamps into seconds', () => {
      expect(parseTimestampSec('1:15')).toBe(75);
      expect(parseTimestampSec('▶ 10:05')).toBe(605);
      expect(parseTimestampSec('[▶ 1:01:05]')).toBe(3665);
      expect(parseTimestampSec('invalid')).toBeNull();
    });
  });
});
