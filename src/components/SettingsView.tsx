import type { User } from 'firebase/auth';
import { Cloud, Cpu, Download } from 'lucide-react';
import React, { useEffect, useState } from 'react';
import type { ConfirmationModalRequest, ModelPreference } from '../types';
import { LinuxInstallerView } from './LinuxInstallerView';
import { UsageView } from './UsageView';
import { WorkspaceView } from './WorkspaceView';

export type SettingsTabId = 'models' | 'integrations' | 'local_agent';

interface SettingsViewProps {
  initialTab?: SettingsTabId;
  accessToken: string | null;
  googleUser: User | null;
  userEmail?: string;
  loggingInGoogle: boolean;
  modelPreference: ModelPreference;
  onChangeModelPreference: (pref: ModelPreference) => void;
  onGoogleLogin: () => Promise<void>;
  onGoogleDisconnect: () => void;
  onRequestConfirm: (req: ConfirmationModalRequest) => void;
}

const SETTINGS_TABS: Array<{
  id: SettingsTabId;
  label: string;
  description: string;
  icon: React.FC<{ className?: string }>;
}> = [
  {
    id: 'models',
    label: 'Modelos & Consumo',
    description: 'Escalonamento automático, cota de tokens e latência',
    icon: Cpu,
  },
  {
    id: 'integrations',
    label: 'Google Drive & Workspace',
    description: 'Conexão OAuth, explorador Drive, Gmail, Agenda e Tarefas',
    icon: Cloud,
  },
  {
    id: 'local_agent',
    label: 'Apps Nativos (Linux · Win · Android)',
    description: 'Pacote .deb/ELF Linux, AegisDesktop.exe Windows e App Kotlin/APK Android',
    icon: Download,
  },
];

export const SettingsView: React.FC<SettingsViewProps> = ({
  initialTab = 'models',
  accessToken,
  googleUser,
  userEmail,
  loggingInGoogle,
  modelPreference,
  onChangeModelPreference,
  onGoogleLogin,
  onGoogleDisconnect,
  onRequestConfirm,
}) => {
  const [activeTab, setActiveTab] = useState<SettingsTabId>(initialTab);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[#070B12]">
      {/* Settings Internal Navigation Bar */}
      <div className="border-b border-white/10 bg-[#0B101A] px-5 py-3 shrink-0">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {SETTINGS_TABS.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`inline-flex items-center gap-2 rounded-xl border px-3.5 py-2 text-xs font-medium transition-all cursor-pointer ${
                    isActive
                      ? 'border-amber-400/60 bg-amber-500/15 text-amber-200 shadow-sm'
                      : 'border-white/10 bg-[#101624] text-slate-300 hover:border-amber-500/35 hover:text-slate-100'
                  }`}
                >
                  <Icon className={`h-3.5 w-3.5 ${isActive ? 'text-amber-300' : 'text-slate-400'}`} />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>

          {activeTab === 'integrations' && accessToken && (
            <div className="flex items-center gap-3 text-xs">
              <span className="font-mono text-emerald-400">
                Conectado: {googleUser?.email || userEmail}
              </span>
              <button
                type="button"
                onClick={onGoogleDisconnect}
                className="rounded-lg border border-white/10 bg-[#121826] px-2.5 py-1 text-[11px] text-slate-300 hover:border-rose-500/40 hover:text-rose-200 transition-colors"
              >
                Desconectar
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Active Settings Section */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {activeTab === 'models' && (
          <UsageView
            modelPreference={modelPreference}
            onChangeModelPreference={onChangeModelPreference}
          />
        )}
        {activeTab === 'integrations' && (
          <WorkspaceView
            accessToken={accessToken}
            userEmail={userEmail}
            onLogin={onGoogleLogin}
            loggingIn={loggingInGoogle}
            onRequestConfirm={onRequestConfirm}
          />
        )}
        {activeTab === 'local_agent' && (
          <div className="flex h-full flex-col overflow-hidden">
            <div className="flex-1 min-h-0 overflow-hidden">
              <LinuxInstallerView />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
