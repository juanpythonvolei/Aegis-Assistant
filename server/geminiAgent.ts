import { GoogleGenAI, ThinkingLevel, Type, type Content, type FunctionDeclaration } from '@google/genai';
import crypto from 'node:crypto';
import * as auth from './auth.ts';
import * as deviceHub from './deviceHub.ts';
import * as gw from './googleWorkspace.ts';
import * as linux from './linuxRuntime.ts';
import * as memory from './memory.ts';
import * as selfEvolution from './selfEvolution.ts';
import * as webBrowser from './webBrowser.ts';
import * as webRoutines from './webRoutines.ts';

let cachedAiClient: GoogleGenAI | null = null;
let cachedAiKey = '';

function getAi(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY?.trim() || '';
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY não configurada no ambiente do servidor.');
  }
  if (!cachedAiClient || cachedAiKey !== apiKey) {
    cachedAiKey = apiKey;
    cachedAiClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return cachedAiClient;
}

export type ModelPreference =
  | 'auto'
  | 'gemini-3.1-flash-lite'
  | 'gemini-4-hydrogen'
  | 'gemini-4-neon'
  | 'gemini-4-argon'
  | 'gemini-4-carbon';

export type ConcreteModelId = Exclude<ModelPreference, 'auto'>;

export type ComplexityTier = 'lite' | 'balanced' | 'advanced' | 'deep';

export interface ModelEscalationStep {
  fromModel: ConcreteModelId;
  toModel: ConcreteModelId;
  fromTier: ComplexityTier;
  toTier: ComplexityTier;
  reason: string;
  direction: 'up' | 'fallback';
  stage: 'preflight' | 'mid-turn' | 'fallback';
  timestamp: string;
}

export type AgentRoutingProgressEvent =
  | {
      event: 'routing_analyzing';
      data: { model: string; reason: string };
    }
  | {
      event: 'model_selected';
      data: {
        model: ConcreteModelId;
        tier: ComplexityTier;
        routingMode: 'auto' | 'manual';
        reason: string;
        escalatedFrom?: ConcreteModelId;
      };
    }
  | {
      event: 'tool_start';
      data: {
        tool: string;
        hop: number;
        model: ConcreteModelId;
        tier: ComplexityTier;
        routingMode: 'auto' | 'manual';
        reason: string;
      };
    }
  | {
      event: 'model_escalated';
      data: {
        fromModel: ConcreteModelId;
        toModel: ConcreteModelId;
        fromTier: ComplexityTier;
        toTier: ComplexityTier;
        reason: string;
        direction: 'up' | 'fallback';
        stage: 'preflight' | 'mid-turn' | 'fallback';
      };
    }
  | {
      event: 'plan_created';
      data: {
        planRationale: string;
        curatorModel: ConcreteModelId;
        curatorTier: ComplexityTier;
        subtasks: Array<{
          subagent: string;
          label: string;
          model: ConcreteModelId;
          objective: string;
        }>;
      };
    }
  | {
      event: 'thought';
      data: {
        source: string;
        role: 'decomposer' | 'worker' | 'curator';
        model: ConcreteModelId;
        text: string;
      };
    }
  | {
      event: 'tool_done';
      data: {
        tool: string;
        status: 'executed' | 'awaiting_confirmation' | 'error';
        subagent?: string;
        summary: string;
      };
    }
  | {
      event: 'curator_start';
      data: {
        model: ConcreteModelId;
        tier: ComplexityTier;
        workerCount: number;
        reason: string;
      };
    }
  | {
      event: 'subagent_start';
      data: {
        subagent: string;
        label: string;
        objective: string;
        model: ConcreteModelId;
        role?: 'worker' | 'specialist';
      };
    }
  | {
      event: 'subagent_done';
      data: {
        subagent: string;
        label: string;
        model: ConcreteModelId;
        status: 'ok' | 'error' | 'awaiting_confirmation';
        summary: string;
        stepsCount: number;
        latencyMs: number;
      };
    }
  | {
      event: 'code_evolution';
      data: {
        phase: 'synthesizing' | 'verified' | 'failed';
        capabilityName: string;
        version?: number;
        message: string;
      };
    };

export interface TurnUsageStats {
  model: ConcreteModelId;
  routingMode: 'auto' | 'manual';
  routingReason: string;
  complexityTier: ComplexityTier;
  promptTokens: number;
  outputTokens: number;
  thoughtsTokens: number;
  totalTokens: number;
  latencyMs: number;
  fallbackUsed: boolean;
  escalationTrail?: ModelEscalationStep[];
  workerModels?: ConcreteModelId[];
  curatorModel?: ConcreteModelId;
  subtasksCount?: number;
}

const TIER_TO_MODEL: Record<ComplexityTier, ConcreteModelId> = {
  lite: 'gemini-3.1-flash-lite',
  balanced: 'gemini-4-hydrogen',
  advanced: 'gemini-4-neon',
  deep: 'gemini-4-carbon',
};

const MODEL_TO_TIER: Record<ConcreteModelId, ComplexityTier> = {
  'gemini-3.1-flash-lite': 'lite',
  'gemini-4-hydrogen': 'balanced',
  'gemini-4-argon': 'advanced',
  'gemini-4-neon': 'advanced',
  'gemini-4-carbon': 'deep',
};

const FALLBACK_LADDER: ConcreteModelId[] = [
  'gemini-4-carbon',
  'gemini-4-neon',
  'gemini-4-argon',
  'gemini-4-hydrogen',
  'gemini-3.1-flash-lite',
];

function getThinkingConfigForModel(
  model: ConcreteModelId,
  tier: ComplexityTier = 'balanced'
): { thinkingLevel: ThinkingLevel; includeThoughts: boolean } | undefined {
  if (model === 'gemini-3.1-flash-lite') return undefined;
  if (model === 'gemini-4-hydrogen') {
    return {
      thinkingLevel: tier === 'advanced' || tier === 'deep' ? ThinkingLevel.MEDIUM : ThinkingLevel.LOW,
      includeThoughts: true,
    };
  }
  if (model === 'gemini-4-argon') {
    return {
      thinkingLevel: tier === 'deep' ? ThinkingLevel.MEDIUM : ThinkingLevel.LOW,
      includeThoughts: true,
    };
  }
  if (model === 'gemini-4-neon') {
    return {
      thinkingLevel: tier === 'deep' ? ThinkingLevel.HIGH : ThinkingLevel.MEDIUM,
      includeThoughts: true,
    };
  }
  if (model === 'gemini-4-carbon') return { thinkingLevel: ThinkingLevel.HIGH, includeThoughts: true };
  return undefined;
}

function extractThoughtTextsFromResponse(response: {
  candidates?: Array<{ content?: { parts?: Array<{ thought?: boolean; text?: string }> } }>;
}): string[] {
  const parts = response.candidates?.[0]?.content?.parts || [];
  const thoughts: string[] = [];
  for (const part of parts) {
    if (part.thought && typeof part.text === 'string' && part.text.trim()) {
      thoughts.push(part.text.trim());
    }
  }
  return thoughts;
}

function nextFallbackModel(current: ConcreteModelId, tried: Set<ConcreteModelId>): ConcreteModelId | null {
  const idx = FALLBACK_LADDER.indexOf(current);
  const start = idx >= 0 ? idx + 1 : 0;
  for (let i = start; i < FALLBACK_LADDER.length; i++) {
    const candidate = FALLBACK_LADDER[i];
    if (!tried.has(candidate)) return candidate;
  }
  return null;
}

function isModelEscalationFallbackError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err || '')).toLowerCase();
  return (
    msg.includes('429') ||
    msg.includes('403') ||
    msg.includes('404') ||
    msg.includes('503') ||
    msg.includes('resource_exhausted') ||
    msg.includes('quota') ||
    msg.includes('permission_denied') ||
    msg.includes('not_found') ||
    msg.includes('overloaded') ||
    msg.includes('unavailable') ||
    msg.includes('rate limit')
  );
}

interface HeuristicRouteScore {
  tier: ComplexityTier;
  score: number;
  confidence: 'high' | 'medium';
  reason: string;
}

function scorePromptComplexity(prompt: string, mode: 'reactive' | 'proactive'): HeuristicRouteScore {
  const trimmed = prompt.trim();
  const lower = trimmed.toLowerCase();
  const len = trimmed.length;
  const wordCount = trimmed.split(/\s+/).filter(Boolean).length;

  // Instant fast-path for trivial greetings / quick status queries
  const trivialRegex =
    /^(oi|olá|ola|bom dia|boa tarde|boa noite|tudo bem|e ai|e aí|fala|obrigado|valeu|ok|tchau|que horas|data de hoje|status|ping|teste|help|ajuda)[\s!?.]*$/i;
  if (mode === 'reactive' && trivialRegex.test(trimmed)) {
    return {
      tier: 'lite',
      score: 5,
      confidence: 'high',
      reason: 'Interação rápida/direta — mantido em Flash Lite para resposta instantânea e economia de tokens.',
    };
  }

  let score = 0;
  const matchedDomains: string[] = [];

  const deepSignals = [
    'arquitetura',
    'auditoria',
    'vulnerabilidade',
    'root cause',
    'causa raiz',
    'depuração profunda',
    'depurar',
    'debugar',
    'refatorar',
    'refatoração',
    'otimização',
    'plano estratégico',
    'estratégia completa',
    'prova matemática',
    'sistema distribuído',
    'segurança crítica',
    'microsserviço',
    'auto-evolução',
    'aperfeiçoar seu próprio código',
    'crie uma nova função no seu código',
  ];

  const advancedSignals = [
    'código',
    'codigo',
    'script',
    'python',
    'typescript',
    'javascript',
    'bash',
    'powershell',
    'sql',
    'algoritmo',
    'api',
    'html',
    'svg',
    'dashboard',
    'gráfico',
    'grafico',
    'diagrama',
    'fluxograma',
    'automatize',
    'automação',
    'correlacione',
    'compare',
    'relatório completo',
    'analise profundamente',
    'plano de ação',
    'crie um sistema',
    'construa',
    'desenvolva',
    'implemente',
    'calcule',
    'equação',
    'subagente',
    'orquestre',
    'orquestrar',
    'crie uma função',
    'crie uma ferramenta',
    'evolua',
  ];

  const balancedSignals = [
    'desenhe',
    'projete',
    'tela',
    'painel',
    'e-mail',
    'email',
    'gmail',
    'drive',
    'planilha',
    'sheets',
    'documento',
    'docs',
    'agenda',
    'calendar',
    'tarefa',
    'tasks',
    'site',
    'navegue',
    'acesse',
    'logar',
    'login',
    'extraia',
    'organize',
    'downloads',
    'mova',
    'edite',
    'escreva',
    'resuma',
    'pesquise',
    'abra',
    'arquivo',
    'pasta',
    'câmera',
    'camera',
    'android',
    'ios',
    'iphone',
    'ipad',
    'celular',
    'dispositivo',
    'adb',
    'termux',
  ];

  const multiStepSignals = [
    'primeiro',
    'depois',
    'em seguida',
    'além disso',
    'e também',
    'e então',
    'por fim',
    'passo a passo',
    'etapas',
  ];

  const deepHits = deepSignals.filter((k) => lower.includes(k));
  const advHits = advancedSignals.filter((k) => lower.includes(k));
  const balHits = balancedSignals.filter((k) => lower.includes(k));
  const multiStepHits = multiStepSignals.filter((k) => lower.includes(k));

  if (deepHits.length > 0) {
    score += 46 + Math.min(26, (deepHits.length - 1) * 14);
    matchedDomains.push('raciocínio profundo/arquitetura');
  }
  if (advHits.length > 0) {
    score += 28 + Math.min(22, (advHits.length - 1) * 8);
    matchedDomains.push('código/análise avançada');
  }
  if (balHits.length > 0) {
    score += 14 + Math.min(14, (balHits.length - 1) * 4);
    matchedDomains.push('ferramentas/telas/workspace');
  }
  if (multiStepHits.length > 0) {
    score += 14 + Math.min(12, (multiStepHits.length - 1) * 6);
    matchedDomains.push('orquestração multi-etapas');
  }

  // Structural complexity signals
  if (trimmed.includes('```') || /[{}[\];=>]{3,}/.test(trimmed)) {
    score += 20;
    matchedDomains.push('bloco técnico/código');
  }
  if (/https?:\/\/\S+/.test(trimmed)) {
    score += 10;
  }
  if (wordCount >= 45 || len >= 260) {
    score += 18;
  } else if (wordCount >= 24 || len >= 140) {
    score += 10;
  } else if (wordCount >= 14 || len >= 75) {
    score += 5;
  }

  if (mode === 'proactive') {
    score += 18;
    matchedDomains.push('varredura proativa');
  }

  // Cross-domain integration boost (e.g., Workspace + Local + Web or Screen)
  const domainCount = [
    /(gmail|drive|agenda|calendar|docs|sheets|tasks|planilha|email)/.test(lower),
    /(linux|windows|terminal|pasta|arquivo|disco|memória|cpu|comando|downloads)/.test(lower),
    /(site|url|http|web|navegue|extraia|login)/.test(lower),
    /(tela|painel|desenhe|projete|dashboard|diagrama|html)/.test(lower),
    /(android|ios|iphone|celular|dispositivo|adb|termux|notificaç)/.test(lower),
  ].filter(Boolean).length;

  if (domainCount >= 3) {
    score += 20;
    matchedDomains.push('integração entre múltiplos domínios');
  } else if (domainCount === 2) {
    score += 10;
  }

  if ((deepHits.length >= 1 && score >= 76) || score >= 104) {
    return {
      tier: 'deep',
      score,
      confidence: 'high',
      reason: `Alta complexidade (${matchedDomains.slice(0, 2).join(' + ') || 'raciocínio profundo'}) — escalonado para Carbon.`,
    };
  }
  if (score >= 52) {
    return {
      tier: 'advanced',
      score,
      confidence: score >= 62 ? 'high' : 'medium',
      reason: `Complexidade avançada (${matchedDomains.slice(0, 2).join(' + ') || 'análise/código'}) — escalonado para Neon.`,
    };
  }
  if (score >= 22) {
    return {
      tier: 'balanced',
      score,
      confidence: score >= 32 ? 'high' : 'medium',
      reason: `Tarefa operacional (${matchedDomains.slice(0, 2).join(' + ') || 'ferramentas/síntese'}) — escalonado para Hydrogen.`,
    };
  }
  return {
    tier: 'lite',
    score,
    confidence: wordCount <= 16 ? 'high' : 'medium',
    reason: 'Consulta direta e objetiva — roteado para Flash Lite com máxima economia de tokens.',
  };
}

export function estimateLongRunningMission(
  prompt: string,
  mode: 'reactive' | 'proactive'
): { shouldRunInBackground: boolean; reason: string } {
  const trimmed = prompt.trim();
  const lower = trimmed.toLowerCase();

  if (mode === 'proactive') {
    return { shouldRunInBackground: true, reason: 'Varredura proativa multi-domínio executada em segundo plano.' };
  }

  if (/\b(em segundo plano|segundo plano|background)\b/i.test(lower)) {
    return { shouldRunInBackground: true, reason: 'Execução em segundo plano solicitada diretamente.' };
  }

  const heavyPatterns = [
    /(mapeie|mapear|rotina web|sub-menu|submenu|baixe.*anexo|baixar.*anexo|extraia.*e.*organize)/,
    /(auto-evolução|aperfeiçoar seu próprio código|crie uma nova função no seu código|crie uma função.*código)/,
    /(auditoria completa|relatório completo|diagnóstico completo|analise profundamente|plano estratégico)/,
    /(orquestre|orquestrar|varredura)/,
  ];
  if (heavyPatterns.some((re) => re.test(lower))) {
    return {
      shouldRunInBackground: true,
      reason: 'Demanda multi-etapas / coleta profunda — iniciada em segundo plano para manter o chat livre.',
    };
  }

  const domainMatches = [
    /(linux|windows|terminal|pasta|arquivo|disco|downloads|logs|comando)/.test(lower),
    /(gmail|email|e-mail|drive|agenda|calendar|docs|sheets|planilha|tasks|tarefa)/.test(lower),
    /(site|url|http|web|portal|navegue|acesse|login)/.test(lower),
    /(desenhe|projete|tela|painel|dashboard|diagrama|html)/.test(lower),
    /(android|ios|iphone|celular|dispositivo|adb|termux)/.test(lower),
  ].filter(Boolean).length;

  if (domainMatches >= 2 && trimmed.length >= 65) {
    return {
      shouldRunInBackground: true,
      reason: `Orquestração cruzando ${domainMatches} domínios — iniciada em segundo plano para resposta sem travar o chat.`,
    };
  }

  return { shouldRunInBackground: false, reason: 'Execução rápida em primeiro plano.' };
}

function promptLikelyNeedsTools(prompt: string): boolean {
  const lower = prompt.toLowerCase();
  return /(linux|windows|terminal|pasta|arquivo|disco|memória|memoria|cpu|comando|downloads|logs|script|diretório|diretorio|gmail|email|e-mail|drive|agenda|calendar|docs|sheets|planilha|tasks|tarefa|nuvem|android|ios|iphone|ipad|celular|dispositivo|adb|termux|notificaç|bateria|site|url|http|web|portal|sub-menu|submenu|anexo|navegue|acesse|rotina|login|desenhe|projete|tela|painel|dashboard|gráfico|grafico|diagrama|html|câmera|camera|lembre|salve na memória|nova função|nova ferramenta|auto-evolução|evolua|meu computador|minha máquina)/.test(
    lower
  );
}

async function classifyPromptSemantically(
  prompt: string,
  heuristic: HeuristicRouteScore
): Promise<{ tier: ComplexityTier; reason: string } | null> {
  try {
    const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), 1650));
    const apiPromise = getAi().models.generateContent({
      model: 'gemini-3.1-flash-lite',
      contents: `Classifique a complexidade real desta solicitação do usuário para um assistente pessoal com ferramentas de sistema, web, Google Workspace e desenho de telas interativas.

Regras dos níveis:
- "lite": saudações, perguntas factuais simples, checagem rápida de status ou comando único trivial.
- "balanced": uso normal de ferramentas (ler/editar arquivo, listar Drive/Gmail/Agenda, abrir site, resumo comum, tela simples).
- "advanced": escrita/análise de código ou scripts, matemática/STEM, criação de dashboards/diagramas HTML ricos, comparação ou encadeamento de várias etapas/fontes.
- "deep": arquitetura de sistemas complexa, depuração de causa raiz difícil, auditoria de segurança, planejamento estratégico profundo.

Solicitação:
"""${prompt.slice(0, 900)}"""`,
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            tier: {
              type: Type.STRING,
              description: 'Exatamente um de: lite, balanced, advanced, deep',
            },
            reason: {
              type: Type.STRING,
              description: 'Justificativa curta em Português (máximo 12 palavras).',
            },
          },
          required: ['tier', 'reason'],
        },
      },
    });

    const res = await Promise.race([apiPromise, timeoutPromise]);
    if (!res || !res.text) return null;
    const parsed = JSON.parse(res.text.trim()) as { tier?: string; reason?: string };
    const validTiers: ComplexityTier[] = ['lite', 'balanced', 'advanced', 'deep'];
    if (!parsed.tier || !validTiers.includes(parsed.tier as ComplexityTier)) return null;

    const chosenTier = parsed.tier as ComplexityTier;
    const rank: Record<ComplexityTier, number> = { lite: 0, balanced: 1, advanced: 2, deep: 3 };
    // Never downgrade a clear high-signal heuristic by more than 1 tier
    const finalTier =
      rank[heuristic.tier] - rank[chosenTier] > 1 ? heuristic.tier : chosenTier;

    return {
      tier: finalTier,
      reason: parsed.reason?.trim() || heuristic.reason,
    };
  } catch {
    return null;
  }
}

export function selectModelForPrompt(
  prompt: string,
  mode: 'reactive' | 'proactive',
  preference: ModelPreference = 'auto'
): {
  model: ConcreteModelId;
  routingMode: 'auto' | 'manual';
  routingReason: string;
  complexityTier: ComplexityTier;
} {
  if (preference && preference !== 'auto') {
    const tier = MODEL_TO_TIER[preference] || 'balanced';
    return {
      model: preference,
      routingMode: 'manual',
      routingReason: `Modelo selecionado manualmente pelo operador (${preference}).`,
      complexityTier: tier,
    };
  }

  const scored = scorePromptComplexity(prompt, mode);
  return {
    model: TIER_TO_MODEL[scored.tier],
    routingMode: 'auto',
    routingReason: scored.reason,
    complexityTier: scored.tier,
  };
}

async function resolveAutomaticModelRoute(
  prompt: string,
  mode: 'reactive' | 'proactive',
  preference: ModelPreference = 'auto',
  onProgress?: (ev: AgentRoutingProgressEvent) => void
): Promise<{
  model: ConcreteModelId;
  routingMode: 'auto' | 'manual';
  routingReason: string;
  complexityTier: ComplexityTier;
  escalatedFrom?: ConcreteModelId;
}> {
  if (preference && preference !== 'auto') {
    const manual = selectModelForPrompt(prompt, mode, preference);
    onProgress?.({
      event: 'model_selected',
      data: {
        model: manual.model,
        tier: manual.complexityTier,
        routingMode: 'manual',
        reason: manual.routingReason,
      },
    });
    return manual;
  }

  onProgress?.({
    event: 'routing_analyzing',
    data: {
      model: 'gemini-3.1-flash-lite',
      reason: 'Analisando complexidade e intenção para escalonamento automático...',
    },
  });

  const heuristic = scorePromptComplexity(prompt, mode);
  let chosenTier = heuristic.tier;
  let chosenReason = heuristic.reason;

  // Run fast semantic triage whenever the prompt is non-trivial or confidence is medium
  if (heuristic.confidence === 'medium' && prompt.trim().length >= 24) {
    const semantic = await classifyPromptSemantically(prompt, heuristic);
    if (semantic) {
      chosenTier = semantic.tier;
      chosenReason = `Triagem semântica: ${semantic.reason}`;
    }
  }

  const chosenModel = TIER_TO_MODEL[chosenTier];
  const escalatedFrom = chosenTier !== 'lite' ? ('gemini-3.1-flash-lite' as ConcreteModelId) : undefined;

  onProgress?.({
    event: 'model_selected',
    data: {
      model: chosenModel,
      tier: chosenTier,
      routingMode: 'auto',
      reason: chosenReason,
      escalatedFrom,
    },
  });

  return {
    model: chosenModel,
    routingMode: 'auto',
    routingReason: chosenReason,
    complexityTier: chosenTier,
    escalatedFrom,
  };
}

function evaluateMidTurnEscalation(params: {
  currentModel: ConcreteModelId;
  hop: number;
  stepsInHop: ExecutedStep[];
  allSteps: ExecutedStep[];
  payloadChars: number;
  hasDrawnHtmlOrDashboard: boolean;
}): { targetModel: ConcreteModelId; targetTier: ComplexityTier; reason: string } | null {
  const { currentModel, hop, stepsInHop, allSteps, payloadChars, hasDrawnHtmlOrDashboard } = params;
  const currentTier = MODEL_TO_TIER[currentModel];
  const hasToolError = stepsInHop.some((s) => s.status === 'error');
  const hasRichTools = stepsInHop.some(
    (s) =>
      s.tool === 'draw_holographic_screen' ||
      s.tool.startsWith('web_') ||
      s.tool.startsWith('drive_') ||
      s.tool.startsWith('gmail_') ||
      s.tool.startsWith('docs_') ||
      s.tool.startsWith('sheets_')
  );

  if (currentTier === 'lite') {
    if (hasDrawnHtmlOrDashboard || allSteps.length >= 3 || payloadChars > 4000) {
      return {
        targetModel: 'gemini-4-neon',
        targetTier: 'advanced',
        reason: 'Escalonado automaticamente durante a execução (múltiplas ferramentas / saída densa).',
      };
    }
    if (hasToolError || hasRichTools || allSteps.length >= 2 || payloadChars > 1400 || hop >= 1) {
      return {
        targetModel: 'gemini-4-hydrogen',
        targetTier: 'balanced',
        reason: hasToolError
          ? 'Escalonado para Hydrogen para diagnosticar e corrigir erro de ferramenta.'
          : 'Escalonado para Hydrogen para sintetizar resultados de ferramentas.',
      };
    }
  }

  if (currentTier === 'balanced') {
    if (hasToolError || hasDrawnHtmlOrDashboard || hop >= 2 || payloadChars > 4800 || allSteps.length >= 4) {
      return {
        targetModel: 'gemini-4-neon',
        targetTier: 'advanced',
        reason: hasToolError
          ? 'Escalonado para Neon para recuperação inteligente após erro de ferramenta.'
          : 'Escalonado para Neon devido à profundidade multi-etapas e volume de contexto.',
      };
    }
  }

  if (currentTier === 'advanced' && hasToolError && hop >= 2) {
    return {
      targetModel: 'gemini-4-carbon',
      targetTier: 'deep',
      reason: 'Escalonado para Carbon para análise de causa raiz em cadeia complexa.',
    };
  }

  return null;
}

export const TOOL_DECLARATIONS: FunctionDeclaration[] = [
  // Autonomous Subagent Orchestration & Self-Evolution tools
  {
    name: 'delegate_subagent',
    description:
      'Delega uma sub-tarefa focada para um subagente especializado do Aegis, que executa autonomamente com seu conjunto de ferramentas dedicado e retorna um relatório verificado ao orquestrador principal.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        subagent: {
          type: Type.STRING,
          description:
            'Subagente trabalhador alvo: "research_drafting" (coleta rápida, triagem, rascunho e estruturação base), "local_system" (Linux/Windows, arquivos, comandos, diagnósticos), "mobile_devices" (dispositivos Android/iOS pareados, controle ADB/Termux/Atalhos iOS, arquivos, apps e telemetria), "web_operator" (navegação web, sub-menus, extração, login autenticado), "workspace_cloud" (Google Drive, Gmail, Calendar, Docs, Sheets, Tasks), "visual_designer" (projeção de telas holográficas/dashboards/HTML) ou "code_architect" (criação/evolução autônoma de novas funções em código).',
        },
        objective: {
          type: Type.STRING,
          description: 'Objetivo claro, autossuficiente e verificável para o subagente executar.',
        },
        context: {
          type: Type.STRING,
          description: 'Contexto adicional opcional (dados já obtidos, restrições ou formato esperado).',
        },
      },
      required: ['subagent', 'objective'],
    },
  },
  {
    name: 'evaluate_and_evolve_capability',
    description:
      'AUTO-EVOLUÇÃO DE CÓDIGO: Quando você detectar uma impossibilidade, bloqueio, formato não suportado ou ausência de função nas ferramentas nativas, use esta ferramenta para sintetizar, validar em sandbox, testar automaticamente e gravar uma NOVA função JavaScript no próprio código do Aegis (`server/evolved_skills/`). Assim que validada, ela passa a existir permanentemente como ferramenta utilizável agora e em sessões futuras.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        name: {
          type: Type.STRING,
          description: 'Nome único em snake_case da nova capacidade (ex: parse_ofx_extrato, calcular_juros_compostos, converter_markdown_tabela).',
        },
        description: {
          type: Type.STRING,
          description: 'Descrição objetiva do que a função resolve.',
        },
        limitationReason: {
          type: Type.STRING,
          description: 'Qual impossibilidade, restrição ou lacuna motivou a criação desta nova capacidade.',
        },
        parametersSpecJson: {
          type: Type.STRING,
          description:
            'JSON descrevendo os parâmetros esperados: {"campo": {"type":"string|number|boolean","description":"...","required":true}}',
        },
        code: {
          type: Type.STRING,
          description:
            'Código JavaScript definindo `async function run(args, ctx) { ... return resultado; }`. Sem imports/require/process.env. Helpers seguros disponíveis em `ctx`: `ctx.fetchText(url, opts)`, `ctx.fetchJson(url, opts)`, `ctx.workspace.list(subpath)`, `ctx.workspace.read(relPath)`, `ctx.workspace.write(relPath, content)`, `ctx.crypto.sha256(s)`, `ctx.crypto.uuid()`, `ctx.crypto.base64Encode(s)`, `ctx.crypto.base64Decode(s)`, `ctx.csv.parse(txt)`, `ctx.csv.stringify(rows)`, `ctx.html.stripTags(html)`, `ctx.nowIso()`, `ctx.log(...)`.',
        },
        testArgsJson: {
          type: Type.STRING,
          description: 'JSON com argumentos de autoverificação real para testar a função imediatamente antes de salvá-la.',
        },
      },
      required: ['name', 'description', 'limitationReason', 'code'],
    },
  },
  {
    name: 'list_evolved_capabilities',
    description: 'Lista todas as funções que o próprio Aegis já criou e integrou ao seu código via auto-evolução.',
    parameters: { type: Type.OBJECT, properties: {} },
  },
  {
    name: 'invoke_evolved_capability',
    description: 'Executa diretamente uma capacidade auto-evoluída previamente gravada no código do Aegis.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        name: { type: Type.STRING, description: 'Nome da capacidade evoluída' },
        argsJson: { type: Type.STRING, description: 'JSON com argumentos para a função' },
      },
      required: ['name'],
    },
  },
  // Holographic Generative Screen & Vision tools
  {
    name: 'draw_holographic_screen',
    description:
      'Projeta e desenha uma tela holográfica flutuante interativa diretamente sobre o núcleo 3D do Aegis para apresentar arquivos (do Drive ou máquina local), galerias de imagens, páginas web extraídas, dashboards interativos (métricas, tabelas, código, progresso) ou artefatos visuais HTML/SVG criados sob medida — sem precisar automatizar mouse ou teclado do sistema.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        kind: {
          type: Type.STRING,
          description:
            'Tipo da tela: "file_viewer" (abre arquivo Drive/local ou conteúdo inline no editor embutido), "image_gallery" (apresenta imagens com legendas), "web_canvas" (exibe página web extraída com links/tabelas), "interactive_dashboard" (painel com métricas KPI, seções, listas, tabelas, código e barras de progresso) ou "html_artifact" (diagrama/slide/interface visual completa em HTML/SVG isolado).',
        },
        title: { type: Type.STRING, description: 'Título da tela holográfica projetada' },
        subtitle: { type: Type.STRING, description: 'Subtítulo curto opcional' },
        fileSource: { type: Type.STRING, description: 'Para file_viewer: "drive", "local" ou "inline"' },
        fileIdOrPath: { type: Type.STRING, description: 'ID do arquivo no Google Drive ou caminho relativo local' },
        fileName: { type: Type.STRING, description: 'Nome do arquivo exibido no visualizador/editor' },
        mimeType: { type: Type.STRING, description: 'MIME type opcional (ex: text/markdown, text/csv, application/json)' },
        content: { type: Type.STRING, description: 'Conteúdo textual/código inline para file_viewer quando fileSource="inline"' },
        webUrl: { type: Type.STRING, description: 'URL da página para web_canvas (se informada sem webText, o Aegis navega e extrai automaticamente)' },
        webTitle: { type: Type.STRING, description: 'Título da página web' },
        webText: { type: Type.STRING, description: 'Resumo ou texto extraído da página web' },
        imagesJson: {
          type: Type.STRING,
          description: 'JSON array para image_gallery: [{"url":"https://...","title":"...","caption":"..."}]',
        },
        metricsJson: {
          type: Type.STRING,
          description: 'JSON array para interactive_dashboard: [{"label":"...","value":"...","delta":"...","tone":"amber|cyan|emerald|rose|slate"}]',
        },
        sectionsJson: {
          type: Type.STRING,
          description:
            'JSON array para interactive_dashboard: [{"heading":"...","body":"...","bullets":["..."],"code":{"language":"ts","content":"..."},"table":{"headers":["A","B"],"rows":[["1","2"]]},"progress":[{"label":"CPU","value":42,"max":100}]}]',
        },
        htmlCode: {
          type: Type.STRING,
          description:
            'Documento HTML/CSS/SVG autocontido (dark obsidian #070B12 + amber #F59E0B) para kind="html_artifact" quando desenhar diagramas, slides, fluxogramas ou interfaces personalizadas.',
        },
      },
      required: ['kind', 'title'],
    },
  },
  {
    name: 'request_camera_vision',
    description:
      'Ativa ou desativa a visão por câmera (webcam) do usuário sob demanda quando ele pedir para o Aegis olhar algo ("me veja", "olhe o que estou segurando", "desligue a câmera").',
    parameters: {
      type: Type.OBJECT,
      properties: {
        action: { type: Type.STRING, description: '"enable" para ativar a câmera ou "disable" para desligar' },
        reason: { type: Type.STRING, description: 'Motivo breve exibido ao usuário' },
      },
      required: ['action'],
    },
  },
  // Local Linux tools
  {
    name: 'linux_system_info',
    description: 'Retorna informações reais do sistema Linux local (hostname, kernel, CPU, RAM livre/total, disco, uptime).',
    parameters: { type: Type.OBJECT, properties: {} },
  },
  {
    name: 'linux_list_files',
    description: 'Lista arquivos e pastas dentro do workspace local Linux.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        subpath: { type: Type.STRING, description: 'Subcaminho relativo (ex: ".", "Downloads", "Documentos")' },
      },
    },
  },
  {
    name: 'linux_search_files',
    description: 'Busca arquivos por nome ou conteúdo dentro do workspace Linux local.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: { type: Type.STRING, description: 'Termo de busca' },
        subpath: { type: Type.STRING, description: 'Pasta inicial opcional' },
      },
      required: ['query'],
    },
  },
  {
    name: 'linux_read_file',
    description: 'Lê o conteúdo de um arquivo local Linux.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        path: { type: Type.STRING, description: 'Caminho relativo do arquivo' },
      },
      required: ['path'],
    },
  },
  {
    name: 'linux_write_file',
    description: 'Cria ou atualiza um arquivo local Linux livremente (não destrutivo).',
    parameters: {
      type: Type.OBJECT,
      properties: {
        path: { type: Type.STRING },
        content: { type: Type.STRING },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'linux_move_file',
    description: 'Move ou renomeia um arquivo local Linux livremente.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        source: { type: Type.STRING },
        destination: { type: Type.STRING },
      },
      required: ['source', 'destination'],
    },
  },
  {
    name: 'linux_delete_file',
    description: 'Exclui um arquivo ou pasta local Linux. Ação destrutiva: requer confirmação explícita do usuário.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        path: { type: Type.STRING },
      },
      required: ['path'],
    },
  },
  {
    name: 'linux_organize_directory',
    description: 'Analisa e organiza um diretório local (ex: Downloads) movendo arquivos para subpastas por categoria.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        directory: { type: Type.STRING, description: 'Pasta a organizar (ex: Downloads)' },
      },
      required: ['directory'],
    },
  },
  {
    name: 'linux_run_command',
    description: 'Executa um comando shell Linux no sistema. Executa livremente comandos normais e pede confirmação apenas em comandos destrutivos. Sempre explique o stdout/stderr real ao usuário.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        command: { type: Type.STRING, description: 'Comando bash Linux' },
      },
      required: ['command'],
    },
  },

  // Memory tools
  {
    name: 'memory_save_fact',
    description: 'Registra um fato importante, preferência, contato ou padrão de fluxo de trabalho na memória persistente.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        category: { type: Type.STRING, description: 'preference, fact, system, contact ou workflow' },
        content: { type: Type.STRING, description: 'Fato objetivo para lembrar em futuras sessões' },
        pinned: { type: Type.BOOLEAN, description: 'Se deve ser fixado como regra prioritária' },
      },
      required: ['category', 'content'],
    },
  },
  {
    name: 'memory_search',
    description: 'Pesquisa fatos salvos na memória persistente.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: { type: Type.STRING },
      },
      required: ['query'],
    },
  },

  // Autonomous Web Navigation & Credential Vault tools
  {
    name: 'web_navigate',
    description: 'Acessa uma URL da web mantendo cookies da sessão e retorna título, texto principal, links e formulários detectados.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        url: { type: Type.STRING, description: 'URL completa (ex: https://news.ycombinator.com)' },
      },
      required: ['url'],
    },
  },
  {
    name: 'web_extract',
    description: 'Extrai informações específicas de uma página web (por seletor CSS opcional, tabelas, links ou conteúdo estruturado).',
    parameters: {
      type: Type.OBJECT,
      properties: {
        url: { type: Type.STRING },
        selector: { type: Type.STRING, description: 'Seletor CSS opcional (ex: "h2", "table tr", ".price")' },
      },
      required: ['url'],
    },
  },
  {
    name: 'web_login',
    description: 'Autentica automaticamente em um site usando uma credencial salva no Cofre Web (ou URL/usuário/senha informados). Sempre exige confirmação explícita do usuário.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        siteOrCredentialId: { type: Type.STRING, description: 'Nome do site ou ID salvo no Cofre de Credenciais' },
        loginUrl: { type: Type.STRING, description: 'URL da página de login (opcional se já estiver no cofre)' },
        username: { type: Type.STRING, description: 'Usuário/e-mail (opcional se já estiver no cofre)' },
        password: { type: Type.STRING, description: 'Senha informada diretamente (opcional se já estiver no cofre)' },
      },
    },
  },
  {
    name: 'web_perform_action',
    description: 'Clica em um link ou preenche/envia um formulário na sessão web atual. Sempre exige confirmação explícita do usuário.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        url: { type: Type.STRING, description: 'URL opcional para abrir antes da ação' },
        clickLinkText: { type: Type.STRING, description: 'Texto parcial ou href do link para navegar' },
        formIndex: { type: Type.NUMBER, description: 'Índice do formulário na página (padrão 0)' },
        fieldsJson: { type: Type.STRING, description: 'JSON com pares campo:valor para preencher no formulário' },
      },
    },
  },
  {
    name: 'web_save_credential',
    description: 'Salva credencial de acesso a um site de forma criptografada no Cofre Web. Exige confirmação explícita do usuário.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        siteName: { type: Type.STRING },
        loginUrl: { type: Type.STRING },
        username: { type: Type.STRING },
        password: { type: Type.STRING },
        notes: { type: Type.STRING },
      },
      required: ['siteName', 'loginUrl', 'username', 'password'],
    },
  },
  {
    name: 'web_map_submenus',
    description:
      'Mapeia semanticamente a árvore hierárquica de menus, sub-menus, abas, breadcrumbs e anexos disponíveis em um site para entender cada subseção antes de extrair dados ou baixar arquivos.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        url: { type: Type.STRING, description: 'URL da página a mapear (opcional se já houver sessão aberta)' },
        credentialId: { type: Type.STRING, description: 'Nome do site ou ID no Cofre de Credenciais para logar antes de mapear (opcional)' },
      },
    },
  },
  {
    name: 'web_download_and_organize',
    description:
      'Baixa um anexo da sessão web autenticada (PDF, XLSX, CSV, DOCX, ZIP, XML etc.), salva organizado em uma pasta local da máquina e opcionalmente envia automaticamente para uma pasta no Google Drive. Exige confirmação explícita.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        fileUrl: { type: Type.STRING, description: 'URL exata do anexo detectado' },
        preferredFilename: { type: Type.STRING, description: 'Nome amigável opcional do arquivo' },
        localFolder: { type: Type.STRING, description: 'Pasta local destino (ex: Downloads/Portais/Financeiro)' },
        driveFolder: { type: Type.STRING, description: 'Pasta destino no Google Drive (ex: Aegis/Portais/Financeiro). Opcional.' },
      },
      required: ['fileUrl'],
    },
  },
  {
    name: 'web_save_routine',
    description:
      'Salva uma rotina repetitiva reutilizável de automação web (login por credencial do cofre, sub-menus e abas alvo, instruções de extração, download de anexos e organização automática em pasta local e Google Drive).',
    parameters: {
      type: Type.OBJECT,
      properties: {
        name: { type: Type.STRING, description: 'Nome da rotina (ex: Coleta Mensal de Notas Fiscais)' },
        siteName: { type: Type.STRING, description: 'Nome do portal/site' },
        credentialId: { type: Type.STRING, description: 'ID ou nome da credencial no Cofre Web (opcional)' },
        startUrl: { type: Type.STRING, description: 'URL inicial do portal' },
        targetSections: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description: 'Lista de menus/sub-menus/abas alvo (ex: ["Financeiro > Notas Fiscais", "Relatórios > Anexos"])',
        },
        extractionInstructions: { type: Type.STRING, description: 'O que extrair em cada subseção' },
        downloadAttachments: { type: Type.BOOLEAN, description: 'Se deve baixar automaticamente os anexos encontrados' },
        fileExtensions: { type: Type.STRING, description: 'Extensões aceitas separadas por vírgula (ex: pdf,xlsx,csv,xml)' },
        localFolder: { type: Type.STRING, description: 'Pasta local destino (ex: Downloads/Portais/Fiscal)' },
        driveFolder: { type: Type.STRING, description: 'Pasta no Google Drive destino (ex: Aegis/Portais/Fiscal)' },
        autoOrganizeBySection: { type: Type.BOOLEAN, description: 'Criar subpastas automáticas por sub-menu/seção' },
      },
      required: ['name', 'startUrl'],
    },
  },
  {
    name: 'web_run_routine',
    description:
      'Executa uma rotina repetitiva de automação web (salva ou sob demanda): faz login com credenciais do cofre, entende e percorre menus/sub-menus/abas automaticamente, extrai dados, baixa anexos e organiza tudo na máquina local e no Google Drive. Exige confirmação explícita.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        routineIdOrName: { type: Type.STRING, description: 'ID ou nome de uma rotina web salva (opcional se informar startUrl)' },
        startUrl: { type: Type.STRING, description: 'URL inicial (para execução sob demanda sem rotina salva)' },
        credentialId: { type: Type.STRING, description: 'ID ou nome da credencial do cofre para login automático' },
        targetSections: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description: 'Sub-menus/abas alvo para navegar',
        },
        extractionInstructions: { type: Type.STRING, description: 'Instruções de extração' },
        downloadAttachments: { type: Type.BOOLEAN },
        localFolder: { type: Type.STRING },
        driveFolder: { type: Type.STRING },
      },
    },
  },

  // Google Workspace tools
  {
    name: 'gmail_list_analyze',
    description: 'Lista e lê metadados/trechos de e-mails recentes no Gmail do usuário.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: { type: Type.STRING },
        maxResults: { type: Type.NUMBER },
      },
    },
  },
  {
    name: 'gmail_send_email',
    description: 'Envia um e-mail via Gmail em nome do usuário. SEMPRE exige confirmação explícita.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        to: { type: Type.STRING },
        subject: { type: Type.STRING },
        body: { type: Type.STRING },
      },
      required: ['to', 'subject', 'body'],
    },
  },
  {
    name: 'gmail_trash_message',
    description: 'Move uma mensagem do Gmail para a lixeira. SEMPRE exige confirmação explícita.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        messageId: { type: Type.STRING },
        subjectPreview: { type: Type.STRING },
      },
      required: ['messageId'],
    },
  },
  {
    name: 'drive_list_files',
    description: 'Lista ou pesquisa arquivos e pastas no Google Drive do usuário, podendo navegar por folderId (ex: "root" ou ID de uma pasta).',
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: { type: Type.STRING, description: 'Filtro opcional de busca por nome' },
        folderId: { type: Type.STRING, description: 'ID opcional da pasta (ex: "root") para listar o conteúdo interno' },
      },
    },
  },
  {
    name: 'drive_read_file',
    description: 'Abre e lê o conteúdo ou metadados de um arquivo específico do Google Drive (Google Docs, Planilhas, Slides, Texto/Código).',
    parameters: {
      type: Type.OBJECT,
      properties: {
        fileId: { type: Type.STRING },
      },
      required: ['fileId'],
    },
  },
  {
    name: 'drive_create_folder',
    description: 'Cria uma nova pasta no Google Drive. Exige confirmação explícita.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        name: { type: Type.STRING },
        parentId: { type: Type.STRING },
      },
      required: ['name'],
    },
  },
  {
    name: 'drive_rename_file',
    description: 'Renomeia um arquivo ou pasta no Google Drive. Exige confirmação explícita.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        fileId: { type: Type.STRING },
        newName: { type: Type.STRING },
      },
      required: ['fileId', 'newName'],
    },
  },
  {
    name: 'drive_move_file',
    description: 'Move um arquivo do Google Drive para outra pasta. Exige confirmação explícita.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        fileId: { type: Type.STRING },
        fileName: { type: Type.STRING },
        targetFolderId: { type: Type.STRING },
      },
      required: ['fileId', 'targetFolderId'],
    },
  },
  {
    name: 'drive_delete_file',
    description: 'Move um arquivo do Google Drive para a lixeira. Exige confirmação explícita.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        fileId: { type: Type.STRING },
        fileName: { type: Type.STRING },
      },
      required: ['fileId'],
    },
  },
  {
    name: 'calendar_list_events',
    description: 'Lista os próximos compromissos no Google Calendar do usuário.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        maxResults: { type: Type.NUMBER },
      },
    },
  },
  {
    name: 'calendar_create_event',
    description: 'Cria um evento no Google Calendar. Exige confirmação explícita.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        summary: { type: Type.STRING },
        startIso: { type: Type.STRING },
        endIso: { type: Type.STRING },
        description: { type: Type.STRING },
        location: { type: Type.STRING },
      },
      required: ['summary', 'startIso', 'endIso'],
    },
  },
  {
    name: 'calendar_update_event',
    description: 'Atualiza os dados de um evento existente no Google Calendar. Exige confirmação explícita.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        eventId: { type: Type.STRING },
        summary: { type: Type.STRING },
        startIso: { type: Type.STRING },
        endIso: { type: Type.STRING },
        description: { type: Type.STRING },
        location: { type: Type.STRING },
      },
      required: ['eventId'],
    },
  },
  {
    name: 'calendar_delete_event',
    description: 'Exclui um evento do Google Calendar. Exige confirmação explícita.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        eventId: { type: Type.STRING },
        summaryPreview: { type: Type.STRING },
      },
      required: ['eventId'],
    },
  },
  {
    name: 'docs_create_document',
    description: 'Cria um Google Doc novo. Exige confirmação explícita.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        title: { type: Type.STRING },
        initialText: { type: Type.STRING },
      },
      required: ['title'],
    },
  },
  {
    name: 'docs_read_document',
    description: 'Lê o conteúdo de um Google Doc existente.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        documentId: { type: Type.STRING },
      },
      required: ['documentId'],
    },
  },
  {
    name: 'docs_append_text',
    description: 'Adiciona texto ao final de um Google Doc existente. Exige confirmação explícita.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        documentId: { type: Type.STRING },
        text: { type: Type.STRING },
      },
      required: ['documentId', 'text'],
    },
  },
  {
    name: 'docs_replace_content',
    description: 'Substitui o conteúdo textual de um Google Doc existente. Exige confirmação explícita.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        documentId: { type: Type.STRING },
        newText: { type: Type.STRING },
      },
      required: ['documentId', 'newText'],
    },
  },
  {
    name: 'sheets_create_spreadsheet',
    description: 'Cria uma nova planilha no Google Sheets. Exige confirmação explícita.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        title: { type: Type.STRING },
      },
      required: ['title'],
    },
  },
  {
    name: 'sheets_read_values',
    description: 'Lê células de uma planilha no Google Sheets.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        spreadsheetId: { type: Type.STRING },
        range: { type: Type.STRING },
      },
      required: ['spreadsheetId'],
    },
  },
  {
    name: 'sheets_update_values',
    description: 'Atualiza um intervalo específico de células em uma planilha Google Sheets. Exige confirmação explícita.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        spreadsheetId: { type: Type.STRING },
        range: { type: Type.STRING },
        rowsJson: { type: Type.STRING },
      },
      required: ['spreadsheetId', 'range', 'rowsJson'],
    },
  },
  {
    name: 'sheets_append_rows',
    description: 'Preenche/adiciona linhas em uma planilha Google Sheets. Exige confirmação explícita.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        spreadsheetId: { type: Type.STRING },
        range: { type: Type.STRING },
        rowsJson: { type: Type.STRING },
      },
      required: ['spreadsheetId', 'range', 'rowsJson'],
    },
  },
  {
    name: 'tasks_list',
    description: 'Lista tarefas no Google Tasks.',
    parameters: { type: Type.OBJECT, properties: {} },
  },
  {
    name: 'tasks_create',
    description: 'Cria uma nova tarefa no Google Tasks. Exige confirmação explícita.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        title: { type: Type.STRING },
        notes: { type: Type.STRING },
        dueIso: { type: Type.STRING },
      },
      required: ['title'],
    },
  },
  {
    name: 'tasks_update',
    description: 'Edita título, notas, data ou status de uma tarefa existente no Google Tasks. Exige confirmação explícita.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        taskId: { type: Type.STRING },
        title: { type: Type.STRING },
        notes: { type: Type.STRING },
        dueIso: { type: Type.STRING },
        status: { type: Type.STRING, description: 'needsAction ou completed' },
      },
      required: ['taskId'],
    },
  },
  {
    name: 'tasks_complete',
    description: 'Marca uma tarefa do Google Tasks como concluída. Exige confirmação explícita.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        taskId: { type: Type.STRING },
        titlePreview: { type: Type.STRING },
      },
      required: ['taskId'],
    },
  },

  // Multi-Device Mesh (Android / iOS / Desktop Remote) & Unified Ecosystem Visibility Tools
  {
    name: 'devices_list_all',
    description:
      'Lista TODOS os dispositivos adicionados/pareados (Android via ADB/Termux/App, iOS via PWA/Atalhos e Desktops Linux/Windows), incluindo status online/offline, bateria, armazenamento, apps, notificações e capacidades.',
    parameters: { type: Type.OBJECT, properties: {} },
  },
  {
    name: 'device_inspect_data',
    description:
      'Inspeciona em detalhes todos os dados sincronizados de um dispositivo específico adicionado ao Aegis (telemetria completa, bateria, RAM, Wi-Fi, armazenamento, aplicativos instalados, notificações recentes, índice de arquivos e histórico de comandos).',
    parameters: {
      type: Type.OBJECT,
      properties: {
        deviceId: { type: Type.STRING, description: 'ID do dispositivo (obtido em devices_list_all)' },
      },
      required: ['deviceId'],
    },
  },
  {
    name: 'device_list_files',
    description:
      'Lista arquivos e pastas em tempo real de um dispositivo Android ou Desktop conectado (ex: /sdcard, /sdcard/Download, /sdcard/DCIM).',
    parameters: {
      type: Type.OBJECT,
      properties: {
        deviceId: { type: Type.STRING, description: 'ID do dispositivo alvo' },
        path: { type: Type.STRING, description: 'Caminho remoto (padrão: /sdcard no Android ou . no Desktop)' },
      },
      required: ['deviceId'],
    },
  },
  {
    name: 'device_read_file',
    description:
      'Lê o conteúdo de um arquivo armazenado em um dispositivo Android ou Desktop conectado.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        deviceId: { type: Type.STRING, description: 'ID do dispositivo alvo' },
        path: { type: Type.STRING, description: 'Caminho completo do arquivo no dispositivo' },
      },
      required: ['deviceId', 'path'],
    },
  },
  {
    name: 'device_execute_action',
    description:
      'Controla um dispositivo Android a nível de sistema (via ADB USB/Wi-Fi pelo Desktop ou Termux/Shizuku pela nuvem) ou envia ação para iOS Atalhos. Suporta: shell, open_app (packageName), input_tap (x,y), input_swipe, input_text (text), input_keyevent (key ex: KEYCODE_HOME, KEYCODE_BACK, KEYCODE_VOLUME_UP), list_packages, notifications, tts_speak (text), notify (title, content), clipboard_get, clipboard_set, torch (enabled), vibrate. Ações destrutivas exigem confirmação.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        deviceId: { type: Type.STRING, description: 'ID do dispositivo alvo' },
        commandType: {
          type: Type.STRING,
          description:
            'Tipo: shell, open_app, input_tap, input_swipe, input_text, input_keyevent, list_packages, notifications, tts_speak, notify, clipboard_get, clipboard_set, torch, vibrate',
        },
        payloadJson: {
          type: Type.STRING,
          description:
            'JSON com parâmetros do comando (ex: {"command":"dumpsys battery"}, {"packageName":"com.whatsapp"}, {"x":540,"y":1200}, {"key":"KEYCODE_HOME"}, {"title":"Aegis","content":"Olá!"})',
        },
      },
      required: ['deviceId', 'commandType'],
    },
  },
  {
    name: 'ecosystem_unified_search',
    description:
      'Busca unificada simultânea em TODAS as fontes conectadas ao usuário: arquivos locais na máquina, Google Drive (nuvem) e snapshots/arquivos/apps/notificações de TODOS os dispositivos Android, iOS e Desktop pareados.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: { type: Type.STRING, description: 'Termo, nome de arquivo, assunto ou aplicativo a localizar em todo o ecossistema' },
      },
      required: ['query'],
    },
  },
];

export function getAllToolDeclarations(): FunctionDeclaration[] {
  return [...TOOL_DECLARATIONS, ...selfEvolution.getActiveEvolvedToolDeclarations()];
}

export type SubagentId =
  | 'research_drafting'
  | 'local_system'
  | 'mobile_devices'
  | 'web_operator'
  | 'workspace_cloud'
  | 'visual_designer'
  | 'code_architect';

const SUBAGENT_PROFILES: Record<
  SubagentId,
  {
    label: string;
    model: ConcreteModelId;
    fallbackModel: ConcreteModelId;
    workerRole: string;
    directive: string;
    toolFilter: (name: string) => boolean;
  }
> = {
  research_drafting: {
    label: 'Coletor & Redator Base',
    model: 'gemini-3.1-flash-lite',
    fallbackModel: 'gemini-4-hydrogen',
    workerRole: 'Trabalho bruto: coleta de memória, rascunho inicial, extração de fatos e estruturação rápida',
    directive:
      'Você é o Subagente Trabalhador de Coleta & Redação Base do Aegis. Faça o trabalho bruto rápido e factual: consulte a memória ou busca unificada se relevante, levante pontos-chave, dados estruturados e um rascunho técnico objetivo para que o Modelo Curador Sênior revise e refine.',
    toolFilter: (n) => n.startsWith('memory_') || n === 'ecosystem_unified_search',
  },
  local_system: {
    label: 'Sistema Local',
    model: 'gemini-3.1-flash-lite',
    fallbackModel: 'gemini-4-hydrogen',
    workerRole: 'Trabalho bruto: leitura de arquivos, comandos shell, espaço em disco, logs e diagnósticos locais',
    directive:
      'Você é o Subagente Trabalhador de Sistema Local do Aegis (Linux/Windows). Execute o trabalho bruto: inspecione hardware, arquivos, diretórios e comandos shell seguros, retornando saídas reais (stdout/stderr/arquivos) bem organizadas para curadoria do modelo sênior.',
    toolFilter: (n) => n.startsWith('linux_') || n === 'ecosystem_unified_search' || n.startsWith('memory_'),
  },
  mobile_devices: {
    label: 'Android & iOS',
    model: 'gemini-3.1-flash-lite',
    fallbackModel: 'gemini-4-hydrogen',
    workerRole: 'Trabalho bruto: telemetria, arquivos, apps, notificações e ações remotas nos dispositivos pareados',
    directive:
      'Você é o Subagente Trabalhador de Dispositivos Móveis do Aegis (Android via ADB/Termux/Shizuku + iOS via PWA/Atalhos). Colete telemetria, arquivos, apps, notificações e execute ações remotas com segurança, entregando dados brutos verificados para a curadoria sênior.',
    toolFilter: (n) => n.startsWith('device') || n === 'ecosystem_unified_search' || n.startsWith('memory_'),
  },
  web_operator: {
    label: 'Operador Web',
    model: 'gemini-4-hydrogen',
    fallbackModel: 'gemini-3.1-flash-lite',
    workerRole: 'Trabalho bruto: navegação em sites, leitura de sub-menus, extração de tabelas e rotinas web',
    directive:
      'Você é o Subagente Trabalhador Operador Web do Aegis. Faça o trabalho bruto web: mapeie árvores de menus, sub-menus e abas (`web_map_submenus`), crie ou execute rotinas repetitivas (`web_save_routine`, `web_run_routine`, `web_download_and_organize`) e extraia dados estruturados reais para o curador sênior.',
    toolFilter: (n) => n.startsWith('web_') || n.startsWith('memory_'),
  },
  workspace_cloud: {
    label: 'Google Workspace',
    model: 'gemini-3.1-flash-lite',
    fallbackModel: 'gemini-4-hydrogen',
    workerRole: 'Trabalho bruto: leitura e coleta em Gmail, Drive, Calendar, Docs, Sheets e Tasks',
    directive:
      'Você é o Subagente Trabalhador de Google Workspace do Aegis. Colete e inspecione dados reais no Gmail, Drive, Calendar, Docs, Sheets e Tasks, retornando um dossiê objetivo para a curadoria sênior.',
    toolFilter: (n) =>
      n.startsWith('gmail_') ||
      n.startsWith('drive_') ||
      n.startsWith('calendar_') ||
      n.startsWith('docs_') ||
      n.startsWith('sheets_') ||
      n.startsWith('tasks_') ||
      n === 'ecosystem_unified_search' ||
      n.startsWith('memory_'),
  },
  visual_designer: {
    label: 'Projeção Visual',
    model: 'gemini-4-hydrogen',
    fallbackModel: 'gemini-3.1-flash-lite',
    workerRole: 'Trabalho bruto: montagem de telas holográficas, dashboards KPI e artefatos HTML/SVG',
    directive:
      'Você é o Subagente Trabalhador de Projeção Visual Holográfica do Aegis. Construa telas interativas (`draw_holographic_screen`) com estética escura obsidian + âmbar/ciano, dados claros e zero poluição visual.',
    toolFilter: (n) =>
      n === 'draw_holographic_screen' ||
      n === 'linux_read_file' ||
      n === 'linux_list_files' ||
      n === 'drive_read_file' ||
      n === 'devices_list_all' ||
      n === 'device_inspect_data' ||
      n === 'web_navigate',
  },
  code_architect: {
    label: 'Auto-Evolução de Código',
    model: 'gemini-4-hydrogen',
    fallbackModel: 'gemini-3.1-flash-lite',
    workerRole: 'Trabalho bruto: prototipagem, testes em sandbox e registro de novas funções JS',
    directive:
      'Você é o Subagente Trabalhador de Auto-Evolução do Aegis. Prototipe, valide em sandbox e persista novas funções JavaScript via `evaluate_and_evolve_capability`, entregando evidências de teste para a curadoria sênior.',
    toolFilter: (n) =>
      n === 'evaluate_and_evolve_capability' ||
      n === 'list_evolved_capabilities' ||
      n === 'invoke_evolved_capability' ||
      n === 'linux_read_file' ||
      n === 'linux_list_files',
  },
};

interface DecomposedMissionPlan {
  shouldDecompose: boolean;
  planRationale: string;
  curatorModel: ConcreteModelId;
  curatorTier: ComplexityTier;
  subtasks: Array<{
    subagent: SubagentId;
    label: string;
    model: ConcreteModelId;
    objective: string;
  }>;
}

const VALID_SUBAGENT_IDS: SubagentId[] = [
  'research_drafting',
  'local_system',
  'mobile_devices',
  'web_operator',
  'workspace_cloud',
  'visual_designer',
  'code_architect',
];

function buildHeuristicMissionPlan(
  prompt: string,
  heuristic: HeuristicRouteScore,
  workspaceConnected: boolean,
  hasDevices: boolean
): DecomposedMissionPlan {
  const trimmed = prompt.trim();
  const lower = trimmed.toLowerCase();

  // Pure greetings or simple conversational Q&A without tool domains skip multi-agent overhead entirely
  const trivialGreeting =
    /^(oi|olá|ola|bom dia|boa tarde|boa noite|tudo bem|e ai|e aí|fala|obrigado|valeu|ok|tchau|ping|teste)[\s!?.]*$/i;
  if (trivialGreeting.test(trimmed)) {
    return {
      shouldDecompose: false,
      planRationale: 'Saudação direta — resposta imediata em Flash Lite sem decomposição.',
      curatorModel: 'gemini-3.1-flash-lite',
      curatorTier: 'lite',
      subtasks: [],
    };
  }

  const needsTools = promptLikelyNeedsTools(trimmed);
  if (!needsTools && heuristic.tier === 'lite' && trimmed.length <= 160) {
    return {
      shouldDecompose: false,
      planRationale: 'Pergunta direta sem necessidade de ferramentas ou curadoria pesada — resposta econômica em Flash Lite.',
      curatorModel: 'gemini-3.1-flash-lite',
      curatorTier: 'lite',
      subtasks: [],
    };
  }

  const subtasks: DecomposedMissionPlan['subtasks'] = [];
  const pushTask = (id: SubagentId, objective: string) => {
    if (subtasks.some((s) => s.subagent === id)) return;
    const prof = SUBAGENT_PROFILES[id];
    subtasks.push({ subagent: id, label: prof.label, model: prof.model, objective });
  };

  if (/(linux|windows|terminal|pasta|arquivo|disco|memória|memoria|cpu|comando|downloads|logs|script|diretório|diretorio)/.test(lower)) {
    pushTask('local_system', `Coletar dados reais do sistema local, arquivos ou comandos necessários para: "${trimmed.slice(0, 220)}"`);
  }
  if (workspaceConnected && /(gmail|email|e-mail|drive|agenda|calendar|docs|sheets|planilha|tasks|tarefa|nuvem)/.test(lower)) {
    pushTask('workspace_cloud', `Consultar e extrair dados relevantes do Google Workspace para: "${trimmed.slice(0, 220)}"`);
  }
  if (hasDevices && /(android|ios|iphone|ipad|celular|dispositivo|adb|termux|notificaç|bateria|app)/.test(lower)) {
    pushTask('mobile_devices', `Inspecionar telemetria, arquivos ou apps nos dispositivos conectados para: "${trimmed.slice(0, 220)}"`);
  }
  if (/(site|url|http|web|portal|sub-menu|submenu|anexo|navegue|acesse|rotina|login)/.test(lower)) {
    pushTask('web_operator', `Navegar, mapear sub-menus ou extrair informações web solicitadas em: "${trimmed.slice(0, 220)}"`);
  }
  if (/(desenhe|projete|tela|painel|dashboard|gráfico|grafico|diagrama|html|visualiz)/.test(lower)) {
    pushTask('visual_designer', `Preparar a estrutura visual/tela holográfica adequada para: "${trimmed.slice(0, 220)}"`);
  }
  if (/(nova função|nova ferramenta|auto-evolução|evolua|criar função|no seu próprio código|sem capacidade)/.test(lower)) {
    pushTask('code_architect', `Avaliar lacuna técnica e prototipar nova capacidade em código para: "${trimmed.slice(0, 220)}"`);
  }

  // Only spawn research_drafting worker when the prompt genuinely warrants multi-stage synthesis
  if (subtasks.length === 0) {
    if (heuristic.tier === 'balanced' && heuristic.score < 32 && trimmed.length <= 180) {
      return {
        shouldDecompose: false,
        planRationale: 'Demanda direta de escopo único — executada sem camada redundante de subagente para economizar tokens.',
        curatorModel: 'gemini-4-hydrogen',
        curatorTier: 'balanced',
        subtasks: [],
      };
    }
    pushTask(
      'research_drafting',
      `Fazer o levantamento bruto, consultar memória se pertinente e estruturar os fatos/pontos principais para responder: "${trimmed.slice(0, 260)}"`
    );
  }

  // Right-size Curator strictly to real demand complexity (never over-provision heavy models)
  const hasHeavyWorker = subtasks.some((s) => s.subagent === 'code_architect' || s.subagent === 'visual_designer');
  let curatorTier: ComplexityTier = 'balanced';
  if (heuristic.tier === 'deep') {
    curatorTier = 'deep';
  } else if (heuristic.tier === 'advanced' || (subtasks.length >= 2 && (heuristic.score >= 38 || hasHeavyWorker))) {
    curatorTier = 'advanced';
  } else if (heuristic.tier === 'lite' && subtasks.length === 1 && !hasHeavyWorker) {
    curatorTier = 'lite';
  } else {
    curatorTier = 'balanced';
  }

  return {
    shouldDecompose: true,
    planRationale: `Subdivisão otimizada: ${subtasks.length} subagente(s) leve(s) no trabalho bruto + ${
      curatorTier === 'lite' ? 'verificação econômica (Flash Lite)' : `curadoria ${TIER_TO_MODEL[curatorTier]}`
    }.`,
    curatorModel: TIER_TO_MODEL[curatorTier],
    curatorTier,
    subtasks: subtasks.slice(0, 3),
  };
}

type SubagentExecutionResult = Awaited<ReturnType<typeof runSpecializedSubagent>>;

function evaluatePostWorkerCuration(params: {
  heuristic: HeuristicRouteScore;
  plannedModel: ConcreteModelId;
  plannedTier: ComplexityTier;
  manualModel?: ConcreteModelId;
  workerResults: SubagentExecutionResult[];
}): {
  skipCurator: boolean;
  curatorModel: ConcreteModelId;
  curatorTier: ComplexityTier;
  rationale: string;
} {
  const { heuristic, plannedModel, plannedTier, manualModel, workerResults } = params;
  if (manualModel) {
    return {
      skipCurator: false,
      curatorModel: manualModel,
      curatorTier: MODEL_TO_TIER[manualModel],
      rationale: `Curadoria manual solicitada pelo operador (${manualModel}).`,
    };
  }

  const allOk = workerResults.every((w) => w.ok);
  const anyErrorStep = workerResults.some((w) => w.steps.some((s) => s.status === 'error'));
  const totalSummaryLen = workerResults.reduce((acc, w) => acc + w.summary.trim().length, 0);
  const hasRichArtifact = workerResults.some((w) => w.screens.length > 0);
  const hasHeavyDomain = workerResults.some(
    (w) => w.subagent === 'code_architect' || w.subagent === 'visual_designer'
  );

  // Skip Senior Curator completely when a single lightweight worker succeeded cleanly on a straightforward task
  if (
    workerResults.length === 1 &&
    allOk &&
    !anyErrorStep &&
    !hasHeavyDomain &&
    totalSummaryLen >= 25 &&
    (heuristic.tier === 'lite' || (heuristic.tier === 'balanced' && heuristic.score < 34))
  ) {
    return {
      skipCurator: true,
      curatorModel: workerResults[0].model,
      curatorTier: MODEL_TO_TIER[workerResults[0].model],
      rationale:
        'Curadoria sênior dispensada: o subagente trabalhador concluiu a tarefa sem erros e com resposta completa (economia de tokens).',
    };
  }

  // Right-size downward if planned curator is heavier than what the actual clean worker output needs
  if (allOk && !anyErrorStep && !hasHeavyDomain && !hasRichArtifact) {
    if (plannedTier === 'deep' && heuristic.score < 84) {
      return {
        skipCurator: false,
        curatorModel: 'gemini-4-neon',
        curatorTier: 'advanced',
        rationale: 'Curadoria ajustada de Carbon → Neon: trabalhadores entregaram dados limpos sem falhas.',
      };
    }
    if (plannedTier === 'advanced' && workerResults.length <= 2 && totalSummaryLen < 1200 && heuristic.score < 56) {
      return {
        skipCurator: false,
        curatorModel: 'gemini-4-hydrogen',
        curatorTier: 'balanced',
        rationale: 'Curadoria ajustada de Neon → Hydrogen: síntese direta suficiente para o volume coletado.',
      };
    }
    if (plannedTier === 'balanced' && workerResults.length === 2 && totalSummaryLen < 850 && heuristic.score < 28) {
      return {
        skipCurator: false,
        curatorModel: 'gemini-3.1-flash-lite',
        curatorTier: 'lite',
        rationale: 'Curadoria leve (Flash Lite): apenas consolidação simples de 2 coletas sem erros.',
      };
    }
  }

  return {
    skipCurator: false,
    curatorModel: plannedModel,
    curatorTier: plannedTier,
    rationale: `Curadoria sênior necessária (${plannedModel}) para auditar e sintetizar ${workerResults.length} subagente(s).`,
  };
}

async function decomposeTaskForWorkersAndCurator(params: {
  prompt: string;
  mode: 'reactive' | 'proactive';
  heuristic: HeuristicRouteScore;
  workspaceConnected: boolean;
  hasDevices: boolean;
  manualModel?: ConcreteModelId;
}): Promise<DecomposedMissionPlan> {
  const fallbackPlan = buildHeuristicMissionPlan(
    params.prompt,
    params.heuristic,
    params.workspaceConnected,
    params.hasDevices
  );

  if (!fallbackPlan.shouldDecompose) {
    if (params.manualModel) {
      return {
        ...fallbackPlan,
        curatorModel: params.manualModel,
        curatorTier: MODEL_TO_TIER[params.manualModel],
      };
    }
    return fallbackPlan;
  }

  // Fast-path: when heuristic already matched explicit domains or prompt is concise,
  // skip the extra LLM planner round-trip (saves ~1.2-2.6s + ~450 tokens per turn).
  const trimmedLen = params.prompt.trim().length;
  const hasExplicitDomainWorker = fallbackPlan.subtasks.some((s) => s.subagent !== 'research_drafting');
  const skipLlmPlanner =
    (hasExplicitDomainWorker && trimmedLen <= 220) ||
    (params.heuristic.confidence === 'high' && trimmedLen <= 160);

  if (skipLlmPlanner) {
    const curatorModel = params.manualModel || fallbackPlan.curatorModel;
    const curatorTier = params.manualModel ? MODEL_TO_TIER[params.manualModel] : fallbackPlan.curatorTier;
    return {
      ...fallbackPlan,
      curatorModel,
      curatorTier,
      planRationale: `${fallbackPlan.planRationale} (planejamento instantâneo sem latência extra)`,
    };
  }

  try {
    const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), 1850));
    const apiPromise = getAi().models.generateContent({
      model: 'gemini-3.1-flash-lite',
      contents: `Você é o Decompositor de Missões do Orquestrador Aegis.
Sua regra de ouro: MESMO para tarefas modestas ou cotidianas, subdivida a tarefa em 1 a 3 sub-tarefas objetivas para que SUBAGENTES LEVES façam o "trabalho bruto" (coleta de dados, leitura, listagem, rascunho base, execução inicial) e um MODELO MAIOR atue como CURADOR SÊNIOR (revisão, verificação, síntese final e recomendações).

Subagentes trabalhadores disponíveis:
- "research_drafting": coleta de memória, rascunho base, levantamento factual, resumo inicial, estruturação de resposta.
- "local_system": arquivos locais, pastas, Downloads, logs, comandos Linux/Windows, disco, CPU/RAM.
- "workspace_cloud": Google Drive, Gmail, Calendar, Docs, Sheets, Tasks (conectado: ${params.workspaceConnected ? 'SIM' : 'NÃO'}).
- "mobile_devices": dispositivos Android/iOS pareados, bateria, arquivos remotos, notificações, apps (há dispositivos: ${params.hasDevices ? 'SIM' : 'NÃO'}).
- "web_operator": navegação web, mapeamento de sub-menus, login, rotinas web, anexos.
- "visual_designer": desenho de telas holográficas, dashboards, diagramas HTML.
- "code_architect": criação/evolução de novas funções em código JS.

Níveis de curador ("curatorTier"):
- "balanced" (Gemini 4 Hydrogen): curadoria de tarefas modestas/cotidianas.
- "advanced" (Gemini 4 Neon): curadoria de tarefas com código, múltiplos domínios, análise crítica ou design.
- "deep" (Gemini 4 Carbon): curadoria de arquitetura complexa, auditoria profunda ou causa raiz difícil.

Solicitação do usuário (${params.mode}):
"""${params.prompt.slice(0, 1000)}"""`,
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            planRationale: {
              type: Type.STRING,
              description: 'Explicação curta em Português (1 frase) de como o trabalho bruto foi dividido e o que o curador vai revisar.',
            },
            curatorTier: {
              type: Type.STRING,
              description: 'Exatamente um de: balanced, advanced, deep',
            },
            subtasks: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  subagent: {
                    type: Type.STRING,
                    description: 'Um dos IDs válidos de subagente trabalhador',
                  },
                  objective: {
                    type: Type.STRING,
                    description: 'Objetivo específico, curto e acionável de trabalho bruto para este subagente.',
                  },
                },
                required: ['subagent', 'objective'],
              },
            },
          },
          required: ['planRationale', 'curatorTier', 'subtasks'],
        },
      },
    });

    const res = await Promise.race([apiPromise, timeoutPromise]);
    if (!res || !res.text) {
      return params.manualModel
        ? { ...fallbackPlan, curatorModel: params.manualModel, curatorTier: MODEL_TO_TIER[params.manualModel] }
        : fallbackPlan;
    }

    const parsed = JSON.parse(res.text.trim()) as {
      planRationale?: string;
      curatorTier?: string;
      subtasks?: Array<{ subagent?: string; objective?: string }>;
    };

    const rawSubtasks = Array.isArray(parsed.subtasks) ? parsed.subtasks : [];
    const normalizedSubtasks: DecomposedMissionPlan['subtasks'] = [];
    for (const item of rawSubtasks.slice(0, 3)) {
      const subId = VALID_SUBAGENT_IDS.includes(item.subagent as SubagentId)
        ? (item.subagent as SubagentId)
        : 'research_drafting';
      const obj = (item.objective || '').trim();
      if (!obj) continue;
      if (normalizedSubtasks.some((s) => s.subagent === subId && s.objective === obj)) continue;
      const prof = SUBAGENT_PROFILES[subId];
      normalizedSubtasks.push({
        subagent: subId,
        label: prof.label,
        model: prof.model,
        objective: obj,
      });
    }

    if (normalizedSubtasks.length === 0) {
      return params.manualModel
        ? { ...fallbackPlan, curatorModel: params.manualModel, curatorTier: MODEL_TO_TIER[params.manualModel] }
        : fallbackPlan;
    }

    let curatorTier: ComplexityTier =
      parsed.curatorTier === 'deep' || parsed.curatorTier === 'advanced' || parsed.curatorTier === 'balanced'
        ? parsed.curatorTier
        : fallbackPlan.curatorTier;

    // Preserve high-signal heuristic floor (never downgrade deep -> balanced)
    const rank: Record<ComplexityTier, number> = { lite: 0, balanced: 1, advanced: 2, deep: 3 };
    if (rank[fallbackPlan.curatorTier] > rank[curatorTier]) {
      curatorTier = fallbackPlan.curatorTier;
    }

    const curatorModel = params.manualModel || TIER_TO_MODEL[curatorTier];
    const finalTier = params.manualModel ? MODEL_TO_TIER[params.manualModel] : curatorTier;

    return {
      shouldDecompose: true,
      planRationale: parsed.planRationale?.trim() || fallbackPlan.planRationale,
      curatorModel,
      curatorTier: finalTier,
      subtasks: normalizedSubtasks,
    };
  } catch {
    return params.manualModel
      ? { ...fallbackPlan, curatorModel: params.manualModel, curatorTier: MODEL_TO_TIER[params.manualModel] }
      : fallbackPlan;
  }
}

export interface HolographicScreenPayload {
  id: string;
  title: string;
  subtitle?: string;
  kind: 'file_viewer' | 'image_gallery' | 'web_canvas' | 'interactive_dashboard' | 'html_artifact';
  createdAt: string;
  fileSource?: 'drive' | 'local' | 'inline';
  fileIdOrPath?: string;
  fileName?: string;
  mimeType?: string;
  content?: string;
  images?: Array<{ url: string; title: string; caption?: string }>;
  webUrl?: string;
  webTitle?: string;
  webText?: string;
  webHeadings?: string[];
  webLinks?: Array<{ text: string; href: string }>;
  webTables?: Array<string[][]>;
  metrics?: Array<{ label: string; value: string; delta?: string; tone?: 'amber' | 'cyan' | 'emerald' | 'rose' | 'slate' }>;
  sections?: Array<{
    heading: string;
    body?: string;
    bullets?: string[];
    code?: { language?: string; content: string };
    table?: { headers: string[]; rows: string[][] };
    progress?: Array<{ label: string; value: number; max?: number }>;
  }>;
  htmlCode?: string;
}

export interface ExecutedStep {
  tool: string;
  args: Record<string, unknown>;
  status: 'executed' | 'awaiting_confirmation' | 'error';
  result?: unknown;
}

export interface AgentTurnResult {
  reply: string;
  steps: ExecutedStep[];
  pendingConfirmations: memory.PendingConfirmation[];
  screens: HolographicScreenPayload[];
  cameraAction?: 'enable' | 'disable';
  usage: TurnUsageStats;
}

function safeParseJson<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string' || !raw.trim()) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function queueConfirmation(
  actionType: string,
  target: string,
  summary: string,
  payload: Record<string, unknown>
): memory.PendingConfirmation {
  const id = `act_${crypto.randomBytes(6).toString('hex')}`;
  return memory.savePendingConfirmation({ id, actionType, target, summary, payload });
}

export interface SingleToolExecutionOutcome {
  toolResult: Record<string, unknown>;
  step: ExecutedStep;
  pendingConfirmation?: memory.PendingConfirmation;
  extraConfirmations?: memory.PendingConfirmation[];
  drawnScreen?: HolographicScreenPayload;
  extraScreens?: HolographicScreenPayload[];
  cameraAction?: 'enable' | 'disable';
}

function summarizeToolOutcome(toolName: string, result: Record<string, unknown>): string {
  if (!result || typeof result !== 'object') return `${toolName} concluída.`;
  if (result.error) return `Erro: ${String(result.error).slice(0, 140)}`;
  if (result.requiresConfirmation) return `Aguardando confirmação do operador.`;
  if (typeof result.summary === 'string' && result.summary.trim()) return result.summary.trim().slice(0, 160);
  if (typeof result.message === 'string' && result.message.trim()) return result.message.trim().slice(0, 160);
  if (Array.isArray(result.entries)) return `${result.entries.length} itens encontrados.`;
  if (Array.isArray(result.files)) return `${result.files.length} arquivos encontrados.`;
  if (Array.isArray(result.devices)) return `${result.devices.length} dispositivos verificados.`;
  if (Array.isArray(result.matches)) return `${result.matches.length} correspondências.`;
  if (typeof result.exitCode === 'number') {
    const outPreview = typeof result.stdout === 'string' ? result.stdout.trim().slice(0, 90) : '';
    return `exit=${result.exitCode}${outPreview ? ` · ${outPreview}` : ''}`;
  }
  return result.ok === false ? 'Execução falhou.' : 'Executado com sucesso.';
}

const CACHEABLE_READONLY_TOOLS = new Set<string>([
  'linux_system_status',
  'linux_list_files',
  'linux_read_file',
  'linux_search_files',
  'drive_list_files',
  'drive_read_file',
  'gmail_list_messages',
  'calendar_list_events',
  'tasks_list',
  'devices_list_all',
  'device_inspect_data',
  'memory_search',
  'list_evolved_capabilities',
  'web_list_routines',
  'web_list_credentials',
]);

function buildToolCacheKey(name: string, args: Record<string, unknown>): string | null {
  if (!CACHEABLE_READONLY_TOOLS.has(name)) return null;
  const sortedKeys = Object.keys(args).sort();
  const normalized: Record<string, unknown> = {};
  for (const k of sortedKeys) normalized[k] = args[k];
  return `${name}:${JSON.stringify(normalized)}`;
}

function selectFocusedCuratorTools(params: {
  allTools: FunctionDeclaration[];
  activeSubagents: SubagentId[];
  workspaceConnected: boolean;
  hasDevices: boolean;
}): FunctionDeclaration[] {
  // Always keep core orchestrator, screen projection, evolution, camera & memory tools
  const coreNames = new Set<string>([
    'draw_holographic_screen',
    'request_camera_vision',
    'delegate_subagent',
    'evaluate_and_evolve_capability',
    'list_evolved_capabilities',
    'invoke_evolved_capability',
    'memory_remember',
    'memory_search',
    'ecosystem_unified_search',
  ]);
  const evolvedNames = new Set(selfEvolution.getActiveEvolvedToolDeclarations().map((d) => d.name));
  const subSet = new Set(params.activeSubagents);

  const filtered = params.allTools.filter((decl) => {
    const n = decl.name || '';
    if (!n) return false;
    if (coreNames.has(n) || evolvedNames.has(n)) return true;
    if (subSet.has('local_system') && n.startsWith('linux_')) return true;
    if (subSet.has('web_operator') && n.startsWith('web_')) return true;
    if (subSet.has('mobile_devices') && n.startsWith('device')) return true;
    if (
      subSet.has('workspace_cloud') &&
      params.workspaceConnected &&
      (n.startsWith('gmail_') ||
        n.startsWith('drive_') ||
        n.startsWith('calendar_') ||
        n.startsWith('docs_') ||
        n.startsWith('sheets_') ||
        n.startsWith('tasks_'))
    ) {
      return true;
    }
    // If general research_drafting ran, keep lightweight local & workspace read access
    if (subSet.has('research_drafting')) {
      if (n === 'linux_system_status' || n === 'linux_list_files' || n === 'linux_read_file') return true;
      if (params.workspaceConnected && (n === 'drive_list_files' || n === 'gmail_list_messages' || n === 'calendar_list_events')) return true;
      if (params.hasDevices && n === 'devices_list_all') return true;
    }
    return false;
  });

  return filtered.length >= 6 ? filtered : params.allTools;
}

async function runSpecializedSubagent(params: {
  subagent: SubagentId;
  objective: string;
  context?: string;
  sessionId: string;
  googleToken: string | null;
  toolCache?: Map<string, SingleToolExecutionOutcome>;
  onProgress?: (ev: AgentRoutingProgressEvent) => void;
}): Promise<{
  ok: boolean;
  subagent: SubagentId;
  label: string;
  model: ConcreteModelId;
  summary: string;
  steps: ExecutedStep[];
  screens: HolographicScreenPayload[];
  pendingConfirmations: memory.PendingConfirmation[];
  latencyMs: number;
  promptTokens: number;
  outputTokens: number;
  thoughtsTokens: number;
  totalTokens: number;
}> {
  const profile = SUBAGENT_PROFILES[params.subagent] || SUBAGENT_PROFILES.research_drafting;
  let subModel: ConcreteModelId = profile.model;
  const triedSubModels = new Set<ConcreteModelId>();
  const t0 = Date.now();

  params.onProgress?.({
    event: 'subagent_start',
    data: {
      subagent: params.subagent,
      label: profile.label,
      objective: params.objective.slice(0, 160),
      model: subModel,
      role: 'worker',
    },
  });

  const allDecls = getAllToolDeclarations();
  const evolvedNames = new Set(selfEvolution.getActiveEvolvedToolDeclarations().map((d) => d.name));
  const subTools = allDecls.filter(
    (d) =>
      d.name &&
      (profile.toolFilter(d.name) ||
        (params.subagent === 'code_architect' && evolvedNames.has(d.name)))
  );

  const subContents: Content[] = [
    {
      role: 'user',
      parts: [
        {
          text: `Sub-tarefa de TRABALHO BRUTO atribuída pelo Orquestrador Aegis:
${params.objective}${params.context ? `\n\nContexto adicional:\n${params.context}` : ''}

Execute seu trabalho bruto de forma rápida, factual e verificável usando as ferramentas disponíveis (quando necessário). Entregue um dossiê estruturado e conciso em Português (Brasil) para o Curador Sênior revisar e refinar.`,
        },
      ],
    },
  ];

  const subSteps: ExecutedStep[] = [];
  const subScreens: HolographicScreenPayload[] = [];
  const subConfirmations: memory.PendingConfirmation[] = [];
  let promptTokens = 0;
  let outputTokens = 0;
  let thoughtsTokens = 0;
  let totalTokens = 0;

  const invokeWorkerModel = async () => {
    while (true) {
      try {
        const thinkingConfig = getThinkingConfigForModel(subModel);
        return await getAi().models.generateContent({
          model: subModel,
          contents: subContents,
          config: {
            systemInstruction: `${profile.directive}\nPapel na arquitetura: ${profile.workerRole}\nGoogle Workspace conectado: ${params.googleToken ? 'SIM' : 'NÃO'}.\nNunca invente saídas; reporte exatamente o que as ferramentas retornaram ou o rascunho objetivo para o Curador Sênior.`,
            ...(thinkingConfig ? { thinkingConfig } : {}),
            tools: subTools.length > 0 ? [{ functionDeclarations: subTools }] : undefined,
          },
        });
      } catch (apiErr: unknown) {
        if (!isModelEscalationFallbackError(apiErr)) {
          throw apiErr;
        }
        triedSubModels.add(subModel);
        const nextModel =
          !triedSubModels.has(profile.fallbackModel)
            ? profile.fallbackModel
            : nextFallbackModel(subModel, triedSubModels);
        if (!nextModel) {
          throw apiErr;
        }
        subModel = nextModel;
      }
    }
  };

  try {
    let finalSummary = 'Trabalho bruto concluído.';
    const WORKER_DEADLINE_MS = 28_000;
    for (let hop = 0; hop < 3; hop++) {
      if (Date.now() - t0 > WORKER_DEADLINE_MS) {
        finalSummary = `${finalSummary} (tempo limite de coleta do trabalhador atingido — encaminhando achados parciais ao Curador).`;
        break;
      }
      const response = await invokeWorkerModel();

      if (response.usageMetadata) {
        promptTokens += response.usageMetadata.promptTokenCount || 0;
        outputTokens += response.usageMetadata.candidatesTokenCount || 0;
        thoughtsTokens += response.usageMetadata.thoughtsTokenCount || 0;
        totalTokens +=
          response.usageMetadata.totalTokenCount ||
          (response.usageMetadata.promptTokenCount || 0) + (response.usageMetadata.candidatesTokenCount || 0);
      }

      const thoughtTexts = extractThoughtTextsFromResponse(response);
      for (const tText of thoughtTexts) {
        params.onProgress?.({
          event: 'thought',
          data: {
            source: profile.label,
            role: 'worker',
            model: subModel,
            text: tText,
          },
        });
      }

      const calls = response.functionCalls || [];
      if (calls.length === 0) {
        finalSummary = (response.text || 'Sub-tarefa concluída pelo subagente trabalhador.').trim();
        break;
      }

      if (response.candidates?.[0]?.content) {
        subContents.push(response.candidates[0].content);
      }

      // Execute all tool calls in this hop in parallel for maximum throughput!
      const parallelOutcomes = await Promise.all(
        calls.map(async (call) => {
          const toolName = call.name || 'unknown';
          const toolArgs = (call.args || {}) as Record<string, unknown>;
          const cacheKey = buildToolCacheKey(toolName, toolArgs);
          const cached = cacheKey && params.toolCache ? params.toolCache.get(cacheKey) : undefined;

          if (cached) {
            params.onProgress?.({
              event: 'tool_done',
              data: {
                tool: toolName,
                status: cached.step.status,
                subagent: profile.label,
                summary: `[cache 0ms] ${summarizeToolOutcome(toolName, cached.toolResult)}`,
              },
            });
            return { call, out: cached };
          }

          params.onProgress?.({
            event: 'tool_start',
            data: {
              tool: toolName,
              hop,
              model: subModel,
              tier: MODEL_TO_TIER[subModel],
              routingMode: 'auto',
              reason: `[${profile.label}] Executando ${toolName}...`,
            },
          });

          const out = await executeAgentToolCall({
            name: toolName,
            args: toolArgs,
            sessionId: params.sessionId,
            googleToken: params.googleToken,
            onProgress: params.onProgress,
            depth: 1,
          });

          if (cacheKey && params.toolCache && out.step.status === 'executed') {
            params.toolCache.set(cacheKey, out);
          }

          params.onProgress?.({
            event: 'tool_done',
            data: {
              tool: toolName,
              status: out.step.status,
              subagent: profile.label,
              summary: summarizeToolOutcome(toolName, out.toolResult),
            },
          });

          return { call, out };
        })
      );

      const responseParts: Array<{
        functionResponse: { id?: string; name: string; response: Record<string, unknown> };
      }> = [];

      for (const { call, out } of parallelOutcomes) {
        subSteps.push(out.step);
        if (out.drawnScreen) subScreens.push(out.drawnScreen);
        if (out.extraScreens) subScreens.push(...out.extraScreens);
        if (out.pendingConfirmation) subConfirmations.push(out.pendingConfirmation);
        if (out.extraConfirmations) subConfirmations.push(...out.extraConfirmations);

        responseParts.push({
          functionResponse: {
            id: call.id,
            name: call.name || 'unknown',
            response: out.toolResult,
          },
        });
      }

      subContents.push({ role: 'user', parts: responseParts });
    }

    const latencyMs = Date.now() - t0;
    const status = subConfirmations.length > 0 ? 'awaiting_confirmation' : 'ok';

    memory.logSubagentRun({
      sessionId: params.sessionId,
      subagentName: params.subagent,
      objective: params.objective,
      model: subModel,
      status,
      summary: finalSummary,
      stepsCount: subSteps.length,
      latencyMs,
    });
    memory.logUsage({
      sessionId: `${params.sessionId}:${params.subagent}`,
      model: subModel,
      routingMode: 'auto',
      routingReason: `Trabalho bruto — ${profile.label}`,
      complexityTier: MODEL_TO_TIER[subModel],
      promptTokens,
      outputTokens,
      thoughtsTokens,
      totalTokens,
      latencyMs,
      toolCallsCount: subSteps.length,
      status: 'ok',
    });

    params.onProgress?.({
      event: 'subagent_done',
      data: {
        subagent: params.subagent,
        label: profile.label,
        model: subModel,
        status,
        summary: finalSummary.slice(0, 320),
        stepsCount: subSteps.length,
        latencyMs,
      },
    });

    return {
      ok: true,
      subagent: params.subagent,
      label: profile.label,
      model: subModel,
      summary: finalSummary,
      steps: subSteps,
      screens: subScreens,
      pendingConfirmations: subConfirmations,
      latencyMs,
      promptTokens,
      outputTokens,
      thoughtsTokens,
      totalTokens,
    };
  } catch (err: unknown) {
    const latencyMs = Date.now() - t0;
    const errMsg = err instanceof Error ? err.message : 'Erro interno no subagente.';
    memory.logSubagentRun({
      sessionId: params.sessionId,
      subagentName: params.subagent,
      objective: params.objective,
      model: subModel,
      status: 'error',
      summary: errMsg,
      stepsCount: subSteps.length,
      latencyMs,
    });
    params.onProgress?.({
      event: 'subagent_done',
      data: {
        subagent: params.subagent,
        label: profile.label,
        model: subModel,
        status: 'error',
        summary: errMsg,
        stepsCount: subSteps.length,
        latencyMs,
      },
    });
    return {
      ok: false,
      subagent: params.subagent,
      label: profile.label,
      model: subModel,
      summary: `Falha no ${profile.label}: ${errMsg}`,
      steps: subSteps,
      screens: subScreens,
      pendingConfirmations: subConfirmations,
      latencyMs,
      promptTokens,
      outputTokens,
      thoughtsTokens,
      totalTokens,
    };
  }
}

export async function executeAgentToolCall(params: {
  name: string;
  args: Record<string, unknown>;
  sessionId: string;
  googleToken: string | null;
  onProgress?: (ev: AgentRoutingProgressEvent) => void;
  depth?: number;
}): Promise<SingleToolExecutionOutcome> {
  const { name, args, sessionId, googleToken, onProgress, depth = 0 } = params;
  let toolResult: Record<string, unknown> = {};
  let pendingConfirmation: memory.PendingConfirmation | undefined;
  let drawnScreen: HolographicScreenPayload | undefined;
  let cameraAction: 'enable' | 'disable' | undefined;

  try {
    // --- AUTONOMOUS SUBAGENT ORCHESTRATION & SELF-EVOLUTION ---
    if (name === 'delegate_subagent') {
      if (depth >= 1) {
        toolResult = {
          ok: false,
          error: 'Delegação aninhada bloqueada: o subagente deve executar diretamente usando suas próprias ferramentas.',
        };
        return { toolResult, step: { tool: name, args, status: 'error', result: toolResult } };
      }
      const rawTarget = String(args.subagent || 'research_drafting') as SubagentId;
      const target: SubagentId = VALID_SUBAGENT_IDS.includes(rawTarget) ? rawTarget : 'research_drafting';
      const objective = String(args.objective || '').trim();
      if (!objective) {
        toolResult = { ok: false, error: 'Objetivo do subagente é obrigatório.' };
        return { toolResult, step: { tool: name, args, status: 'error', result: toolResult } };
      }

      const subRes = await runSpecializedSubagent({
        subagent: target,
        objective,
        context: args.context ? String(args.context) : undefined,
        sessionId,
        googleToken,
        onProgress,
      });

      toolResult = {
        ok: subRes.ok,
        subagent: subRes.subagent,
        label: subRes.label,
        model: subRes.model,
        summary: subRes.summary,
        stepsExecuted: subRes.steps.length,
        screensDrawn: subRes.screens.length,
        confirmationsRequired: subRes.pendingConfirmations.length,
        latencyMs: subRes.latencyMs,
      };

      return {
        toolResult,
        step: {
          tool: `subagent:${subRes.subagent}`,
          args: { objective: objective.slice(0, 140) },
          status: subRes.ok ? 'executed' : 'error',
          result: { summary: subRes.summary.slice(0, 400), stepsExecuted: subRes.steps.length, latencyMs: subRes.latencyMs },
        },
        extraScreens: subRes.screens,
        extraConfirmations: subRes.pendingConfirmations,
      };
    }

    if (name === 'evaluate_and_evolve_capability') {
      const capName = String(args.name || '').trim().toLowerCase();
      const description = String(args.description || '').trim();
      const limitationReason = String(args.limitationReason || 'Lacuna funcional detectada pelo orquestrador').trim();
      const code = String(args.code || '');
      const parametersSpec = safeParseJson<Record<string, selfEvolution.ParameterPropertySpec>>(
        args.parametersSpecJson,
        {}
      );
      const testArgs = safeParseJson<Record<string, unknown>>(args.testArgsJson, {});

      onProgress?.({
        event: 'code_evolution',
        data: {
          phase: 'synthesizing',
          capabilityName: capName || 'nova_capacidade',
          message: `Sintetizando e validando nova função "${capName || 'nova_capacidade'}" no código do Aegis...`,
        },
      });

      const evoRes = await selfEvolution.createOrUpdateEvolvedCapability({
        name: capName,
        description,
        limitationReason,
        parametersSpec,
        code,
        testArgs,
      });

      if (!evoRes.ok || !evoRes.capability) {
        onProgress?.({
          event: 'code_evolution',
          data: {
            phase: 'failed',
            capabilityName: capName || 'nova_capacidade',
            message: evoRes.error || 'Falha na validação da função gerada.',
          },
        });
        toolResult = {
          ok: false,
          error: evoRes.error,
          testResult: evoRes.testResult,
          hint: 'Corrija o erro reportado acima e chame evaluate_and_evolve_capability novamente.',
        };
        return {
          toolResult,
          step: {
            tool: name,
            args: { name: capName, limitationReason },
            status: 'error',
            result: toolResult,
          },
        };
      }

      onProgress?.({
        event: 'code_evolution',
        data: {
          phase: 'verified',
          capabilityName: evoRes.capability.name,
          version: evoRes.capability.version,
          message: `Nova função "${evoRes.capability.name}" v${evoRes.capability.version} verificada e integrada ao Aegis.`,
        },
      });

      memory.logInteraction({
        sessionId,
        role: 'tool',
        content: `[AUTO-EVOLUÇÃO] Função "${evoRes.capability.name}" v${evoRes.capability.version} criada em ${evoRes.capability.file_path} (Motivo: ${limitationReason})`,
      });

      toolResult = {
        ok: true,
        capability: {
          name: evoRes.capability.name,
          version: evoRes.capability.version,
          filePath: evoRes.capability.file_path,
          description: evoRes.capability.description,
        },
        testResult: evoRes.testResult,
        message: `Capacidade "${evoRes.capability.name}" v${evoRes.capability.version} gravada em ${evoRes.capability.file_path}, testada com sucesso e registrada como ferramenta ativa.`,
      };
      return {
        toolResult,
        step: {
          tool: name,
          args: { name: evoRes.capability.name, filePath: evoRes.capability.file_path },
          status: 'executed',
          result: {
            version: evoRes.capability.version,
            testOutput: evoRes.testResult.output,
            durationMs: evoRes.testResult.durationMs,
          },
        },
      };
    }

    if (name === 'list_evolved_capabilities') {
      const caps = memory.listEvolvedCapabilities().map((c) => ({
        name: c.name,
        version: c.version,
        enabled: Boolean(c.enabled),
        description: c.description,
        limitationReason: c.limitation_reason,
        filePath: c.file_path,
        runCount: c.run_count,
        testStatus: c.test_status,
      }));
      toolResult = { ok: true, count: caps.length, capabilities: caps };
      return { toolResult, step: { tool: name, args, status: 'executed', result: { count: caps.length } } };
    }

    if (name === 'invoke_evolved_capability') {
      const capName = String(args.name || '').trim().toLowerCase();
      const capArgs = safeParseJson<Record<string, unknown>>(args.argsJson, {});
      const execRes = await selfEvolution.executeEvolvedCapability(capName, capArgs);
      toolResult = execRes.ok
        ? { ok: true, capability: execRes.capabilityName, version: execRes.version, output: execRes.output, logs: execRes.logs, durationMs: execRes.durationMs }
        : { ok: false, capability: execRes.capabilityName, error: execRes.error, logs: execRes.logs };
      return {
        toolResult,
        step: { tool: `evolved:${capName}`, args: capArgs, status: execRes.ok ? 'executed' : 'error', result: toolResult },
      };
    }

    // --- HOLOGRAPHIC GENERATIVE SCREENS & VISION ---
    if (name === 'draw_holographic_screen') {
      const rawKind = String(args.kind || 'interactive_dashboard');
      const validKinds = ['file_viewer', 'image_gallery', 'web_canvas', 'interactive_dashboard', 'html_artifact'] as const;
      const kind = (validKinds.includes(rawKind as (typeof validKinds)[number])
        ? rawKind
        : 'interactive_dashboard') as HolographicScreenPayload['kind'];

      const screen: HolographicScreenPayload = {
        id: `scr_${crypto.randomBytes(5).toString('hex')}`,
        title: String(args.title || 'Projeção Holográfica Aegis'),
        subtitle: args.subtitle ? String(args.subtitle) : undefined,
        kind,
        createdAt: new Date().toISOString(),
      };

      if (kind === 'file_viewer') {
        const src = String(args.fileSource || 'inline');
        screen.fileSource = src === 'drive' || src === 'local' ? src : 'inline';
        screen.fileIdOrPath = args.fileIdOrPath ? String(args.fileIdOrPath) : undefined;
        screen.fileName = String(args.fileName || args.fileIdOrPath || screen.title);
        screen.mimeType = args.mimeType ? String(args.mimeType) : 'text/plain';
        screen.content = args.content ? String(args.content) : undefined;

        if (screen.fileSource === 'local' && screen.fileIdOrPath && !screen.content) {
          try {
            const localFile = linux.readLocalFile(screen.fileIdOrPath);
            screen.fileName = localFile.name;
            screen.mimeType = localFile.mimeType;
            screen.content = localFile.content;
          } catch {
            // Let client load or show message
          }
        }
      } else if (kind === 'image_gallery') {
        screen.images = safeParseJson(args.imagesJson, []);
      } else if (kind === 'web_canvas') {
        const url = args.webUrl ? String(args.webUrl) : '';
        if (url && !args.webText) {
          try {
            const snap = await webBrowser.webNavigate(sessionId, url);
            screen.webUrl = snap.url;
            screen.webTitle = snap.title || screen.title;
            screen.webText = snap.textPreview;
            screen.webHeadings = snap.headings;
            screen.webLinks = snap.links.slice(0, 24);
            screen.webTables = snap.tables;
          } catch {
            screen.webUrl = url;
            screen.webTitle = args.webTitle ? String(args.webTitle) : screen.title;
            screen.webText = args.webText ? String(args.webText) : '';
          }
        } else {
          screen.webUrl = url;
          screen.webTitle = args.webTitle ? String(args.webTitle) : screen.title;
          screen.webText = args.webText ? String(args.webText) : '';
        }
      } else if (kind === 'interactive_dashboard') {
        screen.metrics = safeParseJson(args.metricsJson, []);
        screen.sections = safeParseJson(args.sectionsJson, []);
      } else if (kind === 'html_artifact') {
        screen.htmlCode = String(args.htmlCode || '');
      }

      drawnScreen = screen;
      toolResult = {
        ok: true,
        screenId: screen.id,
        kind: screen.kind,
        title: screen.title,
        message: `Tela holográfica "${screen.title}" projetada sobre o núcleo 3D.`,
      };
      return {
        toolResult,
        step: { tool: name, args: { kind: screen.kind, title: screen.title }, status: 'executed', result: toolResult },
        drawnScreen,
      };
    }

    if (name === 'request_camera_vision') {
      const action = String(args.action || 'enable').toLowerCase() === 'disable' ? 'disable' : 'enable';
      cameraAction = action;
      toolResult = {
        ok: true,
        action,
        message:
          action === 'enable'
            ? 'Solicitação enviada para ativar a visão por câmera do usuário em tempo real.'
            : 'Solicitação enviada para desligar a câmera do usuário.',
      };
      return {
        toolResult,
        step: { tool: name, args, status: 'executed', result: toolResult },
        cameraAction,
      };
    }

    // --- LOCAL SYSTEM READS & FREE NON-DESTRUCTIVE ACTIONS ---
    if (name === 'linux_system_info') {
      const info = await linux.getLinuxSystemStatus();
      toolResult = { ok: true, system: info };
      return { toolResult, step: { tool: name, args, status: 'executed', result: info } };
    }
    if (name === 'linux_list_files') {
      const files = linux.listLocalFiles(String(args.subpath || '.'));
      toolResult = { ok: true, files };
      return { toolResult, step: { tool: name, args, status: 'executed', result: { count: files.length } } };
    }
    if (name === 'linux_search_files') {
      const hits = linux.searchLocalFiles(String(args.query || ''), String(args.subpath || '.'));
      toolResult = { ok: true, hits };
      return { toolResult, step: { tool: name, args, status: 'executed', result: { count: hits.length } } };
    }
    if (name === 'linux_read_file') {
      const file = linux.readLocalFile(String(args.path || ''));
      toolResult = { ok: true, file };
      return { toolResult, step: { tool: name, args, status: 'executed', result: { path: file.path, sizeBytes: file.sizeBytes } } };
    }
    if (name === 'linux_run_command') {
      const cmd = String(args.command || '');
      if (linux.isDestructiveShellCommand(cmd)) {
        pendingConfirmation = queueConfirmation(
          'linux_run_command',
          cmd,
          `Executar comando destrutivo no sistema: \`${cmd}\``,
          { command: cmd }
        );
        toolResult = { status: 'AWAITING_USER_CONFIRMATION', confirmationId: pendingConfirmation.id, summary: pendingConfirmation.summary };
        return {
          toolResult,
          step: { tool: name, args, status: 'awaiting_confirmation', result: { confirmationId: pendingConfirmation.id } },
          pendingConfirmation,
        };
      }
      const out = await linux.runLinuxCommand(cmd);
      toolResult = { ok: out.exitCode === 0, ...out };
      return { toolResult, step: { tool: name, args, status: 'executed', result: out } };
    }
    if (name === 'linux_write_file') {
      const filePath = String(args.path || '');
      const saved = linux.writeLocalFile(filePath, String(args.content || ''));
      toolResult = { ok: true, ...saved };
      return { toolResult, step: { tool: name, args: { path: filePath }, status: 'executed', result: saved } };
    }
    if (name === 'linux_move_file') {
      const src = String(args.source || '');
      const dst = String(args.destination || '');
      const moved = linux.moveLocalFile(src, dst);
      toolResult = { ok: true, ...moved };
      return { toolResult, step: { tool: name, args, status: 'executed', result: moved } };
    }
    if (name === 'linux_delete_file') {
      const filePath = String(args.path || '');
      pendingConfirmation = queueConfirmation(
        'linux_delete_file',
        filePath,
        `Excluir permanentemente arquivo/diretório local: ${filePath}`,
        { path: filePath }
      );
      toolResult = { status: 'AWAITING_USER_CONFIRMATION', confirmationId: pendingConfirmation.id, summary: pendingConfirmation.summary };
      return {
        toolResult,
        step: { tool: name, args, status: 'awaiting_confirmation', result: { confirmationId: pendingConfirmation.id } },
        pendingConfirmation,
      };
    }
    if (name === 'linux_organize_directory') {
      const dir = String(args.directory || 'Downloads');
      const plan = linux.planDirectoryOrganization(dir);
      if (plan.length === 0) {
        toolResult = { ok: true, message: `Nenhum arquivo solto para organizar em ${dir}.` };
        return { toolResult, step: { tool: name, args, status: 'executed', result: { planCount: 0 } } };
      }
      const applied = linux.applyDirectoryOrganization(plan);
      toolResult = { ok: true, ...applied };
      return { toolResult, step: { tool: name, args, status: 'executed', result: applied } };
    }

    // --- MEMORY TOOLS ---
    if (name === 'memory_save_fact') {
      const cat = String(args.category || 'fact') as memory.MemoryFact['category'];
      const validCat = ['preference', 'fact', 'system', 'contact', 'workflow'].includes(cat) ? cat : 'fact';
      const saved = memory.addMemoryFact({
        category: validCat,
        content: String(args.content || ''),
        source: 'gemini-agent',
        pinned: Boolean(args.pinned),
      });
      toolResult = { ok: true, saved };
      return { toolResult, step: { tool: name, args, status: 'executed', result: saved } };
    }
    if (name === 'memory_search') {
      const hits = memory.listMemoryFacts(String(args.query || ''));
      toolResult = { ok: true, hits };
      return { toolResult, step: { tool: name, args, status: 'executed', result: { count: hits.length } } };
    }

    // --- WEB BROWSER & CREDENTIAL VAULT TOOLS ---
    if (name === 'web_navigate') {
      const snap = await webBrowser.webNavigate(sessionId, String(args.url || ''));
      toolResult = {
        ok: snap.status < 400,
        url: snap.url,
        status: snap.status,
        title: snap.title,
        headings: snap.headings,
        textPreview: snap.textPreview.slice(0, 3500),
        linksCount: snap.links.length,
        topLinks: snap.links.slice(0, 12),
        formsCount: snap.forms.length,
        forms: snap.forms,
      };
      return { toolResult, step: { tool: name, args, status: 'executed', result: { url: snap.url, title: snap.title, status: snap.status } } };
    }
    if (name === 'web_extract') {
      const extracted = await webBrowser.webExtract(
        sessionId,
        String(args.url || ''),
        args.selector ? String(args.selector) : undefined
      );
      toolResult = { ok: true, ...extracted };
      return { toolResult, step: { tool: name, args, status: 'executed', result: { url: extracted.url, matches: extracted.matches.length } } };
    }
    if (name === 'web_login') {
      const target = String(args.siteOrCredentialId || args.loginUrl || 'Site');
      pendingConfirmation = queueConfirmation(
        'web_login',
        target,
        `Autenticar automaticamente no site "${target}" usando as credenciais configuradas`,
        {
          sessionId,
          siteOrCredentialId: args.siteOrCredentialId ? String(args.siteOrCredentialId) : undefined,
          loginUrl: args.loginUrl ? String(args.loginUrl) : undefined,
          username: args.username ? String(args.username) : undefined,
          passwordEnc: args.password ? auth.encryptPacked(String(args.password)) : undefined,
        }
      );
      toolResult = { status: 'AWAITING_USER_CONFIRMATION', confirmationId: pendingConfirmation.id, summary: pendingConfirmation.summary };
      return {
        toolResult,
        step: { tool: name, args: { target }, status: 'awaiting_confirmation', result: { confirmationId: pendingConfirmation.id } },
        pendingConfirmation,
      };
    }
    if (name === 'web_perform_action') {
      const target = String(args.clickLinkText || args.url || 'Sessão Web');
      pendingConfirmation = queueConfirmation(
        'web_perform_action',
        target,
        `Executar ação web em "${target}"`,
        {
          sessionId,
          url: args.url ? String(args.url) : undefined,
          clickLinkText: args.clickLinkText ? String(args.clickLinkText) : undefined,
          formIndex: args.formIndex !== undefined ? Number(args.formIndex) : 0,
          fieldsJson: args.fieldsJson ? String(args.fieldsJson) : '{}',
        }
      );
      toolResult = { status: 'AWAITING_USER_CONFIRMATION', confirmationId: pendingConfirmation.id, summary: pendingConfirmation.summary };
      return {
        toolResult,
        step: { tool: name, args, status: 'awaiting_confirmation', result: { confirmationId: pendingConfirmation.id } },
        pendingConfirmation,
      };
    }
    if (name === 'web_save_credential') {
      const site = String(args.siteName || '');
      pendingConfirmation = queueConfirmation(
        'web_save_credential',
        site,
        `Salvar credencial criptografada para "${site}" (${String(args.username || '')}) no Cofre Web`,
        {
          siteName: site,
          loginUrl: String(args.loginUrl || ''),
          username: String(args.username || ''),
          passwordEnc: auth.encryptPacked(String(args.password || '')),
          notes: String(args.notes || ''),
        }
      );
      toolResult = { status: 'AWAITING_USER_CONFIRMATION', confirmationId: pendingConfirmation.id, summary: pendingConfirmation.summary };
      return {
        toolResult,
        step: { tool: name, args: { siteName: site, loginUrl: args.loginUrl, username: args.username }, status: 'awaiting_confirmation', result: { confirmationId: pendingConfirmation.id } },
        pendingConfirmation,
      };
    }
    if (name === 'web_map_submenus') {
      const mapped = await webRoutines.mapSiteSubmenusWithAI(sessionId, {
        url: args.url ? String(args.url) : undefined,
        credentialId: args.credentialId ? String(args.credentialId) : undefined,
      });
      toolResult = {
        ok: true,
        url: mapped.snapshot.url,
        title: mapped.snapshot.title,
        breadcrumbs: mapped.snapshot.breadcrumbs,
        siteOverview: mapped.siteOverview,
        understoodMenus: mapped.understoodMenus.slice(0, 35),
        attachments: mapped.attachments.slice(0, 20),
      };
      return {
        toolResult,
        step: {
          tool: name,
          args,
          status: 'executed',
          result: {
            url: mapped.snapshot.url,
            menusCount: mapped.understoodMenus.length,
            attachmentsCount: mapped.attachments.length,
          },
        },
      };
    }
    if (name === 'web_download_and_organize') {
      const fileUrl = String(args.fileUrl || '');
      const localFolder = String(args.localFolder || 'Downloads/Portais');
      const driveFolder = String(args.driveFolder || '');
      pendingConfirmation = queueConfirmation(
        'web_download_and_organize',
        fileUrl,
        `Baixar anexo de "${fileUrl}" para pasta local "${localFolder}"${driveFolder ? ` e sincronizar no Google Drive em "${driveFolder}"` : ''}`,
        {
          sessionId,
          fileUrl,
          preferredFilename: args.preferredFilename ? String(args.preferredFilename) : undefined,
          localFolder,
          driveFolder,
        }
      );
      toolResult = {
        status: 'AWAITING_USER_CONFIRMATION',
        confirmationId: pendingConfirmation.id,
        summary: pendingConfirmation.summary,
      };
      return {
        toolResult,
        step: { tool: name, args, status: 'awaiting_confirmation', result: { confirmationId: pendingConfirmation.id } },
        pendingConfirmation,
      };
    }
    if (name === 'web_save_routine') {
      let resolvedCredId: number | null = null;
      if (args.credentialId) {
        const cred = memory.findWebCredential(String(args.credentialId));
        if (cred) resolvedCredId = cred.id;
      }
      const targetSections = Array.isArray(args.targetSections)
        ? args.targetSections.map((s) => String(s))
        : [];
      const saved = memory.saveWebRoutine({
        userId: 0,
        name: String(args.name || 'Rotina Web'),
        siteName: String(args.siteName || ''),
        credentialId: resolvedCredId,
        startUrl: String(args.startUrl || ''),
        targetSections,
        extractionInstructions: String(args.extractionInstructions || ''),
        downloadAttachments: args.downloadAttachments !== false,
        fileExtensions: String(args.fileExtensions || 'pdf,xlsx,xls,csv,docx,zip,xml'),
        localFolder: String(args.localFolder || 'Downloads/Portais'),
        driveFolder: String(args.driveFolder || ''),
        autoOrganizeBySection: args.autoOrganizeBySection !== false,
      });
      toolResult = {
        ok: true,
        routine: {
          id: saved.id,
          name: saved.name,
          startUrl: saved.start_url,
          credentialId: saved.credential_id,
          targetSections,
          localFolder: saved.local_folder,
          driveFolder: saved.drive_folder,
        },
      };
      return {
        toolResult,
        step: { tool: name, args, status: 'executed', result: { routineId: saved.id, name: saved.name } },
      };
    }
    if (name === 'web_run_routine') {
      const routineRef = args.routineIdOrName ? String(args.routineIdOrName) : '';
      const existing = routineRef ? memory.findWebRoutine(routineRef) : null;
      const targetName = existing?.name || routineRef || String(args.startUrl || 'Rotina Web');
      const driveDest = existing?.drive_folder || String(args.driveFolder || '');
      const localDest = existing?.local_folder || String(args.localFolder || 'Downloads/Portais');
      pendingConfirmation = queueConfirmation(
        'web_run_routine',
        targetName,
        `Executar rotina web autônoma "${targetName}" (login, navegação em sub-menus, extração de dados e organização de anexos em "${localDest}"${driveDest ? ` + Google Drive "${driveDest}"` : ''})`,
        {
          sessionId,
          routineId: existing?.id ?? null,
          inlineSpec: existing
            ? null
            : {
                name: targetName,
                credentialId: args.credentialId ? String(args.credentialId) : null,
                startUrl: String(args.startUrl || ''),
                targetSections: Array.isArray(args.targetSections)
                  ? args.targetSections.map((s) => String(s))
                  : [],
                extractionInstructions: String(args.extractionInstructions || ''),
                downloadAttachments: args.downloadAttachments !== false,
                localFolder: localDest,
                driveFolder: driveDest,
                autoOrganizeBySection: true,
              },
        }
      );
      toolResult = {
        status: 'AWAITING_USER_CONFIRMATION',
        confirmationId: pendingConfirmation.id,
        summary: pendingConfirmation.summary,
      };
      return {
        toolResult,
        step: { tool: name, args, status: 'awaiting_confirmation', result: { confirmationId: pendingConfirmation.id } },
        pendingConfirmation,
      };
    }

    // --- GOOGLE WORKSPACE TOOLS ---
    if (
      name.startsWith('gmail_') ||
      name.startsWith('drive_') ||
      name.startsWith('calendar_') ||
      name.startsWith('docs_') ||
      name.startsWith('sheets_') ||
      name.startsWith('tasks_')
    ) {
      if (!googleToken) {
        toolResult = {
          ok: false,
          error: 'Conta Google Workspace não autenticada nesta sessão. Peça ao usuário para conectar sua conta Google em Configurações → Google Drive & Workspace.',
        };
        return { toolResult, step: { tool: name, args, status: 'error', result: toolResult } };
      }
      if (name === 'gmail_list_analyze') {
        const res = await gw.gmailListMessages(googleToken, String(args.query || ''), Number(args.maxResults || 8));
        toolResult = res.ok ? { ok: true, ...(res.data as object) } : { ok: false, error: res.error };
        return { toolResult, step: { tool: name, args, status: res.ok ? 'executed' : 'error', result: res.data } };
      }
      if (name === 'drive_list_files') {
        const res = await gw.driveListFiles(
          googleToken,
          String(args.query || ''),
          40,
          args.folderId ? String(args.folderId) : undefined
        );
        toolResult = res.ok ? { ok: true, ...(res.data as object) } : { ok: false, error: res.error };
        return { toolResult, step: { tool: name, args, status: res.ok ? 'executed' : 'error', result: res.data } };
      }
      if (name === 'drive_read_file') {
        const res = await gw.driveOpenFile(googleToken, String(args.fileId || ''));
        toolResult = res.ok ? { ok: true, ...(res.data as object) } : { ok: false, error: res.error };
        return { toolResult, step: { tool: name, args, status: res.ok ? 'executed' : 'error', result: { ok: res.ok } } };
      }
      if (name === 'calendar_list_events') {
        const res = await gw.calendarListEvents(googleToken, Number(args.maxResults || 15));
        toolResult = res.ok ? { ok: true, ...(res.data as object) } : { ok: false, error: res.error };
        return { toolResult, step: { tool: name, args, status: res.ok ? 'executed' : 'error', result: res.data } };
      }
      if (name === 'docs_read_document') {
        const res = await gw.docsReadDocument(googleToken, String(args.documentId || ''));
        toolResult = res.ok
          ? { ok: true, document: res.data, plainText: gw.docsExtractPlainText(res.data) }
          : { ok: false, error: res.error };
        return { toolResult, step: { tool: name, args, status: res.ok ? 'executed' : 'error', result: { ok: res.ok } } };
      }
      if (name === 'sheets_read_values') {
        const res = await gw.sheetsReadValues(
          googleToken,
          String(args.spreadsheetId || ''),
          String(args.range || 'A1:Z50')
        );
        toolResult = res.ok ? { ok: true, ...(res.data as object) } : { ok: false, error: res.error };
        return { toolResult, step: { tool: name, args, status: res.ok ? 'executed' : 'error', result: res.data } };
      }
      if (name === 'tasks_list') {
        const res = await gw.tasksListTasks(googleToken);
        toolResult = res.ok ? { ok: true, ...(res.data as object) } : { ok: false, error: res.error };
        return { toolResult, step: { tool: name, args, status: res.ok ? 'executed' : 'error', result: res.data } };
      }

      let summary = `Executar ação no Google Workspace: ${name}`;
      let target = 'Google Workspace';
      if (name === 'gmail_send_email') {
        target = String(args.to || '');
        summary = `Enviar e-mail via Gmail para ${target} — Assunto: "${String(args.subject || '')}"`;
      } else if (name === 'gmail_trash_message') {
        target = String(args.messageId || '');
        summary = `Mover e-mail "${String(args.subjectPreview || target)}" para a lixeira do Gmail`;
      } else if (name === 'drive_create_folder') {
        target = String(args.name || '');
        summary = `Criar pasta "${target}" no Google Drive`;
      } else if (name === 'drive_rename_file') {
        target = String(args.newName || '');
        summary = `Renomear item do Google Drive (${String(args.fileId || '')}) para "${target}"`;
      } else if (name === 'drive_move_file') {
        target = String(args.fileName || args.fileId || '');
        summary = `Mover arquivo "${target}" no Google Drive para a pasta ${String(args.targetFolderId || '')}`;
      } else if (name === 'drive_delete_file') {
        target = String(args.fileName || args.fileId || '');
        summary = `Mover arquivo "${target}" para a lixeira do Google Drive`;
      } else if (name === 'calendar_create_event') {
        target = String(args.summary || '');
        summary = `Criar evento "${target}" no Google Calendar (${String(args.startIso || '')})`;
      } else if (name === 'calendar_update_event') {
        target = String(args.summary || args.eventId || '');
        summary = `Atualizar evento "${target}" no Google Calendar`;
      } else if (name === 'calendar_delete_event') {
        target = String(args.summaryPreview || args.eventId || '');
        summary = `Excluir evento "${target}" do Google Calendar`;
      } else if (name === 'docs_create_document') {
        target = String(args.title || '');
        summary = `Criar Google Doc "${target}"`;
      } else if (name === 'docs_append_text') {
        target = String(args.documentId || '');
        summary = `Inserir texto no Google Doc ${target}`;
      } else if (name === 'docs_replace_content') {
        target = String(args.documentId || '');
        summary = `Atualizar o conteúdo completo do Google Doc ${target}`;
      } else if (name === 'sheets_create_spreadsheet') {
        target = String(args.title || '');
        summary = `Criar planilha no Google Sheets: "${target}"`;
      } else if (name === 'sheets_update_values') {
        target = String(args.spreadsheetId || '');
        summary = `Atualizar células na planilha ${target} (${String(args.range || 'A1')})`;
      } else if (name === 'sheets_append_rows') {
        target = String(args.spreadsheetId || '');
        summary = `Preencher linhas na planilha ${target} (${String(args.range || 'A1')})`;
      } else if (name === 'tasks_create') {
        target = String(args.title || '');
        summary = `Criar tarefa no Google Tasks: "${target}"`;
      } else if (name === 'tasks_update') {
        target = String(args.title || args.taskId || '');
        summary = `Atualizar tarefa no Google Tasks: "${target}"`;
      } else if (name === 'tasks_complete') {
        target = String(args.titlePreview || args.taskId || '');
        summary = `Concluir tarefa no Google Tasks: "${target}"`;
      }

      pendingConfirmation = queueConfirmation(name, target, summary, args);
      toolResult = { status: 'AWAITING_USER_CONFIRMATION', confirmationId: pendingConfirmation.id, summary };
      return {
        toolResult,
        step: { tool: name, args, status: 'awaiting_confirmation', result: { confirmationId: pendingConfirmation.id } },
        pendingConfirmation,
      };
    }

    // --- MULTI-DEVICE MESH & UNIFIED ECOSYSTEM VISIBILITY ---
    if (name === 'devices_list_all') {
      await deviceHub.detectLocalAdbDevices(0);
      const devices = memory.listPairedDevices().map(deviceHub.sanitizeDeviceRecord);
      toolResult = {
        ok: true,
        count: devices.length,
        devices: devices.map((d) => ({
          id: d.id,
          name: d.name,
          platform: d.platform,
          transport: d.transport,
          status: d.status,
          capabilities: d.capabilities,
          telemetry: d.telemetry,
          appsCount: d.apps.length,
          notificationsCount: d.notifications.length,
          filesCount: d.files.length,
          lastSeenAt: d.lastSeenAt,
        })),
      };
      return { toolResult, step: { tool: name, args, status: 'executed', result: { count: devices.length } } };
    }

    if (name === 'device_inspect_data') {
      const devId = String(args.deviceId || '').trim();
      const rec = memory.getPairedDeviceById(devId);
      if (!rec) {
        toolResult = { ok: false, error: `Dispositivo "${devId}" não encontrado. Chame devices_list_all primeiro.` };
        return { toolResult, step: { tool: name, args, status: 'error', result: toolResult } };
      }
      const d = deviceHub.sanitizeDeviceRecord(rec);
      const recentCommands = memory.listDeviceCommands(devId, 10);
      toolResult = {
        ok: true,
        device: d,
        recentCommands,
      };
      return { toolResult, step: { tool: name, args, status: 'executed', result: { name: d.name, status: d.status } } };
    }

    if (name === 'device_list_files') {
      const devId = String(args.deviceId || '').trim();
      const targetPath = String(args.path || '/sdcard');
      const res = await deviceHub.dispatchDeviceCommand(devId, 'list_files', { path: targetPath });
      toolResult = res.ok ? { ok: true, transport: res.transport, ...(typeof res.output === 'object' && res.output ? (res.output as object) : { output: res.output }) } : { ok: false, error: res.error };
      return { toolResult, step: { tool: name, args, status: res.ok ? 'executed' : 'error', result: { ok: res.ok, path: targetPath } } };
    }

    if (name === 'device_read_file') {
      const devId = String(args.deviceId || '').trim();
      const targetPath = String(args.path || '');
      const res = await deviceHub.dispatchDeviceCommand(devId, 'read_file', { path: targetPath });
      toolResult = res.ok ? { ok: true, transport: res.transport, ...(typeof res.output === 'object' && res.output ? (res.output as object) : { output: res.output }) } : { ok: false, error: res.error };
      return { toolResult, step: { tool: name, args, status: res.ok ? 'executed' : 'error', result: { ok: res.ok, path: targetPath } } };
    }

    if (name === 'device_execute_action') {
      const devId = String(args.deviceId || '').trim();
      const commandType = String(args.commandType || 'shell').trim();
      const payload = safeParseJson<Record<string, unknown>>(args.payloadJson, {});
      if (deviceHub.isDestructiveDeviceCommand(commandType, payload)) {
        const dev = memory.getPairedDeviceById(devId);
        pendingConfirmation = queueConfirmation(
          'device_execute_action',
          `${dev?.name || devId} (${commandType})`,
          `Executar ação destrutiva "${commandType}" no dispositivo ${dev?.name || devId}`,
          { deviceId: devId, commandType, payload }
        );
        toolResult = { status: 'AWAITING_USER_CONFIRMATION', confirmationId: pendingConfirmation.id, summary: pendingConfirmation.summary };
        return {
          toolResult,
          step: { tool: name, args: { deviceId: devId, commandType }, status: 'awaiting_confirmation', result: { confirmationId: pendingConfirmation.id } },
          pendingConfirmation,
        };
      }
      const res = await deviceHub.dispatchDeviceCommand(devId, commandType, payload);
      toolResult = res.ok
        ? { ok: true, commandId: res.commandId, queued: Boolean(res.queued), transport: res.transport, output: res.output }
        : { ok: false, error: res.error };
      return {
        toolResult,
        step: { tool: `device:${commandType}`, args: { deviceId: devId, ...payload }, status: res.ok ? 'executed' : 'error', result: toolResult },
      };
    }

    if (name === 'ecosystem_unified_search') {
      const query = String(args.query || '').trim();
      const localHits = query ? linux.searchLocalFiles(query, '.') : [];
      const deviceHits = query ? deviceHub.searchAcrossAllDevicesSnapshots(query) : [];
      let driveHits: unknown[] = [];
      let driveStatus = 'disconnected';
      if (googleToken && query) {
        const dRes = await gw.driveListFiles(googleToken, query, 20);
        if (dRes.ok) {
          driveHits = (dRes.data as { files?: unknown[] }).files || [];
          driveStatus = 'connected';
        } else {
          driveStatus = `error: ${dRes.error}`;
        }
      }
      toolResult = {
        ok: true,
        query,
        localFiles: localHits.slice(0, 20),
        googleDrive: { status: driveStatus, files: driveHits.slice(0, 20) },
        pairedDevices: deviceHits.slice(0, 30),
      };
      return {
        toolResult,
        step: {
          tool: name,
          args: { query },
          status: 'executed',
          result: { localCount: localHits.length, driveCount: driveHits.length, deviceHitsCount: deviceHits.length },
        },
      };
    }

    // --- DYNAMIC DISPATCH FOR SELF-EVOLVED CAPABILITIES ---
    const evolvedCap = memory.getEvolvedCapabilityByName(name);
    if (evolvedCap) {
      const execRes = await selfEvolution.executeEvolvedCapability(evolvedCap.name, args);
      toolResult = execRes.ok
        ? {
            ok: true,
            capability: execRes.capabilityName,
            version: execRes.version,
            output: execRes.output,
            logs: execRes.logs,
            durationMs: execRes.durationMs,
          }
        : {
            ok: false,
            capability: execRes.capabilityName,
            error: execRes.error,
            logs: execRes.logs,
          };
      return {
        toolResult,
        step: {
          tool: `evolved:${evolvedCap.name}`,
          args,
          status: execRes.ok ? 'executed' : 'error',
          result: toolResult,
        },
      };
    }

    toolResult = { ok: false, error: `Ferramenta desconhecida: ${name}` };
    return { toolResult, step: { tool: name, args, status: 'error', result: toolResult } };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro interno na ferramenta';
    toolResult = { ok: false, error: message };
    return { toolResult, step: { tool: name, args, status: 'error', result: toolResult } };
  }
}

export async function runAssistantTurn(params: {
  prompt: string;
  sessionId: string;
  mode: 'reactive' | 'proactive';
  modelPreference?: ModelPreference;
  googleToken: string | null;
  userEmail?: string;
  onProgress?: (ev: AgentRoutingProgressEvent) => void;
}): Promise<AgentTurnResult> {
  const t0 = Date.now();
  memory.logInteraction({
    sessionId: params.sessionId,
    role: params.mode === 'proactive' ? 'proactive' : 'user',
    content: params.prompt,
  });

  const memCtx = memory.searchMemoryContext(params.prompt, 5);
  const factsBlock = memCtx.facts
    .slice(0, 5)
    .map((f) => `- [${f.category}${f.pinned ? '|FIX' : ''}] ${f.content.slice(0, 120)}`)
    .join('\n');

  const recentBlock = memCtx.recentInteractions
    .slice(-3)
    .map((i) => `[${i.role}] ${i.content.slice(0, 130)}`)
    .join('\n');

  const savedCreds = memory.listWebCredentials().map((c) => `${c.site_name} (${c.login_url})`);
  const evolvedCaps = memory.listEvolvedCapabilities().filter((c) => c.enabled === 1);
  const devicesBlock = deviceHub.getDevicesContextSummaryForAI();
  const hasDevices = memory.listPairedDevices().length > 0;
  const workspaceConnected = Boolean(params.googleToken);
  const nowIso = new Date().toISOString();

  const routingMode: 'auto' | 'manual' =
    params.modelPreference && params.modelPreference !== 'auto' ? 'manual' : 'auto';
  const manualModel =
    params.modelPreference && params.modelPreference !== 'auto'
      ? (params.modelPreference as ConcreteModelId)
      : undefined;

  let activeModel: ConcreteModelId = manualModel || 'gemini-4-hydrogen';
  let activeTier: ComplexityTier = MODEL_TO_TIER[activeModel];
  let activeReason = 'Pipeline Subagentes Trabalhadores + Curador Sênior.';
  let fallbackUsed = false;
  const escalationTrail: ModelEscalationStep[] = [];
  const failedModels = new Set<ConcreteModelId>();

  const steps: ExecutedStep[] = [];
  const pendingConfirmations: memory.PendingConfirmation[] = [];
  const screens: HolographicScreenPayload[] = [];
  let cameraAction: 'enable' | 'disable' | undefined;

  const workerModelsSet = new Set<ConcreteModelId>();
  let curatorModelUsed: ConcreteModelId | undefined;
  let subtasksCount = 0;

  let promptTokens = 0;
  let outputTokens = 0;
  let thoughtsTokens = 0;
  let totalTokens = 0;

  // STAGE 1: Mission Decomposer (subdivides even modest tasks into lightweight Worker subtasks + Senior Curator)
  params.onProgress?.({
    event: 'routing_analyzing',
    data: {
      model: 'gemini-3.1-flash-lite',
      reason: 'Decompondo a missão entre subagentes trabalhadores e curador sênior...',
    },
  });

  const heuristic = scorePromptComplexity(params.prompt, params.mode);
  const missionPlan = await decomposeTaskForWorkersAndCurator({
    prompt: params.prompt,
    mode: params.mode,
    heuristic,
    workspaceConnected,
    hasDevices,
    manualModel,
  });

  let workerDossierText = '';
  const sharedToolCache = new Map<string, SingleToolExecutionOutcome>();
  const activeSubagentIds: SubagentId[] = missionPlan.subtasks.map((s) => s.subagent);

  if (missionPlan.shouldDecompose && missionPlan.subtasks.length > 0) {
    subtasksCount = missionPlan.subtasks.length;
    params.onProgress?.({
      event: 'plan_created',
      data: {
        planRationale: missionPlan.planRationale,
        curatorModel: missionPlan.curatorModel,
        curatorTier: missionPlan.curatorTier,
        subtasks: missionPlan.subtasks,
      },
    });

    const planSummaryLines = missionPlan.subtasks
      .map((st, idx) => `${idx + 1}. ${st.label} (${st.model}): ${st.objective}`)
      .join('\n');
    params.onProgress?.({
      event: 'thought',
      data: {
        source: 'Decompositor de Missão',
        role: 'decomposer',
        model: 'gemini-3.1-flash-lite',
        text: `${missionPlan.planRationale}\n\nSub-tarefas de trabalho bruto:\n${planSummaryLines}\n\nCuradoria final designada para: ${missionPlan.curatorModel}.`,
      },
    });

    // STAGE 2: Parallel Lightweight Workers ("Trabalho Bruto") with shared read-only cache
    const sharedWorkerContext = [
      factsBlock ? `Memória relevante:\n${factsBlock}` : '',
      recentBlock ? `Histórico recente:\n${recentBlock}` : '',
      hasDevices ? `Dispositivos pareados:\n${devicesBlock}` : '',
      savedCreds.length ? `Sites salvos no Cofre Web: ${savedCreds.slice(0, 6).join(', ')}` : '',
    ]
      .filter(Boolean)
      .join('\n\n');

    const workerResults = await Promise.all(
      missionPlan.subtasks.map((st) =>
        runSpecializedSubagent({
          subagent: st.subagent,
          objective: st.objective,
          context: sharedWorkerContext,
          sessionId: params.sessionId,
          googleToken: params.googleToken,
          toolCache: sharedToolCache,
          onProgress: params.onProgress,
        })
      )
    );

    const dossierSections: string[] = [];
    for (const wr of workerResults) {
      workerModelsSet.add(wr.model);
      steps.push(...wr.steps);
      screens.push(...wr.screens);
      pendingConfirmations.push(...wr.pendingConfirmations);
      promptTokens += wr.promptTokens;
      outputTokens += wr.outputTokens;
      thoughtsTokens += wr.thoughtsTokens;
      totalTokens += wr.totalTokens;

      const compactSummary = wr.summary.length > 1800 ? `${wr.summary.slice(0, 1800)}\n...(truncado)` : wr.summary;
      dossierSections.push(
        `### ${wr.label} (${wr.model} · ${wr.ok ? 'OK' : 'ERRO'} · ${wr.steps.length} tool)\n${compactSummary}`
      );
    }
    workerDossierText = dossierSections.join('\n\n');

    // STAGE 3 GATE: Evaluate whether Senior Curation is truly needed or can be skipped / downsized!
    const curationDecision = evaluatePostWorkerCuration({
      heuristic,
      plannedModel: missionPlan.curatorModel,
      plannedTier: missionPlan.curatorTier,
      manualModel,
      workerResults,
    });

    if (curationDecision.skipCurator) {
      const directWorker = workerResults[0];
      const replyText = directWorker.summary.trim() || 'Operação concluída.';
      const latencyMs = Date.now() - t0;
      const workerModels = Array.from(workerModelsSet);

      params.onProgress?.({
        event: 'thought',
        data: {
          source: 'Otimizador de Curadoria',
          role: 'decomposer',
          model: directWorker.model,
          text: curationDecision.rationale,
        },
      });

      memory.logInteraction({
        sessionId: params.sessionId,
        role: 'assistant',
        content: replyText,
        toolCalls: steps,
      });
      memory.logUsage({
        sessionId: params.sessionId,
        model: directWorker.model,
        routingMode,
        routingReason: curationDecision.rationale,
        complexityTier: curationDecision.curatorTier,
        promptTokens,
        outputTokens,
        thoughtsTokens,
        totalTokens,
        latencyMs,
        toolCallsCount: steps.length,
        status: 'ok',
      });

      return {
        reply: replyText,
        steps,
        pendingConfirmations,
        screens,
        cameraAction,
        usage: {
          model: directWorker.model,
          routingMode,
          routingReason: curationDecision.rationale,
          complexityTier: curationDecision.curatorTier,
          promptTokens,
          outputTokens,
          thoughtsTokens,
          totalTokens,
          latencyMs,
          fallbackUsed: false,
          escalationTrail,
          workerModels,
          curatorModel: directWorker.model,
          subtasksCount,
        },
      };
    }

    // STAGE 3 Setup: Promote to Right-Sized Curator
    activeModel = curationDecision.curatorModel;
    activeTier = curationDecision.curatorTier;
    activeReason = curationDecision.rationale;
    curatorModelUsed = activeModel;

    if (activeModel !== 'gemini-3.1-flash-lite') {
      escalationTrail.push({
        fromModel: 'gemini-3.1-flash-lite',
        toModel: activeModel,
        fromTier: 'lite',
        toTier: activeTier,
        reason: curationDecision.rationale,
        direction: 'up',
        stage: 'preflight',
        timestamp: new Date().toISOString(),
      });
    }

    params.onProgress?.({
      event: 'curator_start',
      data: {
        model: activeModel,
        tier: activeTier,
        workerCount: workerResults.length,
        reason: curationDecision.rationale,
      },
    });
  } else {
    // Direct fast-path (greetings / simple Q&A / single-scope modest requests)
    if (manualModel) {
      activeModel = manualModel;
      activeTier = MODEL_TO_TIER[manualModel];
      activeReason = `Modelo selecionado manualmente (${manualModel}).`;
    } else {
      activeModel = missionPlan.curatorModel;
      activeTier = missionPlan.curatorTier;
      activeReason = missionPlan.planRationale;
    }
    curatorModelUsed = activeModel;
    params.onProgress?.({
      event: 'model_selected',
      data: {
        model: activeModel,
        tier: activeTier,
        routingMode,
        reason: activeReason,
      },
    });
  }

  const directConversationalOnly =
    activeSubagentIds.length === 0 && !promptLikelyNeedsTools(params.prompt);

  const systemInstruction = directConversationalOnly
    ? `Você é Aegis, assistente autônomo estilo J.A.R.V.I.S. Responda em Português (Brasil) de forma clara, direta, precisa e concisa.
Agora: ${nowIso} | Usuário: ${params.userEmail || 'Operador'}${factsBlock ? `\nMemória:\n${factsBlock}` : ''}${recentBlock ? `\nRecente:\n${recentBlock}` : ''}`
    : `Você é Aegis (Curador & Orquestrador Autônomo J.A.R.V.I.S.): opera máquina local (Linux/Windows), dispositivos Android/iOS, navegação web/sub-menus, Google Workspace, telas holográficas e auto-evolução de código (\`evaluate_and_evolve_capability\`).
Agora: ${nowIso} | Usuário: ${params.userEmail || 'Operador'} | Modo: ${params.mode} | Google: ${workspaceConnected ? 'ATIVO' : 'OFF'}${savedCreds.length ? ` | Cofre: ${savedCreds.slice(0, 5).join(', ')}` : ''}${evolvedCaps.length ? ` | Skills: ${evolvedCaps.slice(0, 6).map((c) => c.name).join(', ')}` : ''}${hasDevices ? `\nDispositivos:\n${devicesBlock}` : ''}${factsBlock ? `\nMemória:\n${factsBlock}` : ''}${recentBlock ? `\nRecente:\n${recentBlock}` : ''}
Regras:
1. Responda em Português (Brasil), técnico, objetivo e verificável.
2. Com dossiê de trabalhadores: audite, corrija lacunas e entregue resposta final coesa sem repetir ferramentas já executadas com sucesso.
3. Analise sempre saídas reais (stdout/stderr/arquivos) e sugira próximos passos úteis.
4. Ações não destrutivas executam livremente; ações destrutivas, login web ou mutações Google pedem confirmação.`;

  const initialUserText = workerDossierText
    ? `Solicitação do operador:\n${params.prompt}\n\n---\n[DOSSIÊ DOS TRABALHADORES]\n${workerDossierText}\n---\nRevise os achados acima e entregue a resposta final polida (execute ferramenta extra só se realmente faltar dado).`
    : params.prompt;

  const contents: Content[] = [{ role: 'user', parts: [{ text: initialUserText }] }];

  const invokeWithResilientFallback = async () => {
    while (true) {
      try {
        const thinkingConfig = getThinkingConfigForModel(activeModel, activeTier);
        const allDecls = directConversationalOnly ? [] : getAllToolDeclarations();
        const focusedDecls = directConversationalOnly
          ? []
          : activeSubagentIds.length > 0
          ? selectFocusedCuratorTools({
              allTools: allDecls,
              activeSubagents: activeSubagentIds,
              workspaceConnected,
              hasDevices,
            })
          : allDecls;
        return await getAi().models.generateContent({
          model: activeModel,
          contents,
          config: {
            systemInstruction,
            ...(thinkingConfig ? { thinkingConfig } : {}),
            ...(focusedDecls.length > 0 ? { tools: [{ functionDeclarations: focusedDecls }] } : {}),
          },
        });
      } catch (apiErr: unknown) {
        if (!isModelEscalationFallbackError(apiErr)) {
          throw apiErr;
        }
        failedModels.add(activeModel);
        const nextModel = nextFallbackModel(activeModel, failedModels);
        if (!nextModel) {
          throw apiErr;
        }
        const prevModel = activeModel;
        const prevTier = activeTier;
        activeModel = nextModel;
        activeTier = MODEL_TO_TIER[nextModel];
        curatorModelUsed = activeModel;
        fallbackUsed = true;
        const fbReason = `Fallback automático de ${prevModel} para ${nextModel} por disponibilidade/cota.`;
        activeReason = `${activeReason} (${fbReason})`;
        const step: ModelEscalationStep = {
          fromModel: prevModel,
          toModel: nextModel,
          fromTier: prevTier,
          toTier: activeTier,
          reason: fbReason,
          direction: 'fallback',
          stage: 'fallback',
          timestamp: new Date().toISOString(),
        };
        escalationTrail.push(step);
        params.onProgress?.({
          event: 'model_escalated',
          data: {
            fromModel: prevModel,
            toModel: nextModel,
            fromTier: prevTier,
            toTier: activeTier,
            reason: fbReason,
            direction: 'fallback',
            stage: 'fallback',
          },
        });
      }
    }
  };

  try {
    for (let hop = 0; hop < 6; hop++) {
      const response = await invokeWithResilientFallback();

      const um = response.usageMetadata;
      if (um) {
        promptTokens += um.promptTokenCount || 0;
        outputTokens += um.candidatesTokenCount || 0;
        thoughtsTokens += um.thoughtsTokenCount || 0;
        totalTokens += um.totalTokenCount || (um.promptTokenCount || 0) + (um.candidatesTokenCount || 0);
      }

      // Stream live Gemini reasoning summaries to the Thinking Activity UI
      const curatorThoughts = extractThoughtTextsFromResponse(response);
      for (const thoughtText of curatorThoughts) {
        params.onProgress?.({
          event: 'thought',
          data: {
            source: 'Curador Sênior',
            role: 'curator',
            model: activeModel,
            text: thoughtText,
          },
        });
      }

      const candidateContent = response.candidates?.[0]?.content;
      const functionCalls = response.functionCalls || [];

      if (functionCalls.length === 0) {
        const replyText = (response.text || 'Operação concluída.').trim();
        const latencyMs = Date.now() - t0;
        const workerModels = Array.from(workerModelsSet);
        memory.logInteraction({
          sessionId: params.sessionId,
          role: 'assistant',
          content: replyText,
          toolCalls: steps,
        });
        memory.logUsage({
          sessionId: params.sessionId,
          model: activeModel,
          routingMode,
          routingReason: activeReason,
          complexityTier: activeTier,
          promptTokens,
          outputTokens,
          thoughtsTokens,
          totalTokens,
          latencyMs,
          toolCallsCount: steps.length,
          status: fallbackUsed ? 'fallback' : 'ok',
        });

        return {
          reply: replyText,
          steps,
          pendingConfirmations,
          screens,
          cameraAction,
          usage: {
            model: activeModel,
            routingMode,
            routingReason: activeReason,
            complexityTier: activeTier,
            promptTokens,
            outputTokens,
            thoughtsTokens,
            totalTokens,
            latencyMs,
            fallbackUsed,
            escalationTrail,
            workerModels,
            curatorModel: curatorModelUsed || activeModel,
            subtasksCount,
          },
        };
      }

      if (candidateContent) {
        contents.push(candidateContent);
      }

      const functionResponseParts: Array<{
        functionResponse: { id?: string; name: string; response: Record<string, unknown> };
      }> = [];
      const stepsInHop: ExecutedStep[] = [];
      let hopPayloadChars = 0;
      let hopHasHtmlOrDash = false;

      const parallelCuratorCalls = await Promise.all(
        functionCalls.map(async (call) => {
          const name = call.name || 'unknown';
          const args = (call.args || {}) as Record<string, unknown>;
          const cacheKey = buildToolCacheKey(name, args);
          const cached = cacheKey ? sharedToolCache.get(cacheKey) : undefined;

          if (cached) {
            params.onProgress?.({
              event: 'tool_done',
              data: {
                tool: name,
                status: cached.step.status,
                subagent: 'Curador Sênior',
                summary: `[cache 0ms] ${summarizeToolOutcome(name, cached.toolResult)}`,
              },
            });
            return { call, outcome: cached };
          }

          params.onProgress?.({
            event: 'tool_start',
            data: {
              tool: name,
              hop,
              model: activeModel,
              tier: activeTier,
              routingMode,
              reason: `Curador executando ${name}...`,
            },
          });

          const outcome = await executeAgentToolCall({
            name,
            args,
            sessionId: params.sessionId,
            googleToken: params.googleToken,
            onProgress: params.onProgress,
            depth: 0,
          });

          if (cacheKey && outcome.step.status === 'executed') {
            sharedToolCache.set(cacheKey, outcome);
          }

          params.onProgress?.({
            event: 'tool_done',
            data: {
              tool: name,
              status: outcome.step.status,
              subagent: 'Curador Sênior',
              summary: summarizeToolOutcome(name, outcome.toolResult),
            },
          });

          return { call, outcome };
        })
      );

      for (const { call, outcome } of parallelCuratorCalls) {
        steps.push(outcome.step);
        stepsInHop.push(outcome.step);
        hopPayloadChars += JSON.stringify(outcome.toolResult || {}).length;
        if (outcome.drawnScreen && (outcome.drawnScreen.kind === 'html_artifact' || outcome.drawnScreen.kind === 'interactive_dashboard')) {
          hopHasHtmlOrDash = true;
        }
        if (outcome.pendingConfirmation) pendingConfirmations.push(outcome.pendingConfirmation);
        if (outcome.extraConfirmations) pendingConfirmations.push(...outcome.extraConfirmations);
        if (outcome.drawnScreen) screens.push(outcome.drawnScreen);
        if (outcome.extraScreens) screens.push(...outcome.extraScreens);
        if (outcome.cameraAction) cameraAction = outcome.cameraAction;

        functionResponseParts.push({
          functionResponse: {
            id: call.id,
            name: call.name || 'unknown',
            response: outcome.toolResult,
          },
        });
      }

      contents.push({
        role: 'user',
        parts: functionResponseParts,
      });

      // Dynamic Mid-Turn Auto-Escalation when running in 'auto' mode
      if (routingMode === 'auto') {
        const escalation = evaluateMidTurnEscalation({
          currentModel: activeModel,
          hop,
          stepsInHop,
          allSteps: steps,
          payloadChars: hopPayloadChars,
          hasDrawnHtmlOrDashboard: hopHasHtmlOrDash,
        });
        if (escalation && escalation.targetModel !== activeModel && !failedModels.has(escalation.targetModel)) {
          const prevModel = activeModel;
          const prevTier = activeTier;
          activeModel = escalation.targetModel;
          activeTier = escalation.targetTier;
          curatorModelUsed = activeModel;
          activeReason = escalation.reason;
          escalationTrail.push({
            fromModel: prevModel,
            toModel: activeModel,
            fromTier: prevTier,
            toTier: activeTier,
            reason: escalation.reason,
            direction: 'up',
            stage: 'mid-turn',
            timestamp: new Date().toISOString(),
          });
          params.onProgress?.({
            event: 'model_escalated',
            data: {
              fromModel: prevModel,
              toModel: activeModel,
              fromTier: prevTier,
              toTier: activeTier,
              reason: escalation.reason,
              direction: 'up',
              stage: 'mid-turn',
            },
          });
        }
      }
    }

    const fallbackReply = 'Processamento concluído.';
    const latencyMs = Date.now() - t0;
    const workerModels = Array.from(workerModelsSet);
    memory.logInteraction({
      sessionId: params.sessionId,
      role: 'assistant',
      content: fallbackReply,
      toolCalls: steps,
    });
    memory.logUsage({
      sessionId: params.sessionId,
      model: activeModel,
      routingMode,
      routingReason: activeReason,
      complexityTier: activeTier,
      promptTokens,
      outputTokens,
      thoughtsTokens,
      totalTokens,
      latencyMs,
      toolCallsCount: steps.length,
      status: fallbackUsed ? 'fallback' : 'ok',
    });
    return {
      reply: fallbackReply,
      steps,
      pendingConfirmations,
      screens,
      cameraAction,
      usage: {
        model: activeModel,
        routingMode,
        routingReason: activeReason,
        complexityTier: activeTier,
        promptTokens,
        outputTokens,
        thoughtsTokens,
        totalTokens,
        latencyMs,
        fallbackUsed,
        escalationTrail,
        workerModels,
        curatorModel: curatorModelUsed || activeModel,
        subtasksCount,
      },
    };
  } catch (err: unknown) {
    memory.logUsage({
      sessionId: params.sessionId,
      model: activeModel,
      routingMode,
      routingReason: activeReason,
      complexityTier: activeTier,
      promptTokens,
      outputTokens,
      thoughtsTokens,
      totalTokens,
      latencyMs: Date.now() - t0,
      toolCallsCount: steps.length,
      status: 'error',
    });
    throw err;
  }
}

export async function summarizeCommandOutput(command: string, stdout: string, stderr: string, exitCode: number): Promise<string> {
  try {
    const snippet = (stdout || stderr || '(sem saída textual)').slice(0, 2000);
    const res = await getAi().models.generateContent({
      model: 'gemini-3.1-flash-lite',
      contents: `Comando executado: ${command}\nCódigo de saída: ${exitCode}\nSaída da máquina:\n${snippet}\n\nExplique objetivamente em Português (2 a 4 linhas) qual foi o resultado obtido na máquina.`,
    });
    if (res.usageMetadata) {
      memory.logUsage({
        sessionId: 'command-summary',
        model: 'gemini-3.1-flash-lite',
        routingMode: 'auto',
        routingReason: 'Resumo automático de saída de comando Linux confirmado.',
        complexityTier: 'lite',
        promptTokens: res.usageMetadata.promptTokenCount || 0,
        outputTokens: res.usageMetadata.candidatesTokenCount || 0,
        thoughtsTokens: res.usageMetadata.thoughtsTokenCount || 0,
        totalTokens: res.usageMetadata.totalTokenCount || 0,
        latencyMs: 0,
        toolCallsCount: 0,
        status: 'ok',
      });
    }
    return (res.text || '').trim();
  } catch {
    return '';
  }
}

export async function executeConfirmedAction(
  confirmation: memory.PendingConfirmation,
  googleToken: string | null,
  userId = 0
): Promise<{ ok: boolean; result: unknown; message: string; summary?: string }> {
  const payload = JSON.parse(confirmation.payload_json) as Record<string, unknown>;
  const type = confirmation.action_type;

  try {
    let result: unknown = null;
    let message = 'Ação executada com sucesso.';
    let summary: string | undefined;

    if (type === 'linux_write_file') {
      result = linux.writeLocalFile(String(payload.path), String(payload.content || ''));
      message = `Arquivo local gravado: ${String(payload.path)}`;
    } else if (type === 'linux_move_file') {
      result = linux.moveLocalFile(String(payload.source), String(payload.destination));
      message = `Arquivo movido: ${String(payload.source)} → ${String(payload.destination)}`;
    } else if (type === 'linux_delete_file') {
      result = linux.deleteLocalFile(String(payload.path));
      message = `Arquivo excluído: ${String(payload.path)}`;
    } else if (type === 'linux_organize_directory') {
      const moves = (payload.moves || []) as Array<{ from: string; to: string }>;
      result = linux.applyDirectoryOrganization(moves);
      message = `${moves.length} arquivo(s) organizados em "${String(payload.directory)}".`;
    } else if (type === 'linux_run_command') {
      const cmdOut = await linux.runLinuxCommand(String(payload.command));
      result = cmdOut;
      message = `Comando executado: ${String(payload.command)}`;
      summary = await summarizeCommandOutput(String(payload.command), cmdOut.stdout, cmdOut.stderr, cmdOut.exitCode);
    } else if (type === 'web_save_credential') {
      const rawPw = auth.decryptPacked(String(payload.passwordEnc || ''));
      const enc = auth.encryptSecret(rawPw);
      const saved = memory.saveWebCredential({
        userId,
        siteName: String(payload.siteName),
        loginUrl: String(payload.loginUrl),
        username: String(payload.username),
        encryptedPassword: enc.cipherText,
        iv: enc.iv,
        authTag: enc.authTag,
        notes: String(payload.notes || ''),
      });
      result = { id: saved.id, siteName: saved.site_name, username: saved.username };
      message = `Credencial criptografada salva no Cofre Web para "${saved.site_name}".`;
    } else if (type === 'web_login') {
      const loginRes = await webBrowser.webLoginWithCredential(String(payload.sessionId || 'primary-hud'), {
        siteOrCredentialId: payload.siteOrCredentialId ? String(payload.siteOrCredentialId) : undefined,
        loginUrl: payload.loginUrl ? String(payload.loginUrl) : undefined,
        username: payload.username ? String(payload.username) : undefined,
        password: payload.passwordEnc ? auth.decryptPacked(String(payload.passwordEnc)) : undefined,
      });
      result = loginRes.snapshot;
      message = loginRes.message;
      summary = `Página atual: ${loginRes.snapshot.title} (${loginRes.snapshot.url})\nCookies ativos: ${loginRes.snapshot.cookieCount}`;
    } else if (type === 'device_execute_action') {
      const devId = String(payload.deviceId || '');
      const cmdType = String(payload.commandType || 'shell');
      const cmdPayload = (payload.payload && typeof payload.payload === 'object'
        ? payload.payload
        : {}) as Record<string, unknown>;
      const dispatchRes = await deviceHub.dispatchDeviceCommand(devId, cmdType, cmdPayload);
      if (!dispatchRes.ok) {
        return { ok: false, result: dispatchRes, message: dispatchRes.error || 'Falha ao executar ação no dispositivo.' };
      }
      result = dispatchRes;
      message = `Comando "${cmdType}" executado no dispositivo (${dispatchRes.transport}).`;
      summary = JSON.stringify(dispatchRes.output || {}).slice(0, 600);
    } else if (type === 'web_perform_action') {
      const fields = payload.fieldsJson ? (JSON.parse(String(payload.fieldsJson)) as Record<string, string>) : {};
      const snap = await webBrowser.webPerformAction(String(payload.sessionId || 'primary-hud'), {
        url: payload.url ? String(payload.url) : undefined,
        clickLinkText: payload.clickLinkText ? String(payload.clickLinkText) : undefined,
        formIndex: payload.formIndex !== undefined ? Number(payload.formIndex) : 0,
        fields,
      });
      result = snap;
      message = `Ação web concluída em ${snap.url} (HTTP ${snap.status}).`;
      summary = `Título: ${snap.title}\nPrévia: ${snap.textPreview.slice(0, 400)}`;
    } else if (type === 'web_download_and_organize') {
      const dlRes = await webRoutines.downloadAndOrganizeSingleAttachment({
        sessionId: String(payload.sessionId || 'primary-hud'),
        fileUrl: String(payload.fileUrl || ''),
        preferredFilename: payload.preferredFilename ? String(payload.preferredFilename) : undefined,
        localFolder: String(payload.localFolder || 'Downloads/Portais'),
        driveFolder: payload.driveFolder ? String(payload.driveFolder) : undefined,
        googleToken: googleToken || undefined,
      });
      result = dlRes;
      message = `Anexo "${dlRes.localFile.fileName}" salvo em ${dlRes.localFile.localRelativePath}${
        dlRes.driveUpload?.ok ? ` e enviado ao Google Drive (${dlRes.driveUpload.driveFolderPath})` : ''
      }.`;
      summary = dlRes.driveUpload?.error
        ? `Local: ${dlRes.localFile.localRelativePath}\nDrive: ${dlRes.driveUpload.error}`
        : `Local: ${dlRes.localFile.localRelativePath} (${dlRes.localFile.sizeBytes} bytes)`;
    } else if (type === 'web_run_routine') {
      const runRes = await webRoutines.runWebAutomationRoutine({
        routineId: payload.routineId ? Number(payload.routineId) : undefined,
        inlineSpec: payload.inlineSpec ? (payload.inlineSpec as webRoutines.InlineRoutineSpec) : undefined,
        sessionId: String(payload.sessionId || 'primary-hud'),
        googleToken: googleToken || undefined,
      });
      result = runRes;
      message = runRes.summary;
      summary = [
        `Subseções visitadas: ${runRes.visitedSections.map((v) => v.sectionPath).join(' → ') || 'Nenhuma'}`,
        `Anexos baixados: ${runRes.downloadedFiles.length}`,
        `Uploads Google Drive: ${runRes.driveUploads.length}`,
        runRes.reportLocalPath ? `Relatório local: ${runRes.reportLocalPath}` : '',
      ]
        .filter(Boolean)
        .join('\n');
    } else {
      if (!googleToken) {
        return { ok: false, result: null, message: 'Token Google Workspace ausente. Faça login com o Google novamente.' };
      }

      if (type === 'gmail_send_email') {
        const res = await gw.gmailSendEmail(
          googleToken,
          String(payload.to),
          String(payload.subject),
          String(payload.body),
          payload.threadId ? String(payload.threadId) : undefined
        );
        if (!res.ok) return { ok: false, result: res.data, message: res.error || 'Falha ao enviar e-mail' };
        result = res.data;
        message = `E-mail enviado para ${String(payload.to)}.`;
      } else if (type === 'gmail_modify_labels') {
        const res = await gw.gmailModifyLabels(
          googleToken,
          String(payload.messageId),
          Array.isArray(payload.addLabelIds) ? (payload.addLabelIds as string[]) : [],
          Array.isArray(payload.removeLabelIds) ? (payload.removeLabelIds as string[]) : []
        );
        if (!res.ok) return { ok: false, result: res.data, message: res.error || 'Falha ao atualizar marcador do e-mail' };
        result = res.data;
        message = 'Marcadores do e-mail atualizados.';
      } else if (type === 'gmail_trash_message') {
        const res = await gw.gmailTrashMessage(googleToken, String(payload.messageId));
        if (!res.ok) return { ok: false, result: res.data, message: res.error || 'Falha ao excluir e-mail' };
        result = res.data;
        message = 'E-mail movido para a lixeira.';
      } else if (type === 'drive_create_folder') {
        const res = await gw.driveCreateFolder(googleToken, String(payload.name), payload.parentId ? String(payload.parentId) : undefined);
        if (!res.ok) return { ok: false, result: res.data, message: res.error || 'Falha ao criar pasta no Drive' };
        result = res.data;
        message = `Pasta "${String(payload.name)}" criada no Google Drive.`;
      } else if (type === 'drive_rename_file') {
        const res = await gw.driveRenameFile(googleToken, String(payload.fileId), String(payload.newName));
        if (!res.ok) return { ok: false, result: res.data, message: res.error || 'Falha ao renomear item no Drive' };
        result = res.data;
        message = `Item renomeado para "${String(payload.newName)}" no Google Drive.`;
      } else if (type === 'drive_update_text_file') {
        const res = await gw.driveUpdateTextFile(
          googleToken,
          String(payload.fileId),
          String(payload.content ?? ''),
          payload.mimeType ? String(payload.mimeType) : 'text/plain'
        );
        if (!res.ok) return { ok: false, result: res.data, message: res.error || 'Falha ao salvar conteúdo do arquivo no Drive' };
        result = res.data;
        message = 'Conteúdo do arquivo salvo no Google Drive.';
      } else if (type === 'drive_move_file') {
        const res = await gw.driveMoveFile(googleToken, String(payload.fileId), String(payload.targetFolderId));
        if (!res.ok) return { ok: false, result: res.data, message: res.error || 'Falha ao mover arquivo no Drive' };
        result = res.data;
        message = 'Arquivo movido no Google Drive.';
      } else if (type === 'drive_delete_file') {
        const res = await gw.driveDeleteFile(googleToken, String(payload.fileId));
        if (!res.ok) return { ok: false, result: res.data, message: res.error || 'Falha ao mover arquivo para lixeira' };
        result = res.data;
        message = 'Arquivo movido para a lixeira do Google Drive.';
      } else if (type === 'calendar_create_event') {
        const res = await gw.calendarCreateEvent(googleToken, {
          summary: String(payload.summary),
          startIso: String(payload.startIso),
          endIso: String(payload.endIso),
          description: payload.description ? String(payload.description) : undefined,
          location: payload.location ? String(payload.location) : undefined,
        });
        if (!res.ok) return { ok: false, result: res.data, message: res.error || 'Falha ao criar evento' };
        result = res.data;
        message = `Evento "${String(payload.summary)}" criado no Google Calendar.`;
      } else if (type === 'calendar_update_event') {
        const res = await gw.calendarUpdateEvent(googleToken, String(payload.eventId), {
          summary: payload.summary !== undefined ? String(payload.summary) : undefined,
          startIso: payload.startIso ? String(payload.startIso) : undefined,
          endIso: payload.endIso ? String(payload.endIso) : undefined,
          description: payload.description !== undefined ? String(payload.description) : undefined,
          location: payload.location !== undefined ? String(payload.location) : undefined,
        });
        if (!res.ok) return { ok: false, result: res.data, message: res.error || 'Falha ao atualizar evento' };
        result = res.data;
        message = 'Evento atualizado no Google Calendar.';
      } else if (type === 'calendar_delete_event') {
        const res = await gw.calendarDeleteEvent(googleToken, String(payload.eventId));
        if (!res.ok) return { ok: false, result: res.data, message: res.error || 'Falha ao excluir evento' };
        result = res.data;
        message = 'Evento excluído do Google Calendar.';
      } else if (type === 'docs_create_document') {
        const res = await gw.docsCreateDocument(googleToken, String(payload.title), payload.initialText ? String(payload.initialText) : undefined);
        if (!res.ok) return { ok: false, result: res.data, message: res.error || 'Falha ao criar Google Doc' };
        result = res.data;
        message = `Google Doc "${String(payload.title)}" criado.`;
      } else if (type === 'docs_append_text') {
        const res = await gw.docsAppendText(googleToken, String(payload.documentId), String(payload.text));
        if (!res.ok) return { ok: false, result: res.data, message: res.error || 'Falha ao editar Google Doc' };
        result = res.data;
        message = 'Texto inserido no Google Doc.';
      } else if (type === 'docs_replace_content') {
        const res = await gw.docsReplaceFullContent(googleToken, String(payload.documentId), String(payload.newText ?? ''));
        if (!res.ok) return { ok: false, result: res.data, message: res.error || 'Falha ao atualizar Google Doc' };
        result = res.data;
        message = 'Conteúdo do Google Doc atualizado.';
      } else if (type === 'sheets_create_spreadsheet') {
        const res = await gw.sheetsCreateSpreadsheet(googleToken, String(payload.title));
        if (!res.ok) return { ok: false, result: res.data, message: res.error || 'Falha ao criar planilha' };
        result = res.data;
        message = `Planilha "${String(payload.title)}" criada no Google Sheets.`;
      } else if (type === 'sheets_update_values') {
        const rows = Array.isArray(payload.values)
          ? (payload.values as string[][])
          : (JSON.parse(String(payload.rowsJson || '[]')) as string[][]);
        const res = await gw.sheetsUpdateRange(googleToken, String(payload.spreadsheetId), String(payload.range), rows);
        if (!res.ok) return { ok: false, result: res.data, message: res.error || 'Falha ao salvar alterações na planilha' };
        result = res.data;
        message = 'Células atualizadas na planilha Google Sheets.';
      } else if (type === 'sheets_append_rows') {
        const rows = Array.isArray(payload.values)
          ? (payload.values as string[][])
          : (JSON.parse(String(payload.rowsJson || '[]')) as string[][]);
        const res = await gw.sheetsAppendRows(googleToken, String(payload.spreadsheetId), String(payload.range), rows);
        if (!res.ok) return { ok: false, result: res.data, message: res.error || 'Falha ao preencher planilha' };
        result = res.data;
        message = 'Linhas preenchidas na planilha Google Sheets.';
      } else if (type === 'tasks_create') {
        const res = await gw.tasksCreateTask(googleToken, {
          title: String(payload.title),
          notes: payload.notes ? String(payload.notes) : undefined,
          dueIso: payload.dueIso ? String(payload.dueIso) : undefined,
        });
        if (!res.ok) return { ok: false, result: res.data, message: res.error || 'Falha ao criar tarefa' };
        result = res.data;
        message = `Tarefa "${String(payload.title)}" criada no Google Tasks.`;
      } else if (type === 'tasks_update') {
        const res = await gw.tasksUpdateTask(googleToken, String(payload.taskId), {
          title: payload.title !== undefined ? String(payload.title) : undefined,
          notes: payload.notes !== undefined ? String(payload.notes) : undefined,
          dueIso: payload.dueIso !== undefined ? (payload.dueIso ? String(payload.dueIso) : null) : undefined,
          status: payload.status === 'completed' || payload.status === 'needsAction' ? payload.status : undefined,
        });
        if (!res.ok) return { ok: false, result: res.data, message: res.error || 'Falha ao atualizar tarefa' };
        result = res.data;
        message = 'Tarefa atualizada no Google Tasks.';
      } else if (type === 'tasks_complete') {
        const res = await gw.tasksCompleteTask(googleToken, String(payload.taskId));
        if (!res.ok) return { ok: false, result: res.data, message: res.error || 'Falha ao concluir tarefa' };
        result = res.data;
        message = 'Tarefa marcada como concluída no Google Tasks.';
      } else if (type === 'tasks_delete') {
        const res = await gw.tasksDeleteTask(googleToken, String(payload.taskId));
        if (!res.ok) return { ok: false, result: res.data, message: res.error || 'Falha ao excluir tarefa' };
        result = res.data;
        message = 'Tarefa excluída do Google Tasks.';
      }
    }

    memory.resolvePendingConfirmation(confirmation.id, 'confirmed');
    memory.logInteraction({
      sessionId: 'global',
      role: 'tool',
      content: `[CONFIRMADO] ${message}${summary ? `\n${summary}` : ''}`,
      toolCalls: [{ actionType: type, target: confirmation.target, result }],
    });

    return { ok: true, result, message, summary };
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : 'Erro ao executar ação confirmada.';
    return { ok: false, result: null, message: errMsg };
  }
}
