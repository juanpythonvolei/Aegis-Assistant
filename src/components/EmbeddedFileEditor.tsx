import {
  Bold,
  CheckSquare,
  Code2,
  ExternalLink,
  Eye,
  FileCode2,
  Heading1,
  Heading2,
  Italic,
  List,
  Pencil,
  Replace,
  RotateCcw,
  Save,
  Search,
  WrapText,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import React, { useEffect, useMemo, useRef, useState } from 'react';

export type EmbeddedFileKind =
  | 'folder'
  | 'doc'
  | 'sheet'
  | 'slides'
  | 'text'
  | 'pdf'
  | 'image'
  | 'audio'
  | 'video'
  | 'binary';

export interface EmbeddedFileEditorProps {
  name: string;
  mimeType: string;
  kind: EmbeddedFileKind;
  editable: boolean;
  initialContent?: string;
  sizeLabel?: string;
  modifiedLabel?: string;
  mediaUrl?: string | null;
  mediaLoading?: boolean;
  mediaError?: string | null;
  hasMediaPreview?: boolean;
  externalUrl?: string;
  onRequestMediaPreview?: () => void;
  onSave?: (newContent: string) => void;
}

function getExtension(filename: string): string {
  const idx = filename.lastIndexOf('.');
  return idx >= 0 ? filename.slice(idx + 1).toLowerCase() : '';
}

function parseCsvRows(text: string, delimiter: string): string[][] {
  const lines = text.replace(/\r\n/g, '\n').split('\n').filter((l, i, arr) => i < arr.length - 1 || l.length > 0);
  return lines.slice(0, 500).map((line) => {
    const cells: string[] = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === delimiter && !inQuotes) {
        cells.push(cur);
        cur = '';
      } else {
        cur += ch;
      }
    }
    cells.push(cur);
    return cells;
  });
}

function renderInlineMarkdown(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const regex = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^)]+\))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let keyIdx = 0;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    const token = match[0];
    if (token.startsWith('**') && token.endsWith('**')) {
      parts.push(
        <strong key={keyIdx++} className="font-semibold text-slate-100">
          {token.slice(2, -2)}
        </strong>
      );
    } else if (token.startsWith('*') && token.endsWith('*')) {
      parts.push(
        <em key={keyIdx++} className="italic text-slate-200">
          {token.slice(1, -1)}
        </em>
      );
    } else if (token.startsWith('`') && token.endsWith('`')) {
      parts.push(
        <code key={keyIdx++} className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-[11px] text-sky-300">
          {token.slice(1, -1)}
        </code>
      );
    } else if (token.startsWith('[')) {
      const m = token.match(/^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/);
      if (m) {
        parts.push(
          <a
            key={keyIdx++}
            href={m[2]}
            target="_blank"
            rel="noreferrer"
            className="text-sky-400 underline hover:text-sky-300"
          >
            {m[1]}
          </a>
        );
      } else {
        parts.push(token);
      }
    }
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }
  return parts;
}

const MarkdownPreview: React.FC<{ content: string }> = ({ content }) => {
  const blocks = useMemo(() => {
    const lines = content.replace(/\r\n/g, '\n').split('\n');
    const nodes: React.ReactNode[] = [];
    let i = 0;
    let k = 0;

    while (i < lines.length) {
      const line = lines[i];

      if (line.trim().startsWith('```')) {
        const lang = line.trim().slice(3).trim();
        const codeLines: string[] = [];
        i++;
        while (i < lines.length && !lines[i].trim().startsWith('```')) {
          codeLines.push(lines[i]);
          i++;
        }
        i++;
        nodes.push(
          <div key={k++} className="my-3 overflow-x-auto rounded-lg border border-white/10 bg-[#070B12]">
            {lang && (
              <div className="border-b border-white/8 px-3 py-1 font-mono text-[10px] uppercase text-slate-500">
                {lang}
              </div>
            )}
            <pre className="p-3 font-mono text-xs leading-relaxed text-sky-200">{codeLines.join('\n')}</pre>
          </div>
        );
        continue;
      }

      if (/^#{1,3}\s+/.test(line)) {
        const lvl = line.match(/^#+/)?.[0].length || 1;
        const body = line.replace(/^#{1,3}\s+/, '');
        const cls =
          lvl === 1
            ? 'text-lg font-bold text-slate-100 border-b border-white/8 pb-1.5 mt-4 mb-2'
            : lvl === 2
            ? 'text-base font-semibold text-slate-100 mt-3.5 mb-1.5'
            : 'text-sm font-semibold text-sky-300 mt-3 mb-1';
        nodes.push(
          <div key={k++} className={cls}>
            {renderInlineMarkdown(body)}
          </div>
        );
        i++;
        continue;
      }

      if (/^>\s?/.test(line)) {
        nodes.push(
          <blockquote key={k++} className="my-2 border-l-2 border-sky-400/60 pl-3 text-xs italic text-slate-300">
            {renderInlineMarkdown(line.replace(/^>\s?/, ''))}
          </blockquote>
        );
        i++;
        continue;
      }

      if (/^[-*]\s+\[( |x|X)\]\s+/.test(line)) {
        const checked = /^[-*]\s+\[(x|X)\]/.test(line);
        const body = line.replace(/^[-*]\s+\[( |x|X)\]\s+/, '');
        nodes.push(
          <div key={k++} className="flex items-start gap-2 py-0.5 text-xs text-slate-200">
            <span className={`mt-0.5 font-mono text-[11px] ${checked ? 'text-emerald-400' : 'text-slate-500'}`}>
              {checked ? '[x]' : '[ ]'}
            </span>
            <span className={checked ? 'line-through text-slate-400' : ''}>{renderInlineMarkdown(body)}</span>
          </div>
        );
        i++;
        continue;
      }

      if (/^[-*]\s+/.test(line)) {
        nodes.push(
          <div key={k++} className="flex items-start gap-2 py-0.5 text-xs text-slate-200 pl-1">
            <span className="text-sky-400">•</span>
            <span>{renderInlineMarkdown(line.replace(/^[-*]\s+/, ''))}</span>
          </div>
        );
        i++;
        continue;
      }

      if (/^\d+\.\s+/.test(line)) {
        const num = line.match(/^(\d+)\./)?.[1] || '1';
        nodes.push(
          <div key={k++} className="flex items-start gap-2 py-0.5 text-xs text-slate-200 pl-1">
            <span className="font-mono text-sky-400">{num}.</span>
            <span>{renderInlineMarkdown(line.replace(/^\d+\.\s+/, ''))}</span>
          </div>
        );
        i++;
        continue;
      }

      if (/^---+$/.test(line.trim())) {
        nodes.push(<hr key={k++} className="my-3 border-white/10" />);
        i++;
        continue;
      }

      if (!line.trim()) {
        nodes.push(<div key={k++} className="h-2" />);
        i++;
        continue;
      }

      nodes.push(
        <p key={k++} className="text-xs leading-relaxed text-slate-200">
          {renderInlineMarkdown(line)}
        </p>
      );
      i++;
    }
    return nodes;
  }, [content]);

  return <div className="space-y-0.5">{blocks}</div>;
};

export const EmbeddedFileEditor: React.FC<EmbeddedFileEditorProps> = ({
  name,
  mimeType,
  kind,
  editable,
  initialContent = '',
  sizeLabel,
  modifiedLabel,
  mediaUrl,
  mediaLoading = false,
  mediaError = null,
  hasMediaPreview = false,
  externalUrl,
  onRequestMediaPreview,
  onSave,
}) => {
  const [mode, setMode] = useState<'preview' | 'edit'>(() =>
    kind === 'doc' ? 'edit' : 'preview'
  );
  const [draft, setDraft] = useState(initialContent);
  const [docVisualMode, setDocVisualMode] = useState<'text' | 'pdf'>('text');
  const [slidesVisualMode, setSlidesVisualMode] = useState<'pdf' | 'text'>('pdf');
  const [wrapLines, setWrapLines] = useState(true);
  const [imageZoom, setImageZoom] = useState(false);

  // Find & Replace bar
  const [showFind, setShowFind] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const [replaceQuery, setReplaceQuery] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const lineGutterRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setDraft(initialContent);
    setDocVisualMode('text');
    setSlidesVisualMode(hasMediaPreview || mediaUrl ? 'pdf' : 'text');
    setShowFind(false);
    setImageZoom(false);
    if (!editable) {
      setMode('preview');
    } else if (kind === 'doc') {
      setMode('edit');
    } else {
      setMode('preview');
    }
  }, [name, mimeType, kind, initialContent, editable, hasMediaPreview]);

  const ext = getExtension(name);
  const isDirty = editable && draft !== initialContent;

  const isMarkdown = ext === 'md' || ext === 'markdown' || mimeType === 'text/markdown';
  const isCsv = ext === 'csv' || ext === 'tsv' || mimeType === 'text/csv';
  const isJson = ext === 'json' || mimeType === 'application/json';
  const isHtml = ext === 'html' || ext === 'htm' || mimeType === 'text/html';
  const isSvg = ext === 'svg' || mimeType === 'image/svg+xml';

  const stats = useMemo(() => {
    const lines = draft ? draft.split('\n').length : 0;
    const words = draft.trim() ? draft.trim().split(/\s+/).length : 0;
    const chars = draft.length;
    return { lines, words, chars };
  }, [draft]);

  const prettyJson = useMemo(() => {
    if (!isJson) return null;
    try {
      return { valid: true, formatted: JSON.stringify(JSON.parse(draft), null, 2) };
    } catch (err: unknown) {
      return {
        valid: false,
        formatted: draft,
        error: err instanceof Error ? err.message : 'JSON inválido',
      };
    }
  }, [isJson, draft]);

  const csvRows = useMemo(() => {
    if (!isCsv) return [];
    const delimiter = ext === 'tsv' ? '\t' : ',';
    return parseCsvRows(draft, delimiter);
  }, [isCsv, ext, draft]);

  const insertSnippet = (before: string, after = '', placeholder = '') => {
    const el = textareaRef.current;
    if (!el) {
      setDraft((prev) => `${prev}${before}${placeholder}${after}`);
      return;
    }
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const selected = draft.slice(start, end) || placeholder;
    const next = draft.slice(0, start) + before + selected + after + draft.slice(end);
    setDraft(next);
    requestAnimationFrame(() => {
      el.focus();
      const cursorPos = start + before.length + selected.length;
      el.setSelectionRange(cursorPos, cursorPos);
    });
  };

  const handleEditorKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const el = e.currentTarget;
      const start = el.selectionStart;
      const end = el.selectionEnd;
      const next = draft.slice(0, start) + '  ' + draft.slice(end);
      setDraft(next);
      requestAnimationFrame(() => {
        el.setSelectionRange(start + 2, start + 2);
      });
    }
  };

  const handleReplaceAll = () => {
    if (!findQuery) return;
    setDraft((prev) => prev.split(findQuery).join(replaceQuery));
  };

  const findMatchCount = useMemo(() => {
    if (!findQuery) return 0;
    return draft.split(findQuery).length - 1;
  }, [draft, findQuery]);

  const handleScrollSync = () => {
    if (textareaRef.current && lineGutterRef.current) {
      lineGutterRef.current.scrollTop = textareaRef.current.scrollTop;
    }
  };

  const lineNumbers = useMemo(() => {
    const count = Math.max(1, draft.split('\n').length);
    return Array.from({ length: count }, (_, idx) => idx + 1);
  }, [draft]);

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-3 overflow-hidden">
      {/* Top Action & Mode Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/8 bg-[#0D121B] px-3.5 py-2 shrink-0">
        <div className="flex flex-wrap items-center gap-2">
          {/* Preview vs Editor Switch */}
          {editable ? (
            <div className="flex items-center gap-1 rounded-md bg-[#070B12] p-0.5 border border-white/8">
              <button
                type="button"
                onClick={() => setMode('preview')}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                  mode === 'preview' ? 'bg-sky-500 text-slate-950 font-semibold' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Eye className="h-3.5 w-3.5" />
                <span>Visualizar</span>
              </button>
              <button
                type="button"
                onClick={() => setMode('edit')}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                  mode === 'edit' ? 'bg-sky-500 text-slate-950 font-semibold' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Pencil className="h-3.5 w-3.5" />
                <span>Editor Embutido</span>
              </button>
            </div>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-sky-300">
              <Eye className="h-3.5 w-3.5" />
              <span>Visualizador Integrado</span>
            </span>
          )}

          {/* Format toggle for Google Docs */}
          {kind === 'doc' && mode === 'preview' && (hasMediaPreview || mediaUrl) && (
            <div className="flex items-center gap-1 rounded-md bg-[#070B12] p-0.5 border border-white/8">
              <button
                type="button"
                onClick={() => setDocVisualMode('text')}
                className={`px-2 py-1 rounded text-[11px] font-medium ${
                  docVisualMode === 'text' ? 'bg-white/12 text-slate-100' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Leitura Limpa
              </button>
              <button
                type="button"
                onClick={() => {
                  setDocVisualMode('pdf');
                  if (!mediaUrl && onRequestMediaPreview) onRequestMediaPreview();
                }}
                className={`px-2 py-1 rounded text-[11px] font-medium ${
                  docVisualMode === 'pdf' ? 'bg-white/12 text-slate-100' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Layout Formatado (PDF)
              </button>
            </div>
          )}

          {/* Slides visual vs text switch */}
          {kind === 'slides' && (
            <div className="flex items-center gap-1 rounded-md bg-[#070B12] p-0.5 border border-white/8">
              <button
                type="button"
                onClick={() => {
                  setSlidesVisualMode('pdf');
                  if (!mediaUrl && onRequestMediaPreview) onRequestMediaPreview();
                }}
                className={`px-2 py-1 rounded text-[11px] font-medium ${
                  slidesVisualMode === 'pdf' ? 'bg-white/12 text-slate-100' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Slides Visuais
              </button>
              <button
                type="button"
                onClick={() => setSlidesVisualMode('text')}
                className={`px-2 py-1 rounded text-[11px] font-medium ${
                  slidesVisualMode === 'text' ? 'bg-white/12 text-slate-100' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Texto Extraído
              </button>
            </div>
          )}

          {isDirty && (
            <span className="text-[11px] font-mono text-amber-300">● Alterações não salvas</span>
          )}
        </div>

        {/* Right side tools / save */}
        <div className="flex flex-wrap items-center gap-2">
          {kind === 'image' && mediaUrl && (
            <button
              type="button"
              onClick={() => setImageZoom((z) => !z)}
              className="inline-flex items-center gap-1 rounded border border-white/10 bg-[#151D2B] px-2.5 py-1 text-[11px] text-slate-200 hover:border-sky-500/40"
            >
              {imageZoom ? <ZoomOut className="h-3.5 w-3.5" /> : <ZoomIn className="h-3.5 w-3.5" />}
              <span>{imageZoom ? 'Ajustar Tela' : 'Zoom 100%'}</span>
            </button>
          )}

          {editable && mode === 'edit' && (
            <>
              <button
                type="button"
                onClick={() => setShowFind((v) => !v)}
                className={`inline-flex items-center gap-1 rounded border px-2 py-1 text-[11px] ${
                  showFind
                    ? 'border-sky-500/40 bg-sky-500/15 text-sky-300'
                    : 'border-white/10 bg-[#151D2B] text-slate-300'
                }`}
              >
                <Search className="h-3 w-3" />
                <span>Localizar</span>
              </button>
              <button
                type="button"
                onClick={() => setWrapLines((v) => !v)}
                className={`inline-flex items-center gap-1 rounded border px-2 py-1 text-[11px] ${
                  wrapLines
                    ? 'border-sky-500/40 bg-sky-500/15 text-sky-300'
                    : 'border-white/10 bg-[#151D2B] text-slate-300'
                }`}
              >
                <WrapText className="h-3 w-3" />
                <span>Quebra</span>
              </button>
              {isDirty && (
                <button
                  type="button"
                  onClick={() => setDraft(initialContent)}
                  className="inline-flex items-center gap-1 rounded border border-white/10 bg-[#151D2B] px-2 py-1 text-[11px] text-slate-300 hover:text-white"
                >
                  <RotateCcw className="h-3 w-3" />
                  <span>Descartar</span>
                </button>
              )}
              {onSave && (
                <button
                  type="button"
                  onClick={() => onSave(draft)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-sky-500 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-sky-400"
                >
                  <Save className="h-3.5 w-3.5" />
                  <span>Salvar Alterações</span>
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Formatting & Find/Replace bars in Editor Mode */}
      {editable && mode === 'edit' && (
        <div className="space-y-2 shrink-0">
          {(isMarkdown || kind === 'doc' || ext === 'txt' || ext === '') && (
            <div className="flex flex-wrap items-center gap-1 rounded-lg border border-white/8 bg-[#0B1018] px-2.5 py-1.5">
              <span className="text-[10px] font-mono uppercase text-slate-500 mr-1">Formatar:</span>
              <button
                type="button"
                onClick={() => insertSnippet('# ', '', 'Título')}
                title="Título H1"
                className="p-1.5 rounded hover:bg-white/8 text-slate-300"
              >
                <Heading1 className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => insertSnippet('## ', '', 'Subtítulo')}
                title="Subtítulo H2"
                className="p-1.5 rounded hover:bg-white/8 text-slate-300"
              >
                <Heading2 className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => insertSnippet('**', '**', 'negrito')}
                title="Negrito"
                className="p-1.5 rounded hover:bg-white/8 text-slate-300"
              >
                <Bold className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => insertSnippet('*', '*', 'itálico')}
                title="Itálico"
                className="p-1.5 rounded hover:bg-white/8 text-slate-300"
              >
                <Italic className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => insertSnippet('\n- ', '', 'Item da lista')}
                title="Lista"
                className="p-1.5 rounded hover:bg-white/8 text-slate-300"
              >
                <List className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => insertSnippet('\n- [ ] ', '', 'Tarefa')}
                title="Checklist"
                className="p-1.5 rounded hover:bg-white/8 text-slate-300"
              >
                <CheckSquare className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => insertSnippet('\n```\n', '\n```\n', 'código')}
                title="Bloco de Código"
                className="p-1.5 rounded hover:bg-white/8 text-slate-300"
              >
                <Code2 className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          {showFind && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-sky-500/25 bg-[#0C131F] px-3 py-2">
              <input
                type="text"
                value={findQuery}
                onChange={(e) => setFindQuery(e.target.value)}
                placeholder="Localizar texto..."
                className="flex-1 min-w-[140px] rounded border border-white/10 bg-[#070B12] px-2.5 py-1 text-xs text-slate-100 focus:outline-none"
              />
              <input
                type="text"
                value={replaceQuery}
                onChange={(e) => setReplaceQuery(e.target.value)}
                placeholder="Substituir por..."
                className="flex-1 min-w-[140px] rounded border border-white/10 bg-[#070B12] px-2.5 py-1 text-xs text-slate-100 focus:outline-none"
              />
              <span className="font-mono text-[11px] text-slate-400 tabular-nums">
                {findQuery ? `${findMatchCount} ocorr.` : '—'}
              </span>
              <button
                type="button"
                onClick={handleReplaceAll}
                disabled={!findQuery}
                className="inline-flex items-center gap-1 rounded bg-sky-500 px-2.5 py-1 text-xs font-semibold text-slate-950 disabled:opacity-40"
              >
                <Replace className="h-3 w-3" />
                <span>Substituir tudo</span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* Main Content Body */}
      <div className="flex-1 min-h-0 flex flex-col rounded-xl border border-white/10 bg-[#0B1018] overflow-hidden">
        {/* EDITOR MODE */}
        {editable && mode === 'edit' ? (
          <div className="flex-1 min-h-0 flex overflow-hidden">
            <div
              ref={lineGutterRef}
              className="w-11 shrink-0 select-none overflow-hidden border-r border-white/6 bg-[#080C14] py-3.5 pr-2 text-right font-mono text-[11px] leading-[1.65] text-slate-600 tabular-nums"
            >
              {lineNumbers.map((n) => (
                <div key={n}>{n}</div>
              ))}
            </div>
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onScroll={handleScrollSync}
              onKeyDown={handleEditorKeyDown}
              wrap={wrapLines ? 'soft' : 'off'}
              spellCheck={kind === 'doc' || isMarkdown}
              className={`flex-1 w-full bg-transparent p-3.5 text-xs leading-[1.65] text-slate-100 focus:outline-none resize-none ${
                kind === 'doc' ? 'font-sans' : 'font-mono'
              } ${wrapLines ? '' : 'overflow-x-auto whitespace-pre'}`}
            />
          </div>
        ) : (
          /* VISUALIZAR MODE */
          <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
            {/* PDF / Slides PDF / Doc Formatted PDF */}
            {(kind === 'pdf' ||
              (kind === 'slides' && slidesVisualMode === 'pdf') ||
              (kind === 'doc' && docVisualMode === 'pdf')) && (
              <div className="flex-1 min-h-0 flex flex-col">
                {mediaLoading ? (
                  <div className="flex-1 flex items-center justify-center font-mono text-xs text-slate-400">
                    Carregando visualização visual do documento...
                  </div>
                ) : mediaError ? (
                  <div className="p-6 space-y-3 text-xs">
                    <p className="text-rose-300">{mediaError}</p>
                    {kind === 'slides' && draft && (
                      <pre className="whitespace-pre-wrap font-sans text-slate-200 border-t border-white/10 pt-3">
                        {draft}
                      </pre>
                    )}
                  </div>
                ) : mediaUrl ? (
                  <iframe
                    src={mediaUrl}
                    title={name}
                    className="w-full h-full min-h-[420px] bg-white border-0"
                  />
                ) : (
                  <div className="flex-1 flex flex-col items-center justify-center p-6 text-center space-y-3 text-xs text-slate-400">
                    <p>Visualização PDF ainda não carregada.</p>
                    {onRequestMediaPreview && (
                      <button
                        type="button"
                        onClick={onRequestMediaPreview}
                        className="rounded-lg bg-sky-500 px-3 py-1.5 text-xs font-semibold text-slate-950"
                      >
                        Carregar Visualização PDF
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* SLIDES TEXT FALLBACK */}
            {kind === 'slides' && slidesVisualMode === 'text' && (
              <div className="flex-1 overflow-y-auto p-5">
                <pre className="whitespace-pre-wrap font-sans text-xs leading-relaxed text-slate-200">
                  {draft || 'Apresentação sem texto extraível.'}
                </pre>
              </div>
            )}

            {/* GOOGLE DOC READER */}
            {kind === 'doc' && docVisualMode === 'text' && (
              <div className="flex-1 overflow-y-auto p-6">
                <div className="max-w-3xl mx-auto space-y-3">
                  <pre className="whitespace-pre-wrap font-sans text-[13px] leading-relaxed text-slate-100">
                    {draft || '(Documento vazio — alterne para "Editor Embutido" acima para escrever.)'}
                  </pre>
                </div>
              </div>
            )}

            {/* IMAGE (Blob URL or inline SVG) */}
            {kind === 'image' && (
              <div className="flex-1 overflow-auto flex items-center justify-center p-4 bg-[#070B12]">
                {mediaLoading ? (
                  <span className="font-mono text-xs text-slate-400">Carregando imagem...</span>
                ) : mediaError ? (
                  <span className="text-xs text-rose-300">{mediaError}</span>
                ) : mediaUrl ? (
                  <img
                    src={mediaUrl}
                    alt={name}
                    className={
                      imageZoom
                        ? 'max-w-none rounded'
                        : 'max-h-full max-w-full rounded object-contain'
                    }
                  />
                ) : (
                  <span className="text-xs text-slate-500">Prévia de imagem indisponível.</span>
                )}
              </div>
            )}

            {/* AUDIO */}
            {kind === 'audio' && (
              <div className="flex-1 flex flex-col items-center justify-center p-6 space-y-4">
                <p className="text-xs font-mono text-slate-300">{name}</p>
                {mediaLoading ? (
                  <span className="font-mono text-xs text-slate-400">Carregando áudio...</span>
                ) : mediaError ? (
                  <span className="text-xs text-rose-300">{mediaError}</span>
                ) : mediaUrl ? (
                  <audio controls src={mediaUrl} className="w-full max-w-md" />
                ) : null}
              </div>
            )}

            {/* VIDEO */}
            {kind === 'video' && (
              <div className="flex-1 flex items-center justify-center p-4 bg-black">
                {mediaLoading ? (
                  <span className="font-mono text-xs text-slate-400">Carregando vídeo...</span>
                ) : mediaError ? (
                  <span className="text-xs text-rose-300">{mediaError}</span>
                ) : mediaUrl ? (
                  <video controls src={mediaUrl} className="max-h-full max-w-full rounded" />
                ) : null}
              </div>
            )}

            {/* TEXT / CODE / MARKDOWN / CSV / JSON / HTML / SVG */}
            {kind === 'text' && (
              <div className="flex-1 overflow-auto p-4">
                {isSvg ? (
                  <div className="flex flex-col items-center justify-center gap-4 py-4">
                    <iframe
                      sandbox=""
                      title={name}
                      srcDoc={`<!doctype html><html><body style="margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#070B12;">${draft}</body></html>`}
                      className="w-full h-80 rounded border border-white/10 bg-[#070B12]"
                    />
                  </div>
                ) : isHtml ? (
                  <iframe
                    sandbox=""
                    title={name}
                    srcDoc={draft}
                    className="w-full h-full min-h-[400px] rounded border border-white/10 bg-white"
                  />
                ) : isMarkdown ? (
                  <div className="max-w-3xl mx-auto p-2">
                    <MarkdownPreview content={draft} />
                  </div>
                ) : isCsv ? (
                  <div className="overflow-auto">
                    <table className="w-full border-collapse text-xs">
                      <thead>
                        <tr className="bg-[#111722] text-sky-300 font-semibold">
                          {(csvRows[0] || []).map((cell, idx) => (
                            <th key={idx} className="border border-white/10 px-3 py-2 text-left">
                              {cell}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {csvRows.slice(1).map((row, rIdx) => (
                          <tr key={rIdx} className="hover:bg-white/[0.03]">
                            {row.map((cell, cIdx) => (
                              <td key={cIdx} className="border border-white/10 px-3 py-1.5 text-slate-200">
                                {cell}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : isJson && prettyJson ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-[11px] font-mono">
                      <FileCode2 className="h-3.5 w-3.5 text-cyan-300" />
                      <span className={prettyJson.valid ? 'text-emerald-400' : 'text-amber-300'}>
                        {prettyJson.valid ? 'JSON válido (formatado)' : `Aviso JSON: ${prettyJson.error}`}
                      </span>
                    </div>
                    <pre className="font-mono text-xs leading-relaxed text-cyan-100 whitespace-pre-wrap break-words">
                      {prettyJson.formatted}
                    </pre>
                  </div>
                ) : (
                  <div className="font-mono text-xs leading-relaxed">
                    {draft.split('\n').map((lineText, idx) => (
                      <div key={idx} className="flex gap-4 hover:bg-white/[0.02] px-1">
                        <span className="w-9 shrink-0 select-none text-right text-slate-600 tabular-nums">
                          {idx + 1}
                        </span>
                        <span className="whitespace-pre-wrap break-words text-slate-200 flex-1">
                          {lineText || ' '}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* BINARY METADATA FALLBACK */}
            {kind === 'binary' && (
              <div className="p-6 space-y-3 text-xs">
                <p className="font-medium text-slate-200">Metadados do Arquivo</p>
                <div className="grid grid-cols-2 gap-2 text-slate-400 max-w-md">
                  <span>Tipo MIME:</span>
                  <span className="font-mono text-slate-200">{mimeType}</span>
                  {sizeLabel && (
                    <>
                      <span>Tamanho:</span>
                      <span className="font-mono text-slate-200">{sizeLabel}</span>
                    </>
                  )}
                  {modifiedLabel && (
                    <>
                      <span>Modificado em:</span>
                      <span className="font-mono text-slate-200">{modifiedLabel}</span>
                    </>
                  )}
                </div>
                {externalUrl && (
                  <a
                    href={externalUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-lg bg-sky-500 px-3.5 py-2 text-xs font-semibold text-slate-950 hover:bg-sky-400"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    <span>Abrir Arquivo Completo no Google Drive</span>
                  </a>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer Status Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-1 text-[11px] font-mono text-slate-500 shrink-0 tabular-nums">
        <span className="truncate">{mimeType}</span>
        <div className="flex items-center gap-3">
          {(editable || kind === 'text' || kind === 'doc') && (
            <>
              <span>{stats.lines} linhas</span>
              <span>{stats.words} palavras</span>
              <span>{stats.chars} chars</span>
            </>
          )}
          {sizeLabel && <span>{sizeLabel}</span>}
        </div>
      </div>
    </div>
  );
};
