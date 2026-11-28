import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';

export type ToastTone = 'info' | 'success' | 'warning' | 'error';

interface ToastItem {
  id: string;
  message: string;
  tone: ToastTone;
}

interface ConfirmOptions {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

interface PromptOptions {
  title?: string;
  message: string;
  defaultValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
}

type ActiveModal =
  | {
      kind: 'confirm';
      options: ConfirmOptions;
      resolve: (ok: boolean) => void;
    }
  | {
      kind: 'alert';
      title?: string;
      message: string;
      resolve: () => void;
    }
  | {
      kind: 'prompt';
      options: PromptOptions;
      resolve: (value: string | null) => void;
    };

export interface DialogContextValue {
  toast: (message: string, tone?: ToastTone) => void;
  alert: (message: string, title?: string) => Promise<void>;
  confirm: (options: ConfirmOptions | string) => Promise<boolean>;
  prompt: (options: PromptOptions | string, defaultValue?: string) => Promise<string | null>;
}

const noopDialog: DialogContextValue = {
  toast: () => {},
  alert: async () => {},
  confirm: async () => false,
  prompt: async () => null,
};

let imperativeDialog: DialogContextValue = noopDialog;

export const appDialog: DialogContextValue = {
  toast: (message, tone) => imperativeDialog.toast(message, tone),
  alert: (message, title) => imperativeDialog.alert(message, title),
  confirm: (options) => imperativeDialog.confirm(options),
  prompt: (options, defaultValue) => imperativeDialog.prompt(options, defaultValue),
};

const DialogContext = createContext<DialogContextValue>(noopDialog);

export function useDialog(): DialogContextValue {
  return useContext(DialogContext);
}

export function DialogProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [modal, setModal] = useState<ActiveModal | null>(null);
  const [promptValue, setPromptValue] = useState('');
  const promptInputRef = useRef<HTMLInputElement>(null);

  const dismissToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const toast = useCallback((message: string, tone: ToastTone = 'info') => {
    const id = `toast_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    setToasts(prev => [...prev.slice(-4), { id, message, tone }]);
    window.setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 4500);
  }, []);

  const alert = useCallback((message: string, title?: string) => {
    return new Promise<void>(resolve => {
      setModal({ kind: 'alert', title, message, resolve });
    });
  }, []);

  const confirm = useCallback((options: ConfirmOptions | string) => {
    const normalized: ConfirmOptions = typeof options === 'string' ? { message: options } : options;
    return new Promise<boolean>(resolve => {
      setModal({ kind: 'confirm', options: normalized, resolve });
    });
  }, []);

  const prompt = useCallback((options: PromptOptions | string, defaultValue = '') => {
    const normalized: PromptOptions =
      typeof options === 'string' ? { message: options, defaultValue } : options;
    setPromptValue(normalized.defaultValue ?? '');
    return new Promise<string | null>(resolve => {
      setModal({ kind: 'prompt', options: normalized, resolve });
    });
  }, []);

  useEffect(() => {
    if (modal?.kind === 'prompt') {
      window.setTimeout(() => promptInputRef.current?.focus(), 20);
    }
  }, [modal]);

  useEffect(() => {
    const value: DialogContextValue = { toast, alert, confirm, prompt };
    imperativeDialog = value;
    return () => {
      if (imperativeDialog === value) imperativeDialog = noopDialog;
    };
  }, [toast, alert, confirm, prompt]);

  const closeCancel = useCallback(() => {
    setModal(curr => {
      if (!curr) return null;
      if (curr.kind === 'confirm') curr.resolve(false);
      else if (curr.kind === 'prompt') curr.resolve(null);
      else curr.resolve();
      return null;
    });
  }, []);

  const closeAccept = useCallback(() => {
    setModal(curr => {
      if (!curr) return null;
      if (curr.kind === 'confirm') curr.resolve(true);
      else if (curr.kind === 'prompt') curr.resolve(promptValue);
      else curr.resolve();
      return null;
    });
  }, [promptValue]);

  useEffect(() => {
    if (!modal) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeCancel();
      } else if (e.key === 'Enter' && modal.kind !== 'alert') {
        e.preventDefault();
        closeAccept();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [modal, closeCancel, closeAccept]);

  const contextValue = React.useMemo(
    () => ({ toast, alert, confirm, prompt }),
    [toast, alert, confirm, prompt]
  );

  return (
    <DialogContext.Provider value={contextValue}>
      {children}

      {/* Toast Container */}
      {toasts.length > 0 && (
        <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-2 max-w-sm w-full pointer-events-none px-4 sm:px-0">
          {toasts.map(t => {
            const toneStyles =
              t.tone === 'success'
                ? 'bg-emerald-950/95 border-emerald-500/40 text-emerald-100'
                : t.tone === 'error'
                ? 'bg-rose-950/95 border-rose-500/40 text-rose-100'
                : t.tone === 'warning'
                ? 'bg-amber-950/95 border-amber-500/40 text-amber-100'
                : 'bg-slate-900/95 border-slate-700 text-slate-100';
            return (
              <div
                key={t.id}
                role="status"
                className={`pointer-events-auto flex items-start gap-2.5 px-3.5 py-2.5 rounded-xl border shadow-2xl text-xs backdrop-blur-md ${toneStyles}`}
              >
                {t.tone === 'success' ? (
                  <CheckCircle2 size={15} className="text-emerald-400 shrink-0 mt-0.5" />
                ) : t.tone === 'error' || t.tone === 'warning' ? (
                  <AlertCircle size={15} className={t.tone === 'error' ? 'text-rose-400 shrink-0 mt-0.5' : 'text-amber-400 shrink-0 mt-0.5'} />
                ) : (
                  <Info size={15} className="text-indigo-400 shrink-0 mt-0.5" />
                )}
                <span className="flex-1 leading-relaxed break-words">{t.message}</span>
                <button
                  type="button"
                  onClick={() => dismissToast(t.id)}
                  className="text-slate-400 hover:text-white shrink-0"
                  aria-label="Dismiss notification"
                >
                  <X size={13} />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* In-DOM Confirm / Alert / Prompt Modal */}
      {modal && (
        <div
          className="fixed inset-0 z-[9998] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={closeCancel}
        >
          <div
            role="dialog"
            aria-modal="true"
            className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl p-5 text-slate-100"
            onClick={e => e.stopPropagation()}
          >
            <h3 className="text-sm font-bold text-white mb-2">
              {modal.kind === 'alert'
                ? modal.title || 'Notice'
                : modal.options.title || (modal.kind === 'prompt' ? 'Enter Value' : 'Confirm Action')}
            </h3>
            <p className="text-xs text-slate-300 leading-relaxed whitespace-pre-wrap mb-4">
              {modal.kind === 'alert' ? modal.message : modal.options.message}
            </p>

            {modal.kind === 'prompt' && (
              <input
                ref={promptInputRef}
                type="text"
                value={promptValue}
                onChange={e => setPromptValue(e.target.value)}
                placeholder={modal.options.placeholder}
                className="w-full px-3 py-2 mb-4 bg-slate-950 border border-slate-700 rounded-lg text-xs text-white focus:outline-none focus:border-indigo-500"
              />
            )}

            <div className="flex items-center justify-end gap-2">
              {modal.kind !== 'alert' && (
                <button
                  type="button"
                  onClick={closeCancel}
                  className="px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 cursor-pointer"
                >
                  {modal.options.cancelLabel || 'Cancel'}
                </button>
              )}
              <button
                type="button"
                onClick={closeAccept}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold text-white cursor-pointer ${
                  modal.kind === 'confirm' && modal.options.destructive
                    ? 'bg-rose-600 hover:bg-rose-500'
                    : 'bg-indigo-600 hover:bg-indigo-500'
                }`}
              >
                {modal.kind === 'alert'
                  ? 'OK'
                  : modal.options.confirmLabel || (modal.kind === 'prompt' ? 'Submit' : 'Confirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </DialogContext.Provider>
  );
}
