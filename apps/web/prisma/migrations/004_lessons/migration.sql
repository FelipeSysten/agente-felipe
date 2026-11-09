-- Aprendizado: perguntas de clientes + respostas validadas pela equipe
CREATE TABLE "Lesson" (
    "id" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "conversationId" TEXT,
    "approvedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lesson_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Lesson_status_updatedAt_idx" ON "Lesson"("status", "updatedAt");
CREATE INDEX "Lesson_conversationId_createdAt_idx" ON "Lesson"("conversationId", "createdAt");
