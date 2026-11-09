"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { hashPassword, MIN_PASSWORD, temporaryPassword, verifyPassword } from "@/lib/auth/password";
import { getAdapter } from "@/lib/channels/registry";
import { resolveExternalId, sendAndPersist } from "@/lib/flush";
import { generateReply } from "@/lib/llm";
import { getRedis } from "@/lib/redis";
import { getSettings } from "@/lib/settings";
import { within24h } from "@/lib/time";
import { ROUTE_DEFAULTS, type RouteKey } from "@/lib/handoff-routes";
import { captureFromOperator, createFromCorrection } from "@/lib/lessons";
import { logError, logEvent } from "@/lib/log";

export type ActionState = { ok: boolean; message: string } | null;

export async function logout() {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}

// ─── Conversas ──────────────────────────────────────────────────────
export async function setAi(conversationId: string, enabled: boolean) {
  await requireUser();
  await prisma.conversation.update({
    where: { id: conversationId },
    // reativar a IA também resolve o handoff pendente (§0.9.17)
    data: enabled ? { aiEnabled: true, handoffRequested: false, handoffRoute: null } : { aiEnabled: false },
  });
  logEvent("conversation.ai_toggled", { conversationId, enabled });
  revalidatePath(`/conversations/${conversationId}`);
  revalidatePath("/conversations");
}

export async function replyAsOperator(
  conversationId: string,
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  await requireUser();
  const text = String(form.get("text") ?? "").trim();
  if (!text) return { ok: false, message: "Mensagem vazia" };

  const conv = await prisma.conversation.findUnique({ where: { id: conversationId } });
  // O operador só tem o conv.id: o destinatário vem do ContactIdentity (§0.9.27)
  const externalId = await resolveExternalId(conversationId);
  if (!conv || !externalId) return { ok: false, message: "Contato não encontrado" };

  if (getAdapter(conv.channel).hasServiceWindow && !within24h(conv.lastInboundAt)) {
    return { ok: false, message: "Fora da janela de 24h da Meta: só o cliente pode reabrir a conversa." };
  }
  try {
    await sendAndPersist(conversationId, conv.channel, externalId, text, { role: "operator" });
  } catch (err) {
    logError("operator.reply_failed", err, { conversationId });
    return { ok: false, message: `Falha ao enviar: ${String(err)}` };
  }
  // Mesma regra de quando o atendente responde pelo celular: IA calada por N segundos
  const { humanPauseSeconds } = await getSettings();
  await prisma.conversation.update({
    where: { id: conversationId },
    data: { aiPausedUntil: new Date(Date.now() + humanPauseSeconds * 1000) },
  });
  await captureFromOperator(conversationId, text).catch((err) =>
    logError("lesson.capture_failed", err, { conversationId }),
  );
  revalidatePath(`/conversations/${conversationId}`);
  return { ok: true, message: `Enviado — IA em pausa por ${humanPauseSeconds}s nesta conversa` };
}

// ─── Agentes ────────────────────────────────────────────────────────
const agentSchema = z.object({
  name: z.string().trim().min(2),
  systemPrompt: z.string().trim().min(10),
  provider: z.enum(["google", "groq", "anthropic"]),
  model: z.string().trim().min(2),
  temperature: z.coerce.number().min(0).max(2),
  maxTokens: z.coerce.number().int().min(64).max(4096),
  memoryMode: z.enum(["window_10", "window_20", "window_40", "stateless"]),
  isDefault: z.coerce.boolean(),
});

export async function saveAgent(id: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  await requireUser();
  const parsed = agentSchema.safeParse({
    ...Object.fromEntries(form),
    isDefault: form.get("isDefault") === "on",
  });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Dados inválidos" };

  await prisma.$transaction(async (tx) => {
    if (parsed.data.isDefault) {
      await tx.agentSession.updateMany({ where: { id: { not: id } }, data: { isDefault: false } });
    }
    await tx.agentSession.update({ where: { id }, data: parsed.data });
  });
  revalidatePath("/agents");
  revalidatePath(`/agents/${id}`);
  return { ok: true, message: "Agente salvo — vale a partir da próxima mensagem." };
}

export async function testAgent(id: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  await requireUser();
  const question = String(form.get("question") ?? "").trim();
  const agent = await prisma.agentSession.findUnique({ where: { id } });
  if (!agent || !question) return { ok: false, message: "Escreva uma mensagem de teste" };
  const s = await getSettings();
  const system = agent.systemPrompt
    .replaceAll("{{LINK}}", s.deliveryUrl || "(link ainda não configurado)")
    .replaceAll("{{DELIVERY_URL}}", s.deliveryUrl || "(link ainda não configurado)")
    .replaceAll("{{BUSINESS_NAME}}", s.businessName);
  try {
    const r = await generateReply(agent, system, [{ role: "user", content: question }], { sandbox: true });
    return { ok: true, message: `[${r.provider}/${r.model}] ${r.text}` };
  } catch (err) {
    return { ok: false, message: `Todos os provedores falharam: ${String(err)}` };
  }
}

// ─── Configurações ──────────────────────────────────────────────────
const settingsSchema = z.object({
  businessName: z.string().trim().min(1),
  deliveryUrl: z.union([z.literal(""), z.url()]),
  handoffPhone: z.string().trim().regex(/^\d{0,15}$/, "Telefone: só dígitos com DDI, ex 5551999999999"),
  handoffReply: z.string().trim().min(5),
  debounceWindowMs: z.coerce.number().int().min(3000).max(15000),
  humanPauseSeconds: z.coerce.number().int().min(0, "Pausa: mínimo 0s").max(86_400, "Pausa: máximo 24h (86400s)"),
  handoffKeywords: z.string(),
  orcamentoEnabled: z.literal("on").optional(),
  orcamentoKeywords: z.string().default(""),
  orcamentoPhone: z.string().trim().regex(/^\d{0,15}$/, "Telefone do orçamento: só dígitos com DDI, ex 5511999999999"),
  orcamentoReply: z.string().trim().default(""),
});

const splitKeywords = (s: string) => s.split(",").map((k) => k.trim()).filter(Boolean);

/** Cria/atualiza a regra de uma rota sem tocar nas outras (identifica pelo params.route). */
async function upsertRouteRule(agentSessionId: string, route: RouteKey, priority: number, params: Record<string, unknown>, enabled = true) {
  const rules = await prisma.aIRule.findMany({ where: { agentSessionId, mode: "keyword_pause", action: "handoff" } });
  // Regra antiga de atendimento não tinha `route`
  const rule = rules.find((r) => ((r.params as { route?: string } | null)?.route ?? "atendimento") === route);
  const data = { params: { route, ...params }, enabled };
  if (rule) await prisma.aIRule.update({ where: { id: rule.id }, data });
  else await prisma.aIRule.create({ data: { agentSessionId, priority, mode: "keyword_pause", action: "handoff", ...data } });
}

export async function saveSettings(_prev: ActionState, form: FormData): Promise<ActionState> {
  await requireUser();
  const parsed = settingsSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  const { handoffKeywords, orcamentoEnabled, orcamentoKeywords, orcamentoPhone, orcamentoReply, ...data } = parsed.data;

  await prisma.appSettings.upsert({ where: { id: "singleton" }, create: { id: "singleton", ...data }, update: data });

  const agent = await prisma.agentSession.findFirst({ where: { isDefault: true } });
  if (agent) {
    await upsertRouteRule(agent.id, "atendimento", 10, { keywords: splitKeywords(handoffKeywords) });
    await upsertRouteRule(
      agent.id,
      "orcamento",
      20,
      {
        keywords: splitKeywords(orcamentoKeywords),
        phone: orcamentoPhone,
        reply: orcamentoReply || ROUTE_DEFAULTS.orcamento.reply,
      },
      Boolean(orcamentoEnabled),
    );
  }
  revalidatePath("/settings");
  return { ok: true, message: "Configurações salvas" };
}

// ─── Canal / onboarding ─────────────────────────────────────────────
/** Idempotente: pode ser clicado N vezes. O estado exibido vem do re-GET, nunca do POST. */
export async function ensureChannel(channel: string): Promise<ActionState> {
  await requireUser();
  try {
    const s = await getAdapter(channel).ensureSession();
    revalidatePath("/onboarding");
    return {
      ok: s.state === "WORKING" || s.state === "SCAN_QR" || s.state === "STARTING",
      message: s.state === "SCAN_QR" ? "Escaneie o QR code" : `${s.state}${s.detail ? ` — ${s.detail}` : ""}`,
    };
  } catch (err) {
    logError("channel.ensure_failed", err, { channel });
    return { ok: false, message: `Erro: ${String(err)}` };
  }
}

export async function logoutChannel(channel: string): Promise<ActionState> {
  await requireUser();
  try {
    await getAdapter(channel).logout?.();
    logEvent("channel.logout", { channel });
    revalidatePath("/onboarding");
    return { ok: true, message: "Número desconectado" };
  } catch (err) {
    return { ok: false, message: `Erro: ${String(err)}` };
  }
}

export async function sendTestMessage(_prev: ActionState, form: FormData): Promise<ActionState> {
  await requireUser();
  const to = String(form.get("to") ?? "").replace(/\D/g, "");
  const channel = String(form.get("channel") ?? "whatsapp_cloud");
  if (!to) return { ok: false, message: "Informe o número com DDI" };
  try {
    await getAdapter(channel).sendText(to, "Olá! Agente online ✅");
    return { ok: true, message: "Mensagem enviada" };
  } catch (err) {
    return {
      ok: false,
      message: `Falhou: ${String(err)}${channel === "whatsapp_cloud" ? '. Se for erro 131047, mande um "oi" desse número para o número do bot primeiro (janela de 24h).' : ""}`,
    };
  }
}

// ─── DLQ ────────────────────────────────────────────────────────────
export async function clearDlq() {
  await requireUser();
  await getRedis().del("dlq:llm_flush");
  revalidatePath("/dashboard");
}

// ─── Aprendizado ────────────────────────────────────────────────────
const lessonSchema = z.object({
  question: z.string().trim().min(3, "Escreva a pergunta do cliente").max(600),
  answer: z.string().trim().min(3, "Escreva a resposta certa").max(1200),
});

/** Aprova (salvando a edição de pergunta/resposta) — passa a valer na próxima msg. */
export async function approveLesson(id: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const email = await requireUser();
  const parsed = lessonSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  await prisma.lesson.update({ where: { id }, data: { ...parsed.data, status: "approved", approvedBy: email } });
  logEvent("lesson.approved", { lessonId: id });
  revalidatePath("/learning");
  return { ok: true, message: "Aprovada — a IA já usa isso" };
}

export async function rejectLesson(id: string) {
  await requireUser();
  await prisma.lesson.update({ where: { id }, data: { status: "rejected" } });
  revalidatePath("/learning");
}

export async function deleteLesson(id: string) {
  await requireUser();
  await prisma.lesson.delete({ where: { id } });
  revalidatePath("/learning");
}

export async function createLesson(_prev: ActionState, form: FormData): Promise<ActionState> {
  const email = await requireUser();
  const parsed = lessonSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  await prisma.lesson.create({ data: { ...parsed.data, source: "manual", status: "approved", approvedBy: email } });
  revalidatePath("/learning");
  return { ok: true, message: "Ensinado — a IA já usa isso" };
}

/** "Corrigir" numa resposta da IA: vira lição aprovada na hora. */
export async function correctMessage(messageId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const email = await requireUser();
  const answer = String(form.get("answer") ?? "").trim();
  if (answer.length < 3) return { ok: false, message: "Escreva a resposta certa" };
  try {
    const lesson = await createFromCorrection(messageId, answer, email);
    revalidatePath("/learning");
    revalidatePath(`/conversations/${lesson.conversationId}`);
    return { ok: true, message: "Aprendido — da próxima vez a IA responde assim" };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

// ─── Acesso ao painel (login e senha) ───────────────────────────────
const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9._-]{3,32}$/, "Login: 3 a 32 letras minúsculas, números, ponto, hífen ou _");
const passwordSchema = z.string().min(MIN_PASSWORD, `A senha precisa de pelo menos ${MIN_PASSWORD} caracteres`);

async function loginTaken(username: string, exceptId?: string) {
  return (await prisma.adminUser.count({ where: { username, NOT: exceptId ? { id: exceptId } : undefined } })) > 0;
}

const adminSchema = z.object({
  name: z.string().trim().min(2, "Informe o nome"),
  username: usernameSchema,
  email: z.email("E-mail inválido").trim().toLowerCase(),
  password: z.union([z.literal(""), passwordSchema]),
});

/** Novo administrador. Sem senha informada, gera uma provisória e mostra uma vez. */
export async function addAdmin(_prev: ActionState, form: FormData): Promise<ActionState> {
  const by = await requireUser();
  const parsed = adminSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  const { name, username, email } = parsed.data;
  if (await loginTaken(username)) return { ok: false, message: "Esse login já existe" };
  if (await prisma.adminUser.count({ where: { email } })) return { ok: false, message: "Esse e-mail já é administrador" };
  const password = parsed.data.password || temporaryPassword();
  await prisma.adminUser.create({ data: { name, username, email, passwordHash: await hashPassword(password) } });
  logEvent("admin.created", { by });
  revalidatePath("/settings");
  return {
    ok: true,
    message: parsed.data.password
      ? `${name} já pode entrar com o login "${username}".`
      : `${name} já pode entrar com o login "${username}" e a senha provisória ${password}\nAnote agora: ela não aparece de novo.`,
  };
}

/** Troca a própria senha. Quem ainda não tem cadastro (só ADMIN_EMAILS) escolhe o login aqui. */
export async function changeOwnPassword(_prev: ActionState, form: FormData): Promise<ActionState> {
  const email = await requireUser();
  const me = await prisma.adminUser.findUnique({ where: { email } });
  const next = passwordSchema.safeParse(String(form.get("password") ?? ""));
  if (!next.success) return { ok: false, message: next.error.issues[0]?.message ?? "Senha inválida" };
  if (next.data !== String(form.get("confirm") ?? "")) return { ok: false, message: "As duas senhas não são iguais" };
  if (me?.passwordHash && !(await verifyPassword(String(form.get("current") ?? ""), me.passwordHash))) {
    return { ok: false, message: "A senha atual está errada" };
  }
  const username = usernameSchema.safeParse(String(form.get("username") ?? me?.username ?? ""));
  if (!username.success) return { ok: false, message: username.error.issues[0]?.message ?? "Login inválido" };
  if (await loginTaken(username.data, me?.id)) return { ok: false, message: "Esse login já existe" };

  const passwordHash = await hashPassword(next.data);
  if (me) {
    await prisma.adminUser.update({ where: { id: me.id }, data: { username: username.data, passwordHash } });
  } else {
    const name = String(form.get("name") ?? "").trim() || email.split("@")[0];
    await prisma.adminUser.create({ data: { name, username: username.data, email, passwordHash } });
  }
  logEvent("admin.password_changed");
  revalidatePath("/settings");
  return { ok: true, message: `Senha salva. Seu login é "${username.data}".` };
}

export async function removeAdmin(id: string) {
  const email = await requireUser();
  const target = await prisma.adminUser.findUnique({ where: { id } });
  if (!target || target.email === email) return; // ninguém se remove sozinho
  await prisma.adminUser.delete({ where: { id } });
  logEvent("admin.removed", { by: email });
  revalidatePath("/settings");
}
