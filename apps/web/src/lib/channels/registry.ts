import "server-only";
import type { ChannelAdapter, ChannelId } from "./types";
import { whatsappCloudAdapter } from "./whatsapp-cloud";
import { wahaAdapter } from "./waha";

const adapters: Record<ChannelId, ChannelAdapter> = {
  whatsapp_cloud: whatsappCloudAdapter,
  waha: wahaAdapter,
};

export function getAdapter(id: string): ChannelAdapter {
  const adapter = adapters[id as ChannelId];
  if (!adapter) throw new Error(`canal desconhecido: ${id}`);
  return adapter;
}

export function allAdapters(): ChannelAdapter[] {
  return Object.values(adapters);
}

/** Canais com credenciais configuradas (env vars). */
export function getEnabledAdapters(): ChannelAdapter[] {
  return allAdapters().filter((a) => a.configured());
}
