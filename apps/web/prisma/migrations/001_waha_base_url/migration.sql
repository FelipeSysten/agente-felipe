-- URL pública do gateway WhatsApp (registrada pelo próprio gateway)
ALTER TABLE "AppSettings" ADD COLUMN "wahaBaseUrl" TEXT;
ALTER TABLE "AppSettings" ADD COLUMN "wahaBaseUrlAt" TIMESTAMP(3);
