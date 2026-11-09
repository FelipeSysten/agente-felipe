export type ChannelId = "whatsapp_cloud" | "waha";

export interface ChannelMessage {
  channel: ChannelId;
  /**
   * ID EXTERNO do canal: wa_id da Meta ("5551999999999") ou chatId do Waha
   * ("5551999999999@c.us" / "201932484403261@lid", guardado como veio).
   * Não confundir com Contact.id / Conversation.contactId (cuid interno) — §0.9.27.
   */
  externalId: string;
  contactName?: string;
  text: string;
  providerMsgId: string;
  receivedAt: string; // ISO
  /** Número do bot (canônico) que recebeu/enviou a msg — separa as conversas por número. */
  line?: string;
  /** Enviada por uma pessoa da equipe direto pelo celular/WhatsApp Web do número do bot. */
  fromOperator?: boolean;
  /** Nota de voz: base64 já incluso (gateway) ou id p/ baixar (Cloud API). Nunca vai p/ o Redis. */
  audio?: { mimetype: string; data?: string; mediaId?: string; seconds?: number };
}

export type SessionState =
  | "WORKING"
  | "SCAN_QR"
  | "STARTING"
  | "STOPPED"
  | "NOT_CREATED"
  | "NOT_CONFIGURED"
  | "FAILED";

export interface SessionStatus {
  state: SessionState;
  detail?: string;
  phone?: string;
  verifiedName?: string;
  subscribed?: boolean;
}

export interface ChannelAdapter {
  id: ChannelId;
  label: string;
  /** Tem as env vars mínimas p/ funcionar? */
  configured(): boolean;
  /** Idempotente: GET → (POST/PUT se faltar) → start condicional → re-GET. */
  ensureSession(): Promise<SessionStatus>;
  /** Fonte da verdade: sempre GET no provedor. */
  getSessionStatus(): Promise<SessionStatus>;
  /** Recebe o raw body JÁ validado. Retorna só mensagens de texto de clientes. */
  parseWebhook(rawBody: string): ChannelMessage[];
  /** Aceita o externalId do canal ou um telefone só com dígitos (ex: atendente). */
  sendText(to: string, text: string): Promise<{ providerMsgId?: string }>;
  markRead?(providerMsgId: string, externalId: string): Promise<void>;
  /** Baixa uma mídia pelo id do provedor (Cloud API). Retorna base64. */
  downloadMedia?(mediaId: string): Promise<{ mimetype: string; data: string }>;
  /** Janela de 24h para texto livre (só Cloud API). */
  hasServiceWindow: boolean;
  getQrCode?(): Promise<{ mimetype: string; data: string } | null>;
  logout?(): Promise<void>;
}
