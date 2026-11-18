import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMachine, agentBridge, asyncStateHelpers } from '../stateMachine';

describe('stateMachine & agentBridge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates an FSM, checks initial state and transitions correctly', () => {
    type TestState = 'idle' | 'running' | 'paused' | 'stopped';
    type TestEvent = 'START' | 'PAUSE' | 'RESUME' | 'STOP';

    const machine = createMachine<TestState, TestEvent>(
      {
        id: 'test-fsm-1',
        initial: 'idle',
        states: {
          idle: { START: 'running' },
          running: { PAUSE: 'paused', STOP: 'stopped' },
          paused: { RESUME: 'running', STOP: 'stopped' },
          stopped: { START: 'running' },
        },
      },
      {}
    );

    expect(machine.getState()).toBe('idle');
    expect(machine.can('START')).toBe(true);
    expect(machine.can('PAUSE')).toBe(false);

    expect(machine.send('START')).toBe(true);
    expect(machine.getState()).toBe('running');
    expect(machine.matches('running')).toBe(true);
    expect(machine.matches(['running', 'idle'])).toBe(true);

    expect(machine.send('PAUSE')).toBe(true);
    expect(machine.getState()).toBe('paused');

    expect(machine.send('RESUME')).toBe(true);
    expect(machine.getState()).toBe('running');

    expect(machine.send('STOP')).toBe(true);
    expect(machine.getState()).toBe('stopped');

    // Illegal transition is rejected
    expect(machine.send('PAUSE')).toBe(false);
    expect(machine.getState()).toBe('stopped');
  });

  it('supports transition guards and actions', () => {
    type AuthState = 'logged_out' | 'logging_in' | 'logged_in';
    type AuthEvent = 'LOGIN' | 'LOGOUT';

    let actionExecuted = false;

    const machine = createMachine<AuthState, AuthEvent>(
      {
        id: 'test-auth-fsm',
        initial: 'logged_out',
        states: {
          logged_out: {
            LOGIN: {
              target: 'logged_in',
              guard: (_ctx, payload) => payload?.token === 'valid_secret',
              action: () => {
                actionExecuted = true;
              },
            },
          },
          logged_in: { LOGOUT: 'logged_out' },
        },
      },
      {}
    );

    // Guard rejects invalid token
    expect(machine.send('LOGIN', { token: 'invalid' })).toBe(false);
    expect(machine.getState()).toBe('logged_out');
    expect(actionExecuted).toBe(false);

    // Guard accepts valid token
    expect(machine.send('LOGIN', { token: 'valid_secret' })).toBe(true);
    expect(machine.getState()).toBe('logged_in');
    expect(actionExecuted).toBe(true);
  });

  it('registers with the agentBridge and supports waitForState', async () => {
    type AudioState = 'idle' | 'loading' | 'playing';
    type AudioEvent = 'LOAD' | 'PLAY';

    const playerMachine = createMachine<AudioState, AudioEvent>(
      {
        id: 'test-audio-player',
        initial: 'idle',
        states: {
          idle: { LOAD: 'loading' },
          loading: { PLAY: 'playing' },
          playing: { LOAD: 'loading' },
        },
      },
      {}
    );

    expect(agentBridge.getState('test-audio-player')).toBe('idle');

    // Asynchronously trigger transition
    setTimeout(() => {
      playerMachine.send('LOAD');
      playerMachine.send('PLAY');
    }, 20);

    const reached = await agentBridge.waitForState('test-audio-player', 'playing', 500);
    expect(reached).toBe(true);
    expect(agentBridge.getState('test-audio-player')).toBe('playing');
  });

  it('computes asyncStateHelpers correctly', () => {
    const idleHelpers = asyncStateHelpers({ status: 'idle', data: null, error: null });
    expect(idleHelpers.isIdle).toBe(true);
    expect(idleHelpers.isBusy).toBe(false);

    const loadingHelpers = asyncStateHelpers({ status: 'loading', data: null, error: null });
    expect(loadingHelpers.isLoading).toBe(true);
    expect(loadingHelpers.isBusy).toBe(true);

    const successHelpers = asyncStateHelpers({ status: 'success', data: { count: 42 }, error: null });
    expect(successHelpers.isSuccess).toBe(true);
    expect(successHelpers.isReady).toBe(true);
  });
});
