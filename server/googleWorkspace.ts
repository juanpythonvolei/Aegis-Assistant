export interface GoogleApiResult {
  ok: boolean;
  status: number;
  data: unknown;
  error?: string;
}

async function googleFetch(
  accessToken: string,
  url: string,
  init: RequestInit = {}
): Promise<GoogleApiResult> {
  const headers = new Headers(init.headers || {});
  headers.set('Authorization', `Bearer ${accessToken}`);
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(url, { ...init, headers });
  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = { raw: text };
  }

  if (!res.ok) {
    const errObj = parsed as { error?: { message?: string } };
    return {
      ok: false,
      status: res.status,
      data: parsed,
      error: errObj?.error?.message || `Google API HTTP ${res.status}`,
    };
  }

  return { ok: true, status: res.status, data: parsed };
}

function encodeBase64Url(str: string): string {
  return Buffer.from(str, 'utf-8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function decodeBase64Url(b64: string): string {
  const norm = b64.replace(/-/g, '+').replace(/_/g, '/');
  const pad = norm.length % 4 === 0 ? '' : '='.repeat(4 - (norm.length % 4));
  return Buffer.from(norm + pad, 'base64').toString('utf-8');
}

// ==========================================
// GMAIL
// ==========================================

export async function gmailListMessages(accessToken: string, query = '', maxResults = 12) {
  const qs = new URLSearchParams({ maxResults: String(Math.min(maxResults, 20)) });
  if (query.trim()) qs.set('q', query.trim());

  const listRes = await googleFetch(
    accessToken,
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?${qs.toString()}`
  );
  if (!listRes.ok) return listRes;

  const listData = listRes.data as { messages?: Array<{ id: string; threadId: string }> };
  const messages = listData.messages || [];

  const details = await Promise.all(
    messages.slice(0, 15).map(async (m) => {
      const msgRes = await googleFetch(
        accessToken,
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Date`
      );
      if (!msgRes.ok) return { id: m.id, threadId: m.threadId, snippet: '', subject: '(Erro ao carregar)', from: '', to: '', date: '', labels: [] as string[] };
      const d = msgRes.data as {
        id: string;
        threadId: string;
        snippet?: string;
        labelIds?: string[];
        payload?: { headers?: Array<{ name: string; value: string }> };
      };
      const hdrs = d.payload?.headers || [];
      const getH = (name: string) => hdrs.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || '';
      return {
        id: d.id,
        threadId: d.threadId,
        subject: getH('Subject') || '(Sem assunto)',
        from: getH('From'),
        to: getH('To'),
        date: getH('Date'),
        snippet: d.snippet || '',
        labels: d.labelIds || [],
      };
    })
  );

  return { ok: true, status: 200, data: { messages: details } };
}

interface GmailPart {
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailPart[];
}

function extractGmailBody(part?: GmailPart): { text: string; html: string } {
  if (!part) return { text: '', html: '' };
  let text = '';
  let html = '';

  if (part.mimeType === 'text/plain' && part.body?.data) {
    text = decodeBase64Url(part.body.data);
  } else if (part.mimeType === 'text/html' && part.body?.data) {
    html = decodeBase64Url(part.body.data);
  }

  if (Array.isArray(part.parts)) {
    for (const sub of part.parts) {
      const res = extractGmailBody(sub);
      if (res.text && !text) text = res.text;
      if (res.html && !html) html = res.html;
    }
  }
  return { text, html };
}

export async function gmailGetMessageFull(accessToken: string, messageId: string) {
  const res = await googleFetch(
    accessToken,
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}?format=full`
  );
  if (!res.ok) return res;

  const d = res.data as {
    id: string;
    threadId: string;
    snippet?: string;
    labelIds?: string[];
    payload?: GmailPart & { headers?: Array<{ name: string; value: string }> };
  };
  const hdrs = d.payload?.headers || [];
  const getH = (name: string) => hdrs.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || '';
  const extracted = extractGmailBody(d.payload);
  const fallbackBody = extracted.html
    ? extracted.html.replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    : d.snippet || '';

  return {
    ok: true,
    status: 200,
    data: {
      id: d.id,
      threadId: d.threadId,
      subject: getH('Subject') || '(Sem assunto)',
      from: getH('From'),
      to: getH('To'),
      date: getH('Date'),
      snippet: d.snippet || '',
      labels: d.labelIds || [],
      bodyText: extracted.text || fallbackBody,
    },
  };
}

export async function gmailModifyLabels(
  accessToken: string,
  messageId: string,
  addLabelIds: string[] = [],
  removeLabelIds: string[] = []
) {
  return googleFetch(
    accessToken,
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}/modify`,
    {
      method: 'POST',
      body: JSON.stringify({ addLabelIds, removeLabelIds }),
    }
  );
}

export async function gmailSendEmail(
  accessToken: string,
  to: string,
  subject: string,
  body: string,
  threadId?: string
) {
  const rawMessage = [
    `To: ${to}`,
    `Subject: =?UTF-8?B?${Buffer.from(subject, 'utf-8').toString('base64')}?=`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    '',
    body,
  ].join('\r\n');

  const payload: Record<string, string> = { raw: encodeBase64Url(rawMessage) };
  if (threadId) payload.threadId = threadId;

  return googleFetch(accessToken, 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function gmailTrashMessage(accessToken: string, messageId: string) {
  return googleFetch(
    accessToken,
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}/trash`,
    { method: 'POST' }
  );
}

// ==========================================
// GOOGLE DRIVE
// ==========================================

export async function driveListFiles(
  accessToken: string,
  query = '',
  pageSize = 50,
  folderId?: string
) {
  const qs = new URLSearchParams({
    pageSize: String(Math.min(pageSize, 100)),
    fields: 'files(id,name,mimeType,modifiedTime,size,parents,webViewLink,iconLink,owners(displayName,emailAddress))',
    orderBy: 'folder,name',
    includeItemsFromAllDrives: 'true',
    supportsAllDrives: 'true',
  });
  const qParts = ['trashed = false'];
  if (query.trim()) {
    const escaped = query.trim().replace(/'/g, "\\'");
    qParts.push(`name contains '${escaped}'`);
  } else if (folderId) {
    const escapedParent = folderId.replace(/'/g, "\\'");
    qParts.push(`'${escapedParent}' in parents`);
  }
  qs.set('q', qParts.join(' and '));

  return googleFetch(accessToken, `https://www.googleapis.com/drive/v3/files?${qs.toString()}`);
}

export async function driveGetFileMetadata(accessToken: string, fileId: string) {
  const qs = new URLSearchParams({
    fields: 'id,name,mimeType,modifiedTime,size,parents,webViewLink,description,owners(displayName,emailAddress)',
    supportsAllDrives: 'true',
  });
  return googleFetch(
    accessToken,
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?${qs.toString()}`
  );
}

export async function driveOpenFile(
  accessToken: string,
  fileId: string,
  requestedSheet?: string
): Promise<GoogleApiResult> {
  const metaRes = await driveGetFileMetadata(accessToken, fileId);
  if (!metaRes.ok) return metaRes;

  const meta = metaRes.data as {
    id: string;
    name: string;
    mimeType: string;
    modifiedTime?: string;
    size?: string;
    parents?: string[];
    webViewLink?: string;
    description?: string;
    owners?: Array<{ displayName?: string; emailAddress?: string }>;
  };

  const mime = meta.mimeType || '';

  if (mime === 'application/vnd.google-apps.folder') {
    const childrenRes = await driveListFiles(accessToken, '', 100, meta.id);
    const children = childrenRes.ok ? ((childrenRes.data as { files?: unknown[] }).files || []) : [];
    return {
      ok: true,
      status: 200,
      data: {
        ...meta,
        kind: 'folder',
        editable: false,
        children,
      },
    };
  }

  if (mime === 'application/vnd.google-apps.document') {
    const docRes = await docsReadDocument(accessToken, meta.id);
    if (!docRes.ok) return docRes;
    const textContent = docsExtractPlainText(docRes.data);
    return {
      ok: true,
      status: 200,
      data: {
        ...meta,
        kind: 'doc',
        editable: true,
        hasMediaPreview: true,
        defaultExportMime: 'application/pdf',
        textContent,
      },
    };
  }

  if (mime === 'application/vnd.google-apps.spreadsheet') {
    const sheetRes = await sheetsGetSpreadsheetFull(accessToken, meta.id, requestedSheet);
    if (!sheetRes.ok) return sheetRes;
    return {
      ok: true,
      status: 200,
      data: {
        ...meta,
        kind: 'sheet',
        editable: true,
        hasMediaPreview: true,
        defaultExportMime: 'application/pdf',
        ...(sheetRes.data as object),
      },
    };
  }

  if (mime === 'application/vnd.google-apps.presentation') {
    const exportRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(meta.id)}/export?mimeType=text/plain`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const slideText = exportRes.ok ? await exportRes.text() : '(Não foi possível exportar o texto dos slides.)';
    return {
      ok: true,
      status: 200,
      data: {
        ...meta,
        kind: 'slides',
        editable: false,
        hasMediaPreview: true,
        defaultExportMime: 'application/pdf',
        textContent: slideText.slice(0, 120_000),
      },
    };
  }

  if (mime === 'application/vnd.google-apps.drawing') {
    return {
      ok: true,
      status: 200,
      data: {
        ...meta,
        kind: 'image',
        editable: false,
        hasMediaPreview: true,
        defaultExportMime: 'image/png',
      },
    };
  }

  const isTextLike =
    mime.startsWith('text/') ||
    mime === 'application/json' ||
    mime === 'application/javascript' ||
    mime === 'application/xml' ||
    mime === 'application/x-sh' ||
    mime === 'image/svg+xml' ||
    /\.(txt|md|markdown|json|csv|tsv|ts|tsx|js|jsx|mjs|cjs|py|sh|bash|zsh|yaml|yml|toml|ini|conf|cfg|log|html|htm|css|scss|sql|xml|svg|env)$/i.test(meta.name);

  if (isTextLike) {
    const mediaRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(meta.id)}?alt=media&supportsAllDrives=true`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!mediaRes.ok) {
      return { ok: false, status: mediaRes.status, data: null, error: `Falha ao baixar conteúdo (${mediaRes.status})` };
    }
    const textContent = (await mediaRes.text()).slice(0, 250_000);
    return {
      ok: true,
      status: 200,
      data: {
        ...meta,
        kind: 'text',
        editable: true,
        textContent,
      },
    };
  }

  if (mime === 'application/pdf' || /\.pdf$/i.test(meta.name)) {
    return {
      ok: true,
      status: 200,
      data: {
        ...meta,
        kind: 'pdf',
        editable: false,
        hasMediaPreview: true,
      },
    };
  }

  if (mime.startsWith('image/')) {
    return {
      ok: true,
      status: 200,
      data: {
        ...meta,
        kind: 'image',
        editable: false,
        hasMediaPreview: true,
      },
    };
  }

  if (mime.startsWith('audio/')) {
    return {
      ok: true,
      status: 200,
      data: {
        ...meta,
        kind: 'audio',
        editable: false,
        hasMediaPreview: true,
      },
    };
  }

  if (mime.startsWith('video/')) {
    return {
      ok: true,
      status: 200,
      data: {
        ...meta,
        kind: 'video',
        editable: false,
        hasMediaPreview: true,
      },
    };
  }

  return {
    ok: true,
    status: 200,
    data: {
      ...meta,
      kind: 'binary',
      editable: false,
      hasMediaPreview: false,
    },
  };
}

export async function driveDownloadOrExportMedia(
  accessToken: string,
  fileId: string,
  exportMime?: string
): Promise<{ ok: boolean; status: number; contentType: string; buffer: Buffer; error?: string }> {
  const url = exportMime
    ? `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/export?mimeType=${encodeURIComponent(exportMime)}`
    : `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    return {
      ok: false,
      status: res.status,
      contentType: 'application/json',
      buffer: Buffer.alloc(0),
      error: errText || `Drive Media HTTP ${res.status}`,
    };
  }
  const buf = Buffer.from(await res.arrayBuffer());
  return {
    ok: true,
    status: 200,
    contentType: res.headers.get('content-type') || exportMime || 'application/octet-stream',
    buffer: buf,
  };
}

export async function driveCreateFolder(accessToken: string, name: string, parentId?: string) {
  const body: Record<string, unknown> = {
    name,
    mimeType: 'application/vnd.google-apps.folder',
  };
  if (parentId && parentId !== 'root') body.parents = [parentId];

  return googleFetch(accessToken, 'https://www.googleapis.com/drive/v3/files?supportsAllDrives=true', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function driveRenameFile(accessToken: string, fileId: string, newName: string) {
  return googleFetch(
    accessToken,
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType&supportsAllDrives=true`,
    {
      method: 'PATCH',
      body: JSON.stringify({ name: newName }),
    }
  );
}

export async function driveUpdateTextFile(
  accessToken: string,
  fileId: string,
  content: string,
  mimeType = 'text/plain'
): Promise<GoogleApiResult> {
  const res = await fetch(
    `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(fileId)}?uploadType=media&supportsAllDrives=true`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': `${mimeType}; charset=UTF-8`,
      },
      body: content,
    }
  );
  const text = await res.text();
  let parsed: unknown = {};
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = { raw: text };
  }
  if (!res.ok) {
    const errObj = parsed as { error?: { message?: string } };
    return {
      ok: false,
      status: res.status,
      data: parsed,
      error: errObj?.error?.message || `Google Drive Upload HTTP ${res.status}`,
    };
  }
  return { ok: true, status: res.status, data: parsed };
}

export async function driveMoveFile(accessToken: string, fileId: string, targetFolderId: string) {
  const meta = await googleFetch(
    accessToken,
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=parents&supportsAllDrives=true`
  );
  if (!meta.ok) return meta;
  const currentParents = ((meta.data as { parents?: string[] }).parents || []).join(',');
  const qs = new URLSearchParams({
    addParents: targetFolderId,
    fields: 'id,name,parents',
    supportsAllDrives: 'true',
  });
  if (currentParents) qs.set('removeParents', currentParents);

  return googleFetch(
    accessToken,
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?${qs.toString()}`,
    { method: 'PATCH', body: JSON.stringify({}) }
  );
}

export async function driveDeleteFile(accessToken: string, fileId: string) {
  return googleFetch(
    accessToken,
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?supportsAllDrives=true`,
    {
      method: 'PATCH',
      body: JSON.stringify({ trashed: true }),
    }
  );
}

export async function driveEnsureFolderPath(
  accessToken: string,
  folderPath: string
): Promise<{ ok: boolean; folderId?: string; folderPath: string; createdSegments: string[]; error?: string }> {
  const segments = folderPath
    .split('/')
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s !== '.' && s !== '..');

  if (segments.length === 0) {
    return { ok: true, folderId: 'root', folderPath: '/', createdSegments: [] };
  }

  let parentId = 'root';
  const createdSegments: string[] = [];

  for (const segment of segments) {
    const escapedName = segment.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const escapedParent = parentId.replace(/'/g, "\\'");
    const qs = new URLSearchParams({
      q: `trashed = false and mimeType = 'application/vnd.google-apps.folder' and name = '${escapedName}' and '${escapedParent}' in parents`,
      fields: 'files(id,name)',
      pageSize: '5',
      includeItemsFromAllDrives: 'true',
      supportsAllDrives: 'true',
    });

    const searchRes = await googleFetch(accessToken, `https://www.googleapis.com/drive/v3/files?${qs.toString()}`);
    if (!searchRes.ok) {
      return { ok: false, folderPath: segments.join('/'), createdSegments, error: searchRes.error };
    }

    const existing = ((searchRes.data as { files?: Array<{ id: string; name: string }> }).files || [])[0];
    if (existing?.id) {
      parentId = existing.id;
      continue;
    }

    const createRes = await driveCreateFolder(accessToken, segment, parentId);
    if (!createRes.ok) {
      return { ok: false, folderPath: segments.join('/'), createdSegments, error: createRes.error };
    }
    const createdId = (createRes.data as { id?: string }).id;
    if (!createdId) {
      return { ok: false, folderPath: segments.join('/'), createdSegments, error: `Falha ao criar pasta "${segment}" no Google Drive.` };
    }
    parentId = createdId;
    createdSegments.push(segment);
  }

  return {
    ok: true,
    folderId: parentId,
    folderPath: segments.join('/'),
    createdSegments,
  };
}

export async function driveUploadFileMultipart(
  accessToken: string,
  params: {
    name: string;
    mimeType: string;
    buffer: Buffer;
    parentFolderId?: string;
  }
): Promise<GoogleApiResult> {
  const boundary = `aegis_boundary_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const metadata: Record<string, unknown> = {
    name: params.name,
  };
  if (params.parentFolderId && params.parentFolderId !== 'root') {
    metadata.parents = [params.parentFolderId];
  }

  const preamble = Buffer.from(
    `--${boundary}\r\n` +
      'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
      `${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\n` +
      `Content-Type: ${params.mimeType || 'application/octet-stream'}\r\n\r\n`,
    'utf-8'
  );
  const closing = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf-8');
  const multipartBody = Buffer.concat([preamble, params.buffer, closing]);

  const res = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,name,mimeType,size,webViewLink,parents',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
        'Content-Length': String(multipartBody.length),
      },
      body: multipartBody,
    }
  );

  const text = await res.text();
  let parsed: unknown = {};
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = { raw: text };
  }
  if (!res.ok) {
    const errObj = parsed as { error?: { message?: string } };
    return {
      ok: false,
      status: res.status,
      data: parsed,
      error: errObj?.error?.message || `Google Drive Multipart Upload HTTP ${res.status}`,
    };
  }
  return { ok: true, status: res.status, data: parsed };
}

// ==========================================
// GOOGLE CALENDAR
// ==========================================

export async function calendarListEvents(accessToken: string, maxResults = 20) {
  const qs = new URLSearchParams({
    maxResults: String(Math.min(maxResults, 35)),
    singleEvents: 'true',
    orderBy: 'startTime',
    timeMin: new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
  });
  return googleFetch(
    accessToken,
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?${qs.toString()}`
  );
}

export async function calendarCreateEvent(
  accessToken: string,
  params: { summary: string; startIso: string; endIso: string; description?: string; location?: string }
) {
  return googleFetch(accessToken, 'https://www.googleapis.com/calendar/v3/calendars/primary/events', {
    method: 'POST',
    body: JSON.stringify({
      summary: params.summary,
      description: params.description || '',
      location: params.location || '',
      start: { dateTime: params.startIso },
      end: { dateTime: params.endIso },
    }),
  });
}

export async function calendarUpdateEvent(
  accessToken: string,
  eventId: string,
  params: { summary?: string; startIso?: string; endIso?: string; description?: string; location?: string }
) {
  const body: Record<string, unknown> = {};
  if (params.summary !== undefined) body.summary = params.summary;
  if (params.description !== undefined) body.description = params.description;
  if (params.location !== undefined) body.location = params.location;
  if (params.startIso) body.start = { dateTime: params.startIso };
  if (params.endIso) body.end = { dateTime: params.endIso };

  return googleFetch(
    accessToken,
    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify(body),
    }
  );
}

export async function calendarDeleteEvent(accessToken: string, eventId: string) {
  return googleFetch(
    accessToken,
    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`,
    { method: 'DELETE' }
  );
}

// ==========================================
// GOOGLE DOCS
// ==========================================

export function docsExtractPlainText(docData: unknown): string {
  const d = docData as {
    body?: {
      content?: Array<{
        paragraph?: { elements?: Array<{ textRun?: { content?: string } }> };
        table?: {
          tableRows?: Array<{
            tableCells?: Array<{
              content?: Array<{ paragraph?: { elements?: Array<{ textRun?: { content?: string } }> } }>;
            }>;
          }>;
        };
      }>;
    };
  };
  const blocks = d?.body?.content || [];
  const chunks: string[] = [];
  for (const el of blocks) {
    if (el.paragraph?.elements) {
      chunks.push(el.paragraph.elements.map((e) => e.textRun?.content || '').join(''));
    } else if (el.table?.tableRows) {
      for (const row of el.table.tableRows) {
        const rowCells = (row.tableCells || []).map((cell) =>
          (cell.content || [])
            .map((p) => (p.paragraph?.elements || []).map((e) => e.textRun?.content || '').join('').trim())
            .join(' ')
        );
        chunks.push(rowCells.join(' | ') + '\n');
      }
    }
  }
  return chunks.join('');
}

export async function docsCreateDocument(accessToken: string, title: string, initialText?: string) {
  const createRes = await googleFetch(accessToken, 'https://docs.googleapis.com/v1/documents', {
    method: 'POST',
    body: JSON.stringify({ title }),
  });
  if (!createRes.ok) return createRes;

  const doc = createRes.data as { documentId: string; title: string };
  if (initialText && initialText.trim()) {
    await docsAppendText(accessToken, doc.documentId, initialText);
  }
  return createRes;
}

export async function docsReadDocument(accessToken: string, documentId: string) {
  return googleFetch(accessToken, `https://docs.googleapis.com/v1/documents/${encodeURIComponent(documentId)}`);
}

export async function docsAppendText(accessToken: string, documentId: string, text: string) {
  return googleFetch(
    accessToken,
    `https://docs.googleapis.com/v1/documents/${encodeURIComponent(documentId)}:batchUpdate`,
    {
      method: 'POST',
      body: JSON.stringify({
        requests: [
          {
            insertText: {
              endOfSegmentLocation: { segmentId: '' },
              text: `${text}\n`,
            },
          },
        ],
      }),
    }
  );
}

export async function docsReplaceFullContent(accessToken: string, documentId: string, newText: string) {
  const docRes = await docsReadDocument(accessToken, documentId);
  if (!docRes.ok) return docRes;

  const doc = docRes.data as { body?: { content?: Array<{ endIndex?: number }> } };
  const elements = doc.body?.content || [];
  const lastEnd = elements.length ? (elements[elements.length - 1].endIndex || 1) : 1;

  const requests: Array<Record<string, unknown>> = [];
  if (lastEnd > 2) {
    requests.push({
      deleteContentRange: {
        range: { startIndex: 1, endIndex: lastEnd - 1 },
      },
    });
  }
  if (newText.length > 0) {
    requests.push({
      insertText: {
        location: { index: 1 },
        text: newText,
      },
    });
  }

  if (requests.length === 0) {
    return { ok: true, status: 200, data: { updated: true } };
  }

  return googleFetch(
    accessToken,
    `https://docs.googleapis.com/v1/documents/${encodeURIComponent(documentId)}:batchUpdate`,
    {
      method: 'POST',
      body: JSON.stringify({ requests }),
    }
  );
}

// ==========================================
// GOOGLE SHEETS
// ==========================================

export async function sheetsCreateSpreadsheet(accessToken: string, title: string) {
  return googleFetch(accessToken, 'https://sheets.googleapis.com/v4/spreadsheets', {
    method: 'POST',
    body: JSON.stringify({ properties: { title } }),
  });
}

export async function sheetsReadValues(accessToken: string, spreadsheetId: string, range = 'A1:Z50') {
  return googleFetch(
    accessToken,
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}`
  );
}

export async function sheetsGetSpreadsheetFull(
  accessToken: string,
  spreadsheetId: string,
  requestedSheet?: string
): Promise<GoogleApiResult> {
  const metaRes = await googleFetch(
    accessToken,
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=spreadsheetId,properties.title,sheets(properties(sheetId,title,gridProperties))`
  );
  if (!metaRes.ok) return metaRes;

  const meta = metaRes.data as {
    spreadsheetId: string;
    properties?: { title?: string };
    sheets?: Array<{ properties?: { sheetId?: number; title?: string } }>;
  };
  const sheetTabs = (meta.sheets || []).map((s) => s.properties?.title || 'Sheet1');
  const activeSheet = requestedSheet && sheetTabs.includes(requestedSheet) ? requestedSheet : sheetTabs[0] || 'Sheet1';
  const safeRange = `'${activeSheet.replace(/'/g, "''")}'!A1:Z100`;

  const valuesRes = await sheetsReadValues(accessToken, spreadsheetId, safeRange);
  const values = valuesRes.ok ? ((valuesRes.data as { values?: string[][] }).values || []) : [];

  return {
    ok: true,
    status: 200,
    data: {
      spreadsheetTitle: meta.properties?.title || 'Planilha',
      sheetTabs,
      activeSheet,
      sheetValues: values,
    },
  };
}

export async function sheetsUpdateRange(
  accessToken: string,
  spreadsheetId: string,
  range: string,
  values: string[][]
) {
  const qs = new URLSearchParams({ valueInputOption: 'USER_ENTERED' });
  return googleFetch(
    accessToken,
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?${qs.toString()}`,
    {
      method: 'PUT',
      body: JSON.stringify({ values }),
    }
  );
}

export async function sheetsAppendRows(
  accessToken: string,
  spreadsheetId: string,
  range: string,
  values: string[][]
) {
  const qs = new URLSearchParams({ valueInputOption: 'USER_ENTERED' });
  return googleFetch(
    accessToken,
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}:append?${qs.toString()}`,
    {
      method: 'POST',
      body: JSON.stringify({ values }),
    }
  );
}

// ==========================================
// GOOGLE TASKS
// ==========================================

export async function tasksListTasks(accessToken: string, showCompleted = true) {
  const qs = new URLSearchParams({
    showCompleted: showCompleted ? 'true' : 'false',
    showHidden: 'false',
    maxResults: '40',
  });
  return googleFetch(accessToken, `https://tasks.googleapis.com/tasks/v1/lists/@default/tasks?${qs.toString()}`);
}

export async function tasksCreateTask(
  accessToken: string,
  params: { title: string; notes?: string; dueIso?: string }
) {
  const body: Record<string, unknown> = { title: params.title };
  if (params.notes) body.notes = params.notes;
  if (params.dueIso) body.due = params.dueIso;

  return googleFetch(accessToken, 'https://tasks.googleapis.com/tasks/v1/lists/@default/tasks', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function tasksUpdateTask(
  accessToken: string,
  taskId: string,
  params: { title?: string; notes?: string; dueIso?: string | null; status?: 'needsAction' | 'completed' }
) {
  const body: Record<string, unknown> = {};
  if (params.title !== undefined) body.title = params.title;
  if (params.notes !== undefined) body.notes = params.notes;
  if (params.dueIso !== undefined) body.due = params.dueIso || null;
  if (params.status !== undefined) body.status = params.status;

  return googleFetch(
    accessToken,
    `https://tasks.googleapis.com/tasks/v1/lists/@default/tasks/${encodeURIComponent(taskId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify(body),
    }
  );
}

export async function tasksCompleteTask(accessToken: string, taskId: string) {
  return tasksUpdateTask(accessToken, taskId, { status: 'completed' });
}

export async function tasksDeleteTask(accessToken: string, taskId: string) {
  return googleFetch(
    accessToken,
    `https://tasks.googleapis.com/tasks/v1/lists/@default/tasks/${encodeURIComponent(taskId)}`,
    { method: 'DELETE' }
  );
}
