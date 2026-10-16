export interface CookieObject {
  domain: string;
  expirationDate?: number;
  hostOnly?: boolean;
  httpOnly?: boolean;
  name: string;
  path: string;
  sameSite?: string;
  secure?: boolean;
  session?: boolean;
  storeId?: string;
  value: string;
}

export interface ModelConversationState {
  conversationId: string;
  responseId: string;
  choiceId: string;
}

export interface SavedSessionData {
  snlm0e: string;
  fsid: string;
  bl: string;
  saved_at: number;
  raw_cookies_hash: string;
  account_tier?: string;
}

export interface GeminiResponse {
  text: string;
  conversation_id: string;
  response_id: string;
  choice_id: string;
  images: string[];
  videos: string[];
  elapsed: number;
}

export interface ImageInput {
  data: Buffer;
  filename: string;
  mimeType: string;
}

export interface ModelConfig {
  id: string;
  display_name: string;
  description?: string;
  mode_id: string; // Internal hex hash (e.g. 56fdd199312815e2)
  header_template?: string; // JSPB template string
  thinking_level?: number;
  min_tier: 'free' | 'subscription' | string;
  aliases?: string[];
  capabilities?: string[];
  is_default: boolean;
  source: 'builtin' | 'discovered' | 'custom' | string;
}
