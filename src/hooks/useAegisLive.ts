import { useCallback, useEffect, useRef, useState } from 'react';
import { getAegisSessionToken } from '../lib/apiClient';
import type {
  AegisCoreState,
  HolographicScreenSpec,
  LiveSessionStatus,
  PendingConfirmation,
} from '../types';

function float32ToBase64Pcm16(float32: Float32Array): string {
  const int16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  const bytes = new Uint8Array(int16.buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64Pcm16ToFloat32(b64: string): Float32Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const int16 = new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2));
  const float32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) {
    float32[i] = int16[i] / 32768;
  }
  return float32;
}

export interface UseAegisLiveOptions {
  googleToken: string | null;
  userEmail?: string;
  onUserTranscript: (text: string) => void;
  onAssistantTranscript: (text: string) => void;
  onDrawnScreen: (screen: HolographicScreenSpec) => void;
  onConfirmationRequired: (confirmation: PendingConfirmation) => void;
}

export function useAegisLive(opts: UseAegisLiveOptions) {
  const [status, setStatus] = useState<LiveSessionStatus>('disconnected');
  const [micActive, setMicActive] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [toolBusy, setToolBusy] = useState(false);
  const [liveCaption, setLiveCaption] = useState<{ role: 'user' | 'assistant'; text: string } | null>(null);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);

  const audioLevelRef = useRef<number>(0);
  const wsRef = useRef<WebSocket | null>(null);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  // Input mic refs
  const micStreamRef = useRef<MediaStream | null>(null);
  const inputCtxRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);

  // Output 24kHz audio playback refs
  const outputCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const scheduledSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const meterRafRef = useRef<number>(0);

  // Camera vision refs
  const camStreamRef = useRef<MediaStream | null>(null);
  const camVideoRef = useRef<HTMLVideoElement | null>(null);
  const camCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const camIntervalRef = useRef<number | null>(null);

  const stopPlayback = useCallback(() => {
    for (const src of scheduledSourcesRef.current) {
      try {
        src.stop();
      } catch {
        // ignore already stopped
      }
    }
    scheduledSourcesRef.current.clear();
    if (outputCtxRef.current) {
      nextStartTimeRef.current = outputCtxRef.current.currentTime;
    }
    setSpeaking(false);
  }, []);

  const ensureOutputAudio = useCallback(() => {
    if (!outputCtxRef.current) {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctx({ sampleRate: 24000 });
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.connect(ctx.destination);
      outputCtxRef.current = ctx;
      analyserRef.current = analyser;
      nextStartTimeRef.current = ctx.currentTime;
    }
    if (outputCtxRef.current.state === 'suspended') {
      void outputCtxRef.current.resume();
    }
    return { ctx: outputCtxRef.current, analyser: analyserRef.current! };
  }, []);

  const enqueueOutputPcm24k = useCallback(
    (b64: string) => {
      const { ctx, analyser } = ensureOutputAudio();
      const samples = base64Pcm16ToFloat32(b64);
      if (samples.length === 0) return;

      const buffer = ctx.createBuffer(1, samples.length, 24000);
      buffer.getChannelData(0).set(samples);

      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(analyser);

      const startAt = Math.max(ctx.currentTime + 0.015, nextStartTimeRef.current);
      src.start(startAt);
      nextStartTimeRef.current = startAt + buffer.duration;
      scheduledSourcesRef.current.add(src);
      setSpeaking(true);

      src.onended = () => {
        scheduledSourcesRef.current.delete(src);
        if (scheduledSourcesRef.current.size === 0) {
          setSpeaking(false);
        }
      };
    },
    [ensureOutputAudio]
  );

  const stopCamera = useCallback(() => {
    if (camIntervalRef.current !== null) {
      window.clearInterval(camIntervalRef.current);
      camIntervalRef.current = null;
    }
    if (camStreamRef.current) {
      camStreamRef.current.getTracks().forEach((t) => t.stop());
      camStreamRef.current = null;
    }
    if (camVideoRef.current) {
      camVideoRef.current.srcObject = null;
      camVideoRef.current = null;
    }
    setCameraStream(null);
    setCameraActive(false);
  }, []);

  const stopMic = useCallback(() => {
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (inputCtxRef.current) {
      void inputCtxRef.current.close();
      inputCtxRef.current = null;
    }
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((t) => t.stop());
      micStreamRef.current = null;
    }
    setMicActive(false);
  }, []);

  const disconnect = useCallback(() => {
    stopMic();
    stopCamera();
    stopPlayback();
    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch {
        // ignore
      }
      wsRef.current = null;
    }
    setStatus('disconnected');
    setToolBusy(false);
    setLiveCaption(null);
    audioLevelRef.current = 0;
  }, [stopCamera, stopMic, stopPlayback]);

  const startMicCapture = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        sampleRate: 16000,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    micStreamRef.current = stream;

    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const inputCtx = new Ctx({ sampleRate: 16000 });
    inputCtxRef.current = inputCtx;

    const source = inputCtx.createMediaStreamSource(stream);
    const processor = inputCtx.createScriptProcessor(2048, 1, 1);
    processorRef.current = processor;

    processor.onaudioprocess = (ev) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      const input = ev.inputBuffer.getChannelData(0);

      // Compute RMS for 3D core listening reaction when assistant isn't speaking
      let sum = 0;
      for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
      const rms = Math.sqrt(sum / input.length);
      if (scheduledSourcesRef.current.size === 0) {
        audioLevelRef.current = Math.min(1, rms * 5.2);
      }

      const b64 = float32ToBase64Pcm16(input);
      ws.send(JSON.stringify({ type: 'audio', data: b64 }));
    };

    source.connect(processor);
    // Route through silent gain so ScriptProcessor fires without local feedback
    const silentGain = inputCtx.createGain();
    silentGain.gain.value = 0;
    processor.connect(silentGain);
    silentGain.connect(inputCtx.destination);
    setMicActive(true);
  }, []);

  const enableCamera = useCallback(async (): Promise<boolean> => {
    if (camStreamRef.current) return true;
    try {
      setLiveError(null);
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
      });
      camStreamRef.current = stream;
      setCameraStream(stream);
      setCameraActive(true);

      const video = document.createElement('video');
      video.srcObject = stream;
      video.muted = true;
      video.playsInline = true;
      await video.play();
      camVideoRef.current = video;

      const canvas = document.createElement('canvas');
      canvas.width = 512;
      canvas.height = 384;
      camCanvasRef.current = canvas;

      // Capture <= 1 FPS JPEG frame for Gemini Live API vision
      camIntervalRef.current = window.setInterval(() => {
        const ws = wsRef.current;
        if (!ws || ws.readyState !== WebSocket.OPEN || !camVideoRef.current || !camCanvasRef.current) return;
        const ctx2d = camCanvasRef.current.getContext('2d');
        if (!ctx2d || camVideoRef.current.videoWidth === 0) return;
        ctx2d.drawImage(camVideoRef.current, 0, 0, camCanvasRef.current.width, camCanvasRef.current.height);
        const dataUrl = camCanvasRef.current.toDataURL('image/jpeg', 0.72);
        const b64 = dataUrl.split(',')[1];
        if (b64) {
          ws.send(JSON.stringify({ type: 'video', data: b64, mimeType: 'image/jpeg' }));
        }
      }, 1000);

      return true;
    } catch (err: unknown) {
      setLiveError(err instanceof Error ? err.message : 'Permissão de câmera negada ou indisponível.');
      stopCamera();
      return false;
    }
  }, [stopCamera]);

  const connect = useCallback(
    async (withMic = true, withCamera = false) => {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN && status === 'connected') {
        if (withCamera && !camStreamRef.current) {
          await enableCamera();
        }
        return;
      }

      if (wsRef.current) {
        try {
          wsRef.current.close();
        } catch {
          // ignore
        }
        wsRef.current = null;
      }

      setLiveError(null);
      setStatus('connecting');
      ensureOutputAudio();

      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const sessionToken = getAegisSessionToken();
      const qs = sessionToken ? `?session=${encodeURIComponent(sessionToken)}` : '';
      const ws = new WebSocket(`${proto}//${window.location.host}/api/live${qs}`);
      wsRef.current = ws;

      ws.onopen = () => {
        ws.send(
          JSON.stringify({
            type: 'init',
            googleToken: optsRef.current.googleToken,
            userEmail: optsRef.current.userEmail,
            voiceName: 'Fenrir',
          })
        );
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(String(event.data));
          if (msg.type === 'status') {
            setStatus(msg.status);
            if (msg.status === 'connected') {
              if (withMic && !micStreamRef.current) {
                startMicCapture().catch((err: unknown) => {
                  setLiveError(err instanceof Error ? err.message : 'Permissão de microfone negada.');
                });
              }
              if (withCamera && !camStreamRef.current) {
                void enableCamera();
              }
            }
          } else if (msg.type === 'audio' && msg.data) {
            setToolBusy(false);
            enqueueOutputPcm24k(msg.data);
          } else if (msg.type === 'interrupted') {
            stopPlayback();
          } else if (msg.type === 'input_transcript' && msg.accumulated) {
            setLiveCaption({ role: 'user', text: msg.accumulated });
          } else if (msg.type === 'output_transcript' && msg.accumulated) {
            setLiveCaption({ role: 'assistant', text: msg.accumulated });
          } else if (msg.type === 'turn_complete') {
            setToolBusy(false);
            if (msg.userTranscript) optsRef.current.onUserTranscript(msg.userTranscript);
            if (msg.assistantTranscript) optsRef.current.onAssistantTranscript(msg.assistantTranscript);
          } else if (msg.type === 'tool_start') {
            setToolBusy(true);
          } else if (msg.type === 'screen' && msg.screen) {
            optsRef.current.onDrawnScreen(msg.screen as HolographicScreenSpec);
          } else if (msg.type === 'camera_control') {
            if (msg.action === 'enable') {
              void enableCamera();
            } else {
              stopCamera();
            }
          } else if (msg.type === 'confirmation_required' && msg.confirmation) {
            optsRef.current.onConfirmationRequired(msg.confirmation as PendingConfirmation);
          } else if (msg.type === 'error') {
            setLiveError(msg.message || 'Erro na conexão Live API.');
            setToolBusy(false);
          }
        } catch {
          // ignore parse errors
        }
      };

      ws.onerror = () => {
        setLiveError('Falha de conexão WebSocket com a Gemini Live API.');
        setStatus('error');
      };

      ws.onclose = () => {
        stopMic();
        stopCamera();
        stopPlayback();
        wsRef.current = null;
        setStatus('disconnected');
        setToolBusy(false);
      };
    },
    [enableCamera, enqueueOutputPcm24k, ensureOutputAudio, startMicCapture, status, stopCamera, stopMic, stopPlayback]
  );

  // Sync updated Google OAuth token into an active Live session
  useEffect(() => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'update_google_token', googleToken: opts.googleToken }));
    }
  }, [opts.googleToken]);

  // Output audio RMS meter driving the 3D sphere while Aegis speaks
  useEffect(() => {
    const data = new Uint8Array(128);
    const loop = () => {
      if (analyserRef.current && scheduledSourcesRef.current.size > 0) {
        analyserRef.current.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) {
          const norm = (data[i] - 128) / 128;
          sum += norm * norm;
        }
        const rms = Math.sqrt(sum / data.length);
        audioLevelRef.current = Math.min(1, rms * 3.8);
      } else if (!micStreamRef.current) {
        audioLevelRef.current *= 0.88;
      }
      meterRafRef.current = requestAnimationFrame(loop);
    };
    meterRafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(meterRafRef.current);
  }, []);

  useEffect(() => {
    return () => {
      disconnect();
      if (outputCtxRef.current) {
        void outputCtxRef.current.close();
        outputCtxRef.current = null;
      }
    };
  }, [disconnect]);

  const sendLiveText = useCallback((text: string): boolean => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify({ type: 'text', text }));
    return true;
  }, []);

  const toggleVoice = useCallback(async () => {
    if (status === 'connected' || status === 'connecting') {
      disconnect();
    } else {
      await connect(true, false);
    }
  }, [connect, disconnect, status]);

  const toggleCamera = useCallback(async () => {
    if (cameraActive) {
      stopCamera();
      return;
    }
    if (status === 'connected') {
      await enableCamera();
    } else {
      await connect(true, true);
    }
  }, [cameraActive, connect, enableCamera, status, stopCamera]);

  const derivedCoreState: AegisCoreState = cameraActive
    ? 'seeing'
    : speaking
    ? 'speaking'
    : toolBusy
    ? 'thinking'
    : status === 'connected' && micActive
    ? 'listening'
    : 'idle';

  const clearError = useCallback(() => {
    setLiveError(null);
  }, []);

  return {
    status,
    micActive,
    cameraActive,
    cameraStream,
    speaking,
    toolBusy,
    liveCaption,
    liveError,
    audioLevelRef,
    derivedCoreState,
    connect,
    disconnect,
    toggleVoice,
    toggleCamera,
    enableCamera,
    stopCamera,
    sendLiveText,
    clearError,
  };
}
