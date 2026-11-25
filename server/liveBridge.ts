import { GoogleGenAI, Modality, type LiveServerMessage } from '@google/genai';
import type { IncomingMessage, Server as HttpServer } from 'node:http';
import { URL } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import * as agent from './geminiAgent.ts';
import * as deviceHub from './deviceHub.ts';
import * as memory from './memory.ts';

const LIVE_MODEL = 'gemini-3.8-live';

function parseCookieHeader(cookieHeader: string | undefined): Record<string, string> {
  if (!cookieHeader) return {};
  const map: Record<string, string> = {};
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0) {
      map[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
    }
  }
  return map;
}

function authenticateUpgrade(req: IncomingMessage): memory.LocalUserRecord | null {
  try {
    const parsed = new URL(req.url || '/', 'http://localhost');
    const queryToken = parsed.searchParams.get('session')?.trim();
    const cookies = parseCookieHeader(req.headers.cookie);
    const token = queryToken || cookies.aegis_session || null;
    if (!token) return null;
    return memory.getSessionUser(token);
  } catch {
    return null;
  }
}

type ClientLiveMsg =
  | { type: 'init'; googleToken?: string | null; userEmail?: string; voiceName?: string }
  | { type: 'update_google_token'; googleToken?: string | null }
  | { type: 'audio'; data: string }
  | { type: 'video'; data: string; mimeType?: string }
  | { type: 'text'; text: string }
  | { type: 'end_audio' }
  | { type: 'ping' };

export function attachLiveWebSocketServer(httpServer: HttpServer): void {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (req, socket, head) => {
    try {
      const parsed = new URL(req.url || '/', 'http://localhost');
      if (parsed.pathname !== '/api/live') {
        return; // Let Vite or other upgrade handlers handle non-/api/live paths
      }
      const user = authenticateUpgrade(req);
      if (!user) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req, user);
      });
    } catch {
      socket.destroy();
    }
  });

  wss.on('connection', (ws: WebSocket, _req: IncomingMessage, user: memory.LocalUserRecord) => {
    let liveSession: Awaited<ReturnType<GoogleGenAI['live']['connect']>> | null = null;
    let googleToken: string | null = null;
    let sessionId = `live-${Date.now()}`;
    let inputTranscriptBuf = '';
    let outputTranscriptBuf = '';
    let closed = false;

    const sendJson = (payload: Record<string, unknown>) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(payload));
      }
    };

    const closeLiveSession = () => {
      if (liveSession) {
        try {
          liveSession.close();
        } catch {
          // ignore close errors
        }
        liveSession = null;
      }
    };

    const connectToGeminiLive = async (opts: { userEmail?: string; voiceName?: string }) => {
      closeLiveSession();

      if (!process.env.GEMINI_API_KEY) {
        sendJson({ type: 'error', message: 'GEMINI_API_KEY não configurada no servidor.' });
        return;
      }

      sendJson({ type: 'status', status: 'connecting' });

      const ai = new GoogleGenAI({
        apiKey: process.env.GEMINI_API_KEY,
        apiVersion: 'v1beta',
        httpOptions: {
          apiVersion: 'v1beta',
          headers: { 'User-Agent': 'aistudio-build' },
        },
      });

      const memCtx = memory.searchMemoryContext('preferencias usuario', 8);
      const factsBlock = memCtx.facts
        .map((f) => `- [${f.category}${f.pinned ? '|FIXADO' : ''}] ${f.content.slice(0, 140)}`)
        .join('\n');

      const devicesSummary = deviceHub.getDevicesContextSummaryForAI(user.id);
      const systemInstruction = `Você é Aegis, um orquestrador autônomo de subagentes holográfico tridimensional estilo J.A.R.V.I.S., falando em Português (Brasil) com tom calmo, inteligente, direto e preciso.
Usuário: ${opts.userEmail || user.email}
Google Workspace (Configurações): ${googleToken ? 'ATIVO (Gmail, Drive, Calendar, Docs, Sheets, Tasks)' : 'DESCONECTADO'}

Dispositivos Adicionados (Android / iOS / Desktop):
${devicesSummary}

Memória persistente:
${factsBlock || '- Sem fatos salvos ainda.'}

Instruções essenciais:
1. Fale de forma natural, concisa e fluida em Português (Brasil). Evite respostas excessivamente longas por voz.
2. Você pode delegar tarefas complexas a subagentes especializados (\`delegate_subagent\`), inspecionar e controlar dispositivos Android/iOS/Desktop (\`devices_list_all\`, \`device_inspect_data\`, \`device_list_files\`, \`device_execute_action\`, \`ecosystem_unified_search\`) e sintetizar novas funções no seu código (\`evaluate_and_evolve_capability\`).
3. Quando o usuário pedir para ver arquivos, imagens, páginas web, gráficos, tabelas, código ou qualquer apresentação visual, invoque imediatamente \`draw_holographic_screen\` para desenhar uma tela holográfica flutuante sobre o núcleo 3D e explique resumidamente por voz o que você projetou.
4. Quando o usuário pedir para você enxergá-lo ou olhar algo ("me veja", "olhe isso", "o que estou segurando"), invoque \`request_camera_vision\` com \`action: "enable"\`. Se pedir para desligar a câmera, invoque com \`action: "disable"\`.
5. Quando receber quadros de vídeo da câmera do usuário, descreva ou responda com base no que realmente está vendo.
6. Para ações destrutivas ou alterações no Google Workspace, informe que a confirmação foi aberta na tela.`;

      const fullTools = agent.getAllToolDeclarations();
      const essentialLiveToolNames = new Set([
        'delegate_subagent',
        'draw_holographic_screen',
        'request_camera_vision',
        'evaluate_and_evolve_capability',
        'linux_run_command',
        'linux_list_files',
        'linux_read_file',
        'linux_write_file',
        'devices_list_all',
        'device_inspect_data',
        'device_execute_action',
        'ecosystem_unified_search',
        'web_navigate',
        'web_map_submenus',
        'drive_list_files',
        'gmail_list_messages',
        'memory_save_fact',
      ]);
      const curatedTools = fullTools.filter((t) => t.name && essentialLiveToolNames.has(t.name));

      const openLiveWithTools = async (toolDecls: typeof fullTools) =>
        ai.live.connect({
          model: LIVE_MODEL,
          config: {
            responseModalities: [Modality.AUDIO],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: {
                  voiceName: opts.voiceName || 'Fenrir',
                },
              },
            },
            inputAudioTranscription: {},
            outputAudioTranscription: {},
            systemInstruction,
            ...(toolDecls.length > 0 ? { tools: [{ functionDeclarations: toolDecls }] } : {}),
          },
          callbacks: {
            onopen: () => {
              // WebSocket transport opened; connected status is sent once Live setup completes below
            },
            onmessage: (msg: LiveServerMessage) => {
              if (closed) return;

              const sc = msg.serverContent;
              if (sc) {
                if (sc.interrupted) {
                  sendJson({ type: 'interrupted' });
                }

                if (sc.inputTranscription?.text) {
                  inputTranscriptBuf += sc.inputTranscription.text;
                  sendJson({ type: 'input_transcript', text: sc.inputTranscription.text, accumulated: inputTranscriptBuf });
                }

                if (sc.outputTranscription?.text) {
                  outputTranscriptBuf += sc.outputTranscription.text;
                  sendJson({ type: 'output_transcript', text: sc.outputTranscription.text, accumulated: outputTranscriptBuf });
                }

                const parts = sc.modelTurn?.parts || [];
                for (const part of parts) {
                  if (part.inlineData?.data && part.inlineData.mimeType?.startsWith('audio/')) {
                    sendJson({ type: 'audio', data: part.inlineData.data, mimeType: part.inlineData.mimeType });
                  }
                }

                if (sc.turnComplete) {
                  const userText = inputTranscriptBuf.trim();
                  const modelText = outputTranscriptBuf.trim();
                  if (userText) {
                    memory.logInteraction({ sessionId, role: 'user', content: `[VOZ] ${userText}` });
                  }
                  if (modelText) {
                    memory.logInteraction({ sessionId, role: 'assistant', content: modelText });
                  }
                  sendJson({
                    type: 'turn_complete',
                    userTranscript: userText,
                    assistantTranscript: modelText,
                  });
                  inputTranscriptBuf = '';
                  outputTranscriptBuf = '';
                }
              }

              // Execute tool calls asynchronously and send tool responses back to Live API
              const calls = msg.toolCall?.functionCalls;
              if (calls && calls.length > 0 && liveSession) {
                const activeSession = liveSession;
                void (async () => {
                  const functionResponses: Array<{ id?: string; name: string; response: Record<string, unknown> }> = [];
                  for (const call of calls) {
                    const name = call.name || 'unknown';
                    const args = (call.args || {}) as Record<string, unknown>;
                    sendJson({ type: 'tool_start', tool: name, args });

                    const outcome = await agent.executeAgentToolCall({
                      name,
                      args,
                      sessionId,
                      googleToken,
                    });

                    sendJson({ type: 'tool_step', step: outcome.step });
                    if (outcome.drawnScreen) {
                      sendJson({ type: 'screen', screen: outcome.drawnScreen });
                    }
                    if (outcome.extraScreens) {
                      for (const extraScreen of outcome.extraScreens) {
                        sendJson({ type: 'screen', screen: extraScreen });
                      }
                    }
                    if (outcome.cameraAction) {
                      sendJson({ type: 'camera_control', action: outcome.cameraAction });
                    }
                    if (outcome.pendingConfirmation) {
                      sendJson({ type: 'confirmation_required', confirmation: outcome.pendingConfirmation });
                    }
                    if (outcome.extraConfirmations) {
                      for (const extraConf of outcome.extraConfirmations) {
                        sendJson({ type: 'confirmation_required', confirmation: extraConf });
                      }
                    }

                    functionResponses.push({
                      id: call.id,
                      name,
                      response: outcome.toolResult,
                    });
                  }
                  if (!closed && liveSession === activeSession) {
                    try {
                      activeSession.sendToolResponse({ functionResponses });
                    } catch (err) {
                      console.error('Failed to send Live tool response:', err);
                    }
                  }
                })();
              }
            },
            onerror: (e: ErrorEvent) => {
              if (!closed) {
                sendJson({ type: 'error', message: e.message || 'Erro na sessão Gemini Live API.' });
              }
            },
            onclose: (e: CloseEvent) => {
              if (!closed) {
                sendJson({ type: 'status', status: 'disconnected', reason: e.reason || '' });
              }
              liveSession = null;
            },
          },
        });

      try {
        let session: Awaited<ReturnType<GoogleGenAI['live']['connect']>>;
        try {
          session = await openLiveWithTools(curatedTools);
        } catch (firstErr) {
          console.warn('Live setup with curated tools failed, retrying without tools:', firstErr);
          session = await openLiveWithTools([]);
        }

        if (closed) {
          session.close();
          return;
        }
        liveSession = session;
        sendJson({ type: 'status', status: 'connected', model: LIVE_MODEL });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Falha ao conectar à Gemini Live API.';
        console.error('Gemini Live connect error:', err);
        sendJson({ type: 'error', message });
        sendJson({ type: 'status', status: 'error' });
      }
    };

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as ClientLiveMsg;
        if (msg.type === 'ping') {
          sendJson({ type: 'pong' });
          return;
        }
        if (msg.type === 'init') {
          googleToken = msg.googleToken || null;
          sessionId = `live-${Date.now()}`;
          void connectToGeminiLive({ userEmail: msg.userEmail, voiceName: msg.voiceName });
          return;
        }
        if (msg.type === 'update_google_token') {
          googleToken = msg.googleToken || null;
          return;
        }
        if (!liveSession) return;

        if (msg.type === 'audio' && msg.data) {
          liveSession.sendRealtimeInput({
            audio: {
              data: msg.data,
              mimeType: 'audio/pcm;rate=16000',
            },
          });
        } else if (msg.type === 'video' && msg.data) {
          liveSession.sendRealtimeInput({
            video: {
              data: msg.data,
              mimeType: msg.mimeType || 'image/jpeg',
            },
          });
        } else if (msg.type === 'text' && msg.text?.trim()) {
          memory.logInteraction({ sessionId, role: 'user', content: msg.text.trim() });
          liveSession.sendClientContent({
            turns: [{ role: 'user', parts: [{ text: msg.text.trim() }] }],
            turnComplete: true,
          });
        } else if (msg.type === 'end_audio') {
          liveSession.sendRealtimeInput({ audioStreamEnd: true });
        }
      } catch (err) {
        console.error('Live WS message error:', err);
      }
    });

    ws.on('close', () => {
      closed = true;
      closeLiveSession();
    });

    ws.on('error', () => {
      closed = true;
      closeLiveSession();
    });
  });
}
