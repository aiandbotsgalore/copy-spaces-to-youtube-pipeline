import { describe, it, expect } from 'vitest';
import { buildCopilotSystemPrompt, extractCopilotActions } from '../../server/copilotPrompt';

describe('copilotPrompt', () => {
  it('builds system prompt with context details', () => {
    const prompt = buildCopilotSystemPrompt({
      activeTab: 'transcripts',
      selectedText: 'I think artificial general intelligence is much closer than people expect.',
      currentEpisode: {
        title: 'Spaces Episode 42',
        releaseTag: '20260908_1wxWjlrwXokJQ',
        speakers: ['Alice', 'Bob'],
        segmentsSample: [
          { speaker: 'Alice', text: 'Hello world', start: 0, end: 5.2 },
          { speaker: 'Bob', text: 'I agree', start: 5.5, end: 9.1 },
        ],
      },
      activeMontageClips: [
        {
          id: 'clip_1',
          title: 'AGI Prediction',
          quote: 'We are months away',
          speaker: 'Alice',
          startSec: 10,
          endSec: 25,
          tensionScore: 8,
        },
      ],
      configSummary: { enableTranscription: true },
    });

    expect(prompt).toContain('SpacePipe Executive Audio Producer');
    expect(prompt).toContain('Toggle Live Studio Canvas');
    expect(prompt).toContain('Target Window Gauge');
    expect(prompt).toContain('Narrative Tension Arc');
    expect(prompt).toContain('CURRENT ACTIVE VIEW: transcripts');
    expect(prompt).toContain('CURRENTLY SELECTED TRANSCRIPT TEXT');
    expect(prompt).toContain('Spaces Episode 42');
    expect(prompt).toContain('Alice: Hello world');
    expect(prompt).toContain('AGI Prediction');
    expect(prompt).toContain('enableTranscription');
  });

  it('extracts action blocks from response text and cleans user output', () => {
    const rawResponse = `Here is what I found for your highlight reel:

\`\`\`action
{
  "action": "CREATE_CLIP",
  "params": {
    "title": "Autonomous Coding Breakdown",
    "quote": "Coding as we knew it changed overnight",
    "speaker": "Bob",
    "startSec": 15.2,
    "endSec": 35.8,
    "viralScore": 92
  },
  "explanation": "Extracted 20s viral clip of Bob's coding prediction"
}
\`\`\`

I have also queued this up in your montage. Let me know if you would like to audition it.`;

    const { cleanedText, actions } = extractCopilotActions(rawResponse);

    expect(actions).toHaveLength(1);
    expect(actions[0].action).toBe('CREATE_CLIP');
    expect(actions[0].params.title).toBe('Autonomous Coding Breakdown');
    expect(actions[0].params.startSec).toBe(15.2);
    expect(actions[0].params.viralScore).toBe(92);
    expect(actions[0].explanation).toBe("Extracted 20s viral clip of Bob's coding prediction");

    expect(cleanedText).not.toContain('```action');
    expect(cleanedText).toContain('Here is what I found for your highlight reel:');
    expect(cleanedText).toContain('I have also queued this up in your montage.');
  });

  it('supports xml-style <action> tags as well', () => {
    const rawResponse = `Sure!
<action>
{
  "action": "UPDATE_CONFIG",
  "params": { "enableDiscordWebhook": true },
  "explanation": "Enabled Discord webhook"
}
</action>
Done!`;

    const { cleanedText, actions } = extractCopilotActions(rawResponse);
    expect(actions).toHaveLength(1);
    expect(actions[0].action).toBe('UPDATE_CONFIG');
    expect(actions[0].params.enableDiscordWebhook).toBe(true);
    expect(cleanedText).toBe('Sure!\n\nDone!');
  });

  it('injects transcript search results and archive stats into prompt', () => {
    const prompt = buildCopilotSystemPrompt({
      transcriptSearchResults: [
        {
          episodeTitle: 'The Dangers of Belief',
          releaseTag: '20260925_1qJDzWQRqWNKV',
          speaker: 'Angela Maggard',
          startSec: 124.5,
          endSec: 145.0,
          text: 'The people who compromise are scumbags.',
        },
      ],
      archiveStats: {
        totalEpisodes: 656,
        totalTranscriptsOnDisk: 523,
        allSpeakersSample: ['Angela Maggard', 'Jason Sands'],
      },
    });

    expect(prompt).toContain('GLOBAL TRANSCRIPT SEARCH MATCHES');
    expect(prompt).toContain('Angela Maggard in "The Dangers of Belief"');
    expect(prompt).toContain('The people who compromise are scumbags.');
    expect(prompt).toContain('TRANSCRIPT ARCHIVE CATALOG STATUS');
    expect(prompt).toContain('Total Episodes in Database: 656');
    expect(prompt).toContain('TRANSCRIPT ARCHIVE & GLOBAL SEARCH ACCESS (CRITICAL)');
  });

  it('extracts SEARCH_TRANSCRIPTS and LOAD_EPISODE actions', () => {
    const rawResponse = `Let me find that quote for you:
\`\`\`action
{
  "action": "SEARCH_TRANSCRIPTS",
  "params": { "query": "compromise", "speaker": "Angela" },
  "explanation": "Searching for Angela's compromise quote"
}
\`\`\`
I am searching the archive now.`;

    const { actions } = extractCopilotActions(rawResponse);
    expect(actions).toHaveLength(1);
    expect(actions[0].action).toBe('SEARCH_TRANSCRIPTS');
    expect(actions[0].params.query).toBe('compromise');
    expect(actions[0].params.speaker).toBe('Angela');
  });
});
