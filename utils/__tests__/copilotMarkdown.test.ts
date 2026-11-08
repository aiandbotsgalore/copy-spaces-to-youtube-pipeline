import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { CopilotMarkdown } from '../../components/CopilotMarkdown';

describe('CopilotMarkdown', () => {
  it('renders markdown headings with proper HTML hierarchy', () => {
    const markdown = `## 🚨 Critical Failure Analysis — All 4 Failed Runs Identified
### ❌ The Failures — All Ingest Workflows
Normal paragraph text.`;

    const html = renderToString(React.createElement(CopilotMarkdown, { content: markdown }));

    expect(html).toContain('<h2');
    expect(html).toContain('Critical Failure Analysis');
    expect(html).toContain('<h3');
    expect(html).toContain('The Failures');
    expect(html).toContain('Normal paragraph text.');
  });

  it('renders GFM markdown tables with styled table elements', () => {
    const markdown = `| Run # | Failed Space URL | Time (UTC) | Attempt |
|-------|------------------|------------|---------|
| **220** | \`1vylmgmJadRMzE\` | ▶ 21:59:02 | 2nd attempt |
| **219** | \`1rJqboeezyXgAQ\` | ▶ 21:59:01 | 2nd attempt |`;

    const html = renderToString(React.createElement(CopilotMarkdown, { content: markdown }));

    expect(html).toContain('<table');
    expect(html).toContain('<thead');
    expect(html).toContain('<tbody');
    expect(html).toContain('Run #');
    expect(html).toContain('Failed Space URL');
    expect(html).toContain('1vylmgmJadRMzE');
    expect(html).toContain('2nd attempt');
  });

  it('renders horizontal dividers correctly', () => {
    const markdown = `Section 1
---
Section 2`;

    const html = renderToString(React.createElement(CopilotMarkdown, { content: markdown }));
    expect(html).toContain('<hr');
    expect(html).toContain('Section 1');
    expect(html).toContain('Section 2');
  });

  it('renders numbered ordered lists and bullet lists', () => {
    const markdown = `Recommended steps:
1. **Space is no longer accessible** — Space ended.
2. **Invalid URL/expired token** — Stale token.
- First bullet item
- Second bullet item`;

    const html = renderToString(React.createElement(CopilotMarkdown, { content: markdown }));
    expect(html).toContain('Space is no longer accessible');
    expect(html).toContain('Invalid URL/expired token');
    expect(html).toContain('First bullet item');
    expect(html).toContain('Second bullet item');
  });

  it('renders summary paragraphs into highlighted callout cards', () => {
    const markdown = `**Summary:** The pipeline is largely healthy, but the double ingest failure is the key issue.`;
    const html = renderToString(React.createElement(CopilotMarkdown, { content: markdown }));

    expect(html).toContain('Summary:');
    expect(html).toContain('The pipeline is largely healthy');
    // Callout card classes
    expect(html).toContain('border-indigo-500/30');
  });

  it('sanitizes leaked action JSON blocks and fragments', () => {
    const markdownWithLeak = `  "title": "Retry of failed ingest (Run #220)"
  },
  "explanation": "Retrying failed ingest of Space after initial pipeline failure."
}

## 🚨 Critical Failure Analysis

| Run # | Space |
|---|---|
| 220 | Space 1 |

\`\`\`action
{
  "action": "ENQUEUE_SPACE",
  "params": { "spaceUrl": "https://x.com/..." }
}
\`\`\``;

    const html = renderToString(React.createElement(CopilotMarkdown, { content: markdownWithLeak }));

    expect(html).not.toContain('Retry of failed ingest');
    expect(html).not.toContain('ENQUEUE_SPACE');
    expect(html).toContain('Critical Failure Analysis');
    expect(html).toContain('Space 1');
  });
});
