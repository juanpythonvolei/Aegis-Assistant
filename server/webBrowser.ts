import * as cheerio from 'cheerio';
import dns from 'node:dns/promises';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import * as auth from './auth.ts';
import { LINUX_WORKSPACE_ROOT, detectLocalMime } from './linuxRuntime.ts';
import * as memory from './memory.ts';

interface CookieEntry {
  name: string;
  value: string;
  domain: string;
  path: string;
}

export interface NavMenuNode {
  label: string;
  href: string;
  level: number;
  kind: 'menu' | 'submenu' | 'tab' | 'breadcrumb' | 'action';
  parentPath: string;
  isActive?: boolean;
  children: NavMenuNode[];
}

export interface DetectedAttachment {
  filename: string;
  href: string;
  extension: string;
  label: string;
  sectionHint: string;
}

export interface WebPageSnapshot {
  url: string;
  status: number;
  title: string;
  textPreview: string;
  headings: string[];
  breadcrumbs: string[];
  navigationTree: NavMenuNode[];
  attachments: DetectedAttachment[];
  links: Array<{ text: string; href: string }>;
  forms: Array<{
    index: number;
    action: string;
    method: string;
    fields: Array<{ name: string; type: string; value?: string; placeholder?: string }>;
  }>;
  tables: Array<string[][]>;
  cookieCount: number;
  timestamp: string;
}

export interface DownloadedWebAttachment {
  ok: boolean;
  fileName: string;
  localRelativePath: string;
  sizeBytes: number;
  mimeType: string;
  sourceUrl: string;
  buffer: Buffer;
}

const sessionCookies = new Map<string, CookieEntry[]>();
const lastSnapshots = new Map<string, WebPageSnapshot>();

const ATTACHMENT_EXTENSIONS = new Set([
  'pdf',
  'xlsx',
  'xls',
  'csv',
  'docx',
  'doc',
  'pptx',
  'ppt',
  'zip',
  'rar',
  '7z',
  'tar',
  'gz',
  'xml',
  'json',
  'txt',
  'png',
  'jpg',
  'jpeg',
  'webp',
  'odt',
  'ods',
  'rtf',
]);

const ATTACHMENT_KEYWORDS = [
  'download',
  'baixar',
  'anexo',
  'attachment',
  'export',
  'exportar',
  'boleto',
  'fatura',
  'danfe',
  'nota-fiscal',
  'nota_fiscal',
  'nfe',
  'nfse',
  'comprovante',
  'relatorio',
  'extrato',
  'arquivo',
  'documento',
  'getfile',
  'file=',
];

function isPrivateOrReservedIpv4(ip: string): boolean {
  const parts = ip.split('.').map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a >= 224) return true;
  return false;
}

function isPrivateOrReservedIp(ip: string): boolean {
  const clean = ip.trim().toLowerCase();
  if (net.isIPv4(clean)) return isPrivateOrReservedIpv4(clean);
  if (net.isIPv6(clean)) {
    if (clean === '::' || clean === '::1') return true;
    if (clean.startsWith('fc') || clean.startsWith('fd')) return true;
    if (/^fe[89ab]/.test(clean)) return true;
    if (clean.startsWith('::ffff:')) {
      const mapped = clean.slice(7);
      if (net.isIPv4(mapped)) return isPrivateOrReservedIpv4(mapped);
    }
    return false;
  }
  return true;
}

export async function assertSafeExternalUrl(rawUrl: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(ensureHttpUrl(rawUrl));
  } catch {
    throw new Error('URL inválida informada para acesso web.');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Apenas protocolos HTTP e HTTPS são permitidos.');
  }

  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    !host ||
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host === 'metadata.google.internal'
  ) {
    throw new Error('Acesso bloqueado a endereços locais ou internos de rede.');
  }

  if (net.isIP(host)) {
    if (isPrivateOrReservedIp(host)) {
      throw new Error('Acesso bloqueado a faixas de IP privadas ou reservadas.');
    }
    return parsed;
  }

  try {
    const records = await dns.lookup(host, { all: true });
    if (!records.length) {
      throw new Error(`Não foi possível resolver o domínio "${host}".`);
    }
    for (const rec of records) {
      if (isPrivateOrReservedIp(rec.address)) {
        throw new Error('Acesso bloqueado: o domínio aponta para endereço interno ou privado.');
      }
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes('Acesso bloqueado')) throw err;
    throw new Error(`Falha ao resolver DNS para "${host}": ${err instanceof Error ? err.message : 'erro desconhecido'}`);
  }

  return parsed;
}

function getJar(sessionId: string): CookieEntry[] {
  const existing = sessionCookies.get(sessionId);
  if (existing) return existing;
  const jar: CookieEntry[] = [];
  sessionCookies.set(sessionId, jar);
  return jar;
}

function storeSetCookies(sessionId: string, urlStr: string, headers: Headers) {
  const jar = getJar(sessionId);
  const host = new URL(urlStr).hostname.toLowerCase();
  const rawList =
    typeof (headers as unknown as { getSetCookie?: () => string[] }).getSetCookie === 'function'
      ? (headers as unknown as { getSetCookie: () => string[] }).getSetCookie()
      : [];

  for (const raw of rawList) {
    const [pair, ...attrs] = raw.split(';');
    const eqIdx = pair.indexOf('=');
    if (eqIdx <= 0) continue;
    const name = pair.slice(0, eqIdx).trim();
    const value = pair.slice(eqIdx + 1).trim();
    let domain = host;
    let cookiePath = '/';
    for (const attr of attrs) {
      const [k, v] = attr.trim().split('=');
      if (k?.toLowerCase() === 'domain' && v) domain = v.trim().replace(/^\./, '').toLowerCase();
      if (k?.toLowerCase() === 'path' && v) cookiePath = v.trim();
    }
    const idx = jar.findIndex((c) => c.name === name && c.domain === domain);
    const entry = { name, value, domain, path: cookiePath };
    if (idx >= 0) jar[idx] = entry;
    else jar.push(entry);
  }
}

function buildCookieHeader(sessionId: string, urlStr: string): string {
  const jar = getJar(sessionId);
  const u = new URL(urlStr);
  const host = u.hostname.toLowerCase();
  const pathname = u.pathname || '/';
  return jar
    .filter((c) => (host === c.domain || host.endsWith(`.${c.domain}`)) && pathname.startsWith(c.path))
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
}

function ensureHttpUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

async function fetchWithCookieRedirects(
  sessionId: string,
  targetUrl: string,
  options: { method?: string; headers?: Record<string, string>; body?: string; timeoutMs?: number } = {},
  maxHops = 6
): Promise<{
  finalUrl: string;
  status: number;
  html: string;
  contentType: string;
  contentDisposition: string;
}> {
  let currentUrl = (await assertSafeExternalUrl(targetUrl)).toString();
  let method = (options.method || 'GET').toUpperCase();
  let body = options.body;
  let extraHeaders = options.headers || {};

  for (let hop = 0; hop <= maxHops; hop++) {
    await assertSafeExternalUrl(currentUrl);
    const cookieHeader = buildCookieHeader(sessionId, currentUrl);
    const headers: Record<string, string> = {
      'User-Agent':
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.7',
      'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
      ...extraHeaders,
    };
    if (cookieHeader) headers.Cookie = cookieHeader;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs || 20_000);
    let res: Response;
    try {
      res = await fetch(currentUrl, {
        method,
        headers,
        body: method === 'GET' || method === 'HEAD' ? undefined : body,
        redirect: 'manual',
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    storeSetCookies(sessionId, currentUrl, res.headers);

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) {
        const txt = await res.text();
        return {
          finalUrl: currentUrl,
          status: res.status,
          html: txt,
          contentType: res.headers.get('content-type') || '',
          contentDisposition: res.headers.get('content-disposition') || '',
        };
      }
      currentUrl = new URL(loc, currentUrl).toString();
      if (res.status === 301 || res.status === 302 || res.status === 303) {
        method = 'GET';
        body = undefined;
        extraHeaders = {};
      }
      continue;
    }

    const html = await res.text();
    return {
      finalUrl: currentUrl,
      status: res.status,
      html,
      contentType: res.headers.get('content-type') || '',
      contentDisposition: res.headers.get('content-disposition') || '',
    };
  }

  throw new Error('Limite de redirecionamentos atingido ao navegar.');
}

function extractUrlFromElement(
  $: cheerio.CheerioAPI,
  el: Parameters<cheerio.CheerioAPI>[0],
  baseUrl: string
): string {
  const $el = $(el);
  const candidates = [
    $el.attr('href'),
    $el.attr('data-href'),
    $el.attr('data-url'),
    $el.attr('data-target'),
    $el.attr('data-link'),
  ];

  for (const raw of candidates) {
    const val = (raw || '').trim();
    if (!val || val.startsWith('javascript:')) continue;
    if (val.startsWith('#') && val.length > 1) {
      return `${baseUrl.split('#')[0]}${val}`;
    }
    try {
      return new URL(val, baseUrl).toString();
    } catch {
      // ignore
    }
  }

  const onclick = $el.attr('onclick') || '';
  const onclickMatch = onclick.match(/(?:location\.href|window\.location|window\.open)\s*[=(]\s*['"]([^'"]+)['"]/i);
  if (onclickMatch?.[1]) {
    try {
      return new URL(onclickMatch[1], baseUrl).toString();
    } catch {
      // ignore
    }
  }

  return '';
}

function cleanLabel(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().slice(0, 90);
}

function parseListMenuNodes(
  $: cheerio.CheerioAPI,
  listEl: Parameters<cheerio.CheerioAPI>[0],
  baseUrl: string,
  level: number,
  parentPath: string,
  seenKeys: Set<string>,
  budget: { remaining: number }
): NavMenuNode[] {
  if (level > 4 || budget.remaining <= 0) return [];
  const nodes: NavMenuNode[] = [];

  $(listEl)
    .children('li, div.menu-item, div.nav-item, div.dropdown, details')
    .each((_idx, item) => {
      if (budget.remaining <= 0) return;
      const $item = $(item);

      // Direct trigger element (anchor, button, summary, or span/div with role)
      const $trigger = $item
        .children('a, button, summary, [role="menuitem"], [role="tab"], span.menu-title, div.menu-title')
        .first();
      const label = cleanLabel(
        $trigger.length
          ? $trigger.text()
          : $item
              .clone()
              .children('ul, ol, div.submenu, div.dropdown-menu, div.accordion-body')
              .remove()
              .end()
              .text()
      );
      if (!label) return;

      const href = $trigger.length ? extractUrlFromElement($, $trigger[0], baseUrl) : extractUrlFromElement($, item, baseUrl);
      const isActive =
        $item.hasClass('active') ||
        $trigger.hasClass('active') ||
        $trigger.attr('aria-current') === 'page' ||
        $trigger.attr('aria-selected') === 'true';

      const role = ($trigger.attr('role') || $item.attr('role') || '').toLowerCase();
      const kind: NavMenuNode['kind'] =
        role === 'tab' || $trigger.attr('data-bs-toggle') === 'tab' || $trigger.attr('data-toggle') === 'tab'
          ? 'tab'
          : level === 0
            ? 'menu'
            : 'submenu';

      const currentPath = parentPath ? `${parentPath} > ${label}` : label;
      const dedupeKey = `${currentPath.toLowerCase()}|${href}`;

      // Recurse into child lists / dropdown menus / accordion bodies
      const $nestedContainers = $item.children(
        'ul, ol, div.submenu, div.sub-menu, div.dropdown-menu, div.accordion-body, div.collapse, [role="menu"]'
      );
      const children: NavMenuNode[] = [];
      $nestedContainers.each((_cIdx, sub) => {
        if (budget.remaining <= 0) return;
        const tag = sub.tagName?.toLowerCase();
        if (tag === 'ul' || tag === 'ol') {
          children.push(
            ...parseListMenuNodes($, sub, baseUrl, level + 1, currentPath, seenKeys, budget)
          );
        } else {
          // Dropdown div containing <a> or nested <ul>
          const $subUl = $(sub).children('ul, ol');
          if ($subUl.length > 0) {
            $subUl.each((_u, ulEl) => {
              children.push(
                ...parseListMenuNodes($, ulEl, baseUrl, level + 1, currentPath, seenKeys, budget)
              );
            });
          } else {
            $(sub)
              .find('a, button, [role="menuitem"]')
              .each((_aIdx, subAction) => {
                if (budget.remaining <= 0) return;
                const subLabel = cleanLabel($(subAction).text());
                const subHref = extractUrlFromElement($, subAction, baseUrl);
                if (!subLabel || (!subHref && subLabel.length < 2)) return;
                const subPath = `${currentPath} > ${subLabel}`;
                const subKey = `${subPath.toLowerCase()}|${subHref}`;
                if (seenKeys.has(subKey)) return;
                seenKeys.add(subKey);
                budget.remaining -= 1;
                children.push({
                  label: subLabel,
                  href: subHref,
                  level: level + 1,
                  kind: 'submenu',
                  parentPath: currentPath,
                  children: [],
                });
              });
          }
        }
      });

      if (!href && children.length === 0) return;
      if (seenKeys.has(dedupeKey)) return;
      seenKeys.add(dedupeKey);
      budget.remaining -= 1;

      nodes.push({
        label,
        href,
        level,
        kind,
        parentPath,
        isActive: isActive || undefined,
        children,
      });
    });

  return nodes;
}

function extractNavigationTree($: cheerio.CheerioAPI, baseUrl: string): {
  navigationTree: NavMenuNode[];
  breadcrumbs: string[];
} {
  const breadcrumbs: string[] = [];
  $('[aria-label*="breadcrumb" i] li, [aria-label*="breadcrumb" i] a, .breadcrumb li, .breadcrumbs li').each((_i, el) => {
    const txt = cleanLabel($(el).text());
    if (txt && !breadcrumbs.includes(txt)) breadcrumbs.push(txt);
  });

  const navigationTree: NavMenuNode[] = [];
  const seenKeys = new Set<string>();
  const budget = { remaining: 90 };

  // 1. Hierarchical menus inside nav/aside/header/sidebar/menu containers
  const navSelectors = [
    'nav',
    'aside',
    'header',
    '[role="navigation"]',
    '[role="menubar"]',
    '[role="menu"]',
    '[role="tree"]',
    '.sidebar',
    '.sidenav',
    '.navbar',
    '.main-menu',
    '.menu',
    '.accordion',
  ].join(', ');

  $(navSelectors).each((_i, container) => {
    if (budget.remaining <= 0) return;
    const $container = $(container);
    // Skip breadcrumb navs here
    const ariaLabel = ($container.attr('aria-label') || '').toLowerCase();
    if (ariaLabel.includes('breadcrumb') || $container.hasClass('breadcrumb') || $container.hasClass('breadcrumbs')) {
      return;
    }

    const $topLists = $container.children('ul, ol').add($container.find('> div > ul, > div > ol'));
    if ($topLists.length > 0) {
      $topLists.each((_j, ulEl) => {
        if (budget.remaining <= 0) return;
        navigationTree.push(...parseListMenuNodes($, ulEl, baseUrl, 0, '', seenKeys, budget));
      });
    } else {
      // Flat nav links or dropdown divs
      $container
        .find('a[href], button[data-url], button[data-href], [role="menuitem"]')
        .each((_k, el) => {
          if (budget.remaining <= 0) return;
          const label = cleanLabel($(el).text());
          const href = extractUrlFromElement($, el, baseUrl);
          if (!label || !href) return;
          const key = `${label.toLowerCase()}|${href}`;
          if (seenKeys.has(key)) return;
          seenKeys.add(key);
          budget.remaining -= 1;
          navigationTree.push({
            label,
            href,
            level: 0,
            kind: 'menu',
            parentPath: '',
            isActive: $(el).hasClass('active') || $(el).attr('aria-current') === 'page' || undefined,
            children: [],
          });
        });
    }
  });

  // 2. Explicit Tabs ([role="tablist"], .nav-tabs, .tabs)
  $('[role="tablist"] [role="tab"], .nav-tabs a, .nav-pills a, .tabs a, [data-bs-toggle="tab"], [data-toggle="tab"]').each(
    (_i, tabEl) => {
      if (budget.remaining <= 0) return;
      const label = cleanLabel($(tabEl).text());
      const href = extractUrlFromElement($, tabEl, baseUrl);
      if (!label || !href) return;
      const key = `tab:${label.toLowerCase()}|${href}`;
      if (seenKeys.has(key)) return;
      seenKeys.add(key);
      budget.remaining -= 1;
      navigationTree.push({
        label,
        href,
        level: 0,
        kind: 'tab',
        parentPath: 'Abas',
        isActive: $(tabEl).hasClass('active') || $(tabEl).attr('aria-selected') === 'true' || undefined,
        children: [],
      });
    }
  );

  return {
    navigationTree: navigationTree.slice(0, 50),
    breadcrumbs: breadcrumbs.slice(0, 10),
  };
}

function guessExtensionFromUrl(urlStr: string): string {
  try {
    const u = new URL(urlStr);
    const base = path.basename(u.pathname).toLowerCase();
    const extMatch = base.match(/\.([a-z0-9]{2,5})$/);
    if (extMatch?.[1] && ATTACHMENT_EXTENSIONS.has(extMatch[1])) {
      return extMatch[1];
    }
    for (const val of u.searchParams.values()) {
      const m = val.toLowerCase().match(/\.([a-z0-9]{2,5})$/);
      if (m?.[1] && ATTACHMENT_EXTENSIONS.has(m[1])) return m[1];
    }
  } catch {
    // ignore
  }
  return '';
}

function guessFilenameFromUrl(urlStr: string, fallbackLabel: string, ext: string): string {
  try {
    const u = new URL(urlStr);
    const rawBase = decodeURIComponent(path.basename(u.pathname));
    if (rawBase && rawBase.includes('.') && rawBase.length <= 120) {
      return rawBase;
    }
    for (const [k, v] of u.searchParams.entries()) {
      if (/file|name|doc|anexo|arquivo/i.test(k) && v.trim()) {
        return v.trim();
      }
    }
  } catch {
    // ignore
  }
  const slug = fallbackLabel
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
  const safeBase = slug || 'anexo';
  return ext && !safeBase.toLowerCase().endsWith(`.${ext}`) ? `${safeBase}.${ext}` : safeBase;
}

function extractAttachments($: cheerio.CheerioAPI, baseUrl: string): DetectedAttachment[] {
  const attachments: DetectedAttachment[] = [];
  const seenUrls = new Set<string>();

  $('a[href], button[data-url], button[data-href], [download], iframe[src$=".pdf"], embed[src$=".pdf"]').each(
    (_i, el) => {
      if (attachments.length >= 40) return;
      const $el = $(el);
      const rawHref = $el.attr('href') || $el.attr('src') || $el.attr('data-url') || $el.attr('data-href') || '';
      if (!rawHref || rawHref.startsWith('#') || rawHref.startsWith('javascript:') || rawHref.startsWith('mailto:')) {
        return;
      }
      let absUrl: string;
      try {
        absUrl = new URL(rawHref, baseUrl).toString();
      } catch {
        return;
      }
      if (seenUrls.has(absUrl)) return;

      const label = cleanLabel($el.text() || $el.attr('title') || $el.attr('aria-label') || '');
      const downloadAttr = $el.attr('download');
      const ext = guessExtensionFromUrl(absUrl);
      const lowerHref = absUrl.toLowerCase();
      const lowerLabel = label.toLowerCase();

      const hasDownloadAttr = downloadAttr !== undefined;
      const hasFileExt = Boolean(ext);
      const hasKeywordIntent = ATTACHMENT_KEYWORDS.some(
        (kw) => lowerHref.includes(kw) || lowerLabel.includes(kw)
      );

      if (!hasDownloadAttr && !hasFileExt && !hasKeywordIntent) return;
      // Avoid classifying normal HTML navigation links as attachments unless explicit download attr or attachment keyword
      if (!hasDownloadAttr && !hasFileExt && /\.(html?|php|asp|aspx)$/i.test(new URL(absUrl).pathname)) {
        if (!lowerHref.includes('download') && !lowerHref.includes('export') && !lowerLabel.includes('baixar') && !lowerLabel.includes('download')) {
          return;
        }
      }

      const rowContext = cleanLabel(
        $el.closest('tr, li, article, section, .card, .item').find('h1,h2,h3,h4,td:first-child,strong').first().text() ||
          ''
      );
      const filename =
        (downloadAttr && downloadAttr.trim()) || guessFilenameFromUrl(absUrl, label || rowContext || 'anexo', ext);

      seenUrls.add(absUrl);
      attachments.push({
        filename,
        href: absUrl,
        extension: ext || path.extname(filename).replace(/^\./, '').toLowerCase() || 'bin',
        label: label || filename,
        sectionHint: rowContext,
      });
    }
  );

  return attachments;
}

function parseHtmlToSnapshot(
  sessionId: string,
  url: string,
  status: number,
  rawBody: string,
  contentType: string
): WebPageSnapshot {
  if (contentType.includes('application/json') || rawBody.trim().startsWith('{') || rawBody.trim().startsWith('[')) {
    const snap: WebPageSnapshot = {
      url,
      status,
      title: `JSON Response (${url})`,
      textPreview: rawBody.slice(0, 6000),
      headings: [],
      breadcrumbs: [],
      navigationTree: [],
      attachments: [],
      links: [],
      forms: [],
      tables: [],
      cookieCount: getJar(sessionId).length,
      timestamp: new Date().toISOString(),
    };
    lastSnapshots.set(sessionId, snap);
    return snap;
  }

  const $ = cheerio.load(rawBody);
  $('script, style, noscript, svg, template').remove();

  const title = $('title').first().text().trim() || $('h1').first().text().trim() || url;
  const headings = $('h1, h2, h3, h4')
    .map((_i, el) => $(el).text().replace(/\s+/g, ' ').trim())
    .get()
    .filter(Boolean)
    .slice(0, 20);

  const { navigationTree, breadcrumbs } = extractNavigationTree($, url);
  const attachments = extractAttachments($, url);

  const links: Array<{ text: string; href: string }> = [];
  const seenLinks = new Set<string>();
  $('a[href]').each((_i, el) => {
    if (links.length >= 60) return;
    const hrefRaw = $(el).attr('href') || '';
    if (!hrefRaw || hrefRaw.startsWith('#') || hrefRaw.startsWith('javascript:') || hrefRaw.startsWith('mailto:')) return;
    try {
      const abs = new URL(hrefRaw, url).toString();
      if (seenLinks.has(abs)) return;
      seenLinks.add(abs);
      const text = $(el).text().replace(/\s+/g, ' ').trim() || abs;
      links.push({ text: text.slice(0, 100), href: abs });
    } catch {
      // ignore invalid URLs
    }
  });

  const forms: WebPageSnapshot['forms'] = [];
  $('form').each((idx, el) => {
    if (forms.length >= 10) return;
    const actionRaw = $(el).attr('action') || url;
    let action = url;
    try {
      action = new URL(actionRaw, url).toString();
    } catch {
      action = url;
    }
    const method = ($(el).attr('method') || 'GET').toUpperCase();
    const fields: Array<{ name: string; type: string; value?: string; placeholder?: string }> = [];
    $(el)
      .find('input, select, textarea')
      .each((_j, inp) => {
        const name = $(inp).attr('name') || $(inp).attr('id') || '';
        const type = ($(inp).attr('type') || inp.tagName || 'text').toLowerCase();
        if (!name && type !== 'submit') return;
        fields.push({
          name,
          type,
          value: type === 'hidden' ? $(inp).attr('value') || '' : undefined,
          placeholder: $(inp).attr('placeholder') || undefined,
        });
      });
    forms.push({ index: idx, action, method, fields: fields.slice(0, 25) });
  });

  const tables: Array<string[][]> = [];
  $('table').each((_i, tbl) => {
    if (tables.length >= 6) return;
    const rows: string[][] = [];
    $(tbl)
      .find('tr')
      .each((_r, tr) => {
        if (rows.length >= 25) return;
        const cols = $(tr)
          .find('th, td')
          .map((_c, td) => $(td).text().replace(/\s+/g, ' ').trim())
          .get();
        if (cols.some(Boolean)) rows.push(cols.slice(0, 12));
      });
    if (rows.length > 0) tables.push(rows);
  });

  const bodyText = $('body').text().replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
  const snap: WebPageSnapshot = {
    url,
    status,
    title,
    textPreview: bodyText.slice(0, 6500),
    headings,
    breadcrumbs,
    navigationTree,
    attachments,
    links,
    forms,
    tables,
    cookieCount: getJar(sessionId).length,
    timestamp: new Date().toISOString(),
  };
  lastSnapshots.set(sessionId, snap);
  return snap;
}

export function flattenNavigationTree(nodes: NavMenuNode[]): Array<{
  path: string;
  label: string;
  href: string;
  kind: NavMenuNode['kind'];
  level: number;
}> {
  const flat: Array<{
    path: string;
    label: string;
    href: string;
    kind: NavMenuNode['kind'];
    level: number;
  }> = [];

  function walk(items: NavMenuNode[]) {
    for (const item of items) {
      const fullPath = item.parentPath ? `${item.parentPath} > ${item.label}` : item.label;
      flat.push({
        path: fullPath,
        label: item.label,
        href: item.href,
        kind: item.kind,
        level: item.level,
      });
      if (item.children?.length) walk(item.children);
    }
  }

  walk(nodes);
  return flat;
}

function sanitizeSafeFileName(rawName: string, contentType: string): string {
  const base = path.basename(rawName || 'anexo').replace(/[\x00-\x1f<>:"/\\|?*]+/g, '_').trim();
  let safe = base.replace(/^\.+/, '') || 'anexo';
  if (safe.length > 110) {
    const ext = path.extname(safe);
    safe = `${safe.slice(0, 100)}${ext}`;
  }
  if (!path.extname(safe)) {
    const mimeToExt: Record<string, string> = {
      'application/pdf': '.pdf',
      'text/csv': '.csv',
      'application/json': '.json',
      'application/zip': '.zip',
      'application/xml': '.xml',
      'text/xml': '.xml',
      'text/plain': '.txt',
      'text/html': '.html',
      'image/png': '.png',
      'image/jpeg': '.jpg',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
      'application/vnd.ms-excel': '.xls',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
    };
    const pureMime = contentType.split(';')[0].trim().toLowerCase();
    if (mimeToExt[pureMime]) safe += mimeToExt[pureMime];
  }
  return safe;
}

function extractFilenameFromContentDisposition(header: string): string {
  if (!header) return '';
  const utf8Match = header.match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1].trim().replace(/^"|"$/g, ''));
    } catch {
      return utf8Match[1].trim();
    }
  }
  const plainMatch = header.match(/filename\s*=\s*"?([^";]+)"?/i);
  return plainMatch?.[1]?.trim() || '';
}

function resolveConfinedLocalPath(localSubfolder: string, fileName: string): { fullPath: string; relativePath: string } {
  const cleanSub = (localSubfolder || 'Downloads/Portais')
    .replace(/^~\/?/, '')
    .replace(/^\/+/, '')
    .split('/')
    .map((seg) => seg.trim().replace(/[<>:"\\|?*]+/g, '_'))
    .filter((seg) => seg && seg !== '.' && seg !== '..')
    .join('/');

  const safeFolder = path.resolve(LINUX_WORKSPACE_ROOT, cleanSub || 'Downloads/Portais');
  if (safeFolder !== LINUX_WORKSPACE_ROOT && !safeFolder.startsWith(LINUX_WORKSPACE_ROOT + path.sep)) {
    throw new Error('Pasta local de destino fora do diretório de trabalho permitido.');
  }

  fs.mkdirSync(safeFolder, { recursive: true });
  const target = path.resolve(safeFolder, path.basename(fileName));
  if (!target.startsWith(LINUX_WORKSPACE_ROOT + path.sep)) {
    throw new Error('Caminho de arquivo fora do diretório de trabalho permitido.');
  }

  return {
    fullPath: target,
    relativePath: path.relative(LINUX_WORKSPACE_ROOT, target),
  };
}

export async function webDownloadAttachment(
  sessionId: string,
  fileUrl: string,
  options: {
    localSubfolder?: string;
    preferredFilename?: string;
    maxBytes?: number;
  } = {}
): Promise<DownloadedWebAttachment> {
  const maxBytes = options.maxBytes ?? 20 * 1024 * 1024; // 20 MB limit
  let currentUrl = (await assertSafeExternalUrl(fileUrl)).toString();

  for (let hop = 0; hop <= 6; hop++) {
    await assertSafeExternalUrl(currentUrl);
    const cookieHeader = buildCookieHeader(sessionId, currentUrl);
    const headers: Record<string, string> = {
      'User-Agent':
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      Accept: '*/*',
      'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8',
    };
    if (cookieHeader) headers.Cookie = cookieHeader;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25_000);
    let res: Response;
    try {
      res = await fetch(currentUrl, {
        method: 'GET',
        headers,
        redirect: 'manual',
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    storeSetCookies(sessionId, currentUrl, res.headers);

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) throw new Error(`Redirecionamento inválido ao baixar ${currentUrl}`);
      currentUrl = new URL(loc, currentUrl).toString();
      continue;
    }

    if (!res.ok) {
      throw new Error(`Falha ao baixar anexo (HTTP ${res.status}) em ${currentUrl}`);
    }

    const declaredLength = Number(res.headers.get('content-length') || 0);
    if (declaredLength > maxBytes) {
      throw new Error(`Arquivo excede o limite máximo de ${Math.round(maxBytes / (1024 * 1024))} MB.`);
    }

    const arrBuf = await res.arrayBuffer();
    if (arrBuf.byteLength > maxBytes) {
      throw new Error(`Arquivo baixado excedeu o limite máximo de ${Math.round(maxBytes / (1024 * 1024))} MB.`);
    }

    const buffer = Buffer.from(arrBuf);
    const contentType = res.headers.get('content-type') || '';
    const cdFilename = extractFilenameFromContentDisposition(res.headers.get('content-disposition') || '');
    const rawName =
      cdFilename ||
      options.preferredFilename ||
      guessFilenameFromUrl(currentUrl, 'anexo', guessExtensionFromUrl(currentUrl));
    const safeName = sanitizeSafeFileName(rawName, contentType);
    const { fullPath, relativePath } = resolveConfinedLocalPath(options.localSubfolder || 'Downloads/Portais', safeName);

    fs.writeFileSync(fullPath, buffer);
    const resolvedMime =
      (contentType && contentType.split(';')[0].trim()) || detectLocalMime(fullPath) || 'application/octet-stream';

    return {
      ok: true,
      fileName: safeName,
      localRelativePath: relativePath,
      sizeBytes: buffer.length,
      mimeType: resolvedMime,
      sourceUrl: currentUrl,
      buffer,
    };
  }

  throw new Error('Limite de redirecionamentos excedido ao baixar anexo.');
}

export async function webNavigate(sessionId: string, targetUrl: string): Promise<WebPageSnapshot> {
  const { finalUrl, status, html, contentType } = await fetchWithCookieRedirects(sessionId, targetUrl);
  return parseHtmlToSnapshot(sessionId, finalUrl, status, html, contentType);
}

export async function webExtract(
  sessionId: string,
  targetUrl: string,
  selector?: string
): Promise<{
  url: string;
  title: string;
  matches: string[];
  tables: string[][][];
  links: Array<{ text: string; href: string }>;
  navigationTree: NavMenuNode[];
  attachments: DetectedAttachment[];
}> {
  const { finalUrl, status, html, contentType } = await fetchWithCookieRedirects(sessionId, targetUrl);
  const snap = parseHtmlToSnapshot(sessionId, finalUrl, status, html, contentType);
  if (!selector?.trim()) {
    return {
      url: snap.url,
      title: snap.title,
      matches: [snap.textPreview],
      tables: snap.tables,
      links: snap.links.slice(0, 20),
      navigationTree: snap.navigationTree,
      attachments: snap.attachments,
    };
  }
  const $ = cheerio.load(html);
  const matches = $(selector.trim())
    .map((_i, el) => $(el).text().replace(/\s+/g, ' ').trim())
    .get()
    .filter(Boolean)
    .slice(0, 40);

  return {
    url: snap.url,
    title: snap.title,
    matches,
    tables: snap.tables,
    links: snap.links.slice(0, 20),
    navigationTree: snap.navigationTree,
    attachments: snap.attachments,
  };
}

export async function webLoginWithCredential(
  sessionId: string,
  params: {
    siteOrCredentialId?: string;
    loginUrl?: string;
    username?: string;
    password?: string;
  }
): Promise<{ ok: boolean; message: string; snapshot: WebPageSnapshot }> {
  let loginUrl = params.loginUrl || '';
  let username = params.username || '';
  let password = params.password || '';
  let credentialId: number | null = null;

  if (params.siteOrCredentialId) {
    const cred = memory.findWebCredential(params.siteOrCredentialId);
    if (!cred) {
      throw new Error(`Credencial "${params.siteOrCredentialId}" não encontrada no cofre.`);
    }
    loginUrl = loginUrl || cred.login_url;
    username = cred.username;
    password = auth.decryptSecret(cred.encrypted_password, cred.iv, cred.auth_tag);
    credentialId = cred.id;
  }

  if (!loginUrl || !username || !password) {
    throw new Error('URL de login, usuário e senha são obrigatórios para autenticar no site.');
  }

  const page = await webNavigate(sessionId, loginUrl);

  const loginForm =
    page.forms.find((f) => f.fields.some((fld) => fld.type === 'password')) || page.forms[0];

  if (!loginForm) {
    throw new Error(`Nenhum formulário de login HTML detectado em ${page.url}.`);
  }

  const formParams = new URLSearchParams();
  let userFieldAssigned = false;
  let passFieldAssigned = false;

  for (const fld of loginForm.fields) {
    if (!fld.name) continue;
    const lowerName = fld.name.toLowerCase();
    if (fld.type === 'hidden') {
      formParams.set(fld.name, fld.value || '');
    } else if (fld.type === 'password' && !passFieldAssigned) {
      formParams.set(fld.name, password);
      passFieldAssigned = true;
    } else if (
      !userFieldAssigned &&
      (fld.type === 'email' ||
        fld.type === 'text' ||
        lowerName.includes('user') ||
        lowerName.includes('email') ||
        lowerName.includes('login') ||
        lowerName.includes('cpf') ||
        lowerName.includes('cnpj') ||
        lowerName.includes('matricula'))
    ) {
      formParams.set(fld.name, username);
      userFieldAssigned = true;
    } else if (fld.value) {
      formParams.set(fld.name, fld.value);
    }
  }

  if (!userFieldAssigned) formParams.set('username', username);
  if (!passFieldAssigned) formParams.set('password', password);

  const submitRes = await fetchWithCookieRedirects(sessionId, loginForm.action, {
    method: loginForm.method === 'GET' ? 'GET' : 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Origin: new URL(page.url).origin,
      Referer: page.url,
    },
    body: formParams.toString(),
  });

  const postSnap = parseHtmlToSnapshot(
    sessionId,
    submitRes.finalUrl,
    submitRes.status,
    submitRes.html,
    submitRes.contentType
  );

  if (credentialId) memory.touchWebCredential(credentialId);

  const stillHasPasswordForm = postSnap.forms.some((f) => f.fields.some((fld) => fld.type === 'password'));
  const redirectedAway = postSnap.url !== page.url;
  const ok = submitRes.status < 400 && (redirectedAway || !stillHasPasswordForm || postSnap.cookieCount > 0);

  return {
    ok,
    message: ok
      ? `Sessão web autenticada em ${postSnap.url} (HTTP ${submitRes.status}, ${postSnap.cookieCount} cookie(s) ativos, ${flattenNavigationTree(postSnap.navigationTree).length} item(ns) de menu detectados).`
      : `Tentativa de login retornou HTTP ${submitRes.status} em ${postSnap.url}. Verifique se o site exige JavaScript/CAPTCHA.`,
    snapshot: postSnap,
  };
}

export async function webPerformAction(
  sessionId: string,
  params: {
    url?: string;
    clickLinkText?: string;
    formIndex?: number;
    fields?: Record<string, string>;
  }
): Promise<WebPageSnapshot> {
  let current = lastSnapshots.get(sessionId);
  if (params.url) {
    current = await webNavigate(sessionId, params.url);
  }
  if (!current) {
    throw new Error('Nenhuma página aberta nesta sessão web. Informe uma URL primeiro.');
  }

  if (params.clickLinkText) {
    const q = params.clickLinkText.toLowerCase();
    // Search hierarchical menu tree first (supports "Financeiro > Notas" or submenu labels)
    const flatMenu = flattenNavigationTree(current.navigationTree);
    const menuMatch = flatMenu.find(
      (m) => m.href && (m.path.toLowerCase().includes(q) || m.label.toLowerCase().includes(q) || m.href.toLowerCase().includes(q))
    );
    if (menuMatch?.href) {
      return webNavigate(sessionId, menuMatch.href);
    }

    const match = current.links.find(
      (l) => l.text.toLowerCase().includes(q) || l.href.toLowerCase().includes(q)
    );
    if (!match) {
      throw new Error(`Link ou sub-menu "${params.clickLinkText}" não encontrado na página atual.`);
    }
    return webNavigate(sessionId, match.href);
  }

  const form = current.forms[params.formIndex ?? 0];
  if (!form) {
    throw new Error('Formulário não encontrado na página atual.');
  }

  const payload = new URLSearchParams();
  for (const fld of form.fields) {
    if (!fld.name) continue;
    if (fld.type === 'hidden' && fld.value !== undefined) {
      payload.set(fld.name, fld.value);
    }
  }
  for (const [k, v] of Object.entries(params.fields || {})) {
    payload.set(k, String(v));
  }

  if (form.method === 'GET') {
    const dest = new URL(form.action);
    for (const [k, v] of payload.entries()) dest.searchParams.set(k, v);
    return webNavigate(sessionId, dest.toString());
  }

  const res = await fetchWithCookieRedirects(sessionId, form.action, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Origin: new URL(current.url).origin,
      Referer: current.url,
    },
    body: payload.toString(),
  });
  return parseHtmlToSnapshot(sessionId, res.finalUrl, res.status, res.html, res.contentType);
}

export function getLastWebSnapshot(sessionId: string): WebPageSnapshot | null {
  return lastSnapshots.get(sessionId) || null;
}

export function clearWebSession(sessionId: string): void {
  sessionCookies.delete(sessionId);
  lastSnapshots.delete(sessionId);
}
