import { describe, it, expect } from 'vitest';
import {
  createInceptionAdapter,
  INCEPTION_PRICES,
  inceptionCostUsd,
  estimateInputTokens,
  parseRoleSpec,
  familyOf,
  roleMapNeedsBudget,
  verifyCrossFamily,
  DEFAULT_ROLE_MAP,
  INCEPTION_ROLE_MAP,
} from '../../server/scriptProviders';
import type { RoleMap } from '../../utils/scriptTypes';

const req = (o: Partial<Parameters<ReturnType<typeof createInceptionAdapter>['complete']>[0]> = {}) => ({
  role: 'analyst' as const,
  system: 'You are an analyst.',
  user: 'Analyze the transcript.',
  schema: {
    type: 'object',
    properties: {
      summary: { type: 'string' },
      themes: { type: 'array', items: { type: 'string' } },
    },
    required: ['summary', 'themes'],
    additionalProperties: false,
  },
  schemaName: 'test_schema',
  maxTokens: 1000,
  timeoutMs: 5000,
  signal: new AbortController().signal,
  ...o,
});

describe('Inception / Mercury-3 Adapter', () => {
  it('requires INCEPTION_API_KEY for availability', async () => {
    const noKey = createInceptionAdapter('mercury-3', {
      env: () => ({}),
      budget: { maxUsd: 10, spentUsd: 0 },
    });
    expect(await noKey.available()).toMatchObject({ ok: false, code: 'NO_KEY' });

    const withKey = createInceptionAdapter('mercury-3', {
      env: () => ({ INCEPTION_API_KEY: 'test_key' }),
      budget: { maxUsd: 10, spentUsd: 0 },
    });
    expect(await withKey.available()).toMatchObject({ ok: true });
  });

  it('rejects unsupported models in available()', async () => {
    const invalid = createInceptionAdapter('unknown-model', {
      env: () => ({ INCEPTION_API_KEY: 'test_key' }),
      budget: { maxUsd: 10, spentUsd: 0 },
    });
    expect(await invalid.available()).toMatchObject({ ok: false, code: 'NOT_ALLOWED' });
  });

  it('enforces budget cap before sending request (worst-case token cost)', async () => {
    let fetchCalled = false;
    const fetchImpl = (async () => {
      fetchCalled = true;
      return new Response('{}');
    }) as typeof fetch;

    const budget = { maxUsd: 0.0001, spentUsd: 0.0001 }; // zero remaining
    const ad = createInceptionAdapter('mercury-3', {
      fetchImpl,
      env: () => ({ INCEPTION_API_KEY: 'test_key' }),
      budget,
    });

    const res = await ad.complete(req());
    expect(res).toMatchObject({ ok: false, code: 'BUDGET_EXCEEDED' });
    expect(fetchCalled).toBe(false);
  });

  it('sends strict json_schema payload and records token usage and budget expenditure', async () => {
    const bodies: any[] = [];
    const headersList: any[] = [];
    const fetchImpl = (async (_url: any, init: any) => {
      bodies.push(JSON.parse(init.body));
      headersList.push(init.headers);
      return new Response(
        JSON.stringify({
          model: 'mercury-3',
          choices: [
            {
              message: {
                content: JSON.stringify({ summary: 'High level talk', themes: ['ai', 'future'] }),
              },
            },
          ],
          usage: {
            prompt_tokens: 5000,
            completion_tokens: 200,
          },
        }),
        { status: 200 }
      );
    }) as typeof fetch;

    const budget = { maxUsd: 5.0, spentUsd: 0 };
    const ad = createInceptionAdapter('mercury-3', {
      fetchImpl,
      env: () => ({ INCEPTION_API_KEY: 'sk_secret' }),
      budget,
    });

    const res = await ad.complete(req());
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.provider).toBe('inception');
      expect(res.model).toBe('mercury-3');
      expect(res.json).toEqual({ summary: 'High level talk', themes: ['ai', 'future'] });
      expect(res.usage).toEqual({
        inTok: 5000,
        outTok: 200,
        costUsd: inceptionCostUsd('mercury-3', 5000, 200),
        listCostUsd: inceptionCostUsd('mercury-3', 5000, 200),
        billedCostUsd: 0,
        isPromotional: true,
      });
      expect(budget.spentUsd).toBeCloseTo(inceptionCostUsd('mercury-3', 5000, 200), 8);
    }

    // Verify request payload contract
    expect(bodies).toHaveLength(1);
    expect(bodies[0].model).toBe('mercury-3');
    expect(bodies[0].response_format).toEqual({
      type: 'json_schema',
      json_schema: {
        name: 'test_schema',
        strict: true,
        schema: req().schema,
      },
    });
    expect(headersList[0].Authorization).toBe('Bearer sk_secret');
  });

  it('conservatively estimates input tokens with safety margin for budget preflight', () => {
    const est = estimateInputTokens(req());
    expect(est).toBeGreaterThan(0);
    const naive = Math.ceil((req().system.length + req().user.length) / 4);
    expect(est).toBeGreaterThan(naive);
  });

  it('classifies HTTP 400 as BAD_REQUEST with upstream error message', async () => {
    const fetchImpl = (async () => {
      return new Response(
        JSON.stringify({ error: { message: 'Invalid parameter: schema property types must be string' } }),
        { status: 400 }
      );
    }) as typeof fetch;

    const ad = createInceptionAdapter('mercury-3', {
      fetchImpl,
      env: () => ({ INCEPTION_API_KEY: 'test_key' }),
      budget: { maxUsd: 5, spentUsd: 0 },
    });

    const res = await ad.complete(req());
    expect(res).toMatchObject({
      ok: false,
      code: 'BAD_REQUEST',
    });
    if (!res.ok) {
      expect(res.message).toContain('Invalid parameter');
    }
  });

  it('classifies HTTP 401/403 as NOT_SIGNED_IN and 429 as RATE_LIMIT', async () => {
    const authFail = createInceptionAdapter('mercury-3', {
      fetchImpl: (async () => new Response('{"error":"Unauthorized"}', { status: 401 })) as typeof fetch,
      env: () => ({ INCEPTION_API_KEY: 'bad_key' }),
      budget: { maxUsd: 5, spentUsd: 0 },
    });
    expect(await authFail.complete(req())).toMatchObject({ ok: false, code: 'NOT_SIGNED_IN' });

    const rateLimited = createInceptionAdapter('mercury-3', {
      fetchImpl: (async () => new Response('{"error":"Too Many Requests"}', { status: 429 })) as typeof fetch,
      env: () => ({ INCEPTION_API_KEY: 'key' }),
      budget: { maxUsd: 5, spentUsd: 0 },
    });
    expect(await rateLimited.complete(req())).toMatchObject({ ok: false, code: 'RATE_LIMIT' });
  });

  it('rejects model identity mismatch as UPSTREAM protocol failure', async () => {
    const fetchImpl = (async () => {
      return new Response(
        JSON.stringify({
          model: 'mercury-silent-fallback',
          choices: [{ message: { content: '{"summary":"test","themes":[]}' } }],
        }),
        { status: 200 }
      );
    }) as typeof fetch;

    const ad = createInceptionAdapter('mercury-3', {
      fetchImpl,
      env: () => ({ INCEPTION_API_KEY: 'key' }),
      budget: { maxUsd: 5, spentUsd: 0 },
    });

    const res = await ad.complete(req());
    expect(res).toMatchObject({
      ok: false,
      code: 'UPSTREAM',
    });
    if (!res.ok) {
      expect(res.message).toContain('Model identity mismatch');
    }
  });

  it('classifies unparseable or non-JSON output as BAD_OUTPUT', async () => {
    const nonJsonContent = createInceptionAdapter('mercury-3', {
      fetchImpl: (async () =>
        new Response(
          JSON.stringify({
            model: 'mercury-3',
            choices: [{ message: { content: 'This is plain text, not JSON.' } }],
          }),
          { status: 200 }
        )) as typeof fetch,
      env: () => ({ INCEPTION_API_KEY: 'key' }),
      budget: { maxUsd: 5, spentUsd: 0 },
    });
    expect(await nonJsonContent.complete(req())).toMatchObject({ ok: false, code: 'BAD_OUTPUT' });

    const nonJsonEnvelope = createInceptionAdapter('mercury-3', {
      fetchImpl: (async () => new Response('<html>502 Bad Gateway</html>', { status: 200 })) as typeof fetch,
      env: () => ({ INCEPTION_API_KEY: 'key' }),
      budget: { maxUsd: 5, spentUsd: 0 },
    });
    expect(await nonJsonEnvelope.complete(req())).toMatchObject({ ok: false, code: 'BAD_OUTPUT' });
  });

  it('handles caller cancellation and timeouts', async () => {
    const ctl = new AbortController();
    ctl.abort();
    const ad = createInceptionAdapter('mercury-3', {
      fetchImpl: (async () => new Response('{}')) as typeof fetch,
      env: () => ({ INCEPTION_API_KEY: 'key' }),
      budget: { maxUsd: 5, spentUsd: 0 },
    });
    expect(await ad.complete(req({ signal: ctl.signal }))).toMatchObject({ ok: false, code: 'ABORTED' });
  });
});

describe('Inception Role Parsing & Cross-Family verification', () => {
  it('parses inception role spec and family', () => {
    expect(parseRoleSpec('inception:mercury-3')).toEqual({ provider: 'inception', model: 'mercury-3' });
    expect(familyOf('inception:mercury-3')).toBe('open_source');
    expect(parseRoleSpec('inception:non-existent')).toBeNull();
  });

  it('flags role map needing budget when inception is present', () => {
    const mapWithInception: RoleMap = {
      ...DEFAULT_ROLE_MAP,
      analyst: 'inception:mercury-3',
    };
    expect(roleMapNeedsBudget(mapWithInception)).toBe(true);
  });

  it('verifies cross-family constraints when inception is used', () => {
    // Mercury-3 is open_source family. Reviser open_source + Judge openai/anthropic is valid
    const validMap: RoleMap = {
      analyst: 'inception:mercury-3',
      critic: 'claude_cli:haiku',
      reviser: 'inception:mercury-3',
      judge: 'codex_cli', // OpenAI family -> distinct from open_source
      factcheck: 'claude_cli:haiku', // Anthropic family -> distinct from open_source
    };
    expect(verifyCrossFamily(validMap)).toEqual({ ok: true });

    // Same family for reviser and judge is rejected
    const invalidMap: RoleMap = {
      ...validMap,
      judge: 'inception:mercury-3', // open_source == open_source
    };
    expect(verifyCrossFamily(invalidMap).ok).toBe(false);
  });

  it('validates exported INCEPTION_ROLE_MAP satisfies cross-family review rules', () => {
    expect(verifyCrossFamily(INCEPTION_ROLE_MAP)).toEqual({ ok: true });
    expect(INCEPTION_ROLE_MAP.reviser).toBe('inception:mercury-3');
    expect(INCEPTION_ROLE_MAP.analyst).toBe('inception:mercury-3');
    expect(INCEPTION_ROLE_MAP.critic).toBe('inception:mercury-3');
    expect(familyOf(INCEPTION_ROLE_MAP.judge)).not.toBe(familyOf(INCEPTION_ROLE_MAP.reviser));
  });
});
