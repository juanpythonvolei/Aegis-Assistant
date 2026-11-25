import { GoogleGenAI, Type } from '@google/genai';
import * as gw from './googleWorkspace.ts';
import * as linux from './linuxRuntime.ts';
import * as memory from './memory.ts';
import * as webBrowser from './webBrowser.ts';

export interface SemanticMenuUnderstanding {
  path: string;
  label: string;
  href: string;
  kind: string;
  purpose: string;
  likelyHasAttachments: boolean;
}

export interface SiteMenuMapResult {
  snapshot: webBrowser.WebPageSnapshot;
  siteOverview: string;
  understoodMenus: SemanticMenuUnderstanding[];
  attachments: webBrowser.DetectedAttachment[];
}

export interface RoutineExecutionResult {
  ok: boolean;
  runId: number;
  routineId: number | null;
  routineName: string;
  status: 'ok' | 'partial' | 'error';
  summary: string;
  visitedSections: Array<{
    url: string;
    title: string;
    sectionPath: string;
    understanding: string;
  }>;
  extractedData: Array<{
    section: string;
    url: string;
    summary: string;
    items: Array<{ label: string; value: string }>;
    tablesCount: number;
  }>;
  downloadedFiles: Array<{
    fileName: string;
    localRelativePath: string;
    sizeBytes: number;
    mimeType: string;
    section: string;
    sourceUrl: string;
  }>;
  driveUploads: Array<{
    fileName: string;
    driveFileId: string;
    driveFolderPath: string;
    webViewLink?: string;
  }>;
  reportLocalPath?: string;
  logs: string[];
  latencyMs: number;
}

const PLANNER_MODEL = 'gemini-4-hydrogen';

function getAiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function slugifySegment(raw: string): string {
  return (
    raw
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9_-]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 48) || 'Geral'
  );
}

function parseAllowedExtensions(extStr: string): Set<string> {
  const list = (extStr || '')
    .split(/[,;\s]+/)
    .map((e) => e.trim().replace(/^\./, '').toLowerCase())
    .filter(Boolean);
  return new Set(list);
}

export async function mapSiteSubmenusWithAI(
  sessionId: string,
  params: {
    url?: string;
    credentialId?: string | number;
  }
): Promise<SiteMenuMapResult> {
  let snapshot: webBrowser.WebPageSnapshot | null = null;

  if (params.credentialId !== undefined && String(params.credentialId).trim()) {
    const loginRes = await webBrowser.webLoginWithCredential(sessionId, {
      siteOrCredentialId: String(params.credentialId),
      loginUrl: params.url?.trim() || undefined,
    });
    snapshot = loginRes.snapshot;
    if (params.url?.trim() && snapshot.url !== params.url.trim()) {
      try {
        const currentOrigin = new URL(snapshot.url).origin;
        const targetOrigin = new URL(params.url.trim()).origin;
        if (currentOrigin === targetOrigin && !params.url.toLowerCase().includes('login')) {
          snapshot = await webBrowser.webNavigate(sessionId, params.url.trim());
        }
      } catch {
        // keep post-login snapshot
      }
    }
  } else if (params.url?.trim()) {
    snapshot = await webBrowser.webNavigate(sessionId, params.url.trim());
  } else {
    snapshot = webBrowser.getLastWebSnapshot(sessionId);
  }

  if (!snapshot) {
    throw new Error('Informe uma URL ou credencial para mapear os menus e sub-menus do site.');
  }

  const flatMenus = webBrowser.flattenNavigationTree(snapshot.navigationTree).slice(0, 45);
  const ai = getAiClient();

  if (!ai || flatMenus.length === 0) {
    return {
      snapshot,
      siteOverview:
        flatMenus.length > 0
          ? `Portal "${snapshot.title}" com ${flatMenus.length} item(ns) de menu/sub-menu e ${snapshot.attachments.length} anexo(s) detectado(s).`
          : `Página "${snapshot.title}" carregada (${snapshot.links.length} link(s) e ${snapshot.attachments.length} anexo(s)).`,
      understoodMenus: flatMenus.map((m) => ({
        path: m.path,
        label: m.label,
        href: m.href,
        kind: m.kind,
        purpose: `Seção ${m.kind === 'tab' ? 'de aba' : m.level > 0 ? 'de sub-menu' : 'principal'} "${m.path}"`,
        likelyHasAttachments: /anexo|doc|pdf|relat|fatura|boleto|nota|arquivo|download/i.test(m.path),
      })),
      attachments: snapshot.attachments,
    };
  }

  try {
    const prompt = [
      'Você é o motor de compreensão semântica de navegação web do Aegis.',
      'Analise a árvore hierárquica de menus, sub-menus, abas e anexos extraídos da página abaixo e explique em português claro o propósito de cada subseção para que o usuário e o agente saibam exatamente onde encontrar dados e arquivos.',
      `Título: ${snapshot.title}`,
      `URL: ${snapshot.url}`,
      `Breadcrumbs: ${snapshot.breadcrumbs.join(' > ') || 'Nenhum'}`,
      `Cabeçalhos: ${snapshot.headings.slice(0, 12).join(' | ')}`,
      `Menus/Sub-menus/Abas detectados:\n${JSON.stringify(flatMenus, null, 2)}`,
      `Anexos visíveis nesta página:\n${JSON.stringify(snapshot.attachments.slice(0, 15), null, 2)}`,
    ].join('\n\n');

    const response = await ai.models.generateContent({
      model: PLANNER_MODEL,
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            siteOverview: { type: Type.STRING },
            understoodMenus: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  path: { type: Type.STRING },
                  label: { type: Type.STRING },
                  href: { type: Type.STRING },
                  kind: { type: Type.STRING },
                  purpose: { type: Type.STRING },
                  likelyHasAttachments: { type: Type.BOOLEAN },
                },
                required: ['path', 'label', 'href', 'kind', 'purpose', 'likelyHasAttachments'],
              },
            },
          },
          required: ['siteOverview', 'understoodMenus'],
        },
      },
    });

    const parsed = JSON.parse(response.text || '{}') as {
      siteOverview?: string;
      understoodMenus?: SemanticMenuUnderstanding[];
    };

    return {
      snapshot,
      siteOverview: parsed.siteOverview || `Portal "${snapshot.title}" mapeado com sucesso.`,
      understoodMenus: Array.isArray(parsed.understoodMenus) ? parsed.understoodMenus : [],
      attachments: snapshot.attachments,
    };
  } catch {
    return {
      snapshot,
      siteOverview: `Portal "${snapshot.title}" mapeado (${flatMenus.length} menus/sub-menus e ${snapshot.attachments.length} anexos).`,
      understoodMenus: flatMenus.map((m) => ({
        path: m.path,
        label: m.label,
        href: m.href,
        kind: m.kind,
        purpose: `Acesso à seção "${m.path}"`,
        likelyHasAttachments: /anexo|doc|pdf|relat|fatura|boleto|nota|arquivo|download/i.test(m.path),
      })),
      attachments: snapshot.attachments,
    };
  }
}

interface PlannerStepDecision {
  sectionUnderstanding: string;
  matchedTargetSection: string;
  extractedSummary: string;
  extractedItems: Array<{ label: string; value: string }>;
  attachmentsToDownload: Array<{ href: string; reason: string }>;
  nextAction: 'navigate' | 'submit_form' | 'done';
  nextUrl: string;
  formIndex: number;
  formFieldsJson: string;
}

async function planNextNavigationStep(params: {
  snapshot: webBrowser.WebPageSnapshot;
  targetSections: string[];
  completedTargets: string[];
  visitedUrls: string[];
  extractionInstructions: string;
  downloadAttachments: boolean;
  allowedExtensions: string;
  stepNumber: number;
  maxSteps: number;
}): Promise<PlannerStepDecision> {
  const flatMenus = webBrowser.flattenNavigationTree(params.snapshot.navigationTree).slice(0, 50);
  const candidateLinks = params.snapshot.links.slice(0, 45);
  const ai = getAiClient();

  // Heuristic fallback if Gemini key is unavailable
  if (!ai) {
    const remaining = params.targetSections.filter((t) => !params.completedTargets.includes(t));
    let nextUrl = '';
    for (const target of remaining) {
      const tokens = target
        .toLowerCase()
        .split(/[>\s/,-]+/)
        .filter((w) => w.length >= 3);
      const foundMenu = flatMenus.find(
        (m) =>
          m.href &&
          !params.visitedUrls.includes(m.href) &&
          tokens.some((tok) => m.path.toLowerCase().includes(tok) || m.label.toLowerCase().includes(tok))
      );
      if (foundMenu?.href) {
        nextUrl = foundMenu.href;
        break;
      }
      const foundLink = candidateLinks.find(
        (l) => !params.visitedUrls.includes(l.href) && tokens.some((tok) => l.text.toLowerCase().includes(tok))
      );
      if (foundLink?.href) {
        nextUrl = foundLink.href;
        break;
      }
    }

    return {
      sectionUnderstanding: `Seção "${params.snapshot.title}" (${params.snapshot.breadcrumbs.join(' > ') || 'Raiz'})`,
      matchedTargetSection: remaining[0] || params.snapshot.title,
      extractedSummary: params.snapshot.textPreview.slice(0, 600),
      extractedItems: [],
      attachmentsToDownload: params.downloadAttachments
        ? params.snapshot.attachments.slice(0, 8).map((a) => ({ href: a.href, reason: a.label }))
        : [],
      nextAction: nextUrl ? 'navigate' : 'done',
      nextUrl,
      formIndex: 0,
      formFieldsJson: '{}',
    };
  }

  const prompt = [
    'Você é o Navegador Semântico Autônomo do Aegis.',
    'Seu objetivo é navegar por menus, sub-menus e abas de um site, compreender cada subseção visitada, extrair as informações solicitadas e escolher quais anexos devem ser baixados.',
    `Passo atual: ${params.stepNumber} de ${params.maxSteps}.`,
    `Sub-menus / seções alvo solicitadas pelo usuário: ${JSON.stringify(params.targetSections)}`,
    `Seções alvo JÁ concluídas: ${JSON.stringify(params.completedTargets)}`,
    `URLs já visitadas (NÃO repita a mesma URL): ${JSON.stringify(params.visitedUrls)}`,
    `Instruções de extração: ${params.extractionInstructions || 'Extrair resumo, valores principais, datas e tabelas relevantes.'}`,
    `Baixar anexos? ${params.downloadAttachments ? `SIM (extensões preferenciais: ${params.allowedExtensions})` : 'NÃO'}`,
    '',
    '=== PÁGINA ATUAL ===',
    `URL: ${params.snapshot.url}`,
    `Título: ${params.snapshot.title}`,
    `Breadcrumbs: ${params.snapshot.breadcrumbs.join(' > ') || 'Nenhum'}`,
    `Cabeçalhos: ${params.snapshot.headings.slice(0, 15).join(' | ')}`,
    `Árvore de Menus / Sub-menus / Abas:\n${JSON.stringify(flatMenus, null, 2)}`,
    `Links disponíveis:\n${JSON.stringify(candidateLinks.slice(0, 35), null, 2)}`,
    `Anexos detectados nesta página:\n${JSON.stringify(params.snapshot.attachments.slice(0, 25), null, 2)}`,
    `Formulários disponíveis:\n${JSON.stringify(params.snapshot.forms.slice(0, 4), null, 2)}`,
    `Tabelas (amostra):\n${JSON.stringify(params.snapshot.tables.slice(0, 3).map((t) => t.slice(0, 10)), null, 2)}`,
    `Texto da página:\n${params.snapshot.textPreview.slice(0, 3200)}`,
    '',
    'REGRAS:',
    '1. Escolha nextUrl EXATAMENTE igual a um href existente na Árvore de Menus ou Links disponíveis que ainda não esteja em visitedUrls.',
    '2. Se a página atual corresponde a uma das seções alvo (mesmo com sinônimo, ex: "Boletos" = "Faturas"), preencha matchedTargetSection com o nome dessa seção alvo, extraia os dados relevantes em extractedSummary/extractedItems e liste os attachmentsToDownload desejados.',
    '3. Se ainda restam seções alvo não concluídas e existe um menu/sub-menu/aba que leva até elas, defina nextAction="navigate" e informe nextUrl.',
    '4. Se todas as seções alvo já foram atendidas (ou não há mais sub-menus relevantes), defina nextAction="done".',
  ].join('\n');

  const response = await ai.models.generateContent({
    model: PLANNER_MODEL,
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          sectionUnderstanding: { type: Type.STRING },
          matchedTargetSection: { type: Type.STRING },
          extractedSummary: { type: Type.STRING },
          extractedItems: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                label: { type: Type.STRING },
                value: { type: Type.STRING },
              },
              required: ['label', 'value'],
            },
          },
          attachmentsToDownload: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                href: { type: Type.STRING },
                reason: { type: Type.STRING },
              },
              required: ['href', 'reason'],
            },
          },
          nextAction: { type: Type.STRING },
          nextUrl: { type: Type.STRING },
          formIndex: { type: Type.INTEGER },
          formFieldsJson: { type: Type.STRING },
        },
        required: [
          'sectionUnderstanding',
          'matchedTargetSection',
          'extractedSummary',
          'extractedItems',
          'attachmentsToDownload',
          'nextAction',
          'nextUrl',
          'formIndex',
          'formFieldsJson',
        ],
      },
    },
  });

  const parsed = JSON.parse(response.text || '{}') as Partial<PlannerStepDecision>;
  return {
    sectionUnderstanding: parsed.sectionUnderstanding || params.snapshot.title,
    matchedTargetSection: parsed.matchedTargetSection || '',
    extractedSummary: parsed.extractedSummary || '',
    extractedItems: Array.isArray(parsed.extractedItems) ? parsed.extractedItems : [],
    attachmentsToDownload: Array.isArray(parsed.attachmentsToDownload) ? parsed.attachmentsToDownload : [],
    nextAction:
      parsed.nextAction === 'navigate' || parsed.nextAction === 'submit_form' || parsed.nextAction === 'done'
        ? parsed.nextAction
        : 'done',
    nextUrl: parsed.nextUrl || '',
    formIndex: typeof parsed.formIndex === 'number' ? parsed.formIndex : 0,
    formFieldsJson: parsed.formFieldsJson || '{}',
  };
}

export async function downloadAndOrganizeSingleAttachment(params: {
  sessionId: string;
  fileUrl: string;
  preferredFilename?: string;
  localFolder?: string;
  driveFolder?: string;
  googleToken?: string;
}): Promise<{
  ok: boolean;
  localFile: {
    fileName: string;
    localRelativePath: string;
    sizeBytes: number;
    mimeType: string;
    sourceUrl: string;
  };
  driveUpload?: {
    ok: boolean;
    fileId?: string;
    driveFolderPath: string;
    webViewLink?: string;
    error?: string;
  };
}> {
  const downloaded = await webBrowser.webDownloadAttachment(params.sessionId, params.fileUrl, {
    localSubfolder: params.localFolder || 'Downloads/Portais',
    preferredFilename: params.preferredFilename,
  });

  let driveUpload:
    | {
        ok: boolean;
        fileId?: string;
        driveFolderPath: string;
        webViewLink?: string;
        error?: string;
      }
    | undefined;

  if (params.driveFolder?.trim()) {
    if (!params.googleToken) {
      driveUpload = {
        ok: false,
        driveFolderPath: params.driveFolder.trim(),
        error: 'Google Drive não conectado na sessão atual. Arquivo salvo apenas localmente.',
      };
    } else {
      const folderRes = await gw.driveEnsureFolderPath(params.googleToken, params.driveFolder.trim());
      if (!folderRes.ok || !folderRes.folderId) {
        driveUpload = {
          ok: false,
          driveFolderPath: params.driveFolder.trim(),
          error: folderRes.error || 'Falha ao garantir pasta no Google Drive.',
        };
      } else {
        const upRes = await gw.driveUploadFileMultipart(params.googleToken, {
          name: downloaded.fileName,
          mimeType: downloaded.mimeType,
          buffer: downloaded.buffer,
          parentFolderId: folderRes.folderId,
        });
        const uploadedData = (upRes.data || {}) as { id?: string; webViewLink?: string };
        driveUpload = {
          ok: upRes.ok,
          fileId: uploadedData.id,
          driveFolderPath: folderRes.folderPath,
          webViewLink: uploadedData.webViewLink,
          error: upRes.error,
        };
      }
    }
  }

  return {
    ok: true,
    localFile: {
      fileName: downloaded.fileName,
      localRelativePath: downloaded.localRelativePath,
      sizeBytes: downloaded.sizeBytes,
      mimeType: downloaded.mimeType,
      sourceUrl: downloaded.sourceUrl,
    },
    driveUpload,
  };
}

export interface InlineRoutineSpec {
  name: string;
  siteName?: string;
  credentialId?: number | string | null;
  startUrl: string;
  targetSections: string[];
  extractionInstructions?: string;
  downloadAttachments?: boolean;
  fileExtensions?: string;
  localFolder?: string;
  driveFolder?: string;
  autoOrganizeBySection?: boolean;
}

export async function runWebAutomationRoutine(params: {
  routineId?: number;
  inlineSpec?: InlineRoutineSpec;
  sessionId: string;
  googleToken?: string;
}): Promise<RoutineExecutionResult> {
  const startedAt = Date.now();
  const logs: string[] = [];

  let routineRecord: memory.WebRoutineRecord | null = null;
  if (params.routineId) {
    routineRecord = memory.getWebRoutineById(params.routineId);
    if (!routineRecord) {
      throw new Error(`Rotina web #${params.routineId} não encontrada.`);
    }
  }

  const spec: InlineRoutineSpec = routineRecord
    ? {
        name: routineRecord.name,
        siteName: routineRecord.site_name,
        credentialId: routineRecord.credential_id,
        startUrl: routineRecord.start_url,
        targetSections: (() => {
          try {
            return JSON.parse(routineRecord.target_sections_json) as string[];
          } catch {
            return [];
          }
        })(),
        extractionInstructions: routineRecord.extraction_instructions,
        downloadAttachments: routineRecord.download_attachments === 1,
        fileExtensions: routineRecord.file_extensions,
        localFolder: routineRecord.local_folder,
        driveFolder: routineRecord.drive_folder,
        autoOrganizeBySection: routineRecord.auto_organize_by_section === 1,
      }
    : params.inlineSpec!;

  if (!spec || !spec.startUrl) {
    throw new Error('Especificação de rotina inválida: URL inicial é obrigatória.');
  }

  const visitedSections: RoutineExecutionResult['visitedSections'] = [];
  const extractedData: RoutineExecutionResult['extractedData'] = [];
  const downloadedFiles: RoutineExecutionResult['downloadedFiles'] = [];
  const driveUploads: RoutineExecutionResult['driveUploads'] = [];
  const downloadedBuffers: Array<{ fileName: string; mimeType: string; buffer: Buffer; section: string }> = [];

  const visitedUrls: string[] = [];
  const completedTargets: string[] = [];
  const downloadedUrls = new Set<string>();
  const allowedExts = parseAllowedExtensions(spec.fileExtensions || 'pdf,xlsx,xls,csv,docx,zip,xml');
  const maxHops = 8;
  const maxDownloads = 12;

  try {
    let currentSnap: webBrowser.WebPageSnapshot;

    // Step 1: Login with saved credential if configured
    if (spec.credentialId !== undefined && spec.credentialId !== null && String(spec.credentialId).trim() !== '') {
      logs.push(`Autenticando usando credencial do cofre (${spec.credentialId})...`);
      const loginRes = await webBrowser.webLoginWithCredential(params.sessionId, {
        siteOrCredentialId: String(spec.credentialId),
      });
      logs.push(loginRes.message);
      currentSnap = loginRes.snapshot;

      // Navigate to explicit startUrl if different from login page
      if (spec.startUrl.trim() && spec.startUrl.trim() !== currentSnap.url) {
        const isLoginPageUrl = /login|signin|entrar|auth/i.test(spec.startUrl);
        if (!isLoginPageUrl) {
          logs.push(`Abrindo URL inicial da rotina: ${spec.startUrl}`);
          currentSnap = await webBrowser.webNavigate(params.sessionId, spec.startUrl);
        }
      }
    } else {
      logs.push(`Navegando para URL inicial: ${spec.startUrl}`);
      currentSnap = await webBrowser.webNavigate(params.sessionId, spec.startUrl);
    }

    // Step 2: Semantic Multi-Hop Menu/Sub-Menu Navigation & Extraction Loop
    for (let step = 1; step <= maxHops; step++) {
      if (!visitedUrls.includes(currentSnap.url)) {
        visitedUrls.push(currentSnap.url);
      }

      const menuCount = webBrowser.flattenNavigationTree(currentSnap.navigationTree).length;
      logs.push(
        `[Passo ${step}] Analisando "${currentSnap.title}" (${menuCount} itens de menu/sub-menu, ${currentSnap.attachments.length} anexos detectados).`
      );

      const decision = await planNextNavigationStep({
        snapshot: currentSnap,
        targetSections: spec.targetSections.length ? spec.targetSections : ['Página principal'],
        completedTargets,
        visitedUrls,
        extractionInstructions: spec.extractionInstructions || '',
        downloadAttachments: spec.downloadAttachments !== false,
        allowedExtensions: spec.fileExtensions || 'pdf,xlsx,xls,csv,docx,zip,xml',
        stepNumber: step,
        maxSteps: maxHops,
      });

      const sectionLabel =
        decision.matchedTargetSection ||
        (currentSnap.breadcrumbs.length ? currentSnap.breadcrumbs.join(' > ') : currentSnap.title);

      visitedSections.push({
        url: currentSnap.url,
        title: currentSnap.title,
        sectionPath: sectionLabel,
        understanding: decision.sectionUnderstanding,
      });

      if (decision.matchedTargetSection && !completedTargets.includes(decision.matchedTargetSection)) {
        completedTargets.push(decision.matchedTargetSection);
      }

      if (decision.extractedSummary || decision.extractedItems.length > 0 || currentSnap.tables.length > 0) {
        extractedData.push({
          section: sectionLabel,
          url: currentSnap.url,
          summary: decision.extractedSummary || currentSnap.textPreview.slice(0, 500),
          items: decision.extractedItems,
          tablesCount: currentSnap.tables.length,
        });
      }

      // Download attachments chosen by planner (plus fallback to matching extension attachments on matched sections)
      if (spec.downloadAttachments !== false && downloadedFiles.length < maxDownloads) {
        const chosenHrefs = new Set<string>(decision.attachmentsToDownload.map((a) => a.href));
        if (chosenHrefs.size === 0 && decision.matchedTargetSection && currentSnap.attachments.length > 0) {
          for (const att of currentSnap.attachments) {
            if (allowedExts.size === 0 || allowedExts.has(att.extension.toLowerCase())) {
              chosenHrefs.add(att.href);
            }
          }
        }

        for (const href of chosenHrefs) {
          if (downloadedFiles.length >= maxDownloads) break;
          if (downloadedUrls.has(href)) continue;
          const meta = currentSnap.attachments.find((a) => a.href === href);
          const ext = meta?.extension?.toLowerCase() || '';
          if (allowedExts.size > 0 && ext && ext !== 'bin' && !allowedExts.has(ext)) {
            continue;
          }

          downloadedUrls.add(href);
          const baseLocal = spec.localFolder || 'Downloads/Portais';
          const targetLocalSubfolder = spec.autoOrganizeBySection
            ? `${baseLocal}/${slugifySegment(spec.name)}/${slugifySegment(sectionLabel)}`
            : `${baseLocal}/${slugifySegment(spec.name)}`;

          try {
            const dl = await webBrowser.webDownloadAttachment(params.sessionId, href, {
              localSubfolder: targetLocalSubfolder,
              preferredFilename: meta?.filename,
            });
            downloadedFiles.push({
              fileName: dl.fileName,
              localRelativePath: dl.localRelativePath,
              sizeBytes: dl.sizeBytes,
              mimeType: dl.mimeType,
              section: sectionLabel,
              sourceUrl: dl.sourceUrl,
            });
            downloadedBuffers.push({
              fileName: dl.fileName,
              mimeType: dl.mimeType,
              buffer: dl.buffer,
              section: sectionLabel,
            });
            logs.push(`Anexo baixado e organizado localmente: ${dl.localRelativePath} (${dl.sizeBytes} bytes)`);
          } catch (dlErr) {
            logs.push(
              `Aviso ao baixar anexo (${href}): ${dlErr instanceof Error ? dlErr.message : 'erro desconhecido'}`
            );
          }
        }
      }

      if (decision.nextAction === 'done') {
        logs.push('Todas as subseções relevantes foram percorridas.');
        break;
      }

      if (decision.nextAction === 'submit_form') {
        try {
          const parsedFields = JSON.parse(decision.formFieldsJson || '{}') as Record<string, string>;
          logs.push(`Enviando formulário #${decision.formIndex} na seção atual...`);
          currentSnap = await webBrowser.webPerformAction(params.sessionId, {
            formIndex: decision.formIndex,
            fields: parsedFields,
          });
          continue;
        } catch (formErr) {
          logs.push(`Falha ao enviar formulário: ${formErr instanceof Error ? formErr.message : 'erro'}`);
          break;
        }
      }

      if (decision.nextAction === 'navigate' && decision.nextUrl) {
        if (visitedUrls.includes(decision.nextUrl)) {
          logs.push(`URL sugerida já visitada (${decision.nextUrl}); encerrando navegação.`);
          break;
        }
        logs.push(`Entrando em sub-menu/aba: ${decision.nextUrl}`);
        currentSnap = await webBrowser.webNavigate(params.sessionId, decision.nextUrl);
        continue;
      }

      break;
    }

    // Step 3: Save structured Markdown report locally
    const dateStamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    const reportRelPath = `${spec.localFolder || 'Downloads/Portais'}/${slugifySegment(spec.name)}/relatorio_${dateStamp}.md`;
    const reportMarkdown = [
      `# Relatório Autônomo Aegis — ${spec.name}`,
      `- **Data/Hora:** ${new Date().toLocaleString('pt-BR')}`,
      `- **URL Inicial:** ${spec.startUrl}`,
      `- **Subseções Visitadas:** ${visitedSections.length}`,
      `- **Anexos Baixados:** ${downloadedFiles.length}`,
      '',
      '## Mapa de Sub-Menus & Seções Visitadas',
      ...visitedSections.map((v, i) => `${i + 1}. **${v.sectionPath}** (${v.url}) — ${v.understanding}`),
      '',
      '## Dados Extraídos',
      ...extractedData.flatMap((ed) => [
        `### ${ed.section}`,
        ed.summary,
        ...ed.items.map((it) => `- **${it.label}:** ${it.value}`),
        '',
      ]),
      '## Arquivos Baixados & Organizados Localmente',
      ...(downloadedFiles.length
        ? downloadedFiles.map((f) => `- \`${f.localRelativePath}\` (${Math.max(1, Math.round(f.sizeBytes / 1024))} KB) — Seção: ${f.section}`)
        : ['- Nenhum anexo baixado nesta execução.']),
    ].join('\n');

    const savedReport = linux.writeLocalFile(reportRelPath, reportMarkdown);
    logs.push(`Relatório de extração salvo em: ${savedReport.path}`);

    // Step 4: Upload downloaded files + report to Google Drive if configured
    if (spec.driveFolder?.trim()) {
      if (!params.googleToken) {
        logs.push(
          `Pasta Google Drive configurada ("${spec.driveFolder}"), mas o Google Workspace não está conectado nesta sessão. Os arquivos foram mantidos organizados localmente.`
        );
      } else {
        const rootDrivePath = `${spec.driveFolder.trim()}/${slugifySegment(spec.name)}`;
        const rootFolderRes = await gw.driveEnsureFolderPath(params.googleToken, rootDrivePath);
        if (!rootFolderRes.ok || !rootFolderRes.folderId) {
          logs.push(`Erro ao preparar pasta no Google Drive: ${rootFolderRes.error || 'erro desconhecido'}`);
        } else {
          // Upload extraction report
          const reportUpload = await gw.driveUploadFileMultipart(params.googleToken, {
            name: `relatorio_${dateStamp}.md`,
            mimeType: 'text/markdown',
            buffer: Buffer.from(reportMarkdown, 'utf-8'),
            parentFolderId: rootFolderRes.folderId,
          });
          if (reportUpload.ok) {
            const d = (reportUpload.data || {}) as { id?: string; webViewLink?: string };
            driveUploads.push({
              fileName: `relatorio_${dateStamp}.md`,
              driveFileId: d.id || '',
              driveFolderPath: rootFolderRes.folderPath,
              webViewLink: d.webViewLink,
            });
          }

          // Upload every downloaded binary attachment
          for (const item of downloadedBuffers) {
            let parentId = rootFolderRes.folderId;
            let folderPathUsed = rootFolderRes.folderPath;

            if (spec.autoOrganizeBySection && item.section) {
              const secPath = `${rootDrivePath}/${slugifySegment(item.section)}`;
              const secFolder = await gw.driveEnsureFolderPath(params.googleToken, secPath);
              if (secFolder.ok && secFolder.folderId) {
                parentId = secFolder.folderId;
                folderPathUsed = secFolder.folderPath;
              }
            }

            const upRes = await gw.driveUploadFileMultipart(params.googleToken, {
              name: item.fileName,
              mimeType: item.mimeType,
              buffer: item.buffer,
              parentFolderId: parentId,
            });
            if (upRes.ok) {
              const d = (upRes.data || {}) as { id?: string; webViewLink?: string };
              driveUploads.push({
                fileName: item.fileName,
                driveFileId: d.id || '',
                driveFolderPath: folderPathUsed,
                webViewLink: d.webViewLink,
              });
              logs.push(`Enviado para Google Drive: ${folderPathUsed}/${item.fileName}`);
            } else {
              logs.push(`Falha ao enviar "${item.fileName}" ao Google Drive: ${upRes.error || 'erro'}`);
            }
          }
        }
      }
    }

    const latencyMs = Date.now() - startedAt;
    const status: 'ok' | 'partial' =
      spec.driveFolder?.trim() && !params.googleToken ? 'partial' : 'ok';
    const summary = `Rotina "${spec.name}" concluída: ${visitedSections.length} subseção(ões) analisada(s), ${downloadedFiles.length} anexo(s) baixado(s) localmente e ${driveUploads.length} arquivo(s) sincronizado(s) no Google Drive.`;

    const runRow = memory.logWebRoutineRun({
      routineId: routineRecord?.id ?? null,
      routineName: spec.name,
      status,
      visitedSections,
      extractedData,
      downloadedFiles,
      driveUploads,
      logs,
      summary,
      latencyMs,
    });

    if (routineRecord) {
      memory.updateWebRoutineStatus(routineRecord.id, status, summary);
    }

    return {
      ok: true,
      runId: runRow.id,
      routineId: routineRecord?.id ?? null,
      routineName: spec.name,
      status,
      summary,
      visitedSections,
      extractedData,
      downloadedFiles,
      driveUploads,
      reportLocalPath: savedReport.path,
      logs,
      latencyMs,
    };
  } catch (err) {
    const latencyMs = Date.now() - startedAt;
    const errMsg = err instanceof Error ? err.message : 'Erro inesperado ao executar rotina web.';
    logs.push(`ERRO: ${errMsg}`);
    const runRow = memory.logWebRoutineRun({
      routineId: routineRecord?.id ?? null,
      routineName: spec.name,
      status: 'error',
      visitedSections,
      extractedData,
      downloadedFiles,
      driveUploads,
      logs,
      summary: `Falha na rotina "${spec.name}": ${errMsg}`,
      latencyMs,
    });
    if (routineRecord) {
      memory.updateWebRoutineStatus(routineRecord.id, 'error', errMsg);
    }
    return {
      ok: false,
      runId: runRow.id,
      routineId: routineRecord?.id ?? null,
      routineName: spec.name,
      status: 'error',
      summary: `Falha na rotina "${spec.name}": ${errMsg}`,
      visitedSections,
      extractedData,
      downloadedFiles,
      driveUploads,
      logs,
      latencyMs,
    };
  }
}
