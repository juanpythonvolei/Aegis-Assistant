import {
  Calendar,
  Check,
  CheckSquare,
  ChevronRight,
  Edit3,
  ExternalLink,
  File,
  FileCode2,
  FilePlus2,
  FileText,
  Film,
  Folder,
  FolderInput,
  FolderPlus,
  HardDrive,
  Image as ImageIcon,
  Laptop,
  Mail,
  MailOpen,
  Music,
  Plus,
  Presentation,
  RefreshCw,
  Reply,
  Save,
  Search,
  Send,
  Sheet,
  Table2,
  Trash2,
} from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../lib/apiClient';
import type { ConfirmationModalRequest } from '../types';
import { EmbeddedFileEditor, type EmbeddedFileKind } from './EmbeddedFileEditor';
import { GoogleSignInButton } from './GoogleSignInButton';

interface WorkspaceViewProps {
  accessToken: string | null;
  userEmail?: string;
  onLogin: () => Promise<void>;
  loggingIn: boolean;
  onRequestConfirm: (req: ConfirmationModalRequest) => void;
}

type WorkspaceAppTab = 'drive' | 'gmail' | 'calendar' | 'tasks';

interface GmailMsgSummary {
  id: string;
  threadId?: string;
  subject: string;
  from: string;
  to?: string;
  date: string;
  snippet: string;
  labels?: string[];
}

interface GmailMsgFull extends GmailMsgSummary {
  bodyText: string;
}

interface DriveItem {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
  size?: string;
  parents?: string[];
  webViewLink?: string;
  owners?: Array<{ displayName?: string; emailAddress?: string }>;
}

interface OpenedDriveFile extends DriveItem {
  kind: EmbeddedFileKind;
  editable: boolean;
  hasMediaPreview?: boolean;
  defaultExportMime?: string;
  textContent?: string;
  sheetTabs?: string[];
  activeSheet?: string;
  sheetValues?: string[][];
  dataUrl?: string;
  children?: DriveItem[];
}

interface CalendarEvent {
  id: string;
  summary?: string;
  description?: string;
  location?: string;
  htmlLink?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
}

interface TaskItem {
  id: string;
  title: string;
  notes?: string;
  due?: string;
  status?: 'needsAction' | 'completed';
}

interface BreadcrumbNode {
  id: string;
  name: string;
}

function isFolderMime(mimeType: string): boolean {
  return mimeType === 'application/vnd.google-apps.folder';
}

function formatBytes(size?: string): string {
  const n = Number(size || 0);
  if (!n) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function toLocalDateTimeInput(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (v: number) => String(v).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalDateTimeInput(val: string): string {
  if (!val) return new Date().toISOString();
  const d = new Date(val);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

function colIndexToLetter(idx: number): string {
  let n = idx + 1;
  let col = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    col = String.fromCharCode(65 + rem) + col;
    n = Math.floor((n - 1) / 26);
  }
  return col;
}

function renderDriveIcon(mimeType: string) {
  if (isFolderMime(mimeType)) return <Folder className="h-4 w-4 text-amber-400 shrink-0" />;
  if (mimeType === 'application/vnd.google-apps.document') return <FileText className="h-4 w-4 text-sky-400 shrink-0" />;
  if (mimeType === 'application/vnd.google-apps.spreadsheet') return <Table2 className="h-4 w-4 text-emerald-400 shrink-0" />;
  if (mimeType === 'application/vnd.google-apps.presentation') return <Presentation className="h-4 w-4 text-orange-400 shrink-0" />;
  if (mimeType === 'application/pdf') return <FileText className="h-4 w-4 text-rose-400 shrink-0" />;
  if (mimeType.startsWith('image/') || mimeType === 'application/vnd.google-apps.drawing') return <ImageIcon className="h-4 w-4 text-purple-400 shrink-0" />;
  if (mimeType.startsWith('audio/')) return <Music className="h-4 w-4 text-pink-400 shrink-0" />;
  if (mimeType.startsWith('video/')) return <Film className="h-4 w-4 text-indigo-400 shrink-0" />;
  if (mimeType.startsWith('text/') || mimeType === 'application/json') return <FileCode2 className="h-4 w-4 text-cyan-300 shrink-0" />;
  return <File className="h-4 w-4 text-slate-400 shrink-0" />;
}

export const WorkspaceView: React.FC<WorkspaceViewProps> = ({
  accessToken,
  userEmail,
  onLogin,
  loggingIn,
  onRequestConfirm,
}) => {
  const [appTab, setAppTab] = useState<WorkspaceAppTab>('drive');
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  // Overview lists
  const [gmail, setGmail] = useState<GmailMsgSummary[]>([]);
  const [calendar, setCalendar] = useState<CalendarEvent[]>([]);
  const [tasks, setTasks] = useState<TaskItem[]>([]);

  // Google Drive Explorer State
  const [driveBreadcrumbs, setDriveBreadcrumbs] = useState<BreadcrumbNode[]>([{ id: 'root', name: 'Meu Drive' }]);
  const [driveItems, setDriveItems] = useState<DriveItem[]>([]);
  const [driveSearch, setDriveSearch] = useState('');
  const [driveSearching, setDriveSearching] = useState(false);
  const [driveLoading, setDriveLoading] = useState(false);
  const [openedFile, setOpenedFile] = useState<OpenedDriveFile | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [mediaBlobUrl, setMediaBlobUrl] = useState<string | null>(null);
  const [mediaLoading, setMediaLoading] = useState(false);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const activeBlobUrlRef = useRef<string | null>(null);

  // Contextual Drive / Doc / Sheet Editors
  const [renameDraft, setRenameDraft] = useState('');
  const [isRenaming, setIsRenaming] = useState(false);
  const [moveTargetId, setMoveTargetId] = useState('');
  const [showMoveBox, setShowMoveBox] = useState(false);
  const [sheetDraft, setSheetDraft] = useState<string[][]>([]);
  const [newFolderName, setNewFolderName] = useState('');
  const [newDocTitle, setNewDocTitle] = useState('');
  const [newSheetTitle, setNewSheetTitle] = useState('');

  // Gmail State
  const [gmailSearch, setGmailSearch] = useState('');
  const [selectedEmail, setSelectedEmail] = useState<GmailMsgFull | null>(null);
  const [emailLoading, setEmailLoading] = useState(false);
  const [showCompose, setShowCompose] = useState(false);
  const [emailTo, setEmailTo] = useState('');
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody] = useState('');
  const [replyMode, setReplyMode] = useState(false);
  const [replyBody, setReplyBody] = useState('');

  // Calendar State
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [evSummary, setEvSummary] = useState('');
  const [evStart, setEvStart] = useState('');
  const [evEnd, setEvEnd] = useState('');
  const [evLocation, setEvLocation] = useState('');
  const [evDescription, setEvDescription] = useState('');
  const [showNewEvent, setShowNewEvent] = useState(false);
  const [newEvSummary, setNewEvSummary] = useState('');
  const [newEvStart, setNewEvStart] = useState('');
  const [newEvEnd, setNewEvEnd] = useState('');
  const [newEvLocation, setNewEvLocation] = useState('');

  // Tasks State
  const [selectedTask, setSelectedTask] = useState<TaskItem | null>(null);
  const [taskTitleDraft, setTaskTitleDraft] = useState('');
  const [taskNotesDraft, setTaskNotesDraft] = useState('');
  const [taskDueDraft, setTaskDueDraft] = useState('');
  const [taskStatusDraft, setTaskStatusDraft] = useState<'needsAction' | 'completed'>('needsAction');
  const [newTaskTitle, setNewTaskTitle] = useState('');

  const currentFolderId = driveBreadcrumbs[driveBreadcrumbs.length - 1]?.id || 'root';

  const loadDriveFolder = async (folderId: string, query = '') => {
    if (!accessToken) return;
    setDriveLoading(true);
    try {
      const qs = new URLSearchParams({ folderId });
      if (query.trim()) qs.set('q', query.trim());
      const res = await apiFetch(`/api/workspace/drive/folder?${qs.toString()}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (res.ok) {
        const data = await res.json();
        setDriveItems(data.files || []);
      }
    } finally {
      setDriveLoading(false);
    }
  };

  const loadOverview = async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const res = await apiFetch('/api/workspace/overview', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (res.ok) {
        const data = await res.json();
        setGmail(data.gmail || []);
        setCalendar(data.calendar || []);
        setTasks(data.tasks || []);
        if (!driveSearching && currentFolderId === 'root') {
          setDriveItems(data.drive || []);
        } else {
          await loadDriveFolder(currentFolderId, driveSearching ? driveSearch : '');
        }
      }
    } finally {
      setLoading(false);
    }
  };

  const revokeActiveBlob = () => {
    if (activeBlobUrlRef.current) {
      URL.revokeObjectURL(activeBlobUrlRef.current);
      activeBlobUrlRef.current = null;
    }
    setMediaBlobUrl(null);
    setMediaError(null);
  };

  useEffect(() => {
    return () => {
      if (activeBlobUrlRef.current) {
        URL.revokeObjectURL(activeBlobUrlRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (accessToken) {
      loadOverview();
    } else {
      setDriveItems([]);
      setGmail([]);
      setCalendar([]);
      setTasks([]);
      setOpenedFile(null);
      revokeActiveBlob();
    }
  }, [accessToken]);

  const syncToLocalDaemon = async () => {
    setSyncMsg(null);
    const localTok = localStorage.getItem('aegis_local_token') || '';
    try {
      if (!accessToken) {
        setSyncMsg('Conecte sua conta Google acima antes de sincronizar.');
        return;
      }
      const res = await fetch('http://127.0.0.1:3847/connections', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(localTok ? { 'X-Aegis-Local-Token': localTok } : {}),
        },
        body: JSON.stringify({
          provider: 'google',
          token: accessToken,
          email: userEmail || 'Google User',
        }),
      });
      if (!res.ok) {
        setSyncMsg(
          res.status === 401
            ? 'Abra http://127.0.0.1:3847 uma vez neste navegador para autenticar sua sessão local e tente novamente.'
            : 'Falha ao sincronizar com o daemon local.'
        );
        return;
      }
      setSyncMsg('Sessão Google sincronizada com seu Desktop Linux (:3847)!');
    } catch {
      setSyncMsg('Daemon local (:3847) não detectado nesta máquina.');
    }
  };

  const confirmWorkspaceMutation = (params: {
    title: string;
    summary: string;
    actionType: string;
    target: string;
    payload: Record<string, unknown>;
    onSuccess?: (data: unknown) => Promise<void> | void;
  }) => {
    onRequestConfirm({
      id: `ws-${Date.now()}`,
      title: params.title,
      summary: params.summary,
      actionType: params.actionType,
      target: params.target,
      details: JSON.stringify(params.payload, null, 2),
      onConfirm: async () => {
        if (!accessToken) return;
        const res = await apiFetch('/api/workspace/action', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            actionType: params.actionType,
            payload: { ...params.payload, target: params.target, summary: params.summary },
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          setStatusMsg(`Erro: ${data.message || data.error || 'Falha na operação.'}`);
          return;
        }
        setStatusMsg(data.message || 'Operação concluída.');
        await params.onSuccess?.(data);
        await loadOverview();
      },
    });
  };

  const loadDriveMedia = async (fileId: string, exportMime?: string) => {
    if (!accessToken) return;
    setMediaLoading(true);
    setMediaError(null);
    try {
      const qs = exportMime ? `?exportMime=${encodeURIComponent(exportMime)}` : '';
      const res = await apiFetch(`/api/workspace/drive/media/${encodeURIComponent(fileId)}${qs}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        setMediaError(errData.error || `Falha ao carregar mídia (${res.status}).`);
        return;
      }
      const blob = await res.blob();
      if (activeBlobUrlRef.current) {
        URL.revokeObjectURL(activeBlobUrlRef.current);
      }
      const objUrl = URL.createObjectURL(blob);
      activeBlobUrlRef.current = objUrl;
      setMediaBlobUrl(objUrl);
    } catch (err: unknown) {
      setMediaError(err instanceof Error ? err.message : 'Erro ao carregar visualização.');
    } finally {
      setMediaLoading(false);
    }
  };

  const openDriveItem = async (item: DriveItem, sheetTab?: string) => {
    if (!accessToken) return;
    if (isFolderMime(item.mimeType)) {
      setDriveSearching(false);
      setDriveSearch('');
      setDriveBreadcrumbs((prev) => {
        const idx = prev.findIndex((b) => b.id === item.id);
        if (idx >= 0) return prev.slice(0, idx + 1);
        return [...prev, { id: item.id, name: item.name }];
      });
      await loadDriveFolder(item.id, '');
      return;
    }

    setFileLoading(true);
    setIsRenaming(false);
    setShowMoveBox(false);
    revokeActiveBlob();
    try {
      const qs = sheetTab ? `?sheet=${encodeURIComponent(sheetTab)}` : '';
      const res = await apiFetch(`/api/workspace/drive/file/${encodeURIComponent(item.id)}${qs}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = await res.json();
      if (!res.ok) {
        setStatusMsg(`Erro ao abrir "${item.name}": ${data.error || 'Falha'}`);
        return;
      }
      const f = data.file as OpenedDriveFile;
      setOpenedFile(f);
      setRenameDraft(f.name);
      if (f.kind === 'sheet') {
        const rawRows = f.sheetValues || [];
        const minRows = Math.max(rawRows.length, 6);
        const minCols = Math.max(
          rawRows.reduce((m, r) => Math.max(m, r.length), 0),
          5
        );
        const normalized = Array.from({ length: minRows }, (_, rIdx) =>
          Array.from({ length: minCols }, (_, cIdx) => rawRows[rIdx]?.[cIdx] ?? '')
        );
        setSheetDraft(normalized);
      }
      if (f.kind === 'pdf' || f.kind === 'image' || f.kind === 'audio' || f.kind === 'video' || f.kind === 'slides') {
        void loadDriveMedia(f.id, f.defaultExportMime);
      }
    } finally {
      setFileLoading(false);
    }
  };

  const navigateBreadcrumb = async (idx: number) => {
    const next = driveBreadcrumbs.slice(0, idx + 1);
    setDriveBreadcrumbs(next);
    setDriveSearching(false);
    setDriveSearch('');
    await loadDriveFolder(next[next.length - 1].id, '');
  };

  const openEmailItem = async (msg: GmailMsgSummary) => {
    if (!accessToken) return;
    setEmailLoading(true);
    setReplyMode(false);
    setReplyBody('');
    setShowCompose(false);
    try {
      const res = await apiFetch(`/api/workspace/gmail/message/${encodeURIComponent(msg.id)}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = await res.json();
      if (res.ok && data.message) {
        setSelectedEmail(data.message as GmailMsgFull);
      } else {
        setStatusMsg(data.error || 'Erro ao carregar e-mail completo.');
      }
    } finally {
      setEmailLoading(false);
    }
  };

  const selectCalendarEvent = (ev: CalendarEvent) => {
    setSelectedEvent(ev);
    setShowNewEvent(false);
    setEvSummary(ev.summary || '');
    setEvStart(toLocalDateTimeInput(ev.start?.dateTime || ev.start?.date));
    setEvEnd(toLocalDateTimeInput(ev.end?.dateTime || ev.end?.date));
    setEvLocation(ev.location || '');
    setEvDescription(ev.description || '');
  };

  const selectTaskItem = (t: TaskItem) => {
    setSelectedTask(t);
    setTaskTitleDraft(t.title || '');
    setTaskNotesDraft(t.notes || '');
    setTaskDueDraft(t.due ? t.due.slice(0, 10) : '');
    setTaskStatusDraft(t.status === 'completed' ? 'completed' : 'needsAction');
  };

  const visibleFolders = driveItems.filter((i) => isFolderMime(i.mimeType));

  const filteredGmail = gmailSearch.trim()
    ? gmail.filter(
        (m) =>
          m.subject.toLowerCase().includes(gmailSearch.toLowerCase()) ||
          m.from.toLowerCase().includes(gmailSearch.toLowerCase())
      )
    : gmail;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-amber-500/14 bg-[#0D1017]/90 px-6 py-3.5 shrink-0">
        <div className="space-y-0.5">
          <h2 className="text-base font-semibold text-amber-50">Google Workspace</h2>
          <p className="text-xs text-slate-400">
            Explorador direto do Google Drive, visualização e edição embutida por item.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {accessToken && (
            <div className="flex items-center gap-1 rounded-xl bg-[#141822] p-1 border border-amber-500/18">
              {[
                { id: 'drive' as const, label: 'Drive', icon: HardDrive },
                { id: 'gmail' as const, label: 'Gmail', icon: Mail },
                { id: 'calendar' as const, label: 'Agenda', icon: Calendar },
                { id: 'tasks' as const, label: 'Tarefas', icon: CheckSquare },
              ].map((t) => {
                const Icon = t.icon;
                const active = appTab === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setAppTab(t.id)}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${
                      active
                        ? 'bg-amber-500 text-slate-950 font-semibold shadow-sm shadow-amber-500/30'
                        : 'text-slate-400 hover:text-amber-100'
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    <span>{t.label}</span>
                  </button>
                );
              })}
            </div>
          )}

          <button
            type="button"
            onClick={syncToLocalDaemon}
            className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/12 px-3 py-1.5 text-xs font-medium text-amber-200 hover:bg-amber-500/20 transition-colors whitespace-nowrap shrink-0"
          >
            <Laptop className="h-3.5 w-3.5" />
            <span>Sincronizar Desktop (:3847)</span>
          </button>

          <button
            type="button"
            onClick={loadOverview}
            disabled={loading || !accessToken}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-[#161922] px-3 py-1.5 text-xs font-medium text-slate-200 hover:border-amber-500/35 disabled:opacity-40 transition-colors whitespace-nowrap shrink-0"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Atualizar</span>
          </button>
        </div>
      </div>

      {/* Banners */}
      {(syncMsg || statusMsg) && (
        <div className="border-b border-white/8 bg-[#0A0E15] px-6 py-2 space-y-1.5 shrink-0">
          {syncMsg && (
            <div className="rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-xs text-sky-200 flex items-center justify-between">
              <span>{syncMsg}</span>
              <button type="button" onClick={() => setSyncMsg(null)} className="text-sky-300 hover:underline">
                Fechar
              </button>
            </div>
          )}
          {statusMsg && (
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200 flex items-center justify-between">
              <span>{statusMsg}</span>
              <button type="button" onClick={() => setStatusMsg(null)} className="text-emerald-300 hover:underline">
                Fechar
              </button>
            </div>
          )}
        </div>
      )}

      {!accessToken ? (
        <div className="flex-1 overflow-y-auto p-6 bg-[#07090F]">
          <div className="max-w-md spatial-card rounded-2xl p-6 space-y-4">
            <div className="space-y-1.5">
              <h3 className="text-base font-semibold text-amber-50">Conectar Google Workspace</h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Conecte sua conta Google para navegar nas pastas do Drive, abrir Docs, Planilhas e arquivos diretamente
                no Aegis e editar e-mails, eventos e tarefas com confirmação explícita.
              </p>
            </div>
            <GoogleSignInButton onClick={onLogin} disabled={loggingIn} />
          </div>
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-hidden bg-[#07090F]">
          {/* ==========================================
              APP TAB 1: GOOGLE DRIVE EXPLORER & EDITOR
             ========================================== */}
          {appTab === 'drive' && (
            <div className="grid h-full grid-cols-1 lg:grid-cols-12 gap-4 p-4">
              {/* Left Pane: Folder Structure & Search */}
              <div className="lg:col-span-5 spatial-card rounded-2xl flex flex-col min-h-0 overflow-hidden">
                {/* Search + Breadcrumbs */}
                <div className="p-3.5 border-b border-white/8 space-y-2.5">
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      setDriveSearching(Boolean(driveSearch.trim()));
                      loadDriveFolder(currentFolderId, driveSearch);
                    }}
                    className="flex gap-2"
                  >
                    <div className="relative flex-1">
                      <Search className="h-3.5 w-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        value={driveSearch}
                        onChange={(e) => setDriveSearch(e.target.value)}
                        placeholder="Buscar arquivos ou pastas no Drive..."
                        className="w-full rounded-lg border border-white/10 bg-[#070B12] pl-8 pr-3 py-1.5 text-xs text-slate-100 focus:border-sky-500 focus:outline-none"
                      />
                    </div>
                    <button
                      type="submit"
                      className="rounded-lg bg-sky-500 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-sky-400"
                    >
                      Buscar
                    </button>
                    {driveSearching && (
                      <button
                        type="button"
                        onClick={() => {
                          setDriveSearch('');
                          setDriveSearching(false);
                          loadDriveFolder(currentFolderId, '');
                        }}
                        className="rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-white/5"
                      >
                        Limpar
                      </button>
                    )}
                  </form>

                  {/* Breadcrumbs */}
                  <div className="flex flex-wrap items-center gap-1 text-xs">
                    {driveBreadcrumbs.map((b, idx) => (
                      <React.Fragment key={b.id}>
                        {idx > 0 && <ChevronRight className="h-3.5 w-3.5 text-slate-600" />}
                        <button
                          type="button"
                          onClick={() => navigateBreadcrumb(idx)}
                          className={`px-1.5 py-0.5 rounded hover:bg-white/6 truncate max-w-[140px] ${
                            idx === driveBreadcrumbs.length - 1
                              ? 'text-sky-300 font-medium'
                              : 'text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          {b.name}
                        </button>
                      </React.Fragment>
                    ))}
                  </div>
                </div>

                {/* Quick Create inside current Drive context */}
                <div className="px-3.5 py-2.5 border-b border-white/8 bg-[#0D121B] flex flex-wrap gap-2">
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (!newFolderName.trim()) return;
                      confirmWorkspaceMutation({
                        title: 'Criar Pasta no Google Drive',
                        summary: `Criar pasta "${newFolderName.trim()}" dentro de "${driveBreadcrumbs[driveBreadcrumbs.length - 1]?.name}"?`,
                        actionType: 'drive_create_folder',
                        target: newFolderName.trim(),
                        payload: { name: newFolderName.trim(), parentId: currentFolderId },
                        onSuccess: () => setNewFolderName(''),
                      });
                    }}
                    className="flex items-center gap-1 flex-1 min-w-[160px]"
                  >
                    <input
                      type="text"
                      value={newFolderName}
                      onChange={(e) => setNewFolderName(e.target.value)}
                      placeholder="Nova pasta..."
                      className="flex-1 min-w-0 rounded border border-white/10 bg-[#070B12] px-2 py-1 text-[11px] text-slate-100 focus:outline-none"
                    />
                    <button
                      type="submit"
                      title="Criar pasta nesta pasta"
                      className="inline-flex items-center gap-1 rounded border border-white/10 bg-[#151D2B] px-2 py-1 text-[11px] text-slate-200 hover:border-sky-500/40"
                    >
                      <FolderPlus className="h-3 w-3 text-amber-400" />
                      <span>Pasta</span>
                    </button>
                  </form>

                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (!newDocTitle.trim()) return;
                      confirmWorkspaceMutation({
                        title: 'Criar Google Doc',
                        summary: `Criar documento "${newDocTitle.trim()}" no Google Docs?`,
                        actionType: 'docs_create_document',
                        target: newDocTitle.trim(),
                        payload: { title: newDocTitle.trim() },
                        onSuccess: () => setNewDocTitle(''),
                      });
                    }}
                    className="flex items-center gap-1"
                  >
                    <input
                      type="text"
                      value={newDocTitle}
                      onChange={(e) => setNewDocTitle(e.target.value)}
                      placeholder="Novo Doc..."
                      className="w-24 rounded border border-white/10 bg-[#070B12] px-2 py-1 text-[11px] text-slate-100 focus:outline-none"
                    />
                    <button
                      type="submit"
                      className="inline-flex items-center gap-1 rounded border border-white/10 bg-[#151D2B] px-2 py-1 text-[11px] text-slate-200 hover:border-sky-500/40"
                    >
                      <FilePlus2 className="h-3 w-3 text-sky-400" />
                    </button>
                  </form>

                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (!newSheetTitle.trim()) return;
                      confirmWorkspaceMutation({
                        title: 'Criar Planilha Sheets',
                        summary: `Criar planilha "${newSheetTitle.trim()}" no Google Sheets?`,
                        actionType: 'sheets_create_spreadsheet',
                        target: newSheetTitle.trim(),
                        payload: { title: newSheetTitle.trim() },
                        onSuccess: () => setNewSheetTitle(''),
                      });
                    }}
                    className="flex items-center gap-1"
                  >
                    <input
                      type="text"
                      value={newSheetTitle}
                      onChange={(e) => setNewSheetTitle(e.target.value)}
                      placeholder="Planilha..."
                      className="w-24 rounded border border-white/10 bg-[#070B12] px-2 py-1 text-[11px] text-slate-100 focus:outline-none"
                    />
                    <button
                      type="submit"
                      className="inline-flex items-center gap-1 rounded border border-white/10 bg-[#151D2B] px-2 py-1 text-[11px] text-slate-200 hover:border-emerald-500/40"
                    >
                      <Sheet className="h-3 w-3 text-emerald-400" />
                    </button>
                  </form>
                </div>

                {/* Directory Listing */}
                <div className="flex-1 overflow-y-auto divide-y divide-white/6">
                  {driveLoading ? (
                    <div className="p-5 text-xs font-mono text-slate-400">Carregando estrutura do Drive...</div>
                  ) : driveItems.length === 0 ? (
                    <div className="p-6 text-xs text-slate-500">Pasta vazia ou nenhum arquivo encontrado.</div>
                  ) : (
                    driveItems.map((item) => {
                      const isDir = isFolderMime(item.mimeType);
                      const isSelected = openedFile?.id === item.id;
                      return (
                        <div
                          key={item.id}
                          onClick={() => openDriveItem(item)}
                          className={`px-4 py-2.5 flex items-center justify-between gap-3 cursor-pointer transition-colors ${
                            isSelected ? 'bg-sky-500/12 border-l-2 border-l-sky-400' : 'hover:bg-white/[0.03]'
                          }`}
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            {renderDriveIcon(item.mimeType)}
                            <div className="min-w-0">
                              <p className="text-xs font-medium text-slate-100 truncate">{item.name}</p>
                              <p className="text-[11px] font-mono text-slate-500 truncate">
                                {isDir ? 'Pasta' : formatBytes(item.size) || item.mimeType.split('.').pop()}
                                {item.modifiedTime
                                  ? ` · ${new Date(item.modifiedTime).toLocaleDateString('pt-BR')}`
                                  : ''}
                              </p>
                            </div>
                          </div>
                          <span className="text-[11px] font-mono text-slate-500 shrink-0">
                            {isDir ? 'Abrir →' : 'Visualizar'}
                          </span>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Right Pane: In-App File Viewer & Contextual Editor */}
              <div className="lg:col-span-7 spatial-card rounded-2xl flex flex-col min-h-0 overflow-hidden">
                {fileLoading ? (
                  <div className="flex-1 flex items-center justify-center text-xs font-mono text-slate-400">
                    Abrindo arquivo do Google Drive...
                  </div>
                ) : !openedFile ? (
                  <div className="flex-1 flex flex-col items-center justify-center p-8 text-center space-y-2">
                    <HardDrive className="h-8 w-8 text-slate-600" />
                    <p className="text-sm font-medium text-slate-300">Selecione uma pasta ou arquivo do Google Drive</p>
                    <p className="text-xs text-slate-500 max-w-md">
                      Navegue pela estrutura de pastas à esquerda e clique em qualquer Google Doc, Planilha, Slides,
                      arquivo de texto/código ou imagem para abrir e editar diretamente aqui.
                    </p>
                  </div>
                ) : (
                  <>
                    {/* Contextual File Toolbar */}
                    <div className="border-b border-white/8 bg-[#0D121B] px-5 py-3 space-y-2.5 shrink-0">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex items-center gap-2.5 min-w-0">
                          {renderDriveIcon(openedFile.mimeType)}
                          {isRenaming ? (
                            <form
                              onSubmit={(e) => {
                                e.preventDefault();
                                if (!renameDraft.trim()) return;
                                confirmWorkspaceMutation({
                                  title: 'Renomear Item no Drive',
                                  summary: `Renomear "${openedFile.name}" para "${renameDraft.trim()}"?`,
                                  actionType: 'drive_rename_file',
                                  target: renameDraft.trim(),
                                  payload: { fileId: openedFile.id, newName: renameDraft.trim() },
                                  onSuccess: async () => {
                                    setIsRenaming(false);
                                    await openDriveItem({ ...openedFile, name: renameDraft.trim() });
                                  },
                                });
                              }}
                              className="flex items-center gap-1.5"
                            >
                              <input
                                type="text"
                                value={renameDraft}
                                onChange={(e) => setRenameDraft(e.target.value)}
                                className="rounded border border-sky-500/40 bg-[#070B12] px-2.5 py-1 text-xs text-slate-100 focus:outline-none"
                              />
                              <button type="submit" className="px-2.5 py-1 rounded bg-sky-500 text-xs font-semibold text-slate-950">
                                OK
                              </button>
                              <button
                                type="button"
                                onClick={() => setIsRenaming(false)}
                                className="px-2 py-1 rounded border border-white/10 text-xs text-slate-400"
                              >
                                Cancelar
                              </button>
                            </form>
                          ) : (
                            <h3 className="text-sm font-semibold text-slate-100 truncate">{openedFile.name}</h3>
                          )}
                        </div>

                        <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => {
                              setRenameDraft(openedFile.name);
                              setIsRenaming((v) => !v);
                            }}
                            className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-[#151D2B] px-2.5 py-1 text-[11px] text-slate-300 hover:border-white/25"
                          >
                            <Edit3 className="h-3 w-3" />
                            <span>Renomear</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => setShowMoveBox((v) => !v)}
                            className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-[#151D2B] px-2.5 py-1 text-[11px] text-slate-300 hover:border-white/25"
                          >
                            <FolderInput className="h-3 w-3" />
                            <span>Mover</span>
                          </button>

                          <button
                            type="button"
                            onClick={() =>
                              confirmWorkspaceMutation({
                                title: 'Mover Arquivo para Lixeira',
                                summary: `Mover "${openedFile.name}" para a lixeira do Google Drive?`,
                                actionType: 'drive_delete_file',
                                target: openedFile.name,
                                payload: { fileId: openedFile.id, fileName: openedFile.name },
                                onSuccess: () => setOpenedFile(null),
                              })
                            }
                            className="inline-flex items-center gap-1 rounded-md border border-rose-500/25 bg-rose-500/10 px-2.5 py-1 text-[11px] text-rose-300 hover:bg-rose-500/20"
                          >
                            <Trash2 className="h-3 w-3" />
                            <span>Excluir</span>
                          </button>

                          {openedFile.webViewLink && (
                            <a
                              href={openedFile.webViewLink}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 rounded-md border border-sky-500/30 bg-sky-500/10 px-2.5 py-1 text-[11px] text-sky-300 hover:bg-sky-500/20"
                            >
                              <ExternalLink className="h-3 w-3" />
                              <span>Google Drive</span>
                            </a>
                          )}
                        </div>
                      </div>

                      {showMoveBox && (
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            if (!moveTargetId.trim()) return;
                            confirmWorkspaceMutation({
                              title: 'Mover Arquivo no Drive',
                              summary: `Mover "${openedFile.name}" para a pasta destino ${moveTargetId.trim()}?`,
                              actionType: 'drive_move_file',
                              target: openedFile.name,
                              payload: {
                                fileId: openedFile.id,
                                fileName: openedFile.name,
                                targetFolderId: moveTargetId.trim(),
                              },
                              onSuccess: () => setShowMoveBox(false),
                            });
                          }}
                          className="flex flex-wrap items-center gap-2 pt-1"
                        >
                          <select
                            value={moveTargetId}
                            onChange={(e) => setMoveTargetId(e.target.value)}
                            className="rounded border border-white/10 bg-[#070B12] px-2.5 py-1 text-xs text-slate-100"
                          >
                            <option value="">Selecionar pasta nesta exibição...</option>
                            <option value="root">Meu Drive (Raiz)</option>
                            {visibleFolders.map((f) => (
                              <option key={f.id} value={f.id}>
                                {f.name}
                              </option>
                            ))}
                          </select>
                          <input
                            type="text"
                            value={moveTargetId}
                            onChange={(e) => setMoveTargetId(e.target.value)}
                            placeholder="Ou informe o ID da pasta..."
                            className="flex-1 min-w-[160px] rounded border border-white/10 bg-[#070B12] px-2.5 py-1 text-xs text-slate-100"
                          />
                          <button type="submit" className="px-3 py-1 rounded bg-sky-500 text-xs font-semibold text-slate-950">
                            Mover
                          </button>
                        </form>
                      )}
                    </div>

                    {/* Contextual File Body Viewer & Editor */}
                    <div className="flex-1 min-h-0 flex flex-col overflow-hidden p-4">
                      {openedFile.kind === 'sheet' ? (
                        <div className="flex-1 flex flex-col gap-3 min-h-0">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex flex-wrap items-center gap-1">
                              {(openedFile.sheetTabs || []).map((tab) => (
                                <button
                                  key={tab}
                                  type="button"
                                  onClick={() => openDriveItem(openedFile, tab)}
                                  className={`px-2.5 py-1 rounded text-xs font-medium ${
                                    tab === openedFile.activeSheet
                                      ? 'bg-emerald-500 text-slate-950 font-semibold'
                                      : 'bg-[#131923] text-slate-300 hover:bg-white/10'
                                  }`}
                                >
                                  {tab}
                                </button>
                              ))}
                            </div>

                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() =>
                                  setSheetDraft((prev) => [
                                    ...prev,
                                    Array.from({ length: prev[0]?.length || 5 }, () => ''),
                                  ])
                                }
                                className="inline-flex items-center gap-1 rounded border border-white/10 bg-[#151D2B] px-2.5 py-1 text-xs text-slate-200"
                              >
                                <Plus className="h-3 w-3" />
                                <span>Linha</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => setSheetDraft((prev) => prev.map((r) => [...r, '']))}
                                className="inline-flex items-center gap-1 rounded border border-white/10 bg-[#151D2B] px-2.5 py-1 text-xs text-slate-200"
                              >
                                <Plus className="h-3 w-3" />
                                <span>Coluna</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  const activeTab = openedFile.activeSheet || 'Sheet1';
                                  const lastCol = colIndexToLetter(Math.max((sheetDraft[0]?.length || 1) - 1, 0));
                                  const range = `'${activeTab.replace(/'/g, "''")}'!A1:${lastCol}${sheetDraft.length}`;
                                  confirmWorkspaceMutation({
                                    title: 'Salvar Planilha Google Sheets',
                                    summary: `Atualizar células (${range}) na planilha "${openedFile.name}"?`,
                                    actionType: 'sheets_update_values',
                                    target: openedFile.name,
                                    payload: {
                                      spreadsheetId: openedFile.id,
                                      range,
                                      values: sheetDraft,
                                    },
                                  });
                                }}
                                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-emerald-400"
                              >
                                <Save className="h-3.5 w-3.5" />
                                <span>Salvar Planilha</span>
                              </button>
                            </div>
                          </div>

                          <div className="flex-1 overflow-auto rounded-xl border border-white/10 bg-[#0B1018]">
                            <table className="w-full border-collapse text-xs">
                              <thead>
                                <tr className="bg-[#111722] text-slate-400 font-mono">
                                  <th className="w-10 border-b border-r border-white/8 px-2 py-1.5 text-center">#</th>
                                  {(sheetDraft[0] || []).map((_, cIdx) => (
                                    <th key={cIdx} className="min-w-[120px] border-b border-r border-white/8 px-2 py-1.5 text-left">
                                      {colIndexToLetter(cIdx)}
                                    </th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {sheetDraft.map((row, rIdx) => (
                                  <tr key={rIdx} className="hover:bg-white/[0.02]">
                                    <td className="border-b border-r border-white/8 bg-[#111722]/60 px-2 py-1 text-center font-mono text-[11px] text-slate-500">
                                      {rIdx + 1}
                                    </td>
                                    {row.map((cell, cIdx) => (
                                      <td key={cIdx} className="border-b border-r border-white/8 p-0">
                                        <input
                                          type="text"
                                          value={cell}
                                          onChange={(e) => {
                                            const val = e.target.value;
                                            setSheetDraft((prev) =>
                                              prev.map((r, ri) =>
                                                ri === rIdx ? r.map((c, ci) => (ci === cIdx ? val : c)) : r
                                              )
                                            );
                                          }}
                                          className="w-full bg-transparent px-2.5 py-1.5 text-xs text-slate-100 focus:bg-sky-500/10 focus:outline-none"
                                        />
                                      </td>
                                    ))}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      ) : (
                        <EmbeddedFileEditor
                          name={openedFile.name}
                          mimeType={openedFile.mimeType}
                          kind={openedFile.kind}
                          editable={openedFile.editable}
                          initialContent={openedFile.textContent || ''}
                          sizeLabel={formatBytes(openedFile.size)}
                          modifiedLabel={
                            openedFile.modifiedTime
                              ? new Date(openedFile.modifiedTime).toLocaleString('pt-BR')
                              : undefined
                          }
                          mediaUrl={mediaBlobUrl}
                          mediaLoading={mediaLoading}
                          mediaError={mediaError}
                          hasMediaPreview={openedFile.hasMediaPreview}
                          externalUrl={openedFile.webViewLink}
                          onRequestMediaPreview={() =>
                            void loadDriveMedia(openedFile.id, openedFile.defaultExportMime)
                          }
                          onSave={(newContent) => {
                            if (openedFile.kind === 'doc') {
                              confirmWorkspaceMutation({
                                title: 'Salvar Alterações no Google Doc',
                                summary: `Atualizar o conteúdo do documento "${openedFile.name}" no Google Docs?`,
                                actionType: 'docs_replace_content',
                                target: openedFile.name,
                                payload: { documentId: openedFile.id, newText: newContent },
                                onSuccess: () =>
                                  setOpenedFile((prev) =>
                                    prev ? { ...prev, textContent: newContent } : prev
                                  ),
                              });
                            } else {
                              confirmWorkspaceMutation({
                                title: 'Salvar Arquivo no Google Drive',
                                summary: `Sobrescrever o conteúdo de "${openedFile.name}" no Google Drive?`,
                                actionType: 'drive_update_text_file',
                                target: openedFile.name,
                                payload: {
                                  fileId: openedFile.id,
                                  content: newContent,
                                  mimeType: openedFile.mimeType || 'text/plain',
                                },
                                onSuccess: () =>
                                  setOpenedFile((prev) =>
                                    prev ? { ...prev, textContent: newContent } : prev
                                  ),
                              });
                            }
                          }}
                        />
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {/* ==========================================
              APP TAB 2: GMAIL FULL READER & CONTEXTUAL REPLY
             ========================================== */}
          {appTab === 'gmail' && (
            <div className="grid h-full grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-white/8">
              <div className="lg:col-span-5 flex flex-col min-h-0 bg-[#0A0E16]">
                <div className="p-3.5 border-b border-white/8 flex items-center gap-2">
                  <div className="relative flex-1">
                    <Search className="h-3.5 w-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={gmailSearch}
                      onChange={(e) => setGmailSearch(e.target.value)}
                      placeholder="Filtrar mensagens..."
                      className="w-full rounded-lg border border-white/10 bg-[#070B12] pl-8 pr-3 py-1.5 text-xs text-slate-100 focus:outline-none"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setShowCompose(true);
                      setSelectedEmail(null);
                    }}
                    className="inline-flex items-center gap-1 rounded-lg bg-sky-500 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-sky-400 shrink-0"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>Novo</span>
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto divide-y divide-white/6">
                  {filteredGmail.length === 0 ? (
                    <div className="p-5 text-xs text-slate-500">Nenhuma mensagem encontrada.</div>
                  ) : (
                    filteredGmail.map((m) => {
                      const isUnread = m.labels?.includes('UNREAD');
                      const isSel = selectedEmail?.id === m.id && !showCompose;
                      return (
                        <div
                          key={m.id}
                          onClick={() => openEmailItem(m)}
                          className={`px-4 py-3 cursor-pointer space-y-0.5 transition-colors ${
                            isSel ? 'bg-sky-500/12 border-l-2 border-l-sky-400' : 'hover:bg-white/[0.03]'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <p className={`text-xs truncate ${isUnread ? 'font-bold text-white' : 'font-medium text-slate-200'}`}>
                              {m.subject}
                            </p>
                            {isUnread && <span className="text-[10px] font-mono text-sky-400 shrink-0">NOVA</span>}
                          </div>
                          <p className="text-[11px] text-slate-400 truncate">{m.from}</p>
                          <p className="text-[11px] text-slate-500 line-clamp-1">{m.snippet}</p>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              <div className="lg:col-span-7 flex flex-col min-h-0 bg-[#070B12] p-6 overflow-y-auto">
                {showCompose ? (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (!emailTo.trim() || !emailSubject.trim()) return;
                      confirmWorkspaceMutation({
                        title: 'Enviar E-mail via Gmail',
                        summary: `Enviar e-mail para ${emailTo.trim()} com assunto "${emailSubject.trim()}"?`,
                        actionType: 'gmail_send_email',
                        target: emailTo.trim(),
                        payload: { to: emailTo.trim(), subject: emailSubject.trim(), body: emailBody },
                        onSuccess: () => {
                          setEmailTo('');
                          setEmailSubject('');
                          setEmailBody('');
                          setShowCompose(false);
                        },
                      });
                    }}
                    className="max-w-2xl space-y-4"
                  >
                    <h3 className="text-sm font-semibold text-slate-100">Nova Mensagem Gmail</h3>
                    <input
                      type="email"
                      required
                      value={emailTo}
                      onChange={(e) => setEmailTo(e.target.value)}
                      placeholder="Destinatário (ex: nome@empresa.com)"
                      className="w-full rounded-lg border border-white/10 bg-[#0D121B] px-3 py-2 text-xs text-slate-100 focus:outline-none"
                    />
                    <input
                      type="text"
                      required
                      value={emailSubject}
                      onChange={(e) => setEmailSubject(e.target.value)}
                      placeholder="Assunto"
                      className="w-full rounded-lg border border-white/10 bg-[#0D121B] px-3 py-2 text-xs text-slate-100 focus:outline-none"
                    />
                    <textarea
                      rows={10}
                      value={emailBody}
                      onChange={(e) => setEmailBody(e.target.value)}
                      placeholder="Escreva sua mensagem..."
                      className="w-full rounded-lg border border-white/10 bg-[#0D121B] p-3 text-xs text-slate-100 focus:outline-none"
                    />
                    <div className="flex gap-2">
                      <button
                        type="submit"
                        className="inline-flex items-center gap-1.5 rounded-lg bg-sky-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-sky-400"
                      >
                        <Send className="h-3.5 w-3.5" />
                        <span>Enviar E-mail</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowCompose(false)}
                        className="rounded-lg border border-white/10 px-4 py-2 text-xs text-slate-300"
                      >
                        Cancelar
                      </button>
                    </div>
                  </form>
                ) : emailLoading ? (
                  <div className="text-xs font-mono text-slate-400">Carregando mensagem...</div>
                ) : !selectedEmail ? (
                  <div className="flex-1 flex flex-col items-center justify-center text-center space-y-2">
                    <MailOpen className="h-8 w-8 text-slate-600" />
                    <p className="text-xs text-slate-400">Selecione um e-mail ao lado para abrir o conteúdo completo ou responder.</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-white/8 pb-4">
                      <div className="space-y-1 min-w-0">
                        <h3 className="text-base font-semibold text-slate-100">{selectedEmail.subject}</h3>
                        <p className="text-xs text-slate-400">De: {selectedEmail.from}</p>
                        {selectedEmail.date && (
                          <p className="text-[11px] font-mono text-slate-500">{selectedEmail.date}</p>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => setReplyMode((v) => !v)}
                          className="inline-flex items-center gap-1 rounded-md bg-sky-500 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-sky-400"
                        >
                          <Reply className="h-3.5 w-3.5" />
                          <span>Responder</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const isUnread = selectedEmail.labels?.includes('UNREAD');
                            confirmWorkspaceMutation({
                              title: isUnread ? 'Marcar como Lida' : 'Marcar como Não Lida',
                              summary: `${isUnread ? 'Marcar como lida' : 'Marcar como não lida'} a mensagem "${selectedEmail.subject}"?`,
                              actionType: 'gmail_modify_labels',
                              target: selectedEmail.subject,
                              payload: {
                                messageId: selectedEmail.id,
                                addLabelIds: isUnread ? [] : ['UNREAD'],
                                removeLabelIds: isUnread ? ['UNREAD'] : [],
                              },
                            });
                          }}
                          className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-[#151D2B] px-2.5 py-1.5 text-xs text-slate-200"
                        >
                          <Check className="h-3.5 w-3.5" />
                          <span>{selectedEmail.labels?.includes('UNREAD') ? 'Marcar Lida' : 'Marcar Não Lida'}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            confirmWorkspaceMutation({
                              title: 'Mover E-mail para Lixeira',
                              summary: `Mover "${selectedEmail.subject}" para a lixeira?`,
                              actionType: 'gmail_trash_message',
                              target: selectedEmail.subject,
                              payload: { messageId: selectedEmail.id },
                              onSuccess: () => setSelectedEmail(null),
                            })
                          }
                          className="inline-flex items-center gap-1 rounded-md border border-rose-500/25 bg-rose-500/10 px-2.5 py-1.5 text-xs text-rose-300"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          <span>Excluir</span>
                        </button>
                      </div>
                    </div>

                    {replyMode && (
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          if (!replyBody.trim()) return;
                          const match = selectedEmail.from.match(/<([^>]+)>/);
                          const toAddr = match ? match[1] : selectedEmail.from;
                          const subj = selectedEmail.subject.startsWith('Re:')
                            ? selectedEmail.subject
                            : `Re: ${selectedEmail.subject}`;
                          confirmWorkspaceMutation({
                            title: 'Enviar Resposta no Gmail',
                            summary: `Responder para ${toAddr} ("${subj}")?`,
                            actionType: 'gmail_send_email',
                            target: toAddr,
                            payload: {
                              to: toAddr,
                              subject: subj,
                              body: replyBody,
                              threadId: selectedEmail.threadId,
                            },
                            onSuccess: () => {
                              setReplyMode(false);
                              setReplyBody('');
                            },
                          });
                        }}
                        className="rounded-xl border border-sky-500/25 bg-[#0D131D] p-4 space-y-3"
                      >
                        <p className="text-xs text-sky-300 font-medium">Respondendo para {selectedEmail.from}</p>
                        <textarea
                          rows={5}
                          value={replyBody}
                          onChange={(e) => setReplyBody(e.target.value)}
                          placeholder="Escreva sua resposta..."
                          className="w-full rounded-lg border border-white/10 bg-[#070B12] p-3 text-xs text-slate-100 focus:outline-none"
                        />
                        <div className="flex gap-2">
                          <button type="submit" className="px-3.5 py-1.5 rounded-lg bg-sky-500 text-xs font-semibold text-slate-950">
                            Enviar Resposta
                          </button>
                          <button
                            type="button"
                            onClick={() => setReplyMode(false)}
                            className="px-3 py-1.5 rounded-lg border border-white/10 text-xs text-slate-300"
                          >
                            Cancelar
                          </button>
                        </div>
                      </form>
                    )}

                    <div className="rounded-xl border border-white/8 bg-[#0B1018] p-5">
                      <pre className="whitespace-pre-wrap font-sans text-xs leading-relaxed text-slate-200">
                        {selectedEmail.bodyText || selectedEmail.snippet}
                      </pre>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ==========================================
              APP TAB 3: CALENDAR CONTEXTUAL INSPECTOR & EDITOR
             ========================================== */}
          {appTab === 'calendar' && (
            <div className="grid h-full grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-white/8">
              <div className="lg:col-span-5 flex flex-col min-h-0 bg-[#0A0E16]">
                <div className="p-3.5 border-b border-white/8 flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-200">Próximos Eventos ({calendar.length})</span>
                  <button
                    type="button"
                    onClick={() => {
                      setShowNewEvent(true);
                      setSelectedEvent(null);
                    }}
                    className="inline-flex items-center gap-1 rounded-lg bg-sky-500 px-3 py-1.5 text-xs font-semibold text-slate-950"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>Novo Evento</span>
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto divide-y divide-white/6">
                  {calendar.length === 0 ? (
                    <div className="p-5 text-xs text-slate-500">Nenhum evento agendado.</div>
                  ) : (
                    calendar.map((ev) => (
                      <div
                        key={ev.id}
                        onClick={() => selectCalendarEvent(ev)}
                        className={`px-4 py-3 cursor-pointer space-y-0.5 transition-colors ${
                          selectedEvent?.id === ev.id && !showNewEvent
                            ? 'bg-sky-500/12 border-l-2 border-l-sky-400'
                            : 'hover:bg-white/[0.03]'
                        }`}
                      >
                        <p className="text-xs font-medium text-slate-100 truncate">{ev.summary || '(Sem título)'}</p>
                        <p className="text-[11px] font-mono text-slate-400 tabular-nums">
                          {ev.start?.dateTime
                            ? new Date(ev.start.dateTime).toLocaleString('pt-BR')
                            : ev.start?.date || ''}
                        </p>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="lg:col-span-7 flex flex-col min-h-0 bg-[#070B12] p-6 overflow-y-auto">
                {showNewEvent ? (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (!newEvSummary.trim() || !newEvStart || !newEvEnd) return;
                      confirmWorkspaceMutation({
                        title: 'Criar Evento no Google Calendar',
                        summary: `Criar evento "${newEvSummary.trim()}"?`,
                        actionType: 'calendar_create_event',
                        target: newEvSummary.trim(),
                        payload: {
                          summary: newEvSummary.trim(),
                          startIso: fromLocalDateTimeInput(newEvStart),
                          endIso: fromLocalDateTimeInput(newEvEnd),
                          location: newEvLocation,
                        },
                        onSuccess: () => {
                          setShowNewEvent(false);
                          setNewEvSummary('');
                        },
                      });
                    }}
                    className="max-w-lg space-y-3.5"
                  >
                    <h3 className="text-sm font-semibold text-slate-100">Novo Evento no Google Calendar</h3>
                    <input
                      type="text"
                      required
                      value={newEvSummary}
                      onChange={(e) => setNewEvSummary(e.target.value)}
                      placeholder="Título do evento"
                      className="w-full rounded-lg border border-white/10 bg-[#0D121B] px-3 py-2 text-xs text-slate-100"
                    />
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <label className="text-[11px] text-slate-400">Início</label>
                        <input
                          type="datetime-local"
                          required
                          value={newEvStart}
                          onChange={(e) => setNewEvStart(e.target.value)}
                          className="w-full rounded-lg border border-white/10 bg-[#0D121B] px-3 py-2 text-xs text-slate-100"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[11px] text-slate-400">Fim</label>
                        <input
                          type="datetime-local"
                          required
                          value={newEvEnd}
                          onChange={(e) => setNewEvEnd(e.target.value)}
                          className="w-full rounded-lg border border-white/10 bg-[#0D121B] px-3 py-2 text-xs text-slate-100"
                        />
                      </div>
                    </div>
                    <input
                      type="text"
                      value={newEvLocation}
                      onChange={(e) => setNewEvLocation(e.target.value)}
                      placeholder="Local ou link (opcional)"
                      className="w-full rounded-lg border border-white/10 bg-[#0D121B] px-3 py-2 text-xs text-slate-100"
                    />
                    <button type="submit" className="px-4 py-2 rounded-lg bg-sky-500 text-xs font-semibold text-slate-950">
                      Agendar Evento
                    </button>
                  </form>
                ) : !selectedEvent ? (
                  <div className="flex-1 flex flex-col items-center justify-center text-center space-y-2">
                    <Calendar className="h-8 w-8 text-slate-600" />
                    <p className="text-xs text-slate-400">Selecione um evento ao lado para editar título, horário, local ou descrição.</p>
                  </div>
                ) : (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      confirmWorkspaceMutation({
                        title: 'Atualizar Evento do Google Calendar',
                        summary: `Salvar alterações no evento "${evSummary.trim()}"?`,
                        actionType: 'calendar_update_event',
                        target: evSummary.trim() || selectedEvent.id,
                        payload: {
                          eventId: selectedEvent.id,
                          summary: evSummary.trim(),
                          startIso: evStart ? fromLocalDateTimeInput(evStart) : undefined,
                          endIso: evEnd ? fromLocalDateTimeInput(evEnd) : undefined,
                          location: evLocation,
                          description: evDescription,
                        },
                      });
                    }}
                    className="max-w-xl space-y-4"
                  >
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-slate-100">Editar Evento Contextual</h3>
                      <button
                        type="button"
                        onClick={() =>
                          confirmWorkspaceMutation({
                            title: 'Excluir Evento do Calendar',
                            summary: `Excluir o evento "${selectedEvent.summary || selectedEvent.id}"?`,
                            actionType: 'calendar_delete_event',
                            target: selectedEvent.summary || selectedEvent.id,
                            payload: { eventId: selectedEvent.id },
                            onSuccess: () => setSelectedEvent(null),
                          })
                        }
                        className="inline-flex items-center gap-1 rounded-md border border-rose-500/25 bg-rose-500/10 px-2.5 py-1 text-xs text-rose-300"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        <span>Excluir Evento</span>
                      </button>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[11px] text-slate-400">Título</label>
                      <input
                        type="text"
                        value={evSummary}
                        onChange={(e) => setEvSummary(e.target.value)}
                        className="w-full rounded-lg border border-white/10 bg-[#0D121B] px-3 py-2 text-xs text-slate-100"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <label className="text-[11px] text-slate-400">Início</label>
                        <input
                          type="datetime-local"
                          value={evStart}
                          onChange={(e) => setEvStart(e.target.value)}
                          className="w-full rounded-lg border border-white/10 bg-[#0D121B] px-3 py-2 text-xs text-slate-100"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[11px] text-slate-400">Fim</label>
                        <input
                          type="datetime-local"
                          value={evEnd}
                          onChange={(e) => setEvEnd(e.target.value)}
                          className="w-full rounded-lg border border-white/10 bg-[#0D121B] px-3 py-2 text-xs text-slate-100"
                        />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[11px] text-slate-400">Local</label>
                      <input
                        type="text"
                        value={evLocation}
                        onChange={(e) => setEvLocation(e.target.value)}
                        className="w-full rounded-lg border border-white/10 bg-[#0D121B] px-3 py-2 text-xs text-slate-100"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[11px] text-slate-400">Descrição</label>
                      <textarea
                        rows={4}
                        value={evDescription}
                        onChange={(e) => setEvDescription(e.target.value)}
                        className="w-full rounded-lg border border-white/10 bg-[#0D121B] p-3 text-xs text-slate-100"
                      />
                    </div>
                    <button
                      type="submit"
                      className="inline-flex items-center gap-1.5 rounded-lg bg-sky-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-sky-400"
                    >
                      <Save className="h-3.5 w-3.5" />
                      <span>Salvar Alterações</span>
                    </button>
                  </form>
                )}
              </div>
            </div>
          )}

          {/* ==========================================
              APP TAB 4: TASKS CONTEXTUAL EDITOR
             ========================================== */}
          {appTab === 'tasks' && (
            <div className="grid h-full grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-white/8">
              <div className="lg:col-span-5 flex flex-col min-h-0 bg-[#0A0E16]">
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!newTaskTitle.trim()) return;
                    confirmWorkspaceMutation({
                      title: 'Criar Tarefa no Google Tasks',
                      summary: `Adicionar tarefa "${newTaskTitle.trim()}"?`,
                      actionType: 'tasks_create',
                      target: newTaskTitle.trim(),
                      payload: { title: newTaskTitle.trim() },
                      onSuccess: () => setNewTaskTitle(''),
                    });
                  }}
                  className="p-3.5 border-b border-white/8 flex gap-2"
                >
                  <input
                    type="text"
                    value={newTaskTitle}
                    onChange={(e) => setNewTaskTitle(e.target.value)}
                    placeholder="Nova tarefa no Google Tasks..."
                    className="flex-1 rounded-lg border border-white/10 bg-[#070B12] px-3 py-1.5 text-xs text-slate-100 focus:outline-none"
                  />
                  <button type="submit" className="px-3 py-1.5 rounded-lg bg-sky-500 text-xs font-semibold text-slate-950">
                    Adicionar
                  </button>
                </form>

                <div className="flex-1 overflow-y-auto divide-y divide-white/6">
                  {tasks.length === 0 ? (
                    <div className="p-5 text-xs text-slate-500">Nenhuma tarefa encontrada.</div>
                  ) : (
                    tasks.map((t) => {
                      const done = t.status === 'completed';
                      return (
                        <div
                          key={t.id}
                          onClick={() => selectTaskItem(t)}
                          className={`px-4 py-3 cursor-pointer flex items-center justify-between gap-3 transition-colors ${
                            selectedTask?.id === t.id
                              ? 'bg-sky-500/12 border-l-2 border-l-sky-400'
                              : 'hover:bg-white/[0.03]'
                          }`}
                        >
                          <div className="min-w-0">
                            <p className={`text-xs truncate ${done ? 'line-through text-slate-500' : 'text-slate-100 font-medium'}`}>
                              {t.title}
                            </p>
                            {t.due && (
                              <p className="text-[11px] font-mono text-slate-500">Venc.: {t.due.slice(0, 10)}</p>
                            )}
                          </div>
                          <span className={`text-[11px] font-mono ${done ? 'text-emerald-400' : 'text-amber-300'}`}>
                            {done ? 'Concluída' : 'Pendente'}
                          </span>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              <div className="lg:col-span-7 flex flex-col min-h-0 bg-[#070B12] p-6 overflow-y-auto">
                {!selectedTask ? (
                  <div className="flex-1 flex flex-col items-center justify-center text-center space-y-2">
                    <CheckSquare className="h-8 w-8 text-slate-600" />
                    <p className="text-xs text-slate-400">Selecione uma tarefa ao lado para editar título, notas, prazo ou status.</p>
                  </div>
                ) : (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      confirmWorkspaceMutation({
                        title: 'Atualizar Tarefa no Google Tasks',
                        summary: `Salvar alterações na tarefa "${taskTitleDraft.trim()}"?`,
                        actionType: 'tasks_update',
                        target: taskTitleDraft.trim() || selectedTask.id,
                        payload: {
                          taskId: selectedTask.id,
                          title: taskTitleDraft.trim(),
                          notes: taskNotesDraft,
                          dueIso: taskDueDraft ? `${taskDueDraft}T00:00:00.000Z` : '',
                          status: taskStatusDraft,
                        },
                      });
                    }}
                    className="max-w-xl space-y-4"
                  >
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-slate-100">Editar Tarefa Contextual</h3>
                      <button
                        type="button"
                        onClick={() =>
                          confirmWorkspaceMutation({
                            title: 'Excluir Tarefa',
                            summary: `Excluir permanentemente a tarefa "${selectedTask.title}"?`,
                            actionType: 'tasks_delete',
                            target: selectedTask.title,
                            payload: { taskId: selectedTask.id },
                            onSuccess: () => setSelectedTask(null),
                          })
                        }
                        className="inline-flex items-center gap-1 rounded-md border border-rose-500/25 bg-rose-500/10 px-2.5 py-1 text-xs text-rose-300"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        <span>Excluir</span>
                      </button>
                    </div>

                    <div className="space-y-1">
                      <label className="text-[11px] text-slate-400">Título</label>
                      <input
                        type="text"
                        required
                        value={taskTitleDraft}
                        onChange={(e) => setTaskTitleDraft(e.target.value)}
                        className="w-full rounded-lg border border-white/10 bg-[#0D121B] px-3 py-2 text-xs text-slate-100"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <label className="text-[11px] text-slate-400">Data de Vencimento</label>
                        <input
                          type="date"
                          value={taskDueDraft}
                          onChange={(e) => setTaskDueDraft(e.target.value)}
                          className="w-full rounded-lg border border-white/10 bg-[#0D121B] px-3 py-2 text-xs text-slate-100"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[11px] text-slate-400">Status</label>
                        <select
                          value={taskStatusDraft}
                          onChange={(e) => setTaskStatusDraft(e.target.value as 'needsAction' | 'completed')}
                          className="w-full rounded-lg border border-white/10 bg-[#0D121B] px-3 py-2 text-xs text-slate-100"
                        >
                          <option value="needsAction">Pendente</option>
                          <option value="completed">Concluída</option>
                        </select>
                      </div>
                    </div>

                    <div className="space-y-1">
                      <label className="text-[11px] text-slate-400">Notas</label>
                      <textarea
                        rows={5}
                        value={taskNotesDraft}
                        onChange={(e) => setTaskNotesDraft(e.target.value)}
                        placeholder="Detalhes ou anotações da tarefa..."
                        className="w-full rounded-lg border border-white/10 bg-[#0D121B] p-3 text-xs text-slate-100"
                      />
                    </div>

                    <button
                      type="submit"
                      className="inline-flex items-center gap-1.5 rounded-lg bg-sky-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-sky-400"
                    >
                      <Save className="h-3.5 w-3.5" />
                      <span>Salvar Alterações</span>
                    </button>
                  </form>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
