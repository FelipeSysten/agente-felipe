-- Rota do encaminhamento pendente (atendimento | reservas)
ALTER TABLE "Conversation" ADD COLUMN "handoffRoute" TEXT;
