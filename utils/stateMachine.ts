/**
 * SpacePipe State Machine & Agent Experience (AX) Engine
 * 
 * Provides:
 * 1. Strongly typed Finite State Machines (FSM) with discriminated transitions.
 * 2. Async Lifecycle Machine (replaces fragile loading/error/loaded/data boolean clusters).
 * 3. Agent Bridge (window.__SPACEPIPE_AGENT__) for deterministic AI & automated agent introspection,
 *    state observation, and event-driven synchronization without arbitrary DOM polling.
 */

export interface TransitionRule<TState extends string, TEvent extends string> {
  target: TState;
  guard?: (context: any, eventPayload?: any) => boolean;
  action?: (context: any, eventPayload?: any) => void;
}

export type TransitionsConfig<TState extends string, TEvent extends string> = {
  [S in TState]?: {
    [E in TEvent]?: TState | TransitionRule<TState, TEvent>;
  };
};

export interface MachineConfig<TState extends string, TEvent extends string, TContext = any> {
  id: string;
  initial: TState;
  states: TransitionsConfig<TState, TEvent>;
  onTransition?: (from: TState, to: TState, event: TEvent, context: TContext) => void;
}

export interface StateMachineInstance<TState extends string, TEvent extends string, TContext = any> {
  id: string;
  getState: () => TState;
  getContext: () => TContext;
  can: (event: TEvent, payload?: any) => boolean;
  send: (event: TEvent, payload?: any) => boolean;
  subscribe: (listener: (state: TState, context: TContext) => void) => () => void;
  matches: (state: TState | TState[]) => boolean;
}

/* ---------------------------------------------------------------------------------------------- */
/* Agent Bridge & Global Registry                                                                 */
/* ---------------------------------------------------------------------------------------------- */

export interface AgentStateSnapshot {
  id: string;
  state: string;
  context?: any;
  timestamp: number;
}

export interface SpacePipeAgentBridge {
  version: string;
  getMachine: (id: string) => StateMachineInstance<any, any> | undefined;
  getState: (id: string) => string | undefined;
  getAllStates: () => Record<string, AgentStateSnapshot>;
  waitForState: (id: string, targetState: string | string[], timeoutMs?: number) => Promise<boolean>;
  subscribe: (id: string, callback: (state: string, context?: any) => void) => () => void;
  register: (machine: StateMachineInstance<any, any>) => () => void;
}

const registeredMachines = new Map<string, StateMachineInstance<any, any>>();
const stateListeners = new Map<string, Set<(state: string, context?: any) => void>>();

function getOrCreateAgentBridge(): SpacePipeAgentBridge {
  const globalScope = typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : null) as any;

  if (globalScope && !globalScope.__SPACEPIPE_AGENT__) {
    globalScope.__SPACEPIPE_AGENT__ = {
      version: '1.0.0',
      getMachine: (id: string) => registeredMachines.get(id),
      getState: (id: string) => registeredMachines.get(id)?.getState(),
      getAllStates: () => {
        const result: Record<string, AgentStateSnapshot> = {};
        for (const [id, m] of registeredMachines.entries()) {
          result[id] = {
            id,
            state: m.getState(),
            context: m.getContext(),
            timestamp: Date.now(),
          };
        }
        return result;
      },
      waitForState: (id: string, targetState: string | string[], timeoutMs = 10000): Promise<boolean> => {
        const targets = Array.isArray(targetState) ? targetState : [targetState];
        const machine = registeredMachines.get(id);
        if (machine && targets.includes(machine.getState())) {
          return Promise.resolve(true);
        }

        return new Promise<boolean>((resolve) => {
          let timer: any = null;
          let cleanup: (() => void) | null = null;

          const check = (currentState: string) => {
            if (targets.includes(currentState)) {
              if (timer) clearTimeout(timer);
              cleanup?.();
              resolve(true);
            }
          };

          const bridge = globalScope.__SPACEPIPE_AGENT__;
          cleanup = bridge.subscribe(id, (newState: string) => {
            check(newState);
          });

          // Check again in case state changed synchronously
          const current = registeredMachines.get(id)?.getState();
          if (current && targets.includes(current)) {
            if (cleanup) cleanup();
            resolve(true);
            return;
          }

          timer = setTimeout(() => {
            if (cleanup) cleanup();
            resolve(false);
          }, timeoutMs);
        });
      },
      subscribe: (id: string, callback: (state: string, context?: any) => void) => {
        if (!stateListeners.has(id)) {
          stateListeners.set(id, new Set());
        }
        const set = stateListeners.get(id)!;
        set.add(callback);
        return () => {
          set.delete(callback);
          if (set.size === 0) stateListeners.delete(id);
        };
      },
      register: (machine: StateMachineInstance<any, any>) => {
        registeredMachines.set(machine.id, machine);
        const unsubscribe = machine.subscribe((state, context) => {
          // Notify local listeners
          const listeners = stateListeners.get(machine.id);
          if (listeners) {
            listeners.forEach((fn) => {
              try {
                fn(state, context);
              } catch (err) {
                console.error(`[SpacePipeAgent] Listener error on machine ${machine.id}:`, err);
              }
            });
          }

          // Emit global custom event for external AI / agent test frameworks
          if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
            window.dispatchEvent(
              new CustomEvent('spacepipe:state-change', {
                detail: {
                  machineId: machine.id,
                  state,
                  context,
                  timestamp: Date.now(),
                },
              })
            );
          }
        });

        return () => {
          unsubscribe();
          registeredMachines.delete(machine.id);
        };
      },
    };
  }

  return globalScope?.__SPACEPIPE_AGENT__ || {
    version: '1.0.0',
    getMachine: (id: string) => registeredMachines.get(id),
    getState: (id: string) => registeredMachines.get(id)?.getState(),
    getAllStates: () => ({}),
    waitForState: async () => false,
    subscribe: () => () => {},
    register: () => () => {},
  };
}

export const agentBridge = getOrCreateAgentBridge();

/* ---------------------------------------------------------------------------------------------- */
/* State Machine Factory                                                                          */
/* ---------------------------------------------------------------------------------------------- */

export function createMachine<TState extends string, TEvent extends string, TContext = any>(
  config: MachineConfig<TState, TEvent, TContext>,
  initialContext: TContext
): StateMachineInstance<TState, TEvent, TContext> {
  let currentState: TState = config.initial;
  let currentContext: TContext = initialContext;
  const subscribers = new Set<(state: TState, context: TContext) => void>();

  const instance: StateMachineInstance<TState, TEvent, TContext> = {
    id: config.id,
    getState: () => currentState,
    getContext: () => currentContext,
    matches: (state: TState | TState[]) => {
      return Array.isArray(state) ? state.includes(currentState) : currentState === state;
    },
    can: (event: TEvent, payload?: any) => {
      const stateTransitions = config.states[currentState];
      if (!stateTransitions) return false;
      const rule = stateTransitions[event];
      if (!rule) return false;
      if (typeof rule === 'object' && rule.guard) {
        return rule.guard(currentContext, payload);
      }
      return true;
    },
    send: (event: TEvent, payload?: any) => {
      const stateTransitions = config.states[currentState];
      if (!stateTransitions) {
        return false;
      }

      const rule = stateTransitions[event];
      if (!rule) {
        return false;
      }

      let targetState: TState;
      if (typeof rule === 'string') {
        targetState = rule as TState;
      } else {
        if (rule.guard && !rule.guard(currentContext, payload)) {
          return false;
        }
        if (rule.action) {
          rule.action(currentContext, payload);
        }
        targetState = rule.target;
      }

      const prevState = currentState;
      currentState = targetState;

      config.onTransition?.(prevState, currentState, event, currentContext);

      // Notify internal subscribers
      subscribers.forEach((sub) => {
        try {
          sub(currentState, currentContext);
        } catch (err) {
          console.error(`[StateMachine:${config.id}] Subscriber error:`, err);
        }
      });

      return true;
    },
    subscribe: (listener: (state: TState, context: TContext) => void) => {
      subscribers.add(listener);
      return () => {
        subscribers.delete(listener);
      };
    },
  };

  // Auto-register machine with Agent Bridge
  agentBridge.register(instance);

  return instance;
}

/* ---------------------------------------------------------------------------------------------- */
/* React Hook: useMachine                                                                         */
/* ---------------------------------------------------------------------------------------------- */

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';

export function useMachine<TState extends string, TEvent extends string, TContext = any>(
  machineConfig: MachineConfig<TState, TEvent, TContext>,
  initialContext: TContext
) {
  const machine = useMemo(() => createMachine(machineConfig, initialContext), [machineConfig.id]);
  const [state, setState] = useState<TState>(() => machine.getState());

  useEffect(() => {
    return machine.subscribe((newState) => {
      setState(newState);
    });
  }, [machine]);

  const send = useCallback((event: TEvent, payload?: any) => machine.send(event, payload), [machine]);
  const can = useCallback((event: TEvent, payload?: any) => machine.can(event, payload), [machine]);
  const matches = useCallback((target: TState | TState[]) => machine.matches(target), [machine]);

  return {
    state,
    send,
    can,
    matches,
    context: machine.getContext(),
    machine,
  };
}

/* ---------------------------------------------------------------------------------------------- */
/* Universal Async Data Lifecycle Machine                                                         */
/* ---------------------------------------------------------------------------------------------- */

export type AsyncStatus = 'idle' | 'loading' | 'success' | 'error' | 'revalidating';

export type AsyncState<TData, TError = string> =
  | { status: 'idle'; data: null; error: null }
  | { status: 'loading'; data: null; error: null }
  | { status: 'success'; data: TData; error: null }
  | { status: 'revalidating'; data: TData; error: null }
  | { status: 'error'; data: TData | null; error: TError };

export function createAsyncInitialState<TData>(): AsyncState<TData> {
  return { status: 'idle', data: null, error: null };
}

export function asyncStateHelpers<TData, TError = string>(state: AsyncState<TData, TError>) {
  return {
    isIdle: state.status === 'idle',
    isLoading: state.status === 'loading',
    isSuccess: state.status === 'success',
    isError: state.status === 'error',
    isRevalidating: state.status === 'revalidating',
    isBusy: state.status === 'loading' || state.status === 'revalidating',
    isReady: state.status === 'success' || state.status === 'revalidating',
  };
}
