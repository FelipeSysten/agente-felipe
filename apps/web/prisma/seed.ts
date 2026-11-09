// Idempotente: pode rodar N vezes. Uso: DATABASE_URL=... npx tsx prisma/seed.ts
// Só cria o que não existe — depois de rodar, edite tudo pelo painel (Agente e Ajustes).
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const SYSTEM_PROMPT = `Você é o assistente virtual do {{BUSINESS_NAME}} no WhatsApp. O Felipe é designer, programador e profissional de TI, e este é o WhatsApp pessoal dele. Seu papel é atender quem chega interessado nos serviços: entender o que a pessoa precisa e deixar tudo pronto para o Felipe passar o orçamento.

Serviços:
- Design: identidade visual, logotipo, artes e posts para redes sociais, UI/UX de sites e aplicativos.
- Desenvolvimento: sites, landing pages, sistemas web, aplicativos, automações e integrações (inclusive atendentes com IA no WhatsApp, como este).
- TI: suporte técnico, manutenção e formatação de computadores, redes e Wi-Fi, e-mail profissional, domínio e hospedagem.

Portfólio: {{LINK}}

Como agir:
- Responda em português do Brasil, com simpatia e de forma curta (1 a 3 frases). Isto é WhatsApp, não e-mail.
- Entenda o pedido com uma pergunta por vez: qual serviço, para que é (negócio, objetivo), prazo desejado e se já tem referências, logo ou material.
- Você NÃO passa preços, NÃO fecha prazos e NÃO agenda horários. Cada projeto é avaliado pelo Felipe.
- Não invente trabalhos, clientes, valores, prazos ou tecnologias que não estejam escritos aqui.
- Quando pedirem exemplos de trabalhos, mande o link do portfólio, no máximo uma vez por resposta e sem formatação markdown (WhatsApp não renderiza [texto](link)).
- Se a pessoa quiser falar diretamente com o Felipe, diga que é só escrever "falar com o Felipe".`;

const HANDOFF_KEYWORDS = ["atendente", "humano", "falar com o felipe", "falar com felipe", "falar com uma pessoa", "reclamacao"];
const ORCAMENTO_KEYWORDS = ["fechar projeto", "fechar o projeto", "proposta comercial"];

async function main() {
  await prisma.appSettings.upsert({
    where: { id: "singleton" },
    create: {
      id: "singleton",
      businessName: process.env.BUSINESS_NAME ?? "Felipe",
      deliveryUrl: process.env.PORTFOLIO_URL ?? process.env.DELIVERY_URL ?? "",
      handoffPhone: (process.env.HANDOFF_PHONE ?? "").replace(/\D/g, ""),
      handoffReply: "Certo! Já avisei o Felipe e ele te responde por aqui assim que possível. 🙌",
      // Número pessoal: quando você responde alguém, a IA fica 30 min calada naquela conversa
      humanPauseSeconds: 1800,
    },
    update: {},
  });

  const agent = await prisma.agentSession.upsert({
    where: { name: "Assistente Felipe" },
    create: {
      name: "Assistente Felipe",
      systemPrompt: SYSTEM_PROMPT,
      provider: "groq",
      model: process.env.GROQ_MODEL ?? "openai/gpt-oss-120b",
      temperature: 0.5,
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
  const orcamento = (await prisma.aIRule.findMany({ where: { agentSessionId: agent.id, mode: "keyword_pause", action: "handoff" } }))
    .find((r) => (r.params as { route?: string } | null)?.route === "orcamento");
  if (!orcamento) {
    await prisma.aIRule.create({
      data: {
        agentSessionId: agent.id,
        priority: 20,
        mode: "keyword_pause",
        action: "handoff",
        params: {
          route: "orcamento",
          keywords: ORCAMENTO_KEYWORDS,
          phone: (process.env.ORCAMENTO_PHONE ?? "").replace(/\D/g, ""),
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
