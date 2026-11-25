import { CheckCircle2, Download, Share, Smartphone } from 'lucide-react';
import React, { useState } from 'react';
import { usePWAInstall } from '../hooks/usePWAInstall';

interface PWAInstallButtonProps {
  compact?: boolean;
  alwaysShowGuide?: boolean;
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({
  compact = false,
  alwaysShowGuide = false,
}) => {
  const { canPromptInstall, isInstalled, isIOS, isAndroid, promptInstall } = usePWAInstall();
  const [showIosGuide, setShowIosGuide] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  if (isInstalled && !alwaysShowGuide) {
    return (
      <div className="inline-flex items-center gap-1.5 text-[11px] font-mono text-emerald-400">
        <CheckCircle2 className="h-3.5 w-3.5" />
        <span>App Aegis Instalado</span>
      </div>
    );
  }

  const handleInstall = async () => {
    if (canPromptInstall) {
      const outcome = await promptInstall();
      if (outcome === 'accepted') {
        setStatusMsg('Aegis instalado na tela inicial.');
      }
      return;
    }
    setShowIosGuide((v) => !v);
  };

  if (compact) {
    if (!canPromptInstall && !isIOS && !isAndroid && !alwaysShowGuide) return null;
    return (
      <div className="space-y-2">
        <button
          type="button"
          onClick={() => void handleInstall()}
          className="w-full min-h-[44px] inline-flex items-center justify-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/14 px-3 py-2 text-xs font-semibold text-amber-200 hover:bg-amber-500/24 transition-colors cursor-pointer"
        >
          <Smartphone className="h-4 w-4 text-amber-300" />
          <span>{isIOS ? 'Instalar no iPhone / iPad' : 'Instalar App Aegis (Android / Desktop)'}</span>
        </button>
        {showIosGuide && (
          <div className="rounded-lg border border-sky-500/30 bg-[#0B1220] p-2.5 text-[11px] text-slate-300 leading-relaxed">
            {isIOS ? (
              <>
                No Safari, toque em <Share className="inline h-3.5 w-3.5 text-sky-400 mx-0.5" /> <strong>Compartilhar</strong> e selecione <strong>Adicionar à Tela de Início</strong>.
              </>
            ) : (
              <>
                No Chrome/Edge, abra o menu do navegador (<strong>⋮</strong>) e toque em <strong>Instalar aplicativo</strong> ou <strong>Adicionar à tela inicial</strong>.
              </>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-amber-500/25 bg-[#0C1220] p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-amber-500/40 bg-amber-500/15 text-amber-300">
            <Smartphone className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h4 className="font-display text-sm font-semibold text-slate-100">
              Aplicativo Instalável (Android · iOS · Desktop)
            </h4>
            <p className="text-xs text-slate-400">
              {isInstalled
                ? 'Executando em modo aplicativo nativo (Standalone PWA).'
                : 'Instale o Aegis direto na tela inicial com suporte offline, voz e controle multi-dispositivo.'}
            </p>
          </div>
        </div>

        {!isInstalled && (
          <button
            type="button"
            onClick={() => void handleInstall()}
            className="min-h-[44px] inline-flex items-center gap-2 rounded-xl bg-amber-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-amber-400 transition-colors cursor-pointer shrink-0"
          >
            <Download className="h-4 w-4" />
            <span>{canPromptInstall ? 'Instalar Agora' : isIOS ? 'Como Instalar no iOS' : 'Instalar no Dispositivo'}</span>
          </button>
        )}
      </div>

      {statusMsg && <p className="text-xs text-emerald-400 font-mono">{statusMsg}</p>}

      {(showIosGuide || (alwaysShowGuide && !canPromptInstall && !isInstalled)) && (
        <div className="grid gap-2.5 sm:grid-cols-2 pt-1 text-xs text-slate-300">
          <div className="rounded-lg border border-white/10 bg-[#080C15] p-3 space-y-1">
            <p className="font-semibold text-amber-300">Android (Chrome / Edge / Brave)</p>
            <p className="text-slate-400 leading-relaxed">
              Abra o endereço do Aegis no Chrome do celular, toque no botão <strong>Instalar Agora</strong> (ou menu <strong>⋮ → Instalar aplicativo</strong>).
            </p>
          </div>
          <div className="rounded-lg border border-white/10 bg-[#080C15] p-3 space-y-1">
            <p className="font-semibold text-sky-300">iOS (iPhone / iPad — Safari)</p>
            <p className="text-slate-400 leading-relaxed">
              Abra no <strong>Safari</strong>, toque no ícone <Share className="inline h-3.5 w-3.5 text-sky-400" /> <strong>Compartilhar</strong> e escolha <strong>Adicionar à Tela de Início</strong>.
            </p>
          </div>
        </div>
      )}
    </div>
  );
};
