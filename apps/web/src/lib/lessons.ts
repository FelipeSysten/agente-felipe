import "server-only";
import { prisma } from "@/lib/db";
import { logEvent } from "@/lib/log";

const MAX_IN_PROMPT = 15;
const ALL_IF_AT_MOST = 30;
const MERGE_WINDOW_MS = 3 * 60_000; // msgs seguidas do atendente viram 1 resposta
const QUESTION_MAX_AGE_MS = 2 * 3_600_000; // só pergunta recente do cliente

const clip = (s: string, n = 400) => (s.length > n ? `${s.slice(0, n)}…` : s);

/**
 * Última pergunta do cliente antes de `before` (ou do fim da conversa): pula as
 * respostas que vieram depois dela — a rajada atual do atendente e o que a IA ou
 * o sistema já tinham respondido (caso comum: a IA responde genérico e o
 * atendente complementa) — e junta as msgs seguidas do cliente.
 */
async function customerQuestion(conversationId: string, before?: Date): Promise<string | null> {
  const recent = await prisma.message.findMany({
    where: { conversationId, ...(before && { createdAt: { lt: before } }) },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  const lines: string[] = [];
  for (const m of recent) {
    if (m.role !== "user") {
      if (lines.length) break; // já pegou o bloco de perguntas
      continue; // ainda nas respostas posteriores à pergunta
    }
    if (Date.now() - m.createdAt.getTime() > QUESTION_MAX_AGE_MS) break;
    lines.unshift(m.text);
  }
  const q = lines.join("\n").trim();
  return q ? clip(q) : null;
}

/**
 * Atendente respondeu um cliente (celular ou painel): sugere uma lição pendente.
 * Precisa de aprovação no painel — o número também recebe conversas pessoais.
 */
export async function captureFromOperator(conversationId: string, answer: string) {
  const text = answer.trim();
  if (text.length < 3 || /^\[.*\]$/.test(text)) return; // mídia/placeholder não ensina nada

  const recentPending = await prisma.lesson.findFirst({
    where: {
      conversationId,
      source: "operator",
      status: "pending",
      updatedAt: { gte: new Date(Date.now() - MERGE_WINDOW_MS) },
    },
    orderBy: { updatedAt: "desc" },
  });
  if (recentPending) {
    await prisma.lesson.update({
      where: { id: recentPending.id },
      data: { answer: clip(`${recentPending.answer}\n${text}`, 800) },
    });
    return;
  }

  const question = await customerQuestion(conversationId);
  if (!question) return; // atendente puxou assunto: não há pergunta para aprender
  const lesson = await prisma.lesson.create({
    data: { question, answer: clip(text, 800), source: "operator", conversationId },
  });
  logEvent("lesson.suggested", { lessonId: lesson.id, conversationId });
}

/** Alguém corrigiu uma resposta da IA no painel: vira lição já aprovada. */
export async function createFromCorrection(messageId: string, correctAnswer: string, email: string) {
  const msg = await prisma.message.findUnique({ where: { id: messageId } });
  if (!msg || msg.role !== "assistant") throw new Error("Só respostas da IA podem ser corrigidas");
  const question = await customerQuestion(msg.conversationId, msg.createdAt);
  if (!question) throw new Error("Não achei a pergunta do cliente antes desta resposta");
  const lesson = await prisma.lesson.create({
    data: {
      question,
      answer: clip(correctAnswer.trim(), 800),
      source: "correction",
      status: "approved",
      conversationId: msg.conversationId,
      approvedBy: email,
    },
  });
  logEvent("lesson.correction", { lessonId: lesson.id, conversationId: msg.conversationId });
  return lesson;
}

const STOP = new Set(["para", "pra", "com", "uma", "que", "voces", "vocês", "tem", "quero", "queria", "voce", "você", "como", "qual", "quais", "esta", "está", "isso", "aqui", "boa", "noite", "tarde", "olá", "obrigado"]);
const words = (s: string) =>
  new Set(
    s
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 3 && !STOP.has(w)),
  );

/**
 * Bloco de conhecimento p/ o prompt: lições aprovadas mais parecidas com o que o
 * cliente escreveu agora (todas, se forem poucas).
 */
export async function lessonsForPrompt(customerText: string): Promise<string> {
  const approved = await prisma.lesson.findMany({
    where: { status: "approved" },
    orderBy: { updatedAt: "desc" },
    take: 300,
  });
  if (!approved.length) return "";

  let picked = approved;
  if (approved.length > ALL_IF_AT_MOST) {
    const q = words(customerText);
    picked = approved
      .map((l) => {
        const lw = words(l.question);
        let hits = 0;
        for (const w of lw) if (q.has(w)) hits++;
        return { l, score: hits / Math.sqrt(lw.size || 1) };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_IN_PROMPT)
      .map((x) => x.l);
    if (!picked.length) return "";
  }

  const items = picked.map((l) => `P: ${clip(l.question, 300)}\nR: ${clip(l.answer, 500)}`).join("\n\n");
  return `\n\n[Conhecimento validado pela equipe — são respostas reais do Felipe. Quando o cliente perguntar algo parecido, responda com estas informações, adaptando ao contexto e ao seu jeito de falar. Se não se aplicar, ignore.]\n${items}`;
}
