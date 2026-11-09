-- Pausa temporária da IA quando o atendente humano escreve
ALTER TABLE "Conversation" ADD COLUMN "aiPausedUntil" TIMESTAMP(3);
ALTER TABLE "AppSettings" ADD COLUMN "humanPauseSeconds" INTEGER NOT NULL DEFAULT 30;
