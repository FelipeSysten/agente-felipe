import "server-only";
import { GoogleGenAI } from "@google/genai";
import Groq, { toFile } from "groq-sdk";
import { logError, logEvent } from "@/lib/log";

export interface AudioInput {
  mimetype: string;
  data: string; // base64
}

const PROMPT =
  "Transcreva fielmente este áudio de um cliente no WhatsApp, em português do Brasil. " +
  "Responda SOMENTE com a transcrição, sem comentários. Se não houver fala compreensível, responda exatamente: [inaudível]";

async function viaGemini(audio: AudioInput): Promise<string> {
  const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY, httpOptions: { timeout: 20_000 } });
  const res = await ai.models.generateContent({
    model: process.env.TRANSCRIBE_MODEL ?? "gemini-2.5-flash",
    contents: [{ role: "user", parts: [{ inlineData: { mimeType: audio.mimetype, data: audio.data } }, { text: PROMPT }] }],
    config: { temperature: 0, thinkingConfig: { thinkingBudget: 0 } },
  });
  return res.text?.trim() ?? "";
}

async function viaGroqWhisper(audio: AudioInput): Promise<string> {
  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY, maxRetries: 1, timeout: 20_000 });
  const ext = audio.mimetype.includes("mpeg") ? "mp3" : audio.mimetype.includes("mp4") ? "m4a" : "ogg";
  const res = await groq.audio.transcriptions.create({
    file: await toFile(Buffer.from(audio.data, "base64"), `audio.${ext}`, { type: audio.mimetype }),
    model: "whisper-large-v3-turbo",
    language: "pt",
  });
  return res.text?.trim() ?? "";
}

/** "[inaudível]", "(silêncio)", "[sem fala]", "Ruído."… — resposta curta sem conteúdo. */
export function isNoSpeech(text: string): boolean {
  const t = text.trim();
  if (t.length > 40) return false;
  return /inaud|sil[eê]ncio|sem (fala|[aá]udio)|ru[ií]do|m[uú]sica/i.test(t) || /^[[(].*[\])]\.?$/.test(t);
}

/**
 * Transcreve nota de voz: Gemini (grátis, ~3s) → Whisper do Groq (grátis, ~0,7s).
 * Gemini vem primeiro por ser confiável: em silêncio/ruído o Whisper "alucina"
 * frases (ex: "E aí") com no_speech_prob 0, e o Gemini responde [inaudível].
 * Retorna null se nenhum conseguir ou se o áudio for inaudível.
 */
export async function transcribeAudio(audio: AudioInput, ctx: Record<string, unknown> = {}): Promise<string | null> {
  const providers: [string, (a: AudioInput) => Promise<string>, boolean][] = [
    ["gemini", viaGemini, Boolean(process.env.GOOGLE_API_KEY)],
    ["groq-whisper", viaGroqWhisper, Boolean(process.env.GROQ_API_KEY)],
  ];
  for (const [name, fn, available] of providers) {
    if (!available) continue;
    const started = Date.now();
    try {
      const text = await fn(audio);
      logEvent("audio.transcribed", { ...ctx, provider: name, chars: text.length, latencyMs: Date.now() - started });
      if (!text || isNoSpeech(text)) return null;
      // Whisper "alucina" frases típicas de legenda em silêncio
      if (/^(legendas? (pela|por)|obrigad[oa] por assistir|inscreva-se)/i.test(text)) return null;
      return text;
    } catch (err) {
      logError("audio.transcribe_failed", err, { ...ctx, provider: name, latencyMs: Date.now() - started });
    }
  }
  return null;
}
