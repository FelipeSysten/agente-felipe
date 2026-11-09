// Idempotente: pode rodar N vezes. Uso: DATABASE_URL=... npx tsx prisma/seed.ts
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const SYSTEM_PROMPT = `Você é o atendente virtual do {{BUSINESS_NAME}} no WhatsApp. Seu objetivo é ajudar o cliente e levá-lo a fazer o pedido pelo nosso link de delivery.

Link do delivery (cardápio, preços e pedido): {{DELIVERY_URL}}

Como agir:
- Responda em português do Brasil, com simpatia e de forma curta (1 a 3 frases). Isto é WhatsApp, não e-mail.
- Quando o cliente quiser pedir, ver cardápio, preços, promoções ou formas de pagamento, envie o link do delivery e explique que lá ele monta o pedido e paga.
- Se ele já mandou o que quer, confirme de forma breve e envie o link para finalizar.
- Você NÃO anota pedidos, NÃO confirma pagamentos e NÃO promete prazos de entrega ou preços. Essas informações estão no link.
- Não invente produtos, preços, horários ou endereços. Se não souber, diga que pelo link ele vê tudo, ou ofereça chamar um atendente.
- Se o cliente quiser falar com uma pessoa, reclamar de um pedido ou resolver um problema de entrega, diga que ele pode escrever "atendente".
- Mande o link no máximo uma vez por resposta e sem formatação markdown (WhatsApp não renderiza [texto](link)).`;

const HANDOFF_KEYWORDS = ["atendente", "humano", "falar com alguem", "falar com uma pessoa", "reclamacao", "gerente"];

async function main() {
  await prisma.appSettings.upsert({
    where: { id: "singleton" },
    create: {
      id: "singleton",
      deliveryUrl: process.env.DELIVERY_URL ?? "",
      handoffPhone: (process.env.HANDOFF_PHONE ?? "").replace(/\D/g, ""),
    },
    update: {},
  });

  const agent = await prisma.agentSession.upsert({
    where: { name: "Vendas Delivery" },
    create: {
      name: "Vendas Delivery",
      systemPrompt: SYSTEM_PROMPT,
      provider: "groq",
      model: process.env.GROQ_MODEL ?? "openai/gpt-oss-120b",
      temperature: 0.6,
      maxTokens: 600,
      memoryMode: "window_20",
      isDefault: true,
    },
    update: {},
  });

  const existing = await prisma.aIRule.findFirst({
    where: { agentSessionId: agent.id, mode: "keyword_pause", action: "handoff" },
  });
  if (!existing) {
    await prisma.aIRule.create({
      data: {
        agentSessionId: agent.id,
        priority: 10,
        mode: "keyword_pause",
        action: "handoff",
        params: { keywords: HANDOFF_KEYWORDS },
      },
    });
  }
  const reservas = (await prisma.aIRule.findMany({ where: { agentSessionId: agent.id, mode: "keyword_pause", action: "handoff" } }))
    .find((r) => (r.params as { route?: string } | null)?.route === "reservas");
  if (!reservas) {
    await prisma.aIRule.create({
      data: {
        agentSessionId: agent.id,
        priority: 20,
        mode: "keyword_pause",
        action: "handoff",
        params: {
          route: "reservas",
          keywords: ["reserva", "reservar", "agendar mesa", "agendamento de mesa", "reservar mesa", "guardar uma mesa"],
          phone: (process.env.RESERVAS_PHONE ?? "5573999091977").replace(/\D/g, ""),
        },
      },
    });
  }
  console.log(JSON.stringify({ event: "seed.done", agentId: agent.id }));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
