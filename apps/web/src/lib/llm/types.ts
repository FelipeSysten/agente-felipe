export type ProviderId = "google" | "groq" | "anthropic";

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface ChatArgs {
  system: string;
  messages: ChatTurn[];
  model: string;
  temperature: number;
  maxTokens: number;
}

export interface ChatResult {
  text: string;
  tokensIn: number;
  tokensOut: number;
}

export interface LLMProvider {
  id: ProviderId;
  /** Provedor configurado (tem API key)? */
  available(): boolean;
  defaultModel(): string;
  chat(args: ChatArgs): Promise<ChatResult>;
}
