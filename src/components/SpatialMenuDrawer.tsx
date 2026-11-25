import {
  Brain,
  Globe,
  LogOut,
  MessageSquare,
  Network,
  Settings,
  Smartphone,
  Sparkles,
  Terminal,
  X,
} from 'lucide-react';
import React from 'react';
import type { AegisUser } from '../types';
import { PWAInstallButton } from './PWAInstallButton';

export type SpatialModuleId =
  | 'command'
  | 'orchestrator'
  | 'devices'
  | 'terminal'
  | 'web'
  | 'memory'
  | 'settings';

export const SPATIAL_MODULES: Array<{
  id: SpatialModuleId;
  label: string;
  subtitle: string;
  icon: React.FC<{ className?: string }>;
}> = [
  {
    id: 'command',
    label: 'Orquestrador & Histórico',
    subtitle: 'Central de missões, voz ao vivo, passos e confirmações',
    icon: MessageSquare,
  },
  {
    id: 'orchestrator',
    label: 'Subagentes & Auto-Evolução',
    subtitle: 'Delegações autônomas e novas funções criadas no código do Aegis',
    icon: Network,
  },
  {
    id: 'devices',
    label: 'Dispositivos (Android & iOS)',
    subtitle: 'Controle de sistema Android (ADB/Termux), iOS Atalhos, PWA e visão total',
    icon: Smartphone,
  },
  {
    id: 'terminal',
    label: 'Terminal & Máquina Local',
    subtitle: 'Console, arquivos locais e editor integrado no sistema',
    icon: Terminal,
  },
  {
    id: 'web',
    label: 'Operador Web Autônomo',
    subtitle: 'Navegação web, extração estruturada e Cofre AES-256',
    icon: Globe,
  },
  {
    id: 'memory',
    label: 'Memória & Autonomia',
    subtitle: 'Fatos persistentes e varreduras proativas contínuas',
    icon: Brain,
  },
  {
    id: 'settings',
    label: 'Configurações',
    subtitle: 'Modelos & tokens, Google Drive/Workspace e Agente Local',
    icon: Settings,
  },
];

interface SpatialMenuDrawerProps {
  isOpen: boolean;
  activeModule: SpatialModuleId | null;
  aegisUser: AegisUser;
  accessToken: string | null;
  sessionTokens: number;
  sessionRequests: number;
  onCloseDrawer: () => void;
  onSelectModule: (id: SpatialModuleId) => void;
  onReturnToCore: () => void;
  onLogout: () => void;
}

export const SpatialMenuDrawer: React.FC<SpatialMenuDrawerProps> = ({
  isOpen,
  activeModule,
  aegisUser,
  accessToken,
  sessionTokens,
  sessionRequests,
  onCloseDrawer,
  onSelectModule,
  onReturnToCore,
  onLogout,
}) => {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex isolate"
      role="dialog"
      aria-modal="true"
      aria-label="Menu Espacial Aegis"
    >
      {/* Click-outside scrim strictly behind drawer */}
      <button
        type="button"
        aria-label="Fechar menu"
        onClick={onCloseDrawer}
        className="absolute inset-0 z-0 bg-[#030509]/74 cursor-default"
      />

      {/* Crisp Elevated Drawer Foreground */}
      <aside
        onClick={(e) => e.stopPropagation()}
        className="spatial-drawer-3d relative z-10 flex h-full w-[min(90vw,348px)] flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="flex h-16 items-center justify-between border-b border-amber-500/20 px-5 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-amber-500/40 bg-amber-500/15 text-amber-300">
              <Sparkles className="h-4 w-4" />
            </div>
            <div>
              <span className="font-display text-base font-bold tracking-tight text-slate-100 block leading-none">
                Aegis
              </span>
              <span className="font-mono text-[10px] uppercase tracking-widest text-amber-400/90">
                Orquestrador Autônomo
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={onCloseDrawer}
            className="rounded-lg border border-white/10 bg-[#121826] p-1.5 text-slate-400 hover:border-amber-500/40 hover:text-white transition-colors"
            aria-label="Fechar menu"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Return to Core Shortcut */}
        {activeModule && (
          <div className="px-4 pt-3">
            <button
              type="button"
              onClick={() => {
                onReturnToCore();
                onCloseDrawer();
              }}
              className="w-full flex items-center justify-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/14 px-3 py-2 text-xs font-semibold text-amber-200 hover:bg-amber-500/22 transition-colors"
            >
              <Sparkles className="h-3.5 w-3.5" />
              <span>Voltar ao Núcleo Holográfico 3D</span>
            </button>
          </div>
        )}

        {/* Spatial Module Cards */}
        <nav className="flex-1 overflow-y-auto p-4 space-y-2">
          {SPATIAL_MODULES.map((item) => {
            const Icon = item.icon;
            const isActive = activeModule === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  onSelectModule(item.id);
                  onCloseDrawer();
                }}
                className={`spatial-card w-full text-left flex items-start gap-3 rounded-xl px-3.5 py-3 cursor-pointer ${
                  isActive ? 'border-amber-400/55 bg-amber-500/12' : ''
                }`}
              >
                <div
                  className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${
                    isActive
                      ? 'border-amber-400/50 bg-amber-500/20 text-amber-300'
                      : 'border-white/10 bg-[#0A0F1A] text-amber-400/80'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <span className={`block text-xs font-semibold ${isActive ? 'text-amber-200' : 'text-slate-100'}`}>
                    {item.label}
                  </span>
                  <span className="mt-0.5 block text-[11px] leading-snug text-slate-400">
                    {item.subtitle}
                  </span>
                </div>
              </button>
            );
          })}
        </nav>

        {/* Operator Footer */}
        <div className="border-t border-white/10 bg-[#080B13] p-4 space-y-3 shrink-0">
          <div className="flex items-center justify-between text-[11px]">
            <div className="min-w-0">
              <p className="font-semibold text-slate-200 truncate">{aegisUser.displayName}</p>
              <p className="font-mono text-[10px] text-amber-400/90 tabular-nums">
                {sessionTokens.toLocaleString('pt-BR')} tok · {sessionRequests} req
              </p>
            </div>
            <span className={`font-mono text-[10px] ${accessToken ? 'text-emerald-400' : 'text-slate-500'}`}>
              {accessToken ? 'Google Conectado' : 'Google Offline'}
            </span>
          </div>

          <PWAInstallButton compact />

          <button
            type="button"
            onClick={onLogout}
            className="w-full min-h-[42px] inline-flex items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-[#121826] px-3 py-2 text-xs font-medium text-slate-300 hover:border-rose-500/40 hover:text-rose-200 transition-colors cursor-pointer"
          >
            <LogOut className="h-3.5 w-3.5" />
            <span>Encerrar Sessão</span>
          </button>
        </div>
      </aside>
    </div>
  );
};
