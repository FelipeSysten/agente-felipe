import "server-only";
import { PrismaClient } from "@prisma/client";

declare global {
  var __prisma: PrismaClient | undefined;
}

// log: ["warn"] — P2002 é esperado no dedup concorrente e já é logado semanticamente (§0.9.24)
export const prisma = globalThis.__prisma ?? new PrismaClient({ log: ["warn"] });

if (process.env.NODE_ENV !== "production") globalThis.__prisma = prisma;
