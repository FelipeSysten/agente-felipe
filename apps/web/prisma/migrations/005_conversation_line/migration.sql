-- Conversas pertencem ao número do bot (linha). Trocar o número esconde as antigas.
ALTER TABLE "Conversation" ADD COLUMN "line" TEXT NOT NULL DEFAULT '';
ALTER TABLE "AppSettings" ADD COLUMN "wahaLine" TEXT;

-- Tudo que existe hoje aconteceu no número antigo do QR code: (73) 8843-3532
UPDATE "Conversation" SET "line" = '557388433532' WHERE "channel" = 'waha';

DROP INDEX "Conversation_contactId_channel_key";
CREATE UNIQUE INDEX "Conversation_contactId_channel_line_key" ON "Conversation"("contactId", "channel", "line");
CREATE INDEX "Conversation_channel_line_lastMessageAt_idx" ON "Conversation"("channel", "line", "lastMessageAt");
