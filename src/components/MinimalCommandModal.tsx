import { CornerDownLeft, Loader2, ShieldAlert, Terminal, X } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../lib/apiClient';
import type { ChatMessage, ConfirmationModalRequest, ModelPreference, PendingConfirmation } from '../types';

interface MinimalCommandModalProps {
  isOpen: boolean;
  onClose: () => void;
  accessToken: string | null;
  userEmail?: string;
  modelPreference: ModelPreference;
  onRequestConfirm: (req: ConfirmationModalRequest) => void;
  onNewMessage?: (msg: ChatMessage) => void;
}

export const MinimalCommandModal: React.FC<MinimalCommandModalProps> = ({
  isOpen,
  onClose,
  accessToken,
  userEmail,
  modelPreference,
  onRequestConfirm,
  onNewMessage,
}) => {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [reply, setReply] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingList, setPendingList] = useState<PendingConfirmation[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 40);
    }
  }, [isOpen]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const openConfirmModal = (pending: PendingConfirmation) => {
    onRequestConfirm({
      id: pending.id,
      title: 'Autorização de Execução',
      summary: pending.summary,
      actionType: pending.action_type,
      target: pending.target,
      details: pending.payload_json,
      onConfirm: async () => {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
        const res = await apiFetch('/api/actions/confirm', {
          method: 'POST',
          headers,
          body: JSON.stringify({ confirmationId: pending.id }),
        });
        const data = await res.json();
        const cmdOut = data.result?.stdout || data.result?.stderr || '';
        setReply(
          `${data.message || 'Ação executada.'}${data.summary ? `\n\n${data.summary}` : ''}${
            cmdOut ? `\n\nSaída da máquina:\n${cmdOut}` : ''
          }`
        );
        setPendingList((prev) => prev.filter((p) => p.id !== pending.id));
      },
      onCancel: async () => {
        await apiFetch('/api/actions/cancel', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ confirmationId: pending.id }),
        });
        setPendingList((prev) => prev.filter((p) => p.id !== pending.id));
      },
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || loading) return;

    setLoading(true);
    setError(null);
    setReply(null);
    setPendingList([]);

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

      const res = await apiFetch('/api/assistant/chat', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          prompt: text,
          sessionId: 'minimal-hud',
          mode: 'reactive',
          modelPreference,
          userEmail,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Falha ao processar comando.');
      }

      setReply(data.reply);
      setPendingList(data.pendingConfirmations || []);
      onNewMessage?.({
        id: `hud-${Date.now()}`,
        role: 'assistant',
        content: data.reply,
        timestamp: new Date().toISOString(),
        steps: data.steps,
        pendingConfirmations: data.pendingConfirmations,
        usage: data.usage,
      });
      setInput('');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erro desconhecido.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-center bg-black/70 backdrop-blur-xs pt-[14vh] px-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Janela de Comando Minimalista"
    >
      <div
        className="w-full max-w-2xl rounded-xl border border-white/12 bg-[#11161F] shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <form onSubmit={handleSubmit} className="flex items-center gap-3 border-b border-white/8 px-4 py-3.5">
          <Terminal className="h-4 w-4 text-sky-400 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Comando rápido para Linux local, Memória ou Google Workspace..."
            className="flex-1 bg-transparent text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none"
          />
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin text-sky-400 shrink-0" />
          ) : (
            <button
              type="submit"
              disabled={!input.trim()}
              className="inline-flex items-center gap-1 rounded-md bg-sky-500 px-2.5 py-1 text-xs font-medium text-slate-950 hover:bg-sky-400 disabled:opacity-40 transition-colors whitespace-nowrap shrink-0"
            >
              <span>Executar</span>
              <CornerDownLeft className="h-3 w-3" />
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-slate-400 hover:bg-white/6 hover:text-slate-100 transition-colors"
            aria-label="Fechar janela minimalista"
          >
            <X className="h-4 w-4" />
          </button>
        </form>

        {(reply || error || pendingList.length > 0) && (
          <div className="max-h-[48vh] overflow-y-auto px-5 py-4 space-y-3">
            {error && <p className="text-sm text-rose-400">{error}</p>}
            {reply && <div className="text-sm leading-relaxed text-slate-200 whitespace-pre-wrap">{reply}</div>}
            {pendingList.map((pending) => (
              <div
                key={pending.id}
                className="flex items-center justify-between gap-4 rounded-lg border border-amber-500/25 bg-amber-500/8 px-3.5 py-2.5"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <ShieldAlert className="h-4 w-4 text-amber-400 shrink-0" />
                  <span className="text-xs text-slate-200 truncate">{pending.summary}</span>
                </div>
                <button
                  type="button"
                  onClick={() => openConfirmModal(pending)}
                  className="px-3 py-1.5 rounded-md bg-amber-400 text-xs font-semibold text-slate-950 hover:bg-amber-300 transition-colors whitespace-nowrap shrink-0"
                >
                  Revisar
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between border-t border-white/8 bg-[#0C1017] px-4 py-2 text-xs text-slate-500">
          <span>Esc para fechar · Enter para executar</span>
          <span className="font-mono">Ctrl + K</span>
        </div>
      </div>
    </div>
  );
};
