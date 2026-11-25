import {
  Check,
  Code2,
  Copy,
  ExternalLink,
  FileText,
  Globe,
  Image as ImageIcon,
  Layers,
  LayoutDashboard,
  Maximize2,
  Minimize2,
  Sparkles,
  X,
} from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { apiFetch } from '../lib/apiClient';
import type { HolographicScreenSpec } from '../types';
import { EmbeddedFileEditor, type EmbeddedFileKind } from './EmbeddedFileEditor';

interface HolographicScreenDeckProps {
  screens: HolographicScreenSpec[];
  activeScreenId: string | null;
  minimized: boolean;
  accessToken: string | null;
  onSelectScreen: (id: string) => void;
  onCloseScreen: (id: string) => void;
  onToggleMinimize: () => void;
  onSaveLocalFile?: (path: string, content: string) => Promise<void>;
  onNavigateWebUrl?: (url: string) => Promise<void>;
}

function kindMeta(kind: HolographicScreenSpec['kind']): {
  label: string;
  icon: React.FC<{ className?: string }>;
} {
  switch (kind) {
    case 'file_viewer':
      return { label: 'Arquivo & Editor', icon: FileText };
    case 'image_gallery':
      return { label: 'Galeria Visual', icon: ImageIcon };
    case 'web_canvas':
      return { label: 'Canvas Web', icon: Globe };
    case 'html_artifact':
      return { label: 'Projeção Interativa', icon: Sparkles };
    default:
      return { label: 'Painel Holográfico', icon: LayoutDashboard };
  }
}

const TONE_CLASSES: Record<string, string> = {
  amber: 'border-amber-500/35 text-amber-300',
  cyan: 'border-sky-500/35 text-sky-300',
  emerald: 'border-emerald-500/35 text-emerald-300',
  rose: 'border-rose-500/35 text-rose-300',
  slate: 'border-white/12 text-slate-100',
};

export const HolographicScreenDeck: React.FC<HolographicScreenDeckProps> = ({
  screens,
  activeScreenId,
  minimized,
  accessToken,
  onSelectScreen,
  onCloseScreen,
  onToggleMinimize,
  onSaveLocalFile,
  onNavigateWebUrl,
}) => {
  const [expanded, setExpanded] = useState(false);
  const [copiedCodeKey, setCopiedCodeKey] = useState<string | null>(null);
  const [selectedImgIdx, setSelectedImgIdx] = useState(0);

  // Dynamic file loading state for Drive/local file_viewer screens
  const [loadedFile, setLoadedFile] = useState<{
    name: string;
    mimeType: string;
    kind: EmbeddedFileKind;
    editable: boolean;
    content: string;
    mediaUrl: string | null;
    loading: boolean;
    error: string | null;
    externalUrl?: string;
  } | null>(null);

  const activeScreen = screens.find((s) => s.id === activeScreenId) || screens[screens.length - 1] || null;

  useEffect(() => {
    setSelectedImgIdx(0);
    if (!activeScreen || activeScreen.kind !== 'file_viewer') {
      setLoadedFile(null);
      return;
    }

    let cancelled = false;
    let revokeUrl: string | null = null;

    const load = async () => {
      if (activeScreen.fileSource === 'inline' || (!activeScreen.fileIdOrPath && activeScreen.content !== undefined)) {
        setLoadedFile({
          name: activeScreen.fileName || activeScreen.title,
          mimeType: activeScreen.mimeType || 'text/plain',
          kind: 'text',
          editable: true,
          content: activeScreen.content || '',
          mediaUrl: null,
          loading: false,
          error: null,
        });
        return;
      }

      if (activeScreen.fileSource === 'local' && activeScreen.fileIdOrPath) {
        setLoadedFile({
          name: activeScreen.fileName || activeScreen.fileIdOrPath,
          mimeType: activeScreen.mimeType || 'text/plain',
          kind: 'text',
          editable: true,
          content: activeScreen.content || '',
          mediaUrl: null,
          loading: true,
          error: null,
        });
        try {
          const res = await apiFetch(`/api/linux/file?path=${encodeURIComponent(activeScreen.fileIdOrPath)}`);
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Falha ao carregar arquivo local.');
          let mediaUrl: string | null = null;
          if (['pdf', 'image', 'audio', 'video'].includes(data.kind)) {
            const mRes = await apiFetch(`/api/linux/media?path=${encodeURIComponent(activeScreen.fileIdOrPath)}`);
            if (mRes.ok) {
              const blob = await mRes.blob();
              mediaUrl = URL.createObjectURL(blob);
              revokeUrl = mediaUrl;
            }
          }
          if (!cancelled) {
            setLoadedFile({
              name: data.name || activeScreen.fileName || activeScreen.title,
              mimeType: data.mimeType || 'text/plain',
              kind: (data.kind as EmbeddedFileKind) || 'text',
              editable: data.kind === 'text',
              content: data.content || '',
              mediaUrl,
              loading: false,
              error: null,
            });
          }
        } catch (err: unknown) {
          if (!cancelled) {
            setLoadedFile({
              name: activeScreen.fileName || activeScreen.title,
              mimeType: activeScreen.mimeType || 'text/plain',
              kind: 'text',
              editable: false,
              content: activeScreen.content || '',
              mediaUrl: null,
              loading: false,
              error: err instanceof Error ? err.message : 'Erro ao abrir arquivo.',
            });
          }
        }
        return;
      }

      if (activeScreen.fileSource === 'drive' && activeScreen.fileIdOrPath) {
        if (!accessToken) {
          setLoadedFile({
            name: activeScreen.fileName || activeScreen.title,
            mimeType: activeScreen.mimeType || 'text/plain',
            kind: 'binary',
            editable: false,
            content: '',
            mediaUrl: null,
            loading: false,
            error: 'Conecte sua conta Google no menu Conexões Cloud para abrir arquivos do Google Drive.',
          });
          return;
        }
        setLoadedFile({
          name: activeScreen.fileName || activeScreen.title,
          mimeType: activeScreen.mimeType || 'text/plain',
          kind: 'text',
          editable: false,
          content: '',
          mediaUrl: null,
          loading: true,
          error: null,
        });
        try {
          const res = await apiFetch(`/api/workspace/drive/file/${encodeURIComponent(activeScreen.fileIdOrPath)}`, {
            headers: { Authorization: `Bearer ${accessToken}` },
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Falha ao abrir arquivo do Google Drive.');
          const file = data.file;
          let mediaUrl: string | null = null;
          if (['pdf', 'image', 'audio', 'video', 'slides'].includes(file.kind)) {
            const q = file.defaultExportMime ? `?exportMime=${encodeURIComponent(file.defaultExportMime)}` : '';
            const mRes = await apiFetch(`/api/workspace/drive/media/${encodeURIComponent(activeScreen.fileIdOrPath)}${q}`, {
              headers: { Authorization: `Bearer ${accessToken}` },
            });
            if (mRes.ok) {
              const blob = await mRes.blob();
              mediaUrl = URL.createObjectURL(blob);
              revokeUrl = mediaUrl;
            }
          }
          if (!cancelled) {
            setLoadedFile({
              name: file.name || activeScreen.title,
              mimeType: file.mimeType || 'text/plain',
              kind: (file.kind as EmbeddedFileKind) || 'text',
              editable: Boolean(file.editable),
              content: file.textContent || '',
              mediaUrl,
              loading: false,
              error: null,
              externalUrl: file.webViewLink,
            });
          }
        } catch (err: unknown) {
          if (!cancelled) {
            setLoadedFile({
              name: activeScreen.fileName || activeScreen.title,
              mimeType: activeScreen.mimeType || 'text/plain',
              kind: 'binary',
              editable: false,
              content: '',
              mediaUrl: null,
              loading: false,
              error: err instanceof Error ? err.message : 'Erro ao abrir arquivo do Drive.',
            });
          }
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
      if (revokeUrl) URL.revokeObjectURL(revokeUrl);
    };
  }, [activeScreen, accessToken]);

  if (screens.length === 0 || !activeScreen || minimized) {
    return null;
  }

  const meta = kindMeta(activeScreen.kind);
  const KindIcon = meta.icon;

  return (
    <div
      className={`fixed z-20 flex flex-col transition-all duration-300 ${
        expanded
          ? 'inset-4 sm:inset-6'
          : 'top-18 bottom-28 left-1/2 -translate-x-1/2 w-[min(94vw,980px)]'
      }`}
    >
      <div className="holo-screen-frame flex-1 min-h-0 flex flex-col rounded-2xl overflow-hidden">
        {/* Top Floating Header & Multi-Screen Tabs */}
        <div className="flex items-center justify-between gap-3 border-b border-amber-500/20 bg-[#0A0E17] px-4 py-2.5 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg border border-amber-500/35 bg-amber-500/12 text-amber-300 shrink-0">
              <KindIcon className="h-3.5 w-3.5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="font-display text-sm font-semibold text-slate-100 truncate">
                  {activeScreen.title}
                </h3>
                <span className="hidden sm:inline font-mono text-[10px] uppercase tracking-wider text-amber-400/90">
                  {meta.label}
                </span>
              </div>
              {activeScreen.subtitle && (
                <p className="text-[11px] text-slate-400 truncate">{activeScreen.subtitle}</p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={onToggleMinimize}
              title="Minimizar para o núcleo 3D"
              className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-[#121826] px-2.5 py-1.5 text-[11px] text-slate-300 hover:border-amber-500/40 hover:text-amber-200 transition-colors"
            >
              <Layers className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Núcleo</span>
            </button>
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              title={expanded ? 'Tamanho flutuante' : 'Expandir tela'}
              className="rounded-lg border border-white/10 bg-[#121826] p-1.5 text-slate-300 hover:border-amber-500/40 hover:text-white transition-colors"
            >
              {expanded ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
            </button>
            <button
              type="button"
              onClick={() => onCloseScreen(activeScreen.id)}
              title="Fechar projeção"
              className="rounded-lg border border-white/10 bg-[#121826] p-1.5 text-slate-400 hover:border-rose-500/40 hover:text-rose-300 transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Multi-screen Tab Switcher when > 1 screen drawn */}
        {screens.length > 1 && (
          <div className="flex items-center gap-1.5 overflow-x-auto border-b border-white/8 bg-[#080B13] px-4 py-1.5 shrink-0">
            {screens.map((scr) => {
              const isAct = scr.id === activeScreen.id;
              return (
                <div
                  key={scr.id}
                  className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] transition-colors shrink-0 ${
                    isAct
                      ? 'border-amber-500/45 bg-amber-500/15 text-amber-200 font-medium'
                      : 'border-white/8 bg-[#101622] text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <button type="button" onClick={() => onSelectScreen(scr.id)} className="truncate max-w-[180px]">
                    {scr.title}
                  </button>
                  <button
                    type="button"
                    onClick={() => onCloseScreen(scr.id)}
                    className="text-slate-500 hover:text-rose-300"
                    aria-label={`Fechar ${scr.title}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* Screen Body */}
        <div className="flex-1 min-h-0 overflow-hidden flex flex-col p-4 bg-[#070B12]">
          {/* 1. FILE VIEWER & EMBEDDED EDITOR */}
          {activeScreen.kind === 'file_viewer' && loadedFile && (
            <EmbeddedFileEditor
              name={loadedFile.name}
              mimeType={loadedFile.mimeType}
              kind={loadedFile.kind}
              editable={loadedFile.editable}
              initialContent={loadedFile.content}
              mediaUrl={loadedFile.mediaUrl}
              mediaLoading={loadedFile.loading}
              mediaError={loadedFile.error}
              externalUrl={loadedFile.externalUrl}
              onSave={
                activeScreen.fileSource === 'local' && activeScreen.fileIdOrPath && onSaveLocalFile
                  ? (newContent) => {
                      void onSaveLocalFile(activeScreen.fileIdOrPath!, newContent);
                    }
                  : undefined
              }
            />
          )}

          {/* 2. IMAGE GALLERY */}
          {activeScreen.kind === 'image_gallery' && (
            <div className="flex-1 min-h-0 flex flex-col gap-3 overflow-hidden">
              {activeScreen.images && activeScreen.images.length > 0 ? (
                <>
                  <div className="flex-1 min-h-0 flex flex-col items-center justify-center rounded-xl border border-white/10 bg-[#05080F] p-4 overflow-auto">
                    <img
                      src={activeScreen.images[selectedImgIdx]?.url}
                      alt={activeScreen.images[selectedImgIdx]?.title || 'Imagem'}
                      className="max-h-full max-w-full rounded-lg object-contain shadow-2xl"
                    />
                    <div className="mt-3 text-center">
                      <p className="text-xs font-semibold text-slate-100">
                        {activeScreen.images[selectedImgIdx]?.title}
                      </p>
                      {activeScreen.images[selectedImgIdx]?.caption && (
                        <p className="text-[11px] text-slate-400 mt-0.5">
                          {activeScreen.images[selectedImgIdx]?.caption}
                        </p>
                      )}
                    </div>
                  </div>
                  {activeScreen.images.length > 1 && (
                    <div className="flex items-center gap-2 overflow-x-auto pb-1 shrink-0">
                      {activeScreen.images.map((img, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => setSelectedImgIdx(idx)}
                          className={`rounded-lg border p-1 transition-colors shrink-0 ${
                            idx === selectedImgIdx
                              ? 'border-amber-400 bg-amber-500/15'
                              : 'border-white/10 bg-[#0E1420] opacity-70 hover:opacity-100'
                          }`}
                        >
                          <img src={img.url} alt={img.title} className="h-14 w-20 rounded object-cover" />
                        </button>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <div className="flex-1 flex items-center justify-center text-xs text-slate-400">
                  Nenhuma imagem fornecida nesta projeção.
                </div>
              )}
            </div>
          )}

          {/* 3. WEB CANVAS */}
          {activeScreen.kind === 'web_canvas' && (
            <div className="flex-1 min-h-0 flex flex-col gap-3 overflow-y-auto pr-1">
              {activeScreen.webUrl && (
                <div className="flex items-center justify-between gap-3 rounded-xl border border-amber-500/20 bg-[#0D1320] px-4 py-2.5 shrink-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <Globe className="h-4 w-4 text-amber-400 shrink-0" />
                    <span className="font-mono text-xs text-slate-200 truncate">{activeScreen.webUrl}</span>
                  </div>
                  <a
                    href={activeScreen.webUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-amber-300 hover:text-amber-200 shrink-0"
                  >
                    <span>Abrir Original</span>
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </div>
              )}

              {activeScreen.webHeadings && activeScreen.webHeadings.length > 0 && (
                <div className="spatial-card rounded-xl p-4 space-y-2">
                  <h4 className="font-mono text-[11px] uppercase tracking-wider text-amber-400">
                    Tópicos Detectados
                  </h4>
                  <ul className="space-y-1 text-xs text-slate-200">
                    {activeScreen.webHeadings.slice(0, 10).map((h, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <span className="text-amber-400">›</span>
                        <span>{h}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {activeScreen.webText && (
                <div className="spatial-card rounded-xl p-4">
                  <h4 className="font-mono text-[11px] uppercase tracking-wider text-slate-400 mb-2">
                    Conteúdo Extraído
                  </h4>
                  <p className="text-xs leading-relaxed text-slate-200 whitespace-pre-wrap">
                    {activeScreen.webText}
                  </p>
                </div>
              )}

              {activeScreen.webTables && activeScreen.webTables.length > 0 && (
                <div className="spatial-card rounded-xl p-4 overflow-x-auto">
                  <h4 className="font-mono text-[11px] uppercase tracking-wider text-amber-400 mb-2">
                    Tabelas Extraídas
                  </h4>
                  {activeScreen.webTables.slice(0, 2).map((tbl, tIdx) => (
                    <table key={tIdx} className="w-full border-collapse text-xs mb-3">
                      <tbody>
                        {tbl.slice(0, 15).map((row, rIdx) => (
                          <tr key={rIdx} className={rIdx === 0 ? 'bg-amber-500/10 text-amber-200 font-semibold' : 'border-t border-white/8'}>
                            {row.map((cell, cIdx) => (
                              <td key={cIdx} className="px-2.5 py-1.5 text-slate-200">
                                {cell}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ))}
                </div>
              )}

              {activeScreen.webLinks && activeScreen.webLinks.length > 0 && (
                <div className="spatial-card rounded-xl p-4">
                  <h4 className="font-mono text-[11px] uppercase tracking-wider text-slate-400 mb-2">
                    Links Navegáveis
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {activeScreen.webLinks.slice(0, 12).map((lnk, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => onNavigateWebUrl?.(lnk.href)}
                        className="text-left rounded-lg border border-white/8 bg-[#0A0F1A] px-3 py-2 text-xs text-slate-200 hover:border-amber-500/40 hover:text-amber-200 transition-colors truncate"
                      >
                        <span className="block truncate font-medium">{lnk.text || lnk.href}</span>
                        <span className="block truncate font-mono text-[10px] text-slate-500">{lnk.href}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 4. INTERACTIVE DASHBOARD */}
          {activeScreen.kind === 'interactive_dashboard' && (
            <div className="flex-1 min-h-0 overflow-y-auto space-y-4 pr-1">
              {activeScreen.metrics && activeScreen.metrics.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {activeScreen.metrics.map((m, idx) => (
                    <div
                      key={idx}
                      className={`spatial-card rounded-xl p-3.5 border ${TONE_CLASSES[m.tone || 'amber'] || TONE_CLASSES.amber}`}
                    >
                      <span className="block text-[11px] text-slate-400">{m.label}</span>
                      <span className="mt-1 block font-display text-xl font-bold tabular-nums text-slate-100">
                        {m.value}
                      </span>
                      {m.delta && (
                        <span className="mt-0.5 block font-mono text-[11px] opacity-85">{m.delta}</span>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {activeScreen.sections && activeScreen.sections.length > 0 && (
                <div className="space-y-3">
                  {activeScreen.sections.map((sec, sIdx) => (
                    <div key={sIdx} className="spatial-card rounded-xl p-4 space-y-3">
                      <h4 className="font-display text-sm font-semibold text-amber-300">{sec.heading}</h4>
                      {sec.body && (
                        <p className="text-xs leading-relaxed text-slate-200 whitespace-pre-wrap">{sec.body}</p>
                      )}
                      {sec.bullets && sec.bullets.length > 0 && (
                        <ul className="space-y-1.5 text-xs text-slate-200">
                          {sec.bullets.map((b, bIdx) => (
                            <li key={bIdx} className="flex items-start gap-2">
                              <span className="text-amber-400 mt-0.5">▸</span>
                              <span>{b}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                      {sec.progress && sec.progress.length > 0 && (
                        <div className="space-y-2">
                          {sec.progress.map((pr, pIdx) => {
                            const max = pr.max || 100;
                            const pct = Math.max(0, Math.min(100, Math.round((pr.value / max) * 100)));
                            return (
                              <div key={pIdx} className="space-y-1">
                                <div className="flex justify-between text-[11px] font-mono">
                                  <span className="text-slate-300">{pr.label}</span>
                                  <span className="text-amber-300 tabular-nums">{pct}%</span>
                                </div>
                                <div className="h-2 rounded-full bg-white/8 overflow-hidden">
                                  <div
                                    className="h-full rounded-full bg-gradient-to-r from-amber-500 to-yellow-300"
                                    style={{ width: `${pct}%` }}
                                  />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                      {sec.table && (
                        <div className="overflow-x-auto">
                          <table className="w-full border-collapse text-xs">
                            <thead>
                              <tr className="bg-amber-500/10 text-amber-200">
                                {sec.table.headers.map((h, hIdx) => (
                                  <th key={hIdx} className="border border-white/10 px-3 py-1.5 text-left font-medium">
                                    {h}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {sec.table.rows.map((row, rIdx) => (
                                <tr key={rIdx} className="hover:bg-white/[0.03]">
                                  {row.map((cell, cIdx) => (
                                    <td key={cIdx} className="border border-white/8 px-3 py-1.5 text-slate-200">
                                      {cell}
                                    </td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                      {sec.code && (
                        <div className="rounded-lg border border-white/10 bg-[#05080F] overflow-hidden">
                          <div className="flex items-center justify-between border-b border-white/8 px-3 py-1.5">
                            <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase text-slate-400">
                              <Code2 className="h-3 w-3 text-amber-400" />
                              {sec.code.language || 'code'}
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                navigator.clipboard.writeText(sec.code!.content);
                                setCopiedCodeKey(`${sIdx}`);
                                setTimeout(() => setCopiedCodeKey(null), 1600);
                              }}
                              className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-amber-300"
                            >
                              {copiedCodeKey === `${sIdx}` ? (
                                <Check className="h-3 w-3 text-emerald-400" />
                              ) : (
                                <Copy className="h-3 w-3" />
                              )}
                              <span>{copiedCodeKey === `${sIdx}` ? 'Copiado' : 'Copiar'}</span>
                            </button>
                          </div>
                          <pre className="p-3 font-mono text-xs text-amber-100/95 overflow-x-auto leading-relaxed">
                            {sec.code.content}
                          </pre>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* 5. SANDBOXED HTML / SVG ARTIFACT */}
          {activeScreen.kind === 'html_artifact' && (
            <div className="flex-1 min-h-0 flex flex-col rounded-xl border border-amber-500/20 overflow-hidden bg-[#05070B]">
              <iframe
                sandbox=""
                title={activeScreen.title}
                srcDoc={activeScreen.htmlCode || '<p style="color:#94a3b8;font-family:sans-serif;padding:24px;">Artefato vazio.</p>'}
                className="w-full h-full min-h-[380px] border-0 bg-[#05070B]"
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
