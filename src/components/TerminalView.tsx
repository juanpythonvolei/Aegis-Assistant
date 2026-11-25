import {
  ArrowLeft,
  FileText,
  Folder,
  HardDrive,
  RefreshCw,
  Terminal as TerminalIcon,
} from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../lib/apiClient';
import type {
  ConfirmationModalRequest,
  LinuxSystemStatus,
  LocalFileEntry,
} from '../types';
import { EmbeddedFileEditor, type EmbeddedFileKind } from './EmbeddedFileEditor';

interface TerminalViewProps {
  onRequestConfirm: (req: ConfirmationModalRequest) => void;
}

interface TerminalLine {
  id: string;
  kind: 'cmd' | 'stdout' | 'stderr' | 'info';
  text: string;
}

interface OpenedLocalFile {
  path: string;
  name: string;
  mimeType: string;
  kind: EmbeddedFileKind;
  content: string;
  sizeBytes: number;
}

export const TerminalView: React.FC<TerminalViewProps> = ({ onRequestConfirm }) => {
  const [status, setStatus] = useState<LinuxSystemStatus | null>(null);
  const [currentSubpath, setCurrentSubpath] = useState('.');
  const [files, setFiles] = useState<LocalFileEntry[]>([]);
  const [selectedFile, setSelectedFile] = useState<OpenedLocalFile | null>(null);
  const [mediaBlobUrl, setMediaBlobUrl] = useState<string | null>(null);
  const [mediaLoading, setMediaLoading] = useState(false);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const activeBlobRef = useRef<string | null>(null);
  const [saveFeedback, setSaveFeedback] = useState<string | null>(null);

  const [command, setCommand] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const [lines, setLines] = useState<TerminalLine[]>([
    {
      id: 'init-1',
      kind: 'info',
      text: 'Shell local conectado ao Aegis. Operações de leitura e escrita executam livremente; apenas ações destrutivas exigem confirmação.',
    },
  ]);
  const [running, setRunning] = useState(false);

  const revokeMediaBlob = () => {
    if (activeBlobRef.current) {
      URL.revokeObjectURL(activeBlobRef.current);
      activeBlobRef.current = null;
    }
    setMediaBlobUrl(null);
    setMediaError(null);
  };

  useEffect(() => {
    return () => {
      if (activeBlobRef.current) {
        URL.revokeObjectURL(activeBlobRef.current);
      }
    };
  }, []);

  const loadSystemAndFiles = async (subpath = currentSubpath) => {
    try {
      const [statusRes, filesRes] = await Promise.all([
        apiFetch('/api/linux/status'),
        apiFetch(`/api/linux/files?path=${encodeURIComponent(subpath)}`),
      ]);
      if (statusRes.ok) setStatus(await statusRes.json());
      if (filesRes.ok) {
        const fData = await filesRes.json();
        setFiles(fData.files || []);
      }
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    loadSystemAndFiles('.');
  }, []);

  const openFile = async (entry: LocalFileEntry) => {
    if (entry.type === 'directory') {
      setCurrentSubpath(entry.relativePath || '.');
      setSelectedFile(null);
      revokeMediaBlob();
      loadSystemAndFiles(entry.relativePath || '.');
      return;
    }
    setSaveFeedback(null);
    revokeMediaBlob();
    const res = await apiFetch(`/api/linux/file?path=${encodeURIComponent(entry.relativePath)}`);
    if (!res.ok) return;
    const data = (await res.json()) as OpenedLocalFile;
    setSelectedFile(data);

    if (data.kind === 'pdf' || data.kind === 'image' || data.kind === 'audio' || data.kind === 'video') {
      setMediaLoading(true);
      try {
        const mRes = await apiFetch(`/api/linux/media?path=${encodeURIComponent(entry.relativePath)}`);
        if (!mRes.ok) {
          setMediaError(`Falha ao carregar mídia (${mRes.status}).`);
          return;
        }
        const blob = await mRes.blob();
        const url = URL.createObjectURL(blob);
        activeBlobRef.current = url;
        setMediaBlobUrl(url);
      } catch (err: unknown) {
        setMediaError(err instanceof Error ? err.message : 'Erro ao carregar mídia local.');
      } finally {
        setMediaLoading(false);
      }
    }
  };

  const handleSaveLocalFile = (filePath: string, newContent: string) => {
    onRequestConfirm({
      id: `save-local-${Date.now()}`,
      title: 'Salvar Arquivo Local Linux',
      summary: `Gravar alterações no arquivo "${filePath}"?`,
      actionType: 'linux_write_file',
      target: filePath,
      details: `${newContent.length} caracteres serão gravados em ~/linux_workspace/${filePath}`,
      onConfirm: async () => {
        const res = await apiFetch('/api/linux/file', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: filePath, content: newContent }),
        });
        const data = await res.json();
        if (!res.ok) {
          setSaveFeedback(`Erro ao salvar: ${data.error || 'Falha'}`);
          return;
        }
        setSelectedFile((prev) =>
          prev ? { ...prev, content: newContent, sizeBytes: data.bytesWritten ?? newContent.length } : prev
        );
        setSaveFeedback(`Arquivo salvo (${data.bytesWritten} bytes).`);
        await loadSystemAndFiles(currentSubpath);
      },
    });
  };

  const executeShell = async (cmdText: string, confirmed = false) => {
    setRunning(true);
    try {
      const res = await apiFetch('/api/linux/exec', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: cmdText, confirmed }),
      });
      const data = await res.json();
      if (data.requiresConfirmation) {
        onRequestConfirm({
          id: `shell-${Date.now()}`,
          title: 'Confirmar Comando Linux',
          summary: data.message,
          actionType: 'linux_run_command',
          target: cmdText,
          details: cmdText,
          onConfirm: async () => {
            await executeShell(cmdText, true);
          },
          onCancel: () => {
            setLines((prev) => [
              ...prev,
              { id: `cancel-${Date.now()}`, kind: 'info', text: `Cancelado: ${cmdText}` },
            ]);
          },
        });
        return;
      }

      const newLines: TerminalLine[] = [];
      if (data.stdout) {
        newLines.push({ id: `out-${Date.now()}`, kind: 'stdout', text: data.stdout });
      }
      if (data.stderr) {
        newLines.push({ id: `err-${Date.now()}`, kind: 'stderr', text: data.stderr });
      }
      if (!data.stdout && !data.stderr) {
        newLines.push({
          id: `ok-${Date.now()}`,
          kind: 'info',
          text: `Concluído (código de saída ${data.exitCode ?? 0})`,
        });
      }
      setLines((prev) => [...prev, ...newLines]);
      await loadSystemAndFiles(currentSubpath);
    } finally {
      setRunning(false);
    }
  };

  const handleTerminalSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = command.trim();
    if (!trimmed || running) return;
    setHistory((prev) => [trimmed, ...prev.slice(0, 30)]);
    setHistoryIdx(-1);
    setCommand('');
    setLines((prev) => [...prev, { id: `cmd-${Date.now()}`, kind: 'cmd', text: `$ ${trimmed}` }]);
    await executeShell(trimmed, false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      const next = Math.min(historyIdx + 1, history.length - 1);
      if (history[next] !== undefined) {
        setHistoryIdx(next);
        setCommand(history[next]);
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = historyIdx - 1;
      if (next < 0) {
        setHistoryIdx(-1);
        setCommand('');
      } else {
        setHistoryIdx(next);
        setCommand(history[next]);
      }
    }
  };

  const memUsedMb = status ? status.totalMemMb - status.freeMemMb : 0;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* System Hardware Diagnostics Bar */}
      <div className="border-b border-amber-500/14 bg-[#0D1017]/90 px-6 py-3.5 shrink-0">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 flex-1">
            <div className="spatial-card rounded-xl px-3.5 py-2.5 text-xs">
              <span className="text-[10px] font-mono uppercase tracking-[0.14em] text-amber-400/75 block">Host &amp; Kernel</span>
              <span className="font-mono text-amber-50 tabular-nums mt-0.5 block truncate">
                {status ? `${status.hostname} · ${status.release}` : 'Carregando...'}
              </span>
            </div>
            <div className="spatial-card rounded-xl px-3.5 py-2.5 text-xs">
              <span className="text-[10px] font-mono uppercase tracking-[0.14em] text-amber-400/75 block">Processador &amp; Carga</span>
              <span className="font-mono text-amber-50 tabular-nums mt-0.5 block">
                {status ? `${status.cpuCount} vCPU · load ${status.loadAvg[0]}` : '—'}
              </span>
            </div>
            <div className="spatial-card rounded-xl px-3.5 py-2.5 text-xs">
              <span className="text-[10px] font-mono uppercase tracking-[0.14em] text-amber-400/75 block">Memória RAM</span>
              <span className="font-mono text-amber-50 tabular-nums mt-0.5 block">
                {status ? `${memUsedMb} / ${status.totalMemMb} MB` : '—'}
              </span>
            </div>
            <div className="spatial-card rounded-xl px-3.5 py-2.5 text-xs">
              <span className="text-[10px] font-mono uppercase tracking-[0.14em] text-amber-400/75 block">Disco Local</span>
              <span className="font-mono text-amber-50 tabular-nums truncate block mt-0.5">
                {status ? status.diskUsage : '—'}
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={() => loadSystemAndFiles(currentSubpath)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/22 bg-[#161922] px-3 py-2 text-xs font-medium text-amber-100 hover:border-amber-400/45 transition-colors whitespace-nowrap shrink-0"
          >
            <RefreshCw className="h-3.5 w-3.5 text-amber-400" />
            <span>Atualizar</span>
          </button>
        </div>
      </div>

      {/* Split Layout: Terminal + File Explorer & Embedded Viewer/Editor */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-4 p-4 min-h-0 bg-[#07090F]">
        {/* Interactive Terminal */}
        <div className="lg:col-span-6 spatial-card rounded-2xl flex flex-col min-h-0 overflow-hidden">
          <div className="flex items-center justify-between border-b border-amber-500/14 px-5 py-2.5 bg-[#0F131C]">
            <div className="flex items-center gap-2 text-xs font-medium text-amber-100">
              <TerminalIcon className="h-3.5 w-3.5 text-amber-400" />
              <span>Terminal do Sistema</span>
            </div>
            <div className="flex items-center gap-2">
              {['ls -la', 'find . -maxdepth 2', 'df -h .', 'uname -a'].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => {
                    setLines((prev) => [...prev, { id: `cmd-${Date.now()}`, kind: 'cmd', text: `$ ${preset}` }]);
                    executeShell(preset, false);
                  }}
                  className="font-mono text-[11px] text-slate-400 hover:text-sky-300 transition-colors whitespace-nowrap shrink-0"
                >
                  {preset}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-5 font-mono text-xs space-y-2">
            {lines.map((line) => (
              <pre
                key={line.id}
                className={`whitespace-pre-wrap break-words leading-relaxed ${
                  line.kind === 'cmd'
                    ? 'text-sky-400 font-semibold pt-1'
                    : line.kind === 'stderr'
                    ? 'text-rose-400'
                    : line.kind === 'info'
                    ? 'text-slate-500'
                    : 'text-slate-200'
                }`}
              >
                {line.text}
              </pre>
            ))}
          </div>

          <form
            onSubmit={handleTerminalSubmit}
            className="flex items-center gap-2.5 border-t border-amber-500/14 bg-[#0D1119] px-4 py-3"
          >
            <span className="font-mono text-xs text-amber-400 shrink-0">aegis@host:~$</span>
            <input
              type="text"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Digite um comando bash (ex: ls -la, find . -maxdepth 2, mkdir NovaPasta)"
              className="flex-1 bg-transparent font-mono text-xs text-amber-50 placeholder:text-slate-600 focus:outline-none"
            />
            <button
              type="submit"
              disabled={running || !command.trim()}
              className="px-3.5 py-1.5 rounded-lg bg-amber-500 text-xs font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-40 transition-colors whitespace-nowrap shrink-0"
            >
              Executar
            </button>
          </form>
        </div>

        {/* Local File Explorer & Embedded Viewer/Editor */}
        <div className="lg:col-span-6 spatial-card rounded-2xl flex flex-col min-h-0 overflow-hidden">
          <div className="flex items-center justify-between border-b border-amber-500/14 px-5 py-2.5 bg-[#0F131C] shrink-0">
            <div className="flex items-center gap-2 text-xs font-medium text-slate-300 min-w-0">
              {selectedFile ? (
                <button
                  type="button"
                  onClick={() => {
                    setSelectedFile(null);
                    setSaveFeedback(null);
                    revokeMediaBlob();
                  }}
                  className="inline-flex items-center gap-1 rounded border border-white/10 bg-[#151D2B] px-2 py-1 text-[11px] text-sky-300 hover:border-sky-500/40 shrink-0"
                >
                  <ArrowLeft className="h-3 w-3" />
                  <span>Arquivos</span>
                </button>
              ) : (
                <HardDrive className="h-3.5 w-3.5 text-sky-400 shrink-0" />
              )}
              <span className="font-mono truncate">
                {selectedFile
                  ? `~/linux_workspace/${selectedFile.path}`
                  : `~/linux_workspace/${currentSubpath === '.' ? '' : currentSubpath}`}
              </span>
            </div>
            {!selectedFile && currentSubpath !== '.' && (
              <button
                type="button"
                onClick={() => {
                  const parent = currentSubpath.includes('/')
                    ? currentSubpath.split('/').slice(0, -1).join('/')
                    : '.';
                  setCurrentSubpath(parent || '.');
                  loadSystemAndFiles(parent || '.');
                }}
                className="text-xs text-sky-400 hover:underline whitespace-nowrap shrink-0"
              >
                Voltar pasta
              </button>
            )}
          </div>

          {saveFeedback && (
            <div className="border-b border-emerald-500/20 bg-emerald-500/10 px-4 py-1.5 text-xs text-emerald-200 flex items-center justify-between shrink-0">
              <span>{saveFeedback}</span>
              <button type="button" onClick={() => setSaveFeedback(null)} className="text-emerald-300 hover:underline">
                Fechar
              </button>
            </div>
          )}

          {!selectedFile ? (
            <div className="flex-1 overflow-y-auto divide-y divide-white/6">
              {files.length === 0 ? (
                <div className="p-6 text-xs text-slate-500">Diretório vazio.</div>
              ) : (
                files.map((entry) => (
                  <button
                    key={entry.relativePath}
                    type="button"
                    onClick={() => openFile(entry)}
                    className="w-full flex items-center justify-between gap-3 px-5 py-2.5 text-left hover:bg-white/4 transition-colors"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      {entry.type === 'directory' ? (
                        <Folder className="h-4 w-4 text-sky-400 shrink-0" />
                      ) : (
                        <FileText className="h-4 w-4 text-slate-400 shrink-0" />
                      )}
                      <span className="text-xs font-mono text-slate-200 truncate">{entry.name}</span>
                    </div>
                    <span className="text-[11px] font-mono text-slate-500 tabular-nums whitespace-nowrap shrink-0">
                      {entry.type === 'directory' ? 'pasta' : `${entry.sizeBytes} B`}
                    </span>
                  </button>
                ))
              )}
            </div>
          ) : (
            <div className="flex-1 min-h-0 flex flex-col overflow-hidden p-4 bg-[#070B12]">
              <EmbeddedFileEditor
                name={selectedFile.name}
                mimeType={selectedFile.mimeType}
                kind={selectedFile.kind}
                editable={selectedFile.kind === 'text'}
                initialContent={selectedFile.content}
                sizeLabel={`${selectedFile.sizeBytes} B`}
                mediaUrl={mediaBlobUrl}
                mediaLoading={mediaLoading}
                mediaError={mediaError}
                onSave={(newContent) => handleSaveLocalFile(selectedFile.path, newContent)}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

