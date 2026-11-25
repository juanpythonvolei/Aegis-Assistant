import { Lock, ShieldCheck, UserPlus } from 'lucide-react';
import React, { useRef, useState } from 'react';
import { apiFetch, setAegisSessionToken } from '../lib/apiClient';
import type { AegisUser } from '../types';
import { GoogleSignInButton } from './GoogleSignInButton';
import { JarvisHologramCore } from './JarvisHologramCore';

interface LoginScreenProps {
  needsSetup: boolean;
  onAuthenticated: (user: AegisUser) => void;
  onGoogleLogin: () => Promise<void>;
  loggingInGoogle: boolean;
  authError: string | null;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({
  needsSetup,
  onAuthenticated,
  onGoogleLogin,
  loggingInGoogle,
  authError,
}) => {
  const [mode, setMode] = useState<'login' | 'register'>(needsSetup ? 'register' : 'login');
  const [identifier, setIdentifier] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const idleAudioRef = useRef(0.08);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (mode === 'register') {
        const res = await apiFetch('/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, email, displayName, password }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Falha ao criar conta.');
        setAegisSessionToken(data.sessionToken);
        onAuthenticated(data.user);
      } else {
        const res = await apiFetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ identifier, password }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Credenciais inválidas.');
        setAegisSessionToken(data.sessionToken);
        onAuthenticated(data.user);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erro de autenticação.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="relative min-h-screen w-full bg-[#05070B] text-slate-100 flex items-center justify-center p-6 overflow-hidden">
      {/* Live 3D JARVIS Hologram behind Login Gate */}
      <JarvisHologramCore coreState="idle" audioLevelRef={idleAudioRef} />

      <div className="spatial-panel relative z-10 w-full max-w-md rounded-2xl p-7 space-y-6">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 text-xs font-medium text-amber-400">
            <ShieldCheck className="h-4 w-4" />
            <span>Acesso ao Núcleo Holográfico</span>
          </div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-slate-100">
            {mode === 'register' ? 'Criar Conta Aegis' : 'Entrar no Aegis'}
          </h1>
          <p className="text-xs text-slate-400 leading-relaxed">
            Autentique-se para ativar a holografia 3D, voz e visão em tempo real, telas desenhadas pela IA, Google
            Workspace e controle local Linux &amp; Windows.
          </p>
        </div>

        {/* Mode Switcher */}
        <div className="grid grid-cols-2 gap-1 rounded-lg bg-[#070B12] p-1 border border-white/10">
          <button
            type="button"
            onClick={() => {
              setMode('login');
              setError(null);
            }}
            className={`py-2 text-xs font-medium rounded-md transition-colors ${
              mode === 'login' ? 'bg-amber-500 text-slate-950 font-semibold' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Entrar
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('register');
              setError(null);
            }}
            className={`py-2 text-xs font-medium rounded-md transition-colors ${
              mode === 'register' ? 'bg-amber-500 text-slate-950 font-semibold' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Criar Conta
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3.5">
          {mode === 'register' ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs text-slate-400">Usuário</label>
                  <input
                    type="text"
                    required
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="ex: juan"
                    className="w-full rounded-lg border border-white/10 bg-[#070B12] px-3 py-2 text-xs text-slate-100 focus:border-amber-500 focus:outline-none"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-slate-400">Nome de Exibição</label>
                  <input
                    type="text"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="Seu nome"
                    className="w-full rounded-lg border border-white/10 bg-[#070B12] px-3 py-2 text-xs text-slate-100 focus:border-amber-500 focus:outline-none"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-slate-400">E-mail</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="voce@exemplo.com"
                  className="w-full rounded-lg border border-white/10 bg-[#070B12] px-3 py-2 text-xs text-slate-100 focus:border-amber-500 focus:outline-none"
                />
              </div>
            </>
          ) : (
            <div className="space-y-1">
              <label className="text-xs text-slate-400">Usuário ou E-mail</label>
              <input
                type="text"
                required
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder="usuario ou voce@exemplo.com"
                className="w-full rounded-lg border border-white/10 bg-[#070B12] px-3 py-2 text-xs text-slate-100 focus:border-amber-500 focus:outline-none"
              />
            </div>
          )}

          <div className="space-y-1">
            <label className="text-xs text-slate-400">Senha</label>
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Mínimo 6 caracteres"
              className="w-full rounded-lg border border-white/10 bg-[#070B12] px-3 py-2 text-xs text-slate-100 focus:border-amber-500 focus:outline-none"
            />
          </div>

          {(error || authError) && (
            <p className="text-xs text-rose-400 leading-snug">{error || authError}</p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-amber-500 px-4 py-2.5 text-xs font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-50 transition-colors"
          >
            {mode === 'register' ? <UserPlus className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
            <span>{submitting ? 'Autenticando...' : mode === 'register' ? 'Criar Conta e Ativar Núcleo' : 'Entrar no Aegis'}</span>
          </button>
        </form>

        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-white/10" />
          </div>
          <div className="relative flex justify-center text-[11px]">
            <span className="bg-[#0D121E] px-2.5 text-slate-500">ou conecte automaticamente via SSO</span>
          </div>
        </div>

        <div className="space-y-2.5">
          <GoogleSignInButton onClick={onGoogleLogin} disabled={loggingInGoogle} />
        </div>
      </div>
    </div>
  );
};
