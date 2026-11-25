import { AlertTriangle, Check, X } from 'lucide-react';
import React, { useState } from 'react';
import type { ConfirmationModalRequest } from '../types';

interface ConfirmationDialogProps {
  request: ConfirmationModalRequest | null;
  onClose: () => void;
}

export const ConfirmationDialog: React.FC<ConfirmationDialogProps> = ({ request, onClose }) => {
  const [busy, setBusy] = useState(false);

  if (!request) return null;

  const handleConfirm = async () => {
    setBusy(true);
    try {
      await request.onConfirm();
    } finally {
      setBusy(false);
      onClose();
    }
  };

  const handleCancel = async () => {
    setBusy(true);
    try {
      await request.onCancel?.();
    } finally {
      setBusy(false);
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
    >
      <div className="w-full max-w-lg rounded-xl border border-white/12 bg-[#11161F] shadow-2xl overflow-hidden">
        <div className="flex items-start justify-between gap-4 border-b border-white/8 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-500/15 text-amber-400">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div>
              <h2 id="confirm-dialog-title" className="text-base font-semibold text-slate-100">
                {request.title}
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                {request.actionType} · {request.target}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleCancel}
            disabled={busy}
            className="rounded-md p-1.5 text-slate-400 hover:bg-white/6 hover:text-slate-100 transition-colors"
            aria-label="Fechar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          <p className="text-sm leading-relaxed text-slate-200">{request.summary}</p>
          {request.details && (
            <pre className="max-h-52 overflow-auto rounded-lg border border-white/8 bg-[#0A0D12] p-3 text-xs font-mono text-slate-300 whitespace-pre-wrap break-words">
              {request.details}
            </pre>
          )}
          <p className="text-xs text-slate-400">
            Nenhuma alteração local ou no Google Workspace é aplicada sem sua autorização explícita.
          </p>
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-white/8 bg-[#0D1118] px-6 py-3.5">
          <button
            type="button"
            onClick={handleCancel}
            disabled={busy}
            className="px-4 py-2 rounded-lg border border-white/10 text-xs font-medium text-slate-300 hover:bg-white/5 hover:text-white transition-colors whitespace-nowrap shrink-0"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={busy}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-sky-500 text-xs font-semibold text-slate-950 hover:bg-sky-400 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
          >
            <Check className="h-3.5 w-3.5" />
            {busy ? 'Executando...' : 'Confirmar Execução'}
          </button>
        </div>
      </div>
    </div>
  );
};
