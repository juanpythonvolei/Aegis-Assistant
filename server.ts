import 'dotenv/config';
import express, { type Request, type Response } from 'express';
import http from 'node:http';
import path from 'node:path';
import { createServer as createViteServer } from 'vite';
import * as auth from './server/auth.ts';
import * as bgJobs from './server/backgroundJobs.ts';
import * as deviceHub from './server/deviceHub.ts';
import * as agent from './server/geminiAgent.ts';
import * as gw from './server/googleWorkspace.ts';
import * as bundle from './server/linuxBundle.ts';
import * as linux from './server/linuxRuntime.ts';
import { attachLiveWebSocketServer } from './server/liveBridge.ts';
import * as memory from './server/memory.ts';
import * as nativePackages from './server/nativePackages.ts';
import * as selfEvolution from './server/selfEvolution.ts';
import * as webBrowser from './server/webBrowser.ts';
import * as webRoutines from './server/webRoutines.ts';

function extractBearerToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader) return null;
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

async function startServer() {
  const app = express();
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), geolocation=()');
    next();
  });
  app.use(express.json({ limit: '4mb' }));

  // ==========================================
  // AUTHENTICATION & OAUTH ROUTES
  // ==========================================

  app.get('/api/auth/me', async (req: Request, res: Response) => {
    const user = auth.getAuthenticatedUser(req);
    const totalUsers = memory.countUsers();
    return res.json({
      authenticated: Boolean(user),
      needsSetup: totalUsers === 0,
      user: user ? auth.sanitizeUser(user) : null,
    });
  });

  app.post('/api/auth/register', (req: Request, res: Response) => {
    const { username, email, displayName, password } = req.body as {
      username?: string;
      email?: string;
      displayName?: string;
      password?: string;
    };
    if (!username?.trim() || !email?.trim() || !password || password.length < 6) {
      return res.status(400).json({ error: 'Usuário, e-mail e senha (mín. 6 caracteres) são obrigatórios.' });
    }
    if (memory.findUserByIdentifier(username) || memory.findUserByIdentifier(email)) {
      return res.status(409).json({ error: 'Usuário ou e-mail já cadastrado.' });
    }
    const created = memory.createUser({
      username: username.trim(),
      email: email.trim(),
      displayName: displayName?.trim() || username.trim(),
      passwordHash: auth.hashPassword(password),
      authProvider: 'local',
    });
    const sessionToken = auth.issueSession(res, created.id);
    return res.json({ user: auth.sanitizeUser(created), sessionToken });
  });

  app.post('/api/auth/login', (req: Request, res: Response) => {
    const { identifier, password } = req.body as { identifier?: string; password?: string };
    if (!identifier?.trim() || !password) {
      return res.status(400).json({ error: 'Informe usuário/e-mail e senha.' });
    }
    const user = memory.findUserByIdentifier(identifier);
    if (!user || !user.password_hash || !auth.verifyPassword(password, user.password_hash)) {
      return res.status(401).json({ error: 'Credenciais inválidas.' });
    }
    const sessionToken = auth.issueSession(res, user.id);
    return res.json({ user: auth.sanitizeUser(user), sessionToken });
  });

  app.post('/api/auth/google-sso', async (req: Request, res: Response) => {
    const bearer = extractBearerToken(req);
    const bodyToken = typeof req.body?.accessToken === 'string' ? req.body.accessToken.trim() : '';
    const googleAccessToken = bearer || bodyToken;
    if (!googleAccessToken) {
      return res.status(401).json({ error: 'Token OAuth do Google obrigatório para validação SSO.' });
    }

    try {
      const verifyRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${googleAccessToken}` },
      });
      if (!verifyRes.ok) {
        return res.status(401).json({ error: 'Token Google inválido ou expirado.' });
      }
      const profile = (await verifyRes.json()) as {
        email?: string;
        email_verified?: boolean;
        name?: string;
      };
      const verifiedEmail = profile.email?.trim().toLowerCase();
      if (!verifiedEmail || profile.email_verified === false) {
        return res.status(401).json({ error: 'Conta Google sem e-mail verificado.' });
      }

      const displayName =
        profile.name?.trim() ||
        (typeof req.body?.displayName === 'string' ? req.body.displayName.trim() : '') ||
        verifiedEmail;

      let user = memory.findUserByIdentifier(verifiedEmail);
      if (!user) {
        const baseUser = verifiedEmail.split('@')[0].replace(/[^a-zA-Z0-9_.-]/g, '') || `user_${Date.now()}`;
        const uniqueUser = memory.findUserByIdentifier(baseUser)
          ? `${baseUser}_${Date.now().toString().slice(-4)}`
          : baseUser;
        user = memory.createUser({
          username: uniqueUser,
          email: verifiedEmail,
          displayName,
          passwordHash: '',
          authProvider: 'google',
        });
      }
      const sessionToken = auth.issueSession(res, user.id);
      return res.json({ user: auth.sanitizeUser(user), sessionToken });
    } catch {
      return res.status(502).json({ error: 'Falha ao verificar identidade com os servidores do Google.' });
    }
  });

  app.post('/api/auth/logout', (req: Request, res: Response) => {
    const token = auth.extractSessionToken(req);
    if (token) memory.deleteSession(token);
    res.clearCookie('aegis_session', { path: '/', sameSite: 'none', secure: true });
    return res.json({ ok: true });
  });

  // ==========================================
  // ASSISTANT & PROACTIVE AGENT ROUTES
  // ==========================================

  app.post('/api/assistant/chat', auth.requireAuth, async (req: Request, res: Response) => {
    try {
      const {
        prompt,
        sessionId = 'default',
        mode = 'reactive',
        modelPreference = 'auto',
        userEmail,
      } = req.body as {
        prompt?: string;
        sessionId?: string;
        mode?: 'reactive' | 'proactive';
        modelPreference?: agent.ModelPreference;
        userEmail?: string;
      };

      if (!prompt || !prompt.trim()) {
        return res.status(400).json({ error: 'Prompt é obrigatório.' });
      }

      const googleToken = extractBearerToken(req);
      const authedUser = (req as Request & { aegisUser?: memory.LocalUserRecord }).aegisUser;
      const result = await agent.runAssistantTurn({
        prompt: prompt.trim(),
        sessionId,
        mode,
        modelPreference,
        googleToken,
        userEmail: userEmail || authedUser?.email,
      });

      return res.json(result);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Erro ao processar solicitação no Gemini.';
      console.error('Assistant error:', err);
      return res.status(500).json({ error: message });
    }
  });

  app.post('/api/assistant/chat-stream', auth.requireAuth, async (req: Request, res: Response) => {
    const {
      prompt,
      sessionId = 'default',
      mode = 'reactive',
      modelPreference = 'auto',
      userEmail,
      allowBackground = true,
    } = req.body as {
      prompt?: string;
      sessionId?: string;
      mode?: 'reactive' | 'proactive';
      modelPreference?: agent.ModelPreference;
      userEmail?: string;
      allowBackground?: boolean;
    };

    if (!prompt || !prompt.trim()) {
      return res.status(400).json({ error: 'Prompt é obrigatório.' });
    }

    const trimmedPrompt = prompt.trim();
    const googleToken = extractBearerToken(req);
    const authedUser = (req as Request & { aegisUser?: memory.LocalUserRecord }).aegisUser;
    const userId = authedUser?.id ?? 0;

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    res.write(': connected\n\n');

    let closed = false;
    res.on('close', () => {
      if (!res.writableEnded) {
        closed = true;
      }
    });

    const keepaliveTimer = setInterval(() => {
      if (!closed && !res.writableEnded) {
        res.write(': keepalive\n\n');
      }
    }, 12_000);

    const emitSse = (event: string, data: unknown) => {
      if (closed || res.writableEnded) return;
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    const finishStream = () => {
      clearInterval(keepaliveTimer);
      if (!res.writableEnded) {
        res.end();
      }
    };

    let promotedJob: bgJobs.BackgroundJobRecord | null = null;
    let turnFinished = false;
    const prePromotionEvents: agent.AgentRoutingProgressEvent[] = [];

    const promoteToBackground = (reason: string, ackText: string) => {
      if (promotedJob || turnFinished) return;
      const job = bgJobs.createBackgroundJob({
        userId,
        sessionId,
        prompt: trimmedPrompt,
        initialActivity: reason,
        initialModel: modelPreference === 'auto' ? 'gemini-3.1-flash-lite' : modelPreference,
      });
      for (const pastEv of prePromotionEvents) {
        bgJobs.applyProgressEventToJob(job, pastEv);
      }
      promotedJob = job;
      emitSse('background_started', {
        job: {
          id: job.id,
          title: job.title,
          prompt: job.prompt,
          status: job.status,
          phase: job.phase,
          activeModel: job.activeModel,
          latestActivity: job.latestActivity,
          startedAt: job.startedAt,
          announced: job.announced,
          trace: job.trace,
        },
        reason,
        ackMessage: ackText,
      });
      finishStream();
    };

    // Check upfront if this mission is clearly long-running
    const bgEstimate = allowBackground
      ? agent.estimateLongRunningMission(trimmedPrompt, mode)
      : { shouldRunInBackground: false, reason: '' };

    if (allowBackground && bgEstimate.shouldRunInBackground) {
      promoteToBackground(
        bgEstimate.reason,
        `Entendido — como esta demanda envolve múltiplas etapas (${bgEstimate.reason}), iniciei a execução em **segundo plano** para não travar nossa conversa. Pode continuar falando comigo normalmente; assim que concluir, eu te aviso aqui mesmo no chat.`
      );
    }

    // Dynamic mid-flight promotion: if synchronous execution takes > 6.5s, move smoothly to background
    const midFlightTimer =
      allowBackground && !promotedJob
        ? setTimeout(() => {
            if (!turnFinished && !promotedJob && !closed && !res.writableEnded) {
              promoteToBackground(
                'Demanda em andamento com múltiplas etapas/ferramentas',
                'Percebi que essa tarefa vai levar alguns segundos a mais, então movi a execução para **segundo plano** para liberar o chat. Pode seguir conversando normalmente — assim que eu terminar, trago o resultado aqui.'
              );
            }
          }, 6_500)
        : null;

    const turnPromise = agent
      .runAssistantTurn({
        prompt: trimmedPrompt,
        sessionId,
        mode,
        modelPreference,
        googleToken,
        userEmail: userEmail || authedUser?.email,
        onProgress: (ev) => {
          if (promotedJob) {
            bgJobs.applyProgressEventToJob(promotedJob, ev);
          } else {
            prePromotionEvents.push(ev);
            emitSse(ev.event, ev.data);
          }
        },
      })
      .then((result) => {
        turnFinished = true;
        if (midFlightTimer) clearTimeout(midFlightTimer);
        if (promotedJob) {
          bgJobs.completeBackgroundJob(promotedJob, result);
        } else {
          emitSse('done', result);
          finishStream();
        }
      })
      .catch((err: unknown) => {
        turnFinished = true;
        if (midFlightTimer) clearTimeout(midFlightTimer);
        const message = err instanceof Error ? err.message : 'Erro ao processar solicitação no Gemini.';
        console.error('Assistant stream error:', err);
        if (promotedJob) {
          bgJobs.failBackgroundJob(promotedJob, message);
        } else {
          emitSse('error', { error: message });
          finishStream();
        }
      });

    // If not already promoted upfront, wait for either completion or promotion
    if (!promotedJob) {
      await turnPromise;
    }
  });

  app.get('/api/assistant/jobs', auth.requireAuth, (req: Request, res: Response) => {
    const authedUser = (req as Request & { aegisUser?: memory.LocalUserRecord }).aegisUser;
    if (!authedUser) return res.status(401).json({ error: 'Não autenticado.' });
    const jobs = bgJobs.listUserBackgroundJobs(authedUser.id);
    return res.json({ jobs });
  });

  app.post('/api/assistant/jobs/:id/ack', auth.requireAuth, (req: Request, res: Response) => {
    const authedUser = (req as Request & { aegisUser?: memory.LocalUserRecord }).aegisUser;
    if (!authedUser) return res.status(401).json({ error: 'Não autenticado.' });
    const ok = bgJobs.acknowledgeBackgroundJob(authedUser.id, String(req.params.id || ''));
    if (!ok) return res.status(404).json({ error: 'Tarefa em segundo plano não encontrada.' });
    return res.json({ ok: true });
  });

  app.delete('/api/assistant/jobs/:id', auth.requireAuth, (req: Request, res: Response) => {
    const authedUser = (req as Request & { aegisUser?: memory.LocalUserRecord }).aegisUser;
    if (!authedUser) return res.status(401).json({ error: 'Não autenticado.' });
    const ok = bgJobs.deleteBackgroundJob(authedUser.id, String(req.params.id || ''));
    if (!ok) return res.status(404).json({ error: 'Tarefa não encontrada ou ainda em execução.' });
    return res.json({ ok: true });
  });

  app.post('/api/assistant/proactive-sweep', auth.requireAuth, async (req: Request, res: Response) => {
    try {
      const { ruleId, userEmail, modelPreference = 'auto' } = req.body as {
        ruleId?: number;
        userEmail?: string;
        modelPreference?: agent.ModelPreference;
      };
      const googleToken = extractBearerToken(req);
      const rules = memory.listProactiveRules().filter((r) => r.enabled === 1);
      const targetRules = ruleId ? rules.filter((r) => r.id === ruleId) : rules;

      if (targetRules.length === 0) {
        return res.json({
          reply: 'Nenhuma regra proativa ativa encontrada para executar.',
          steps: [],
          pendingConfirmations: [],
          usage: {
            model: 'gemini-3.1-flash-lite',
            routingMode: 'auto',
            routingReason: 'Sem regras ativas.',
            complexityTier: 'lite',
            promptTokens: 0,
            outputTokens: 0,
            thoughtsTokens: 0,
            totalTokens: 0,
            latencyMs: 0,
            fallbackUsed: false,
          },
        });
      }

      const combinedPrompt = targetRules
        .map((r) => `Regra [${r.title}] (Gatilho: ${r.condition_spec}): ${r.action_prompt}`)
        .join('\n\n');

      const result = await agent.runAssistantTurn({
        prompt: `Execute uma varredura proativa com base nas regras abaixo. Analise os dados reais disponíveis (Linux local e Google Workspace se conectado), apresente um resumo objetivo dos achados e prepare confirmações para quaisquer ações recomendadas:\n\n${combinedPrompt}`,
        sessionId: 'proactive-sweep',
        mode: 'proactive',
        modelPreference,
        googleToken,
        userEmail,
      });

      for (const r of targetRules) {
        memory.updateProactiveRuleResult(r.id, result.reply.slice(0, 280));
      }

      return res.json(result);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Erro na varredura proativa.';
      return res.status(500).json({ error: message });
    }
  });

  // ==========================================
  // USAGE & TOKEN TELEMETRY ROUTES
  // ==========================================

  app.get('/api/usage', auth.requireAuth, (_req: Request, res: Response) => {
    return res.json(memory.getUsageSummary());
  });

  // ==========================================
  // SUBAGENT ORCHESTRATOR & SELF-EVOLUTION ROUTES
  // ==========================================

  app.get('/api/orchestrator/runs', auth.requireAuth, (_req: Request, res: Response) => {
    return res.json({ runs: memory.listSubagentRuns(50) });
  });

  app.get('/api/evolution/capabilities', auth.requireAuth, (_req: Request, res: Response) => {
    return res.json({ capabilities: memory.listEvolvedCapabilities() });
  });

  app.patch('/api/evolution/capabilities/:name/toggle', auth.requireAuth, (req: Request, res: Response) => {
    const name = String(req.params.name || '').trim().toLowerCase();
    const { enabled } = (req.body || {}) as { enabled?: boolean };
    const updated = memory.toggleEvolvedCapability(name, typeof enabled === 'boolean' ? enabled : undefined);
    if (!updated) {
      return res.status(404).json({ error: 'Capacidade evoluída não encontrada.' });
    }
    return res.json({ capability: updated });
  });

  app.post('/api/evolution/capabilities/:name/test', auth.requireAuth, async (req: Request, res: Response) => {
    try {
      const name = String(req.params.name || '').trim().toLowerCase();
      const { args = {} } = (req.body || {}) as { args?: Record<string, unknown> };
      const execRes = await selfEvolution.executeEvolvedCapability(name, args);
      return res.status(execRes.ok ? 200 : 400).json(execRes);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Falha ao executar teste da capacidade.';
      return res.status(400).json({ ok: false, error: msg });
    }
  });

  app.delete('/api/evolution/capabilities/:name', auth.requireAuth, (req: Request, res: Response) => {
    const name = String(req.params.name || '').trim().toLowerCase();
    const ok = selfEvolution.deleteEvolvedCapabilityFull(name);
    return res.json({ ok });
  });

  // ==========================================
  // EXPLICIT USER CONFIRMATION GATES
  // ==========================================

  app.post('/api/actions/confirm', auth.requireAuth, async (req: Request, res: Response) => {
    try {
      const { confirmationId } = req.body as { confirmationId?: string };
      if (!confirmationId) {
        return res.status(400).json({ error: 'confirmationId é obrigatório.' });
      }
      const pending = memory.getPendingConfirmation(confirmationId);
      if (!pending) {
        return res.status(404).json({ error: 'Solicitação de confirmação não encontrada.' });
      }
      if (pending.status !== 'pending') {
        return res.status(409).json({ error: `Ação já processada (${pending.status}).` });
      }

      const googleToken = extractBearerToken(req);
      const authedUser = (req as Request & { aegisUser?: memory.LocalUserRecord }).aegisUser;
      const execResult = await agent.executeConfirmedAction(pending, googleToken, authedUser?.id || 0);
      return res.status(execResult.ok ? 200 : 400).json(execResult);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Erro ao confirmar ação.';
      return res.status(500).json({ error: message });
    }
  });

  app.post('/api/actions/cancel', auth.requireAuth, (req: Request, res: Response) => {
    const { confirmationId } = req.body as { confirmationId?: string };
    if (!confirmationId) {
      return res.status(400).json({ error: 'confirmationId é obrigatório.' });
    }
    const pending = memory.getPendingConfirmation(confirmationId);
    if (!pending) {
      return res.status(404).json({ error: 'Solicitação não encontrada.' });
    }
    memory.resolvePendingConfirmation(confirmationId, 'cancelled');
    memory.logInteraction({
      sessionId: 'global',
      role: 'tool',
      content: `[CANCELADO] ${pending.summary}`,
    });
    return res.json({ ok: true, message: 'Ação cancelada sem efeitos colaterais.' });
  });

  // ==========================================
  // PERSISTENT MEMORY ROUTES
  // ==========================================

  app.get('/api/memory', auth.requireAuth, (req: Request, res: Response) => {
    const q = typeof req.query.q === 'string' ? req.query.q : '';
    const facts = memory.listMemoryFacts(q);
    const interactions = memory.getInteractions(80);
    const stats = memory.getMemoryStats();
    return res.json({ facts, interactions, stats });
  });

  app.post('/api/memory/facts', auth.requireAuth, (req: Request, res: Response) => {
    const { category = 'fact', content, pinned = false } = req.body as {
      category?: memory.MemoryFact['category'];
      content?: string;
      pinned?: boolean;
    };
    if (!content || !content.trim()) {
      return res.status(400).json({ error: 'Conteúdo da memória é obrigatório.' });
    }
    const fact = memory.addMemoryFact({ category, content, source: 'manual', pinned });
    return res.json({ fact });
  });

  app.patch('/api/memory/facts/:id/pin', auth.requireAuth, (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const fact = memory.togglePinFact(id);
    if (!fact) return res.status(404).json({ error: 'Memória não encontrada.' });
    return res.json({ fact });
  });

  app.delete('/api/memory/facts/:id', auth.requireAuth, (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const ok = memory.deleteMemoryFact(id);
    return res.json({ ok });
  });

  // ==========================================
  // PROACTIVE RULES ROUTES
  // ==========================================

  app.get('/api/proactive/rules', auth.requireAuth, (_req: Request, res: Response) => {
    return res.json({ rules: memory.listProactiveRules() });
  });

  app.post('/api/proactive/rules', auth.requireAuth, (req: Request, res: Response) => {
    const { title, triggerType = 'manual', conditionSpec, actionPrompt } = req.body as {
      title?: string;
      triggerType?: 'filesystem' | 'workspace_email' | 'schedule' | 'manual';
      conditionSpec?: string;
      actionPrompt?: string;
    };
    if (!title || !actionPrompt) {
      return res.status(400).json({ error: 'Título e instrução da regra são obrigatórios.' });
    }
    const rule = memory.createProactiveRule({
      title,
      triggerType,
      conditionSpec: conditionSpec || 'manual',
      actionPrompt,
    });
    return res.json({ rule });
  });

  app.patch('/api/proactive/rules/:id', auth.requireAuth, (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const rule = memory.toggleProactiveRule(id);
    if (!rule) return res.status(404).json({ error: 'Regra não encontrada.' });
    return res.json({ rule });
  });

  app.delete('/api/proactive/rules/:id', auth.requireAuth, (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const ok = memory.deleteProactiveRule(id);
    return res.json({ ok });
  });

  // ==========================================
  // LOCAL LINUX RUNTIME & TERMINAL ROUTES
  // ==========================================

  app.get('/api/linux/status', auth.requireAuth, async (_req: Request, res: Response) => {
    const status = await linux.getLinuxSystemStatus();
    return res.json(status);
  });

  app.get('/api/linux/files', auth.requireAuth, (req: Request, res: Response) => {
    try {
      const subpath = typeof req.query.path === 'string' ? req.query.path : '.';
      const files = linux.listLocalFiles(subpath);
      return res.json({ path: subpath, files });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erro ao listar arquivos';
      return res.status(400).json({ error: msg });
    }
  });

  app.get('/api/linux/file', auth.requireAuth, (req: Request, res: Response) => {
    try {
      const filePath = typeof req.query.path === 'string' ? req.query.path : '';
      const file = linux.readLocalFile(filePath);
      return res.json(file);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erro ao ler arquivo';
      return res.status(400).json({ error: msg });
    }
  });

  app.get('/api/linux/media', auth.requireAuth, (req: Request, res: Response) => {
    try {
      const filePath = typeof req.query.path === 'string' ? req.query.path : '';
      const media = linux.readLocalMedia(filePath);
      res.setHeader('Content-Type', media.mimeType);
      res.setHeader('Content-Disposition', 'inline');
      return res.send(media.buffer);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erro ao ler mídia local';
      return res.status(400).json({ error: msg });
    }
  });

  app.post('/api/linux/file', auth.requireAuth, (req: Request, res: Response) => {
    try {
      const { path: filePath, content } = req.body as { path?: string; content?: string };
      if (!filePath || typeof content !== 'string') {
        return res.status(400).json({ error: 'Caminho e conteúdo são obrigatórios.' });
      }
      const saved = linux.writeLocalFile(filePath, content);
      memory.logInteraction({
        sessionId: 'terminal',
        role: 'tool',
        content: `[EDITOR] Arquivo salvo: ${saved.path} (${saved.bytesWritten} bytes)`,
      });
      return res.json({ ok: true, ...saved });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erro ao salvar arquivo';
      return res.status(400).json({ error: msg });
    }
  });

  app.post('/api/linux/exec', auth.requireAuth, async (req: Request, res: Response) => {
    try {
      const { command, confirmed = false } = req.body as { command?: string; confirmed?: boolean };
      if (!command || !command.trim()) {
        return res.status(400).json({ error: 'Comando é obrigatório.' });
      }
      if (linux.isMutatingShellCommand(command) && !confirmed) {
        return res.json({
          requiresConfirmation: true,
          command: command.trim(),
          message: `O comando "${command.trim()}" pode alterar arquivos ou estado local. Confirme para executar.`,
        });
      }
      const output = await linux.runLinuxCommand(command.trim());
      memory.logInteraction({
        sessionId: 'terminal',
        role: 'tool',
        content: `$ ${command.trim()}\n${output.stdout || output.stderr}`,
      });
      return res.json({ requiresConfirmation: false, ...output });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erro ao executar comando';
      return res.status(400).json({ error: msg });
    }
  });

  // ==========================================
  // AUTONOMOUS WEB BROWSER & CREDENTIAL VAULT
  // ==========================================

  app.get('/api/web/credentials', auth.requireAuth, (_req: Request, res: Response) => {
    return res.json({ credentials: memory.listWebCredentials() });
  });

  app.post('/api/web/credentials', auth.requireAuth, (req: Request, res: Response) => {
    const { siteName, loginUrl, username, password, notes = '' } = req.body as {
      siteName?: string;
      loginUrl?: string;
      username?: string;
      password?: string;
      notes?: string;
    };
    if (!siteName?.trim() || !loginUrl?.trim() || !username?.trim() || !password) {
      return res.status(400).json({ error: 'Site, URL de login, usuário e senha são obrigatórios.' });
    }
    const authedUser = (req as Request & { aegisUser?: memory.LocalUserRecord }).aegisUser;
    const enc = auth.encryptSecret(password);
    const saved = memory.saveWebCredential({
      userId: authedUser?.id || 0,
      siteName: siteName.trim(),
      loginUrl: loginUrl.trim(),
      username: username.trim(),
      encryptedPassword: enc.cipherText,
      iv: enc.iv,
      authTag: enc.authTag,
      notes,
    });
    return res.json({
      credential: {
        id: saved.id,
        site_name: saved.site_name,
        login_url: saved.login_url,
        username: saved.username,
        notes: saved.notes,
        created_at: saved.created_at,
      },
    });
  });

  app.delete('/api/web/credentials/:id', auth.requireAuth, (req: Request, res: Response) => {
    const ok = memory.deleteWebCredential(Number(req.params.id));
    return res.json({ ok });
  });

  app.get('/api/web/snapshot', auth.requireAuth, (req: Request, res: Response) => {
    const sessionId = typeof req.query.sessionId === 'string' ? req.query.sessionId : 'primary-hud';
    return res.json({ snapshot: webBrowser.getLastWebSnapshot(sessionId) });
  });

  app.post('/api/web/navigate', auth.requireAuth, async (req: Request, res: Response) => {
    try {
      const { url, sessionId = 'primary-hud' } = req.body as { url?: string; sessionId?: string };
      if (!url?.trim()) return res.status(400).json({ error: 'URL é obrigatória.' });
      const snapshot = await webBrowser.webNavigate(sessionId, url.trim());
      return res.json({ snapshot });
    } catch (err: unknown) {
      return res.status(400).json({ error: err instanceof Error ? err.message : 'Falha ao acessar URL.' });
    }
  });

  app.post('/api/web/login', auth.requireAuth, async (req: Request, res: Response) => {
    try {
      const {
        credentialId,
        loginUrl,
        username,
        password,
        sessionId = 'primary-hud',
      } = req.body as {
        credentialId?: string | number;
        loginUrl?: string;
        username?: string;
        password?: string;
        sessionId?: string;
      };
      const loginRes = await webBrowser.webLoginWithCredential(sessionId, {
        siteOrCredentialId: credentialId !== undefined ? String(credentialId) : undefined,
        loginUrl,
        username,
        password,
      });
      return res.json(loginRes);
    } catch (err: unknown) {
      return res.status(400).json({ error: err instanceof Error ? err.message : 'Falha ao autenticar no site.' });
    }
  });

  app.post('/api/web/action', auth.requireAuth, async (req: Request, res: Response) => {
    try {
      const {
        sessionId = 'primary-hud',
        url,
        clickLinkText,
        formIndex,
        fields,
      } = req.body as {
        sessionId?: string;
        url?: string;
        clickLinkText?: string;
        formIndex?: number;
        fields?: Record<string, string>;
      };
      const snapshot = await webBrowser.webPerformAction(sessionId, {
        url,
        clickLinkText,
        formIndex,
        fields,
      });
      return res.json({ snapshot });
    } catch (err: unknown) {
      return res.status(400).json({ error: err instanceof Error ? err.message : 'Falha ao executar ação web.' });
    }
  });

  app.post('/api/web/map-menus', auth.requireAuth, async (req: Request, res: Response) => {
    try {
      const { url, credentialId, sessionId = 'primary-hud' } = req.body as {
        url?: string;
        credentialId?: string | number;
        sessionId?: string;
      };
      const result = await webRoutines.mapSiteSubmenusWithAI(sessionId, { url, credentialId });
      return res.json(result);
    } catch (err: unknown) {
      return res.status(400).json({ error: err instanceof Error ? err.message : 'Falha ao mapear menus e sub-menus.' });
    }
  });

  app.post('/api/web/download', auth.requireAuth, async (req: Request, res: Response) => {
    try {
      const {
        sessionId = 'primary-hud',
        fileUrl,
        preferredFilename,
        localFolder = 'Downloads/Portais',
        driveFolder = '',
      } = req.body as {
        sessionId?: string;
        fileUrl?: string;
        preferredFilename?: string;
        localFolder?: string;
        driveFolder?: string;
      };
      if (!fileUrl?.trim()) {
        return res.status(400).json({ error: 'URL do anexo é obrigatória.' });
      }
      const googleToken = extractBearerToken(req) || undefined;
      const result = await webRoutines.downloadAndOrganizeSingleAttachment({
        sessionId,
        fileUrl: fileUrl.trim(),
        preferredFilename,
        localFolder,
        driveFolder,
        googleToken,
      });
      return res.json(result);
    } catch (err: unknown) {
      return res.status(400).json({ error: err instanceof Error ? err.message : 'Falha ao baixar e organizar anexo.' });
    }
  });

  app.get('/api/web/routines', auth.requireAuth, (req: Request, res: Response) => {
    const authedUser = (req as Request & { aegisUser?: memory.LocalUserRecord }).aegisUser;
    const routines = memory.listWebRoutines(authedUser?.id).map((r) => ({
      ...r,
      target_sections: (() => {
        try {
          return JSON.parse(r.target_sections_json) as string[];
        } catch {
          return [];
        }
      })(),
    }));
    const runs = memory.listWebRoutineRuns(undefined, 20).map((run) => ({
      ...run,
      visited_sections: (() => {
        try {
          return JSON.parse(run.visited_sections_json);
        } catch {
          return [];
        }
      })(),
      extracted_data: (() => {
        try {
          return JSON.parse(run.extracted_data_json);
        } catch {
          return [];
        }
      })(),
      downloaded_files: (() => {
        try {
          return JSON.parse(run.downloaded_files_json);
        } catch {
          return [];
        }
      })(),
      drive_uploads: (() => {
        try {
          return JSON.parse(run.drive_uploads_json);
        } catch {
          return [];
        }
      })(),
      logs: (() => {
        try {
          return JSON.parse(run.logs_json);
        } catch {
          return [];
        }
      })(),
    }));
    return res.json({ routines, runs });
  });

  app.post('/api/web/routines', auth.requireAuth, (req: Request, res: Response) => {
    const authedUser = (req as Request & { aegisUser?: memory.LocalUserRecord }).aegisUser;
    const body = req.body as {
      id?: number;
      name?: string;
      siteName?: string;
      credentialId?: number | null;
      startUrl?: string;
      targetSections?: string[];
      extractionInstructions?: string;
      downloadAttachments?: boolean;
      fileExtensions?: string;
      localFolder?: string;
      driveFolder?: string;
      autoOrganizeBySection?: boolean;
      scheduleHint?: string;
      enabled?: boolean;
    };
    if (!body.name?.trim() || !body.startUrl?.trim()) {
      return res.status(400).json({ error: 'Nome da rotina e URL inicial são obrigatórios.' });
    }
    const saved = memory.saveWebRoutine({
      id: body.id ? Number(body.id) : undefined,
      userId: authedUser?.id || 0,
      name: body.name.trim(),
      siteName: body.siteName || '',
      credentialId: body.credentialId ? Number(body.credentialId) : null,
      startUrl: body.startUrl.trim(),
      targetSections: Array.isArray(body.targetSections) ? body.targetSections : [],
      extractionInstructions: body.extractionInstructions || '',
      downloadAttachments: body.downloadAttachments !== false,
      fileExtensions: body.fileExtensions || 'pdf,xlsx,xls,csv,docx,zip,xml',
      localFolder: body.localFolder || 'Downloads/Portais',
      driveFolder: body.driveFolder || '',
      autoOrganizeBySection: body.autoOrganizeBySection !== false,
      scheduleHint: body.scheduleHint || 'Sob demanda',
      enabled: body.enabled !== false,
    });
    return res.json({
      routine: {
        ...saved,
        target_sections: (() => {
          try {
            return JSON.parse(saved.target_sections_json) as string[];
          } catch {
            return [];
          }
        })(),
      },
    });
  });

  app.delete('/api/web/routines/:id', auth.requireAuth, (req: Request, res: Response) => {
    const ok = memory.deleteWebRoutine(Number(req.params.id));
    return res.json({ ok });
  });

  app.post('/api/web/routines/:id/run', auth.requireAuth, async (req: Request, res: Response) => {
    try {
      const routineId = Number(req.params.id);
      const { sessionId = 'primary-hud' } = (req.body || {}) as { sessionId?: string };
      const googleToken = extractBearerToken(req) || undefined;
      const result = await webRoutines.runWebAutomationRoutine({
        routineId,
        sessionId,
        googleToken,
      });
      return res.json(result);
    } catch (err: unknown) {
      return res.status(400).json({ error: err instanceof Error ? err.message : 'Falha ao executar rotina web.' });
    }
  });

  // ==========================================
  // GOOGLE WORKSPACE EXPLORER & EDIT ROUTES
  // ==========================================

  app.get('/api/workspace/overview', auth.requireAuth, async (req: Request, res: Response) => {
    const token = extractBearerToken(req);
    if (!token) {
      return res.status(401).json({ error: 'Token Google Workspace ausente.' });
    }

    const [gmail, drive, calendar, tasks] = await Promise.all([
      gw.gmailListMessages(token, '', 12),
      gw.driveListFiles(token, '', 50, 'root'),
      gw.calendarListEvents(token, 20),
      gw.tasksListTasks(token, true),
    ]);

    return res.json({
      gmail: gmail.ok ? (gmail.data as { messages?: unknown[] }).messages || [] : [],
      drive: drive.ok ? (drive.data as { files?: unknown[] }).files || [] : [],
      calendar: calendar.ok ? (calendar.data as { items?: unknown[] }).items || [] : [],
      tasks: tasks.ok ? (tasks.data as { items?: unknown[] }).items || [] : [],
      errors: {
        gmail: gmail.ok ? null : gmail.error,
        drive: drive.ok ? null : drive.error,
        calendar: calendar.ok ? null : calendar.error,
        tasks: tasks.ok ? null : tasks.error,
      },
    });
  });

  app.get('/api/workspace/drive/folder', auth.requireAuth, async (req: Request, res: Response) => {
    const token = extractBearerToken(req);
    if (!token) return res.status(401).json({ error: 'Token Google Workspace ausente.' });
    const folderId = typeof req.query.folderId === 'string' && req.query.folderId.trim() ? req.query.folderId.trim() : 'root';
    const q = typeof req.query.q === 'string' ? req.query.q : '';
    const listRes = await gw.driveListFiles(token, q, 100, q.trim() ? undefined : folderId);
    if (!listRes.ok) return res.status(listRes.status || 400).json({ error: listRes.error });
    const files = (listRes.data as { files?: unknown[] }).files || [];
    return res.json({ folderId, files });
  });

  app.get('/api/workspace/drive/file/:id', auth.requireAuth, async (req: Request, res: Response) => {
    const token = extractBearerToken(req);
    if (!token) return res.status(401).json({ error: 'Token Google Workspace ausente.' });
    const sheet = typeof req.query.sheet === 'string' ? req.query.sheet : undefined;
    const fileRes = await gw.driveOpenFile(token, String(req.params.id), sheet);
    if (!fileRes.ok) return res.status(fileRes.status || 400).json({ error: fileRes.error });
    return res.json({ file: fileRes.data });
  });

  app.get('/api/workspace/drive/media/:id', auth.requireAuth, async (req: Request, res: Response) => {
    const token = extractBearerToken(req);
    if (!token) return res.status(401).json({ error: 'Token Google Workspace ausente.' });
    const exportMime = typeof req.query.exportMime === 'string' && req.query.exportMime.trim() ? req.query.exportMime.trim() : undefined;
    const media = await gw.driveDownloadOrExportMedia(token, String(req.params.id), exportMime);
    if (!media.ok) {
      return res.status(media.status || 400).json({ error: media.error || 'Falha ao carregar mídia do Drive.' });
    }
    res.setHeader('Content-Type', media.contentType);
    res.setHeader('Content-Disposition', 'inline');
    return res.send(media.buffer);
  });

  app.get('/api/workspace/gmail/message/:id', auth.requireAuth, async (req: Request, res: Response) => {
    const token = extractBearerToken(req);
    if (!token) return res.status(401).json({ error: 'Token Google Workspace ausente.' });
    const msgRes = await gw.gmailGetMessageFull(token, String(req.params.id));
    if (!msgRes.ok) return res.status(msgRes.status || 400).json({ error: msgRes.error });
    return res.json({ message: msgRes.data });
  });

  app.get('/api/workspace/sheets/:id', auth.requireAuth, async (req: Request, res: Response) => {
    const token = extractBearerToken(req);
    if (!token) return res.status(401).json({ error: 'Token Google Workspace ausente.' });
    const sheet = typeof req.query.sheet === 'string' ? req.query.sheet : undefined;
    const sheetRes = await gw.sheetsGetSpreadsheetFull(token, String(req.params.id), sheet);
    if (!sheetRes.ok) return res.status(sheetRes.status || 400).json({ error: sheetRes.error });
    return res.json(sheetRes.data);
  });

  app.post('/api/workspace/action', auth.requireAuth, async (req: Request, res: Response) => {
    const token = extractBearerToken(req);
    if (!token) {
      return res.status(401).json({ error: 'Token Google Workspace ausente.' });
    }
    const { actionType, payload } = req.body as {
      actionType?: string;
      payload?: Record<string, unknown>;
    };
    if (!actionType || !payload) {
      return res.status(400).json({ error: 'actionType e payload são obrigatórios.' });
    }

    const fakeConfirmation: memory.PendingConfirmation = {
      id: `direct_${Date.now()}`,
      action_type: actionType,
      target: String(payload.target || actionType),
      summary: String(payload.summary || actionType),
      payload_json: JSON.stringify(payload),
      status: 'pending',
      created_at: new Date().toISOString(),
    };

    const authedUser = (req as Request & { aegisUser?: memory.LocalUserRecord }).aegisUser;
    const result = await agent.executeConfirmedAction(fakeConfirmation, token, authedUser?.id || 0);
    return res.status(result.ok ? 200 : 400).json(result);
  });

  // ==========================================
  // LINUX INSTALLER BUNDLE ROUTES
  // ==========================================

  app.get('/api/installer/files', (_req: Request, res: Response) => {
    return res.json({ files: bundle.getLinuxBundleFiles() });
  });

  app.get('/api/installer/install.sh', (_req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/x-shellscript; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="install-aegis.sh"');
    return res.send(bundle.getInstallScriptText());
  });

  app.get('/api/installer/install-windows.ps1', (_req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="install-windows.ps1"');
    return res.send(bundle.getWindowsInstallScriptText());
  });

  app.get('/api/installer/start-aegis.bat', (_req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="start-aegis.bat"');
    return res.send(bundle.getWindowsLauncherBatText());
  });

  app.get('/api/installer/bundle.zip', async (_req: Request, res: Response) => {
    const zipBuffer = await bundle.buildLinuxBundleZip();
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="aegis-desktop-bundle.zip"');
    return res.send(zipBuffer);
  });

  const getServerOrigin = (req: Request): string => {
    const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol || 'https';
    const host = (req.headers['x-forwarded-host'] as string) || req.headers.host || 'localhost:3000';
    return nativePackages.sanitizeOrigin(`${proto.split(',')[0].trim()}://${host.split(',')[0].trim()}`);
  };

  // ==========================================
  // NATIVE OS APPLICATION PACKAGES (LINUX / WINDOWS / ANDROID)
  // ==========================================

  const DEFAULT_GITHUB_REPO = 'juanpythonvolei/Aegis-Assistant';

  const getConfiguredGithubRepo = (): string | null => {
    const stored = memory.getAppSetting('github_repo');
    if (stored) return nativePackages.normalizeGithubRepo(stored);
    return nativePackages.normalizeGithubRepo(process.env.AEGIS_GITHUB_REPO || DEFAULT_GITHUB_REPO);
  };

  app.get('/api/installers/catalog', async (req: Request, res: Response) => {
    try {
      const forceRefresh = req.query.refresh === '1' || req.query.refresh === 'true';
      const catalog = await nativePackages.getNativeInstallersCatalog(getServerOrigin(req), {
        githubRepo: getConfiguredGithubRepo(),
        forceRefresh,
      });
      return res.json(catalog);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Falha ao compilar catalogo de aplicativos nativos.';
      console.error('Native installers catalog error:', err);
      return res.status(500).json({ error: msg });
    }
  });

  app.post('/api/installers/github-repo', auth.requireAuth, async (req: Request, res: Response) => {
    try {
      const rawRepo = typeof req.body?.repo === 'string' ? req.body.repo.trim() : '';
      if (!rawRepo) {
        memory.setAppSetting('github_repo', null);
        nativePackages.clearGithubReleaseCache();
        const catalog = await nativePackages.getNativeInstallersCatalog(getServerOrigin(req), {
          githubRepo: nativePackages.normalizeGithubRepo(process.env.AEGIS_GITHUB_REPO),
          forceRefresh: true,
        });
        return res.json({ ok: true, catalog });
      }

      const normalized = nativePackages.normalizeGithubRepo(rawRepo);
      if (!normalized) {
        return res.status(400).json({
          error: 'Informe um repositório GitHub válido no formato usuario/repositorio ou URL https://github.com/usuario/repositorio.',
        });
      }

      memory.setAppSetting('github_repo', normalized);
      nativePackages.clearGithubReleaseCache(normalized);
      const catalog = await nativePackages.getNativeInstallersCatalog(getServerOrigin(req), {
        githubRepo: normalized,
        forceRefresh: true,
      });
      return res.json({ ok: true, repo: normalized, catalog });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Falha ao vincular repositório GitHub.';
      return res.status(500).json({ error: msg });
    }
  });

  app.get(
    ['/api/installers/linux/aegis-desktop_2.1.0_amd64.deb', '/api/installers/linux/aegis-desktop_2.0.0_amd64.deb'],
    (_req: Request, res: Response) => {
      try {
        const artifacts = nativePackages.buildLinuxNativeArtifacts();
        res.setHeader('Content-Type', 'application/vnd.debian.binary-package');
        res.setHeader('Content-Disposition', 'attachment; filename="aegis-desktop_2.1.0_amd64.deb"');
        res.setHeader('X-Content-SHA256', artifacts.debSha256);
        return res.send(artifacts.debBuffer);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Falha ao gerar pacote .deb.';
        return res.status(500).json({ error: msg });
      }
    }
  );

  app.get(
    [
      '/api/installers/linux/AegisDesktop-2.1.0-x86_64.AppImage',
      '/api/installers/linux/AegisDesktop-2.1.0.AppImage',
    ],
    (_req: Request, res: Response) => {
      try {
        const artifacts = nativePackages.buildLinuxNativeArtifacts();
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Disposition', 'attachment; filename="AegisDesktop-2.1.0-x86_64.AppImage"');
        res.setHeader('X-Content-SHA256', artifacts.appImageSha256);
        return res.send(artifacts.appImageBuffer);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Falha ao gerar pacote .AppImage.';
        return res.status(500).json({ error: msg });
      }
    }
  );

  app.get('/api/installers/linux/aegis-desktop-linux-x64.tar.gz', (_req: Request, res: Response) => {
    try {
      const artifacts = nativePackages.buildLinuxNativeArtifacts();
      res.setHeader('Content-Type', 'application/gzip');
      res.setHeader('Content-Disposition', 'attachment; filename="aegis-desktop-linux-x64.tar.gz"');
      res.setHeader('X-Content-SHA256', artifacts.tarGzSha256);
      return res.send(artifacts.tarGzBuffer);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Falha ao gerar pacote .tar.gz.';
      return res.status(500).json({ error: msg });
    }
  });

  app.get('/api/installers/linux/aegis-desktop', (_req: Request, res: Response) => {
    try {
      const artifacts = nativePackages.buildLinuxNativeArtifacts();
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', 'attachment; filename="aegis-desktop"');
      res.setHeader('X-Content-SHA256', artifacts.elfSha256);
      return res.send(artifacts.elfBuffer);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Falha ao compilar binario ELF.';
      return res.status(500).json({ error: msg });
    }
  });

  app.get(
    [
      '/api/installers/windows/AegisDesktop-Windows-Native-2.1.0.zip',
      '/api/installers/windows/AegisDesktop-Windows-Native-2.0.0.zip',
    ],
    async (req: Request, res: Response) => {
      try {
        const pkg = await nativePackages.buildWindowsNativePackageZip(getServerOrigin(req));
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', 'attachment; filename="AegisDesktop-Windows-Native-2.1.0.zip"');
        res.setHeader('X-Content-SHA256', pkg.sha256);
        return res.send(pkg.buffer);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Falha ao gerar pacote nativo Windows.';
        return res.status(500).json({ error: msg });
      }
    }
  );

  app.get(
    [
      '/api/installers/android/AegisAndroid-Native-2.1.0.zip',
      '/api/installers/android/AegisAndroid-Native-2.0.0.zip',
    ],
    async (req: Request, res: Response) => {
      try {
        const code = typeof req.query.code === 'string' ? nativePackages.sanitizePairingCode(req.query.code) : '';
        const pkg = await nativePackages.buildAndroidNativeProjectZip(getServerOrigin(req), code);
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', 'attachment; filename="AegisAndroid-Native-2.1.0.zip"');
        res.setHeader('X-Content-SHA256', pkg.sha256);
        return res.send(pkg.buffer);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Falha ao gerar projeto nativo Android.';
        return res.status(500).json({ error: msg });
      }
    }
  );

  // ==========================================
  // MULTI-DEVICE MESH ROUTES (ANDROID / IOS / DESKTOP)
  // ==========================================

  const extractDeviceToken = (req: Request): string | null => {
    const headerToken = req.headers['x-aegis-device-token'];
    if (typeof headerToken === 'string' && headerToken.trim()) return headerToken.trim();
    const bearer = extractBearerToken(req);
    if (bearer && bearer.startsWith('agd_')) return bearer;
    return null;
  };

  app.get('/api/devices', auth.requireAuth, async (req: Request, res: Response) => {
    const authedUser = (req as Request & { aegisUser?: memory.LocalUserRecord }).aegisUser;
    await deviceHub.detectLocalAdbDevices(authedUser?.id || 0);
    const devices = memory.listPairedDevices(authedUser?.id).map(deviceHub.sanitizeDeviceRecord);
    return res.json({ devices });
  });

  app.post('/api/devices/pairing-code', auth.requireAuth, (req: Request, res: Response) => {
    const authedUser = (req as Request & { aegisUser?: memory.LocalUserRecord }).aegisUser;
    const { label = '', platform = 'android' } = (req.body || {}) as {
      label?: string;
      platform?: memory.DevicePlatform;
    };
    const validPlatforms: memory.DevicePlatform[] = ['android', 'ios', 'linux', 'windows', 'web'];
    const safePlatform = validPlatforms.includes(platform) ? platform : 'android';
    const rec = deviceHub.generatePairingCode(authedUser?.id || 0, label, safePlatform);
    return res.json({
      code: rec.code,
      platform: rec.platform,
      label: rec.label,
      expiresAt: rec.expires_at,
      origin: getServerOrigin(req),
    });
  });

  // Register or sync the current browser/PWA mobile device (iOS Safari / Android Chrome / Desktop)
  app.post('/api/devices/register-browser', auth.requireAuth, (req: Request, res: Response) => {
    const authedUser = (req as Request & { aegisUser?: memory.LocalUserRecord }).aegisUser;
    const {
      deviceId,
      name,
      platform = 'android',
      telemetry = {},
      storage = {},
    } = (req.body || {}) as {
      deviceId?: string;
      name?: string;
      platform?: memory.DevicePlatform;
      telemetry?: Record<string, unknown>;
      storage?: Record<string, unknown>;
    };

    const validPlatforms: memory.DevicePlatform[] = ['android', 'ios', 'linux', 'windows', 'web'];
    const safePlatform = validPlatforms.includes(platform) ? platform : 'web';
    const cleanId =
      deviceId && /^pwa_[a-zA-Z0-9_-]{6,40}$/.test(deviceId)
        ? deviceId
        : `pwa_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

    const existing = memory.getPairedDeviceById(cleanId);
    let rawToken: string | undefined;
    let tokenHash: string | undefined;
    if (!existing) {
      const issued = deviceHub.generateDeviceToken();
      rawToken = issued.rawToken;
      tokenHash = issued.tokenHash;
    }

    const saved = memory.upsertPairedDevice({
      id: cleanId,
      userId: authedUser?.id || 0,
      name: (name || `Aegis PWA (${safePlatform.toUpperCase()})`).slice(0, 80),
      platform: safePlatform,
      transport: safePlatform === 'ios' ? 'ios_shortcut' : 'pwa_browser',
      serialOrUid: cleanId,
      tokenHash,
      status: 'online',
      capabilities:
        safePlatform === 'ios'
          ? ['ios_shortcuts_webhook', 'telemetry', 'notifications', 'clipboard', 'pwa_standalone']
          : ['pwa_standalone', 'telemetry', 'notifications'],
      telemetry,
      storageSnapshot: storage,
    });
    const sanitized = deviceHub.sanitizeDeviceRecord(saved);
    deviceHub.broadcastOperatorEvent('device_update', sanitized);
    return res.json({ device: sanitized, deviceToken: rawToken });
  });

  app.get('/api/devices/:id', auth.requireAuth, (req: Request, res: Response) => {
    const id = String(req.params.id || '');
    const row = memory.getPairedDeviceById(id);
    if (!row) return res.status(404).json({ error: 'Dispositivo não encontrado.' });
    const commands = memory.listDeviceCommands(id, 30);
    return res.json({
      device: deviceHub.sanitizeDeviceRecord(row),
      commands,
    });
  });

  app.post('/api/devices/:id/command', auth.requireAuth, async (req: Request, res: Response) => {
    const id = String(req.params.id || '');
    const { commandType, payload = {}, confirmed = false } = (req.body || {}) as {
      commandType?: string;
      payload?: Record<string, unknown>;
      confirmed?: boolean;
    };
    if (!commandType || !commandType.trim()) {
      return res.status(400).json({ error: 'commandType é obrigatório.' });
    }
    if (deviceHub.isDestructiveDeviceCommand(commandType, payload) && !confirmed) {
      return res.json({
        requiresConfirmation: true,
        commandType,
        payload,
        message: `O comando "${commandType}" pode remover dados ou reiniciar o dispositivo. Confirme para continuar.`,
      });
    }
    const result = await deviceHub.dispatchDeviceCommand(id, commandType.trim(), payload);
    return res.status(result.ok ? 200 : 400).json(result);
  });

  app.delete('/api/devices/:id', auth.requireAuth, (req: Request, res: Response) => {
    const id = String(req.params.id || '');
    const ok = memory.deletePairedDevice(id);
    deviceHub.broadcastOperatorEvent('device_removed', { id });
    return res.json({ ok });
  });

  // Device-Agent HTTP Pairing & iOS Shortcuts Bridge (Authenticated via pairingCode or X-Aegis-Device-Token)
  app.post('/api/devices/pair', (req: Request, res: Response) => {
    const {
      pairingCode,
      name,
      platform = 'ios',
      transport = 'ios_shortcut',
      capabilities = [],
      telemetry = {},
    } = (req.body || {}) as {
      pairingCode?: string;
      name?: string;
      platform?: memory.DevicePlatform;
      transport?: memory.DeviceTransport;
      capabilities?: string[];
      telemetry?: Record<string, unknown>;
    };
    if (!pairingCode?.trim()) {
      return res.status(400).json({ error: 'pairingCode é obrigatório.' });
    }
    const codeRec = memory.consumeDevicePairingCode(pairingCode);
    if (!codeRec) {
      return res.status(401).json({ error: 'Código de pareamento inválido ou expirado.' });
    }
    const { rawToken, tokenHash } = deviceHub.generateDeviceToken();
    const devId = `dev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
    const validPlatforms: memory.DevicePlatform[] = ['android', 'ios', 'linux', 'windows', 'web'];
    const safePlatform = validPlatforms.includes(platform) ? platform : codeRec.platform;
    const saved = memory.upsertPairedDevice({
      id: devId,
      userId: codeRec.user_id,
      name: (name || codeRec.label || `Dispositivo ${safePlatform.toUpperCase()}`).slice(0, 80),
      platform: safePlatform,
      transport,
      serialOrUid: devId,
      tokenHash,
      status: 'online',
      capabilities: Array.isArray(capabilities) ? capabilities.map(String) : ['ios_shortcuts_webhook', 'telemetry'],
      telemetry,
    });
    const sanitized = deviceHub.sanitizeDeviceRecord(saved);
    deviceHub.broadcastOperatorEvent('device_update', sanitized);
    return res.json({ ok: true, deviceId: saved.id, token: rawToken, device: sanitized });
  });

  app.post('/api/devices/telemetry', (req: Request, res: Response) => {
    const token = extractDeviceToken(req);
    if (!token) return res.status(401).json({ error: 'X-Aegis-Device-Token ausente.' });
    const device = memory.findPairedDeviceByTokenHash(deviceHub.hashDeviceToken(token));
    if (!device) return res.status(401).json({ error: 'Token de dispositivo inválido.' });

    const { telemetry, storage, apps, notifications, files } = (req.body || {}) as {
      telemetry?: Record<string, unknown>;
      storage?: Record<string, unknown>;
      apps?: unknown[];
      notifications?: unknown[];
      files?: unknown[];
    };
    const updated = memory.updateDeviceSnapshots({
      id: device.id,
      telemetry,
      storageSnapshot: storage,
      appsSnapshot: apps,
      notificationsSnapshot: notifications,
      filesSnapshot: files,
    });
    if (updated) {
      deviceHub.broadcastOperatorEvent('device_update', deviceHub.sanitizeDeviceRecord(updated));
    }
    const pendingCommands = memory.getPendingDeviceCommands(device.id).map((c) => ({
      id: c.id,
      commandType: c.command_type,
      payload: JSON.parse(c.payload_json || '{}'),
      createdAt: c.created_at,
    }));
    return res.json({ ok: true, deviceId: device.id, pendingCommands });
  });

  app.get('/api/devices/ios/poll', (req: Request, res: Response) => {
    const token = extractDeviceToken(req);
    if (!token) return res.status(401).json({ error: 'X-Aegis-Device-Token ausente.' });
    const device = memory.findPairedDeviceByTokenHash(deviceHub.hashDeviceToken(token));
    if (!device) return res.status(401).json({ error: 'Token de dispositivo inválido.' });
    memory.updateDeviceStatus(device.id, 'online');
    const pending = memory.getPendingDeviceCommands(device.id).map((c) => ({
      id: c.id,
      commandType: c.command_type,
      payload: JSON.parse(c.payload_json || '{}'),
      createdAt: c.created_at,
    }));
    return res.json({ ok: true, deviceId: device.id, commands: pending });
  });

  app.post('/api/devices/ios/report', (req: Request, res: Response) => {
    const token = extractDeviceToken(req);
    if (!token) return res.status(401).json({ error: 'X-Aegis-Device-Token ausente.' });
    const device = memory.findPairedDeviceByTokenHash(deviceHub.hashDeviceToken(token));
    if (!device) return res.status(401).json({ error: 'Token de dispositivo inválido.' });
    const { commandId, ok = true, output } = (req.body || {}) as {
      commandId?: string;
      ok?: boolean;
      output?: unknown;
    };
    if (!commandId) return res.status(400).json({ error: 'commandId obrigatório.' });
    memory.updateDeviceCommandResult(commandId, ok ? 'completed' : 'error', output ?? { ok });
    deviceHub.broadcastOperatorEvent('command_update', {
      deviceId: device.id,
      commandId,
      status: ok ? 'completed' : 'error',
      output,
    });
    return res.json({ ok: true });
  });

  // Downloadable Android Termux Agent & Kotlin Companion Scripts
  app.get('/api/devices/scripts/android-agent.mjs', (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Content-Disposition', 'inline; filename="aegis-android-agent.mjs"');
    return res.send(deviceHub.getAndroidTermuxAgentScript(getServerOrigin(req)));
  });

  app.get('/api/devices/scripts/android-termux.sh', (req: Request, res: Response) => {
    const code = typeof req.query.code === 'string' ? req.query.code.replace(/[^A-Z0-9]/gi, '').slice(0, 10) : '';
    res.setHeader('Content-Type', 'text/x-shellscript; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="install-android-termux.sh"');
    return res.send(deviceHub.getAndroidTermuxInstallSh(getServerOrigin(req), code));
  });

  app.get('/api/devices/scripts/android-kotlin.zip', async (req: Request, res: Response) => {
    const code = typeof req.query.code === 'string' ? nativePackages.sanitizePairingCode(req.query.code) : '';
    const pkg = await nativePackages.buildAndroidNativeProjectZip(getServerOrigin(req), code);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="AegisAndroid-Native-2.1.0.zip"');
    res.setHeader('X-Content-SHA256', pkg.sha256);
    return res.send(pkg.buffer);
  });

  // ==========================================
  // VITE / STATIC SERVING ON PORT 3000
  // ==========================================

  const PORT = 3000;
  const httpServer = http.createServer(app);

  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    const hmrDisabled = process.env.DISABLE_HMR === 'true';
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: !hmrDisabled,
        ws: { server: httpServer },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('/{*splat}', (_req: Request, res: Response) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  attachLiveWebSocketServer(httpServer);
  deviceHub.attachDeviceWebSocketServer(httpServer);
  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Aegis server running on http://0.0.0.0:${PORT} (HTTP + Gemini Live WS + Device Mesh WS)`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
