import "server-only";
import { prisma } from "@/lib/db";

const LIMIT_CONTACT = Number(process.env.COST_LIMIT_USD_PER_CONTACT_DAY ?? 0.5);
const LIMIT_TOTAL = Number(process.env.COST_LIMIT_USD_TOTAL_DAY ?? 2);

/** Data de hoje em America/Sao_Paulo, como Date UTC 00:00 (coluna @db.Date). */
export function todaySP(): Date {
  return new Date(new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }));
}

export async function checkCostBudget(contactId: string) {
  const date = todaySP();
  const [contact, total] = await Promise.all([
    prisma.usageDaily.aggregate({ where: { date, contactId }, _sum: { costUsd: true } }),
    prisma.usageDaily.aggregate({ where: { date }, _sum: { costUsd: true } }),
  ]);
  if ((contact._sum.costUsd?.toNumber() ?? 0) >= LIMIT_CONTACT) return "contact_over" as const;
  if ((total._sum.costUsd?.toNumber() ?? 0) >= LIMIT_TOTAL) return "total_over" as const;
  return "ok" as const;
}

export async function recordUsage(contactId: string, tokensIn: number, tokensOut: number, costUsd: number) {
  const date = todaySP();
  await prisma.usageDaily.upsert({
    where: { date_contactId: { date, contactId } },
    create: { date, contactId, tokensIn, tokensOut, costUsd },
    update: {
      tokensIn: { increment: tokensIn },
      tokensOut: { increment: tokensOut },
      costUsd: { increment: costUsd },
    },
  });
}
