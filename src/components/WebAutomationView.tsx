import {
  CheckCircle2,
  ChevronRight,
  CloudUpload,
  Compass,
  Download,
  ExternalLink,
  FileText,
  FolderOpen,
  Globe,
  HardDrive,
  KeyRound,
  Layers,
  Loader2,
  Lock,
  Play,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
} from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { apiFetch } from '../lib/apiClient';
import type {
  ConfirmationModalRequest,
  DetectedAttachment,
  NavMenuNode,
  SemanticMenuUnderstanding,
  WebCredentialSummary,
  WebPageSnapshot,
  WebRoutine,
  WebRoutineRun,
} from '../types';

interface WebAutomationViewProps {
  accessToken: string | null;
  onRequestConfirm: (req: ConfirmationModalRequest) => void;
  onAskOrchestrator?: (directive: string) => void;
}

type WebTab = 'routines' | 'browser' | 'vault';

function formatBytes(bytes: number): string {
  if (!bytes || bytes < 1024) return `${bytes || 0} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export const WebAutomationView: React.FC<WebAutomationViewProps> = ({
  accessToken,
  onRequestConfirm,
  onAskOrchestrator,
}) => {
  const [activeTab, setActiveTab] = useState<WebTab>('routines');

  // Shared data
  const [credentials, setCredentials] = useState<WebCredentialSummary[]>([]);
  const [routines, setRoutines] = useState<WebRoutine[]>([]);
  const [runs, setRuns] = useState<WebRoutineRun[]>([]);
  const [snapshot, setSnapshot] = useState<WebPageSnapshot | null>(null);

  // Browser & Sub-menu Mapper state
  const [urlInput, setUrlInput] = useState('https://news.ycombinator.com');
  const [loadingNav, setLoadingNav] = useState(false);
  const [mappingMenus, setMappingMenus] = useState(false);
  const [siteOverview, setSiteOverview] = useState<string>('');
  const [understoodMenus, setUnderstoodMenus] = useState<SemanticMenuUnderstanding[]>([]);
  const [downloadingHref, setDownloadingHref] = useState<string | null>(null);
  const [quickLocalFolder, setQuickLocalFolder] = useState('Downloads/Portais');
  const [quickDriveFolder, setQuickDriveFolder] = useState('Aegis/Portais');
  const [webFeedback, setWebFeedback] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);

  // Routine form state
  const [editingRoutineId, setEditingRoutineId] = useState<number | null>(null);
  const [routineName, setRoutineName] = useState('');
  const [routineSiteName, setRoutineSiteName] = useState('');
  const [routineCredId, setRoutineCredId] = useState<string>('');
  const [routineStartUrl, setRoutineStartUrl] = useState('');
  const [routineSectionsText, setRoutineSectionsText] = useState(
    'Financeiro > Notas Fiscais\nRelatórios > Anexos'
  );
  const [routineInstructions, setRoutineInstructions] = useState(
    'Extrair valores, datas de vencimento, tabelas principais e baixar todos os anexos disponíveis.'
  );
  const [routineDownloadAttachments, setRoutineDownloadAttachments] = useState(true);
  const [routineExtensions, setRoutineExtensions] = useState('pdf,xlsx,xls,csv,docx,zip,xml');
  const [routineLocalFolder, setRoutineLocalFolder] = useState('Downloads/Portais');
  const [routineDriveFolder, setRoutineDriveFolder] = useState('Aegis/Portais');
  const [routineAutoOrganize, setRoutineAutoOrganize] = useState(true);
  const [savingRoutine, setSavingRoutine] = useState(false);
  const [runningRoutineId, setRunningRoutineId] = useState<number | null>(null);
  const [selectedRun, setSelectedRun] = useState<WebRoutineRun | null>(null);

  // Vault state
  const [siteName, setSiteName] = useState('');
  const [loginUrl, setLoginUrl] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [savingCred, setSavingCred] = useState(false);

  const authHeaders = (): Record<string, string> => {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (accessToken) h.Authorization = `Bearer ${accessToken}`;
    return h;
  };

  const loadData = async () => {
    const [credRes, snapRes, routRes] = await Promise.all([
      apiFetch('/api/web/credentials'),
      apiFetch('/api/web/snapshot?sessionId=primary-hud'),
      apiFetch('/api/web/routines'),
    ]);
    if (credRes.ok) {
      const d = await credRes.json();
      setCredentials(d.credentials || []);
    }
    if (snapRes.ok) {
      const s = await snapRes.json();
      if (s.snapshot) setSnapshot(s.snapshot);
    }
    if (routRes.ok) {
      const r = await routRes.json();
      setRoutines(r.routines || []);
      const fetchedRuns = (r.runs || []) as WebRoutineRun[];
      setRuns(fetchedRuns);
      if (!selectedRun && fetchedRuns.length > 0) {
        setSelectedRun(fetchedRuns[0]);
      }
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  const navigateUrl = async (targetUrl?: string) => {
    const url = (targetUrl ?? urlInput).trim();
    if (!url || loadingNav) return;
    setUrlInput(url);
    setWebFeedback(null);
    setLoadingNav(true);
    try {
      const res = await apiFetch('/api/web/navigate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, sessionId: 'primary-hud' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao acessar URL.');
      setSnapshot(data.snapshot);
      setUnderstoodMenus([]);
      setSiteOverview('');
    } catch (err: unknown) {
      setWebFeedback({ tone: 'err', text: err instanceof Error ? err.message : 'Erro ao navegar.' });
    } finally {
      setLoadingNav(false);
    }
  };

  const handleMapSubmenus = async (overrideUrl?: string, credId?: number) => {
    setMappingMenus(true);
    setWebFeedback(null);
    try {
      const res = await apiFetch('/api/web/map-menus', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: (overrideUrl ?? urlInput).trim() || undefined,
          credentialId: credId,
          sessionId: 'primary-hud',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Falha ao mapear menus e sub-menus.');
      setSnapshot(data.snapshot);
      setSiteOverview(data.siteOverview || '');
      setUnderstoodMenus(data.understoodMenus || []);
      setActiveTab('browser');
      setWebFeedback({
        tone: 'ok',
        text: `Mapeamento semântico concluído: ${(data.understoodMenus || []).length} subseção(ões) compreendidas e ${(data.attachments || []).length} anexo(s) detectado(s).`,
      });
    } catch (err: unknown) {
      setWebFeedback({ tone: 'err', text: err instanceof Error ? err.message : 'Erro ao mapear menus.' });
    } finally {
      setMappingMenus(false);
    }
  };

  const handleDownloadAttachment = async (att: DetectedAttachment) => {
    setDownloadingHref(att.href);
    setWebFeedback(null);
    try {
      const res = await apiFetch('/api/web/download', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          sessionId: 'primary-hud',
          fileUrl: att.href,
          preferredFilename: att.filename,
          localFolder: quickLocalFolder,
          driveFolder: accessToken ? quickDriveFolder : '',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Falha ao baixar anexo.');
      const driveMsg = data.driveUpload?.ok
        ? ` + enviado ao Google Drive (${data.driveUpload.driveFolderPath})`
        : data.driveUpload?.error
          ? ` (Drive: ${data.driveUpload.error})`
          : '';
      setWebFeedback({
        tone: 'ok',
        text: `Anexo salvo localmente em "${data.localFile.localRelativePath}" (${formatBytes(data.localFile.sizeBytes)})${driveMsg}.`,
      });
    } catch (err: unknown) {
      setWebFeedback({ tone: 'err', text: err instanceof Error ? err.message : 'Erro ao baixar anexo.' });
    } finally {
      setDownloadingHref(null);
    }
  };

  const resetRoutineForm = () => {
    setEditingRoutineId(null);
    setRoutineName('');
    setRoutineSiteName('');
    setRoutineCredId('');
    setRoutineStartUrl('');
    setRoutineSectionsText('Financeiro > Notas Fiscais\nRelatórios > Anexos');
    setRoutineInstructions('Extrair valores, datas de vencimento, tabelas principais e baixar todos os anexos disponíveis.');
    setRoutineDownloadAttachments(true);
    setRoutineExtensions('pdf,xlsx,xls,csv,docx,zip,xml');
    setRoutineLocalFolder('Downloads/Portais');
    setRoutineDriveFolder('Aegis/Portais');
    setRoutineAutoOrganize(true);
  };

  const handleEditRoutine = (r: WebRoutine) => {
    setEditingRoutineId(r.id);
    setRoutineName(r.name);
    setRoutineSiteName(r.site_name || '');
    setRoutineCredId(r.credential_id ? String(r.credential_id) : '');
    setRoutineStartUrl(r.start_url);
    setRoutineSectionsText((r.target_sections || []).join('\n'));
    setRoutineInstructions(r.extraction_instructions || '');
    setRoutineDownloadAttachments(r.download_attachments === 1);
    setRoutineExtensions(r.file_extensions || 'pdf,xlsx,xls,csv,docx,zip,xml');
    setRoutineLocalFolder(r.local_folder || 'Downloads/Portais');
    setRoutineDriveFolder(r.drive_folder || '');
    setRoutineAutoOrganize(r.auto_organize_by_section === 1);
  };

  const handleSaveRoutine = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!routineName.trim() || !routineStartUrl.trim()) return;
    setSavingRoutine(true);
    setWebFeedback(null);
    try {
      const targetSections = routineSectionsText
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);
      const res = await apiFetch('/api/web/routines', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editingRoutineId ?? undefined,
          name: routineName.trim(),
          siteName: routineSiteName.trim(),
          credentialId: routineCredId ? Number(routineCredId) : null,
          startUrl: routineStartUrl.trim(),
          targetSections,
          extractionInstructions: routineInstructions.trim(),
          downloadAttachments: routineDownloadAttachments,
          fileExtensions: routineExtensions.trim(),
          localFolder: routineLocalFolder.trim() || 'Downloads/Portais',
          driveFolder: routineDriveFolder.trim(),
          autoOrganizeBySection: routineAutoOrganize,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Falha ao salvar rotina.');
      resetRoutineForm();
      await loadData();
      setWebFeedback({ tone: 'ok', text: `Rotina "${data.routine.name}" salva com sucesso.` });
    } catch (err: unknown) {
      setWebFeedback({ tone: 'err', text: err instanceof Error ? err.message : 'Erro ao salvar rotina.' });
    } finally {
      setSavingRoutine(false);
    }
  };

  const handleDeleteRoutine = async (id: number) => {
    await apiFetch(`/api/web/routines/${id}`, { method: 'DELETE' });
    if (editingRoutineId === id) resetRoutineForm();
    await loadData();
  };

  const handleRunRoutine = (routine: WebRoutine) => {
    onRequestConfirm({
      id: `run-routine-${routine.id}-${Date.now()}`,
      title: 'Executar Rotina Web Autônoma',
      summary: `Permitir que o Aegis acesse "${routine.start_url}"${routine.credential_id ? ' (com login automático pelo Cofre)' : ''}, navegue pelos sub-menus configurados, baixe anexos para "${routine.local_folder}"${routine.drive_folder ? ` e sincronize no Google Drive em "${routine.drive_folder}"` : ''}?`,
      actionType: 'web_run_routine',
      target: routine.name,
      onConfirm: async () => {
        setRunningRoutineId(routine.id);
        setWebFeedback(null);
        try {
          const res = await apiFetch(`/api/web/routines/${routine.id}/run`, {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify({ sessionId: 'primary-hud' }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Falha ao executar rotina.');
          await loadData();
          setSelectedRun({
            id: data.runId,
            routine_id: data.routineId,
            routine_name: data.routineName,
            status: data.status,
            visited_sections: data.visitedSections || [],
            extracted_data: data.extractedData || [],
            downloaded_files: data.downloadedFiles || [],
            drive_uploads: data.driveUploads || [],
            logs: data.logs || [],
            summary: data.summary,
            latency_ms: data.latencyMs || 0,
            created_at: new Date().toISOString(),
          });
          setWebFeedback({ tone: data.ok ? 'ok' : 'err', text: data.summary });
        } catch (err: unknown) {
          setWebFeedback({ tone: 'err', text: err instanceof Error ? err.message : 'Erro ao executar rotina.' });
        } finally {
          setRunningRoutineId(null);
        }
      },
    });
  };

  const handleSaveCredential = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!siteName.trim() || !loginUrl.trim() || !username.trim() || !password) return;
    setSavingCred(true);
    try {
      const res = await apiFetch('/api/web/credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          siteName: siteName.trim(),
          loginUrl: loginUrl.trim(),
          username: username.trim(),
          password,
        }),
      });
      if (res.ok) {
        setSiteName('');
        setLoginUrl('');
        setUsername('');
        setPassword('');
        await loadData();
        setWebFeedback({ tone: 'ok', text: 'Credencial criptografada salva no cofre.' });
      }
    } finally {
      setSavingCred(false);
    }
  };

  const handleDeleteCredential = async (id: number) => {
    await apiFetch(`/api/web/credentials/${id}`, { method: 'DELETE' });
    await loadData();
  };

  const handleAutoLogin = (cred: WebCredentialSummary, mapAfter = false) => {
    onRequestConfirm({
      id: `weblogin-${cred.id}-${Date.now()}`,
      title: 'Autenticação Autônoma em Site',
      summary: `Permitir que o Aegis acesse "${cred.login_url}" e realize login automático como "${cred.username}"?`,
      actionType: 'web_login',
      target: cred.site_name,
      onConfirm: async () => {
        if (mapAfter) {
          await handleMapSubmenus(cred.login_url, cred.id);
          return;
        }
        setLoadingNav(true);
        setWebFeedback(null);
        try {
          const res = await apiFetch('/api/web/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ credentialId: cred.id, sessionId: 'primary-hud' }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Falha no login automático.');
          setSnapshot(data.snapshot);
          setActiveTab('browser');
          setWebFeedback({ tone: 'ok', text: data.message });
          await loadData();
        } catch (err: unknown) {
          setWebFeedback({ tone: 'err', text: err instanceof Error ? err.message : 'Erro ao logar.' });
        } finally {
          setLoadingNav(false);
        }
      },
    });
  };

  const renderNavTree = (nodes: NavMenuNode[], depth = 0): React.ReactNode => {
    if (!nodes.length) return null;
    return (
      <ul className={depth === 0 ? 'space-y-1' : 'mt-1 ml-3.5 border-l border-amber-500/18 pl-2.5 space-y-1'}>
        {nodes.map((node, idx) => (
          <li key={`${node.label}-${node.href}-${idx}`}>
            <div className="flex items-center justify-between gap-2 rounded-md px-2 py-1 hover:bg-white/5">
              <button
                type="button"
                disabled={!node.href}
                onClick={() => node.href && navigateUrl(node.href)}
                className="flex items-center gap-1.5 min-w-0 text-left text-xs text-slate-200 disabled:text-slate-400 hover:text-amber-300"
              >
                <ChevronRight className="h-3 w-3 text-amber-400/70 shrink-0" />
                <span className="truncate">{node.label}</span>
              </button>
              <span className="text-[10px] font-mono uppercase text-slate-500 shrink-0">
                {node.kind === 'tab' ? 'aba' : node.level > 0 ? 'sub' : 'menu'}
              </span>
            </div>
            {node.children && node.children.length > 0 && renderNavTree(node.children, depth + 1)}
          </li>
        ))}
      </ul>
    );
  };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[#07090F]">
      {/* Top Bar */}
      <div className="border-b border-amber-500/14 bg-[#0D1017] px-6 py-4 flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-amber-50">
            Automação Web Repetitiva, Sub-Menus &amp; Organização de Anexos
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Login automático com credenciais criptografadas, leitura semântica de menus/sub-menus/abas, download de anexos e arquivamento sincronizado na máquina local e no Google Drive.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <div className="inline-flex rounded-lg border border-white/10 bg-[#080B12] p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setActiveTab('routines')}
              className={`px-3 py-1.5 rounded-md font-medium whitespace-nowrap transition-colors ${
                activeTab === 'routines'
                  ? 'bg-amber-500 text-slate-950'
                  : 'text-slate-300 hover:text-amber-200'
              }`}
            >
              Rotinas ({routines.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('browser')}
              className={`px-3 py-1.5 rounded-md font-medium whitespace-nowrap transition-colors ${
                activeTab === 'browser'
                  ? 'bg-amber-500 text-slate-950'
                  : 'text-slate-300 hover:text-amber-200'
              }`}
            >
              Navegador &amp; Sub-Menus
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('vault')}
              className={`px-3 py-1.5 rounded-md font-medium whitespace-nowrap transition-colors ${
                activeTab === 'vault'
                  ? 'bg-amber-500 text-slate-950'
                  : 'text-slate-300 hover:text-amber-200'
              }`}
            >
              Cofre ({credentials.length})
            </button>
          </div>
        </div>
      </div>

      {webFeedback && (
        <div
          className={`border-b px-6 py-2.5 text-xs flex items-center justify-between gap-3 ${
            webFeedback.tone === 'ok'
              ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-200'
              : 'border-rose-500/25 bg-rose-500/10 text-rose-200'
          }`}
        >
          <span>{webFeedback.text}</span>
          <button
            type="button"
            onClick={() => setWebFeedback(null)}
            className="text-[11px] opacity-75 hover:opacity-100 shrink-0"
          >
            Fechar
          </button>
        </div>
      )}

      {/* TAB 1: REPETITIVE WEB ROUTINES */}
      {activeTab === 'routines' && (
        <div className="flex-1 overflow-y-auto p-6">
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
            {/* Left: Create / Edit Routine Form */}
            <div className="xl:col-span-5 rounded-xl border border-white/10 bg-[#0D1119] flex flex-col overflow-hidden">
              <div className="border-b border-white/8 px-5 py-3.5 flex items-center justify-between bg-[#101520]">
                <div className="flex items-center gap-2 text-sm font-medium text-amber-50">
                  <Layers className="h-4 w-4 text-amber-400" />
                  <span>{editingRoutineId ? 'Editar Rotina Repetitiva' : 'Nova Rotina Autônoma'}</span>
                </div>
                {editingRoutineId && (
                  <button
                    type="button"
                    onClick={resetRoutineForm}
                    className="text-xs text-slate-400 hover:text-slate-200"
                  >
                    Cancelar edição
                  </button>
                )}
              </div>

              <form onSubmit={handleSaveRoutine} className="p-5 space-y-3.5 text-xs">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className="space-y-1 block">
                    <span className="text-slate-300 font-medium">Nome da rotina *</span>
                    <input
                      type="text"
                      required
                      value={routineName}
                      onChange={(e) => setRoutineName(e.target.value)}
                      placeholder="Ex: Coleta Mensal de Notas"
                      className="w-full rounded-lg border border-white/10 bg-[#080B12] px-3 py-2 text-slate-100 focus:border-amber-500/50 focus:outline-none"
                    />
                  </label>

                  <label className="space-y-1 block">
                    <span className="text-slate-300 font-medium">Credencial de Login (Cofre)</span>
                    <select
                      value={routineCredId}
                      onChange={(e) => {
                        const val = e.target.value;
                        setRoutineCredId(val);
                        const found = credentials.find((c) => String(c.id) === val);
                        if (found) {
                          if (!routineStartUrl) setRoutineStartUrl(found.login_url);
                          if (!routineSiteName) setRoutineSiteName(found.site_name);
                        }
                      }}
                      className="w-full rounded-lg border border-white/10 bg-[#080B12] px-3 py-2 text-slate-100 focus:border-amber-500/50 focus:outline-none"
                    >
                      <option value="">Sem login (acesso direto)</option>
                      {credentials.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.site_name} ({c.username})
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <label className="space-y-1 block">
                  <span className="text-slate-300 font-medium">URL inicial do portal *</span>
                  <input
                    type="url"
                    required
                    value={routineStartUrl}
                    onChange={(e) => setRoutineStartUrl(e.target.value)}
                    placeholder="https://portal.exemplo.com/painel"
                    className="w-full rounded-lg border border-white/10 bg-[#080B12] px-3 py-2 font-mono text-slate-100 focus:border-amber-500/50 focus:outline-none"
                  />
                </label>

                <label className="space-y-1 block">
                  <span className="text-slate-300 font-medium">
                    Menus, Sub-Menus e Abas Alvo (1 caminho por linha)
                  </span>
                  <textarea
                    rows={3}
                    value={routineSectionsText}
                    onChange={(e) => setRoutineSectionsText(e.target.value)}
                    placeholder={'Financeiro > Boletos > 2ª Via\nDocumentos > Relatórios Mensais'}
                    className="w-full rounded-lg border border-white/10 bg-[#080B12] px-3 py-2 text-slate-100 focus:border-amber-500/50 focus:outline-none"
                  />
                  <span className="text-[11px] text-slate-500 block">
                    O Aegis entende semanticamente cada subseção mesmo quando os rótulos variam no menu do site.
                  </span>
                </label>

                <label className="space-y-1 block">
                  <span className="text-slate-300 font-medium">O que extrair em cada subseção</span>
                  <textarea
                    rows={2}
                    value={routineInstructions}
                    onChange={(e) => setRoutineInstructions(e.target.value)}
                    className="w-full rounded-lg border border-white/10 bg-[#080B12] px-3 py-2 text-slate-100 focus:border-amber-500/50 focus:outline-none"
                  />
                </label>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                  <label className="space-y-1 block">
                    <span className="text-slate-300 font-medium flex items-center gap-1.5">
                      <HardDrive className="h-3.5 w-3.5 text-amber-400" />
                      Pasta Local (Máquina)
                    </span>
                    <input
                      type="text"
                      value={routineLocalFolder}
                      onChange={(e) => setRoutineLocalFolder(e.target.value)}
                      placeholder="Downloads/Portais/Fiscal"
                      className="w-full rounded-lg border border-white/10 bg-[#080B12] px-3 py-2 font-mono text-slate-100 focus:border-amber-500/50 focus:outline-none"
                    />
                  </label>

                  <label className="space-y-1 block">
                    <span className="text-slate-300 font-medium flex items-center gap-1.5">
                      <CloudUpload className="h-3.5 w-3.5 text-sky-400" />
                      Pasta Google Drive (Nuvem)
                    </span>
                    <input
                      type="text"
                      value={routineDriveFolder}
                      onChange={(e) => setRoutineDriveFolder(e.target.value)}
                      placeholder="Aegis/Portais/Fiscal"
                      className="w-full rounded-lg border border-white/10 bg-[#080B12] px-3 py-2 font-mono text-slate-100 focus:border-amber-500/50 focus:outline-none"
                    />
                    {!accessToken && routineDriveFolder.trim() && (
                      <span className="text-[11px] text-amber-400/90 block">
                        Conecte o Google Workspace em Configurações para ativar o envio automático ao Drive.
                      </span>
                    )}
                  </label>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-center pt-1">
                  <label className="flex items-center gap-2 text-slate-200 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={routineDownloadAttachments}
                      onChange={(e) => setRoutineDownloadAttachments(e.target.checked)}
                      className="rounded border-white/20 bg-[#080B12] text-amber-500"
                    />
                    <span>Baixar anexos automaticamente</span>
                  </label>

                  <label className="flex items-center gap-2 text-slate-200 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={routineAutoOrganize}
                      onChange={(e) => setRoutineAutoOrganize(e.target.checked)}
                      className="rounded border-white/20 bg-[#080B12] text-amber-500"
                    />
                    <span>Subpastas por sub-menu/seção</span>
                  </label>
                </div>

                {routineDownloadAttachments && (
                  <label className="space-y-1 block">
                    <span className="text-slate-400">Extensões permitidas (separadas por vírgula)</span>
                    <input
                      type="text"
                      value={routineExtensions}
                      onChange={(e) => setRoutineExtensions(e.target.value)}
                      className="w-full rounded-lg border border-white/10 bg-[#080B12] px-3 py-1.5 font-mono text-slate-200 focus:border-amber-500/50 focus:outline-none"
                    />
                  </label>
                )}

                <button
                  type="submit"
                  disabled={savingRoutine}
                  className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-amber-500 px-4 py-2.5 text-xs font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-50 transition-colors"
                >
                  <Plus className="h-4 w-4" />
                  <span>{savingRoutine ? 'Salvando...' : editingRoutineId ? 'Atualizar Rotina' : 'Salvar Rotina Repetitiva'}</span>
                </button>
              </form>
            </div>

            {/* Right: Saved Routines + Last Run Inspector */}
            <div className="xl:col-span-7 flex flex-col gap-6">
              {/* Saved Routines List */}
              <div className="rounded-xl border border-white/10 bg-[#0D1119] overflow-hidden">
                <div className="border-b border-white/8 px-5 py-3.5 flex items-center justify-between bg-[#101520]">
                  <span className="text-sm font-medium text-amber-50">Rotinas Salvas</span>
                  <button
                    type="button"
                    onClick={() => void loadData()}
                    className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-amber-300"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    <span>Atualizar</span>
                  </button>
                </div>

                {routines.length === 0 ? (
                  <div className="p-6 text-xs text-slate-400 space-y-2">
                    <p className="text-slate-200 font-medium">Nenhuma rotina repetitiva configurada ainda.</p>
                    <p>
                      Cadastre ao lado a URL do portal, escolha sua credencial do cofre e liste os menus/sub-menus que
                      o Aegis deve percorrer para baixar anexos e organizar nas pastas local e do Google Drive.
                    </p>
                  </div>
                ) : (
                  <div className="divide-y divide-white/8">
                    {routines.map((r) => {
                      const cred = credentials.find((c) => c.id === r.credential_id);
                      const isRunning = runningRoutineId === r.id;
                      return (
                        <div key={r.id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-white/[0.02]">
                          <div className="min-w-0 space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-semibold text-slate-100 truncate">{r.name}</span>
                              {r.last_status && (
                                <span
                                  className={`text-[11px] font-mono ${
                                    r.last_status === 'ok'
                                      ? 'text-emerald-400'
                                      : r.last_status === 'partial'
                                        ? 'text-amber-400'
                                        : 'text-rose-400'
                                  }`}
                                >
                                  · {r.last_status}
                                </span>
                              )}
                            </div>
                            <p className="text-[11px] font-mono text-slate-400 truncate">{r.start_url}</p>
                            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-400">
                              <span>
                                Login: <strong className="text-slate-200">{cred ? cred.site_name : 'Direto'}</strong>
                              </span>
                              <span>
                                Sub-menus: <strong className="text-slate-200 tabular-nums">{r.target_sections.length}</strong>
                              </span>
                              <span>
                                Local: <code className="text-amber-300/90">{r.local_folder}</code>
                              </span>
                              {r.drive_folder && (
                                <span>
                                  Drive: <code className="text-sky-300/90">{r.drive_folder}</code>
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              type="button"
                              disabled={isRunning}
                              onClick={() => handleRunRoutine(r)}
                              className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-50 whitespace-nowrap"
                            >
                              {isRunning ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Play className="h-3.5 w-3.5" />
                              )}
                              <span>{isRunning ? 'Executando...' : 'Executar'}</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleEditRoutine(r)}
                              className="rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-white/5"
                            >
                              Editar
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleDeleteRoutine(r.id)}
                              className="rounded-lg p-1.5 text-slate-500 hover:bg-white/5 hover:text-rose-400"
                              title="Excluir rotina"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Execution Report & History */}
              <div className="rounded-xl border border-white/10 bg-[#0D1119] overflow-hidden">
                <div className="border-b border-white/8 px-5 py-3.5 flex items-center justify-between bg-[#101520]">
                  <span className="text-sm font-medium text-amber-50">
                    Resultado &amp; Histórico de Execuções ({runs.length})
                  </span>
                  {selectedRun && (
                    <span className="text-xs font-mono text-slate-400 tabular-nums">
                      {selectedRun.latency_ms} ms · {selectedRun.visited_sections.length} seções ·{' '}
                      {selectedRun.downloaded_files.length} anexos
                    </span>
                  )}
                </div>

                {!selectedRun ? (
                  <div className="p-6 text-xs text-slate-500">
                    Ao executar uma rotina, você verá aqui o caminho percorrido nos sub-menus, os dados extraídos, os
                    anexos organizados localmente e os links enviados ao Google Drive.
                  </div>
                ) : (
                  <div className="p-5 space-y-4 text-xs">
                    {runs.length > 1 && (
                      <div className="flex items-center gap-2 overflow-x-auto pb-1">
                        {runs.slice(0, 6).map((run) => (
                          <button
                            key={run.id}
                            type="button"
                            onClick={() => setSelectedRun(run)}
                            className={`px-2.5 py-1 rounded-md border text-[11px] whitespace-nowrap ${
                              selectedRun.id === run.id
                                ? 'border-amber-500/50 bg-amber-500/15 text-amber-200'
                                : 'border-white/10 bg-[#080B12] text-slate-400 hover:text-slate-200'
                            }`}
                          >
                            #{run.id} · {run.routine_name}
                          </button>
                        ))}
                      </div>
                    )}

                    <div className="rounded-lg border border-white/8 bg-[#080B12] p-3.5 text-slate-200">
                      <div className="flex items-center gap-2 font-medium text-amber-100">
                        <CheckCircle2
                          className={`h-4 w-4 shrink-0 ${
                            selectedRun.status === 'ok'
                              ? 'text-emerald-400'
                              : selectedRun.status === 'partial'
                                ? 'text-amber-400'
                                : 'text-rose-400'
                          }`}
                        />
                        <span>{selectedRun.summary}</span>
                      </div>
                    </div>

                    {selectedRun.visited_sections.length > 0 && (
                      <div className="space-y-1.5">
                        <p className="font-medium text-slate-300">Sub-Menus &amp; Seções Compreendidas</p>
                        <div className="divide-y divide-white/6 rounded-lg border border-white/8 bg-[#080B12]">
                          {selectedRun.visited_sections.map((sec, idx) => (
                            <div key={`${sec.url}-${idx}`} className="px-3.5 py-2.5 space-y-0.5">
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-medium text-amber-200">{sec.sectionPath}</span>
                                <span className="font-mono text-[11px] text-slate-500 truncate max-w-[240px]">
                                  {sec.url}
                                </span>
                              </div>
                              <p className="text-slate-400">{sec.understanding}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {(selectedRun.downloaded_files.length > 0 || selectedRun.drive_uploads.length > 0) && (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div className="rounded-lg border border-white/8 bg-[#080B12] p-3 space-y-2">
                          <div className="flex items-center gap-1.5 font-medium text-slate-200">
                            <FolderOpen className="h-3.5 w-3.5 text-amber-400" />
                            <span>Organizados Localmente ({selectedRun.downloaded_files.length})</span>
                          </div>
                          {selectedRun.downloaded_files.length === 0 ? (
                            <p className="text-slate-500">Nenhum anexo baixado.</p>
                          ) : (
                            <ul className="space-y-1.5">
                              {selectedRun.downloaded_files.map((f, idx) => (
                                <li key={`${f.localRelativePath}-${idx}`} className="flex items-center justify-between gap-2">
                                  <span className="font-mono text-[11px] text-slate-300 truncate">{f.localRelativePath}</span>
                                  <span className="font-mono text-[11px] text-slate-500 tabular-nums shrink-0">
                                    {formatBytes(f.sizeBytes)}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>

                        <div className="rounded-lg border border-white/8 bg-[#080B12] p-3 space-y-2">
                          <div className="flex items-center gap-1.5 font-medium text-slate-200">
                            <CloudUpload className="h-3.5 w-3.5 text-sky-400" />
                            <span>Enviados ao Google Drive ({selectedRun.drive_uploads.length})</span>
                          </div>
                          {selectedRun.drive_uploads.length === 0 ? (
                            <p className="text-slate-500">Nenhum upload para o Drive nesta execução.</p>
                          ) : (
                            <ul className="space-y-1.5">
                              {selectedRun.drive_uploads.map((u, idx) => (
                                <li key={`${u.driveFileId}-${idx}`} className="flex items-center justify-between gap-2">
                                  <span className="font-mono text-[11px] text-sky-200 truncate">
                                    {u.driveFolderPath}/{u.fileName}
                                  </span>
                                  {u.webViewLink && (
                                    <a
                                      href={u.webViewLink}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="text-sky-400 hover:text-sky-300 shrink-0"
                                    >
                                      <ExternalLink className="h-3 w-3" />
                                    </a>
                                  )}
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      </div>
                    )}

                    {selectedRun.logs.length > 0 && (
                      <details className="rounded-lg border border-white/8 bg-[#080B12]">
                        <summary className="cursor-pointer px-3.5 py-2 text-slate-400 hover:text-slate-200">
                          Ver log passo a passo ({selectedRun.logs.length} eventos)
                        </summary>
                        <pre className="border-t border-white/8 p-3 text-[11px] font-mono text-slate-400 whitespace-pre-wrap max-h-48 overflow-y-auto">
                          {selectedRun.logs.join('\n')}
                        </pre>
                      </details>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: BROWSER & SEMANTIC SUB-MENU MAPPER */}
      {activeTab === 'browser' && (
        <div className="flex-1 overflow-y-auto p-6">
          <div className="rounded-xl border border-white/10 bg-[#0D1119] overflow-hidden flex flex-col">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void navigateUrl();
              }}
              className="flex flex-wrap items-center gap-2 border-b border-white/10 bg-[#101520] p-4"
            >
              <div className="flex items-center gap-2 flex-1 min-w-[240px] rounded-lg border border-white/10 bg-[#080B12] px-3 py-2">
                <Globe className="h-4 w-4 text-amber-400 shrink-0" />
                <input
                  type="text"
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  placeholder="https://portal.exemplo.com"
                  className="w-full bg-transparent text-xs font-mono text-amber-50 focus:outline-none"
                />
              </div>
              <button
                type="submit"
                disabled={loadingNav}
                className="px-4 py-2 rounded-lg bg-amber-500 text-xs font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-50 whitespace-nowrap shrink-0"
              >
                {loadingNav ? 'Acessando...' : 'Navegar'}
              </button>
              <button
                type="button"
                disabled={mappingMenus}
                onClick={() => void handleMapSubmenus()}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-sky-500/35 bg-sky-500/10 text-xs font-medium text-sky-200 hover:bg-sky-500/20 disabled:opacity-50 whitespace-nowrap shrink-0"
              >
                {mappingMenus ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Compass className="h-3.5 w-3.5" />}
                <span>{mappingMenus ? 'Mapeando...' : 'Mapear Sub-Menus com IA'}</span>
              </button>
            </form>

            {!snapshot ? (
              <div className="p-8 text-xs text-slate-400 space-y-2">
                <p className="text-slate-200 font-medium">Nenhuma página carregada na sessão atual.</p>
                <p>
                  Informe uma URL acima ou faça login em uma credencial no Cofre para inspecionar a árvore de menus,
                  sub-menus, abas e anexos disponíveis para download.
                </p>
              </div>
            ) : (
              <div className="p-5 space-y-5">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/8 pb-3">
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold text-slate-100 truncate">{snapshot.title}</h3>
                    <p className="text-[11px] font-mono text-slate-400 truncate">{snapshot.url}</p>
                    {snapshot.breadcrumbs && snapshot.breadcrumbs.length > 0 && (
                      <p className="text-[11px] text-amber-300/90 mt-0.5">
                        Caminho: {snapshot.breadcrumbs.join(' > ')}
                      </p>
                    )}
                  </div>
                  <div className="text-xs font-mono text-sky-300 tabular-nums whitespace-nowrap">
                    HTTP {snapshot.status} · {snapshot.cookieCount} cookies · {(snapshot.attachments || []).length} anexos
                  </div>
                </div>

                {siteOverview && (
                  <div className="rounded-lg border border-sky-500/25 bg-sky-500/10 px-4 py-3 text-xs text-sky-100 flex items-start gap-2.5">
                    <Sparkles className="h-4 w-4 text-sky-300 shrink-0 mt-0.5" />
                    <div className="space-y-1">
                      <p className="font-medium">Compreensão Semântica do Portal</p>
                      <p className="text-sky-200/90">{siteOverview}</p>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
                  {/* Left: Hierarchical Menus & Sub-Menus */}
                  <div className="lg:col-span-5 space-y-3">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-300">
                        Árvore de Menus, Sub-Menus &amp; Abas
                      </h4>
                      {onAskOrchestrator && (
                        <button
                          type="button"
                          onClick={() =>
                            onAskOrchestrator(
                              `Analise os sub-menus de ${snapshot.url}, crie uma rotina repetitiva para extrair os dados e baixar os anexos organizando na máquina local e no Google Drive.`
                            )
                          }
                          className="text-[11px] text-amber-300 hover:underline"
                        >
                          Criar rotina via IA
                        </button>
                      )}
                    </div>

                    {understoodMenus.length > 0 ? (
                      <div className="max-h-96 overflow-y-auto divide-y divide-white/6 rounded-lg border border-white/10 bg-[#080B12]">
                        {understoodMenus.map((m, idx) => (
                          <div key={`${m.path}-${idx}`} className="p-3 space-y-1 hover:bg-white/[0.03]">
                            <div className="flex items-center justify-between gap-2">
                              <button
                                type="button"
                                disabled={!m.href}
                                onClick={() => m.href && navigateUrl(m.href)}
                                className="text-xs font-medium text-amber-200 hover:underline text-left truncate"
                              >
                                {m.path}
                              </button>
                              {m.likelyHasAttachments && (
                                <span className="text-[10px] font-mono text-emerald-400 shrink-0">anexos</span>
                              )}
                            </div>
                            <p className="text-[11px] text-slate-400">{m.purpose}</p>
                          </div>
                        ))}
                      </div>
                    ) : snapshot.navigationTree && snapshot.navigationTree.length > 0 ? (
                      <div className="max-h-96 overflow-y-auto rounded-lg border border-white/10 bg-[#080B12] p-3">
                        {renderNavTree(snapshot.navigationTree)}
                      </div>
                    ) : (
                      <div className="rounded-lg border border-white/10 bg-[#080B12] p-4 text-xs text-slate-500">
                        Nenhum menu estruturado detectado nesta página. Clique em &ldquo;Mapear Sub-Menus com IA&rdquo;
                        ou navegue pelos links abaixo.
                      </div>
                    )}
                  </div>

                  {/* Right: Detected Attachments + Extracted Content */}
                  <div className="lg:col-span-7 space-y-4">
                    {/* Attachments Panel */}
                    <div className="rounded-lg border border-white/10 bg-[#080B12] overflow-hidden">
                      <div className="border-b border-white/8 px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 bg-[#0E131D]">
                        <span className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                          <FileText className="h-3.5 w-3.5 text-amber-400" />
                          Anexos Detectados na Página ({(snapshot.attachments || []).length})
                        </span>
                        <div className="flex items-center gap-2 text-[11px]">
                          <input
                            type="text"
                            value={quickLocalFolder}
                            onChange={(e) => setQuickLocalFolder(e.target.value)}
                            title="Pasta local de destino"
                            className="w-32 rounded border border-white/10 bg-[#07090F] px-2 py-1 font-mono text-slate-300"
                          />
                          <input
                            type="text"
                            value={quickDriveFolder}
                            onChange={(e) => setQuickDriveFolder(e.target.value)}
                            title="Pasta Google Drive de destino"
                            className="w-32 rounded border border-white/10 bg-[#07090F] px-2 py-1 font-mono text-sky-300"
                          />
                        </div>
                      </div>

                      {!snapshot.attachments || snapshot.attachments.length === 0 ? (
                        <div className="p-4 text-xs text-slate-500">
                          Nenhum link de anexo (PDF, XLSX, CSV, DOCX, ZIP, XML) encontrado nesta subseção.
                        </div>
                      ) : (
                        <div className="max-h-56 overflow-y-auto divide-y divide-white/6">
                          {snapshot.attachments.map((att, idx) => (
                            <div key={`${att.href}-${idx}`} className="px-4 py-2.5 flex items-center justify-between gap-3">
                              <div className="min-w-0">
                                <p className="text-xs font-medium text-slate-100 truncate">{att.filename}</p>
                                <p className="text-[11px] text-slate-400 truncate">
                                  {att.sectionHint || att.label} · .{att.extension}
                                </p>
                              </div>
                              <button
                                type="button"
                                disabled={downloadingHref === att.href}
                                onClick={() => void handleDownloadAttachment(att)}
                                className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/35 bg-amber-500/10 px-2.5 py-1.5 text-[11px] font-medium text-amber-200 hover:bg-amber-500/20 disabled:opacity-50 whitespace-nowrap shrink-0"
                              >
                                {downloadingHref === att.href ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : (
                                  <Download className="h-3 w-3" />
                                )}
                                <span>Baixar &amp; Organizar</span>
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Text Preview */}
                    <div className="space-y-1.5">
                      <p className="text-xs font-medium text-slate-300">Conteúdo Extraído</p>
                      <pre className="max-h-52 overflow-y-auto rounded-lg border border-white/8 bg-[#080B12] p-3 text-xs font-mono text-slate-300 whitespace-pre-wrap">
                        {snapshot.textPreview || '(Sem texto visível)'}
                      </pre>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 3: ENCRYPTED CREDENTIALS VAULT */}
      {activeTab === 'vault' && (
        <div className="flex-1 overflow-y-auto p-6">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 max-w-5xl">
            <div className="lg:col-span-5 rounded-xl border border-white/10 bg-[#0D1119] overflow-hidden">
              <div className="flex items-center gap-2 border-b border-white/8 px-5 py-3.5 text-sm font-medium text-amber-50 bg-[#101520]">
                <KeyRound className="h-4 w-4 text-amber-400" />
                <span>Nova Credencial (AES-256-GCM)</span>
              </div>

              <form onSubmit={handleSaveCredential} className="p-5 space-y-3 text-xs">
                <input
                  type="text"
                  required
                  value={siteName}
                  onChange={(e) => setSiteName(e.target.value)}
                  placeholder="Nome do site ou portal (ex: Portal Financeiro)"
                  className="w-full rounded-lg border border-white/10 bg-[#080B12] px-3 py-2 text-slate-100 focus:border-amber-500/50 focus:outline-none"
                />
                <input
                  type="url"
                  required
                  value={loginUrl}
                  onChange={(e) => setLoginUrl(e.target.value)}
                  placeholder="https://site.com/login"
                  className="w-full rounded-lg border border-white/10 bg-[#080B12] px-3 py-2 font-mono text-slate-100 focus:border-amber-500/50 focus:outline-none"
                />
                <input
                  type="text"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Usuário, CPF ou e-mail"
                  className="w-full rounded-lg border border-white/10 bg-[#080B12] px-3 py-2 text-slate-100 focus:border-amber-500/50 focus:outline-none"
                />
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Senha"
                  className="w-full rounded-lg border border-white/10 bg-[#080B12] px-3 py-2 text-slate-100 focus:border-amber-500/50 focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={savingCred}
                  className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg bg-amber-500 px-3 py-2.5 text-xs font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-50"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>{savingCred ? 'Criptografando...' : 'Salvar Credencial no Cofre'}</span>
                </button>
              </form>
            </div>

            <div className="lg:col-span-7 rounded-xl border border-white/10 bg-[#0D1119] overflow-hidden">
              <div className="border-b border-white/8 px-5 py-3.5 text-sm font-medium text-amber-50 bg-[#101520]">
                Credenciais Protegidas ({credentials.length})
              </div>
              <div className="divide-y divide-white/8">
                {credentials.length === 0 ? (
                  <div className="p-6 text-xs text-slate-500">
                    Nenhuma credencial salva ainda. Cadastre ao lado para usar em logins e rotinas repetitivas.
                  </div>
                ) : (
                  credentials.map((cred) => (
                    <div key={cred.id} className="px-5 py-3.5 flex flex-wrap items-center justify-between gap-3">
                      <div className="min-w-0 space-y-0.5">
                        <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-100">
                          <Lock className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                          <span className="truncate">{cred.site_name}</span>
                        </div>
                        <p className="text-[11px] font-mono text-slate-400 truncate">
                          {cred.username} · {cred.login_url}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleAutoLogin(cred, true)}
                          className="px-2.5 py-1.5 rounded-md border border-amber-500/35 bg-amber-500/10 text-[11px] font-medium text-amber-200 hover:bg-amber-500/20 whitespace-nowrap"
                        >
                          Logar &amp; Mapear Menus
                        </button>
                        <button
                          type="button"
                          onClick={() => handleAutoLogin(cred, false)}
                          className="px-2.5 py-1.5 rounded-md border border-sky-500/30 bg-sky-500/10 text-[11px] font-medium text-sky-300 hover:bg-sky-500/20"
                        >
                          Logar
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDeleteCredential(cred.id)}
                          className="rounded-md p-1.5 text-slate-500 hover:bg-white/6 hover:text-rose-400"
                          title="Remover"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
