import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import os from 'os';
import {
  CookieObject,
  GeminiResponse,
  ImageInput,
  ModelConfig,
  ModelConversationState,
  SavedSessionData,
} from './types';
import { buildHeaderValue, ModelRegistry } from './registry';

function getSessionCachePath(cookiesKey: string): string {
  const dataDir = path.join(os.homedir(), '.seniorengineer');
  if (!fs.existsSync(dataDir)) {
    try {
      fs.mkdirSync(dataDir, { recursive: true });
    } catch (_) {}
  }
  const hash = crypto.createHash('md5').update(cookiesKey || 'guest').digest('hex').slice(0, 10);
  return path.join(dataDir, `gemini_web_session_${hash}.json`);
}

export function getPlatformDetails(): { ua: string; platform: string; secChUa: string } {
  const p = os.platform();
  if (p === 'win32') {
    return {
      ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36',
      platform: '"Windows"',
      secChUa: '"Not(A:Brand";v="99", "Google Chrome";v="152", "Chromium";v="152"',
    };
  } else if (p === 'linux') {
    return {
      ua: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36',
      platform: '"Linux"',
      secChUa: '"Not(A:Brand";v="99", "Google Chrome";v="152", "Chromium";v="152"',
    };
  } else {
    return {
      ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36',
      platform: '"macOS"',
      secChUa: '"Not(A:Brand";v="99", "Google Chrome";v="152", "Chromium";v="152"',
    };
  }
}

const platformDetails = getPlatformDetails();

export class GeminiWebClient {
  public cookiesKey: string;
  public rawCookies: string = '';
  public snlm0e: string = '';
  public fsid: string = '';
  public bl: string = '';
  public reqId: number;
  public conversationId: string = '';
  public responseId: string = '';
  public choiceId: string = '';
  public isInitialized: boolean = false;
  public accountTier: string = 'free';
  private convStates: Map<string, ModelConversationState> = new Map();

  constructor(cookiesKey: string = '') {
    this.cookiesKey = cookiesKey?.trim() || '';
    this.reqId = Math.floor(Math.random() * 9000000) + 1000000;
    this.parseCookies();
  }

  private parseCookies(): void {
    if (!this.cookiesKey || this.cookiesKey === 'no-key' || this.cookiesKey === 'guest') {
      this.rawCookies = '';
      this.accountTier = 'free';
      return;
    }

    // Try parsing as JSON array
    try {
      if (this.cookiesKey.startsWith('[') && this.cookiesKey.endsWith(']')) {
        const parsed = JSON.parse(this.cookiesKey);
        if (Array.isArray(parsed)) {
          const parts: string[] = [];
          for (const ck of parsed as CookieObject[]) {
            if (ck.name && ck.value) {
              parts.push(`${ck.name}=${ck.value}`);
            }
          }
          this.rawCookies = parts.join('; ');
          return;
        }
      }
    } catch (_) {}

    // Treat as raw cookie header string
    this.rawCookies = this.cookiesKey;
  }

  public getConvState(modelId: string): { convId: string; respId: string; choiceId: string } {
    const s = this.convStates.get(modelId);
    if (s) {
      return { convId: s.conversationId, respId: s.responseId, choiceId: s.choiceId };
    }
    return { convId: this.conversationId, respId: this.responseId, choiceId: this.choiceId };
  }

  public updateConvState(modelId: string, convId: string, respId: string, choiceId: string): void {
    this.convStates.set(modelId, { conversationId: convId, responseId: respId, choiceId });
    this.conversationId = convId;
    this.responseId = respId;
    this.choiceId = choiceId;
  }

  public resetState(): void {
    this.convStates.clear();
    this.conversationId = '';
    this.responseId = '';
    this.choiceId = '';
  }

  private hashCookies(): string {
    return crypto.createHash('sha256').update(this.rawCookies || 'guest').digest('hex');
  }

  private loadCachedSession(): boolean {
    const cachePath = getSessionCachePath(this.cookiesKey);
    if (!fs.existsSync(cachePath)) return false;

    try {
      const content = fs.readFileSync(cachePath, 'utf8');
      const cached = JSON.parse(content) as SavedSessionData;
      const twelveHoursAgo = Date.now() - 12 * 60 * 60 * 1000;

      if (
        cached.snlm0e &&
        cached.raw_cookies_hash === this.hashCookies() &&
        cached.saved_at * 1000 > twelveHoursAgo
      ) {
        this.snlm0e = cached.snlm0e;
        this.fsid = cached.fsid || '';
        this.bl = cached.bl || '';
        this.accountTier = cached.account_tier || 'free';
        this.isInitialized = true;
        return true;
      }
    } catch (_) {}

    return false;
  }

  private persistSession(): void {
    if (!this.snlm0e) return;
    const cachePath = getSessionCachePath(this.cookiesKey);
    const saved: SavedSessionData = {
      snlm0e: this.snlm0e,
      fsid: this.fsid,
      bl: this.bl,
      saved_at: Math.floor(Date.now() / 1000),
      raw_cookies_hash: this.hashCookies(),
      account_tier: this.accountTier,
    };
    try {
      fs.writeFileSync(cachePath, JSON.stringify(saved, null, 2), 'utf8');
    } catch (_) {}
  }

  public async request(urlStr: string, options: RequestInit = {}): Promise<Response> {
    const headers = new Headers(options.headers || {});
    if (!headers.has('User-Agent')) headers.set('User-Agent', platformDetails.ua);
    if (!headers.has('sec-ch-ua')) headers.set('sec-ch-ua', platformDetails.secChUa);
    if (!headers.has('sec-ch-ua-mobile')) headers.set('sec-ch-ua-mobile', '?0');
    if (!headers.has('sec-ch-ua-platform')) headers.set('sec-ch-ua-platform', platformDetails.platform);

    if (this.rawCookies && !headers.has('Cookie')) {
      headers.set('Cookie', this.rawCookies);
    }

    return fetch(urlStr, {
      ...options,
      headers,
    });
  }

  public async initSession(signal?: AbortSignal): Promise<void> {
    if (!this.rawCookies || this.cookiesKey === 'guest' || this.cookiesKey === 'no-key') {
      this.accountTier = 'free';
      this.isInitialized = true;
      return;
    }

    if (this.loadCachedSession()) {
      return;
    }

    const urlStr = 'https://gemini.google.com/app';
    const resp = await this.request(urlStr, {
      method: 'GET',
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        Referer: 'https://gemini.google.com/',
      },
      redirect: 'manual',
      signal,
    });

    if (resp.status !== 200) {
      // In guest mode, if status isn't 200, we can still operate without snlm0e tokens
      this.isInitialized = true;
      return;
    }

    const bodyStr = await resp.text();
    const snMatch = /"SNlM0e":"(.*?)"/.exec(bodyStr);
    if (snMatch && snMatch[1]) {
      this.snlm0e = snMatch[1];
      const fsMatch = /"FdrFJe":"(.*?)"/.exec(bodyStr);
      if (fsMatch && fsMatch[1]) this.fsid = fsMatch[1];

      const cfMatch = /"cfb2h":"(.*?)"/.exec(bodyStr);
      if (cfMatch && cfMatch[1]) this.bl = cfMatch[1];

      this.isInitialized = true;
      this.persistSession();
      return;
    }

    // Guest mode can proceed even without snlm0e
    this.isInitialized = true;
  }

  public async ensureInit(signal?: AbortSignal): Promise<void> {
    if (!this.isInitialized) {
      await this.initSession(signal);
    }
  }

  public async executeStreamRequest(
    prompt: string,
    modelName: string,
    onChunk?: (text: string) => void,
    signal?: AbortSignal
  ): Promise<GeminiResponse> {
    await this.ensureInit(signal);

    const modelCfg = ModelRegistry.getInstance().resolve(modelName);
    this.reqId += 100;
    const reqIDStr = this.reqId.toString();

    const msgInner = [prompt, 0, null, [], null, null, 0];
    const msgLang = ['en-US'];
    const msgContext = [null, null, null, null, null, null, null, null, null, ''];
    const msgStruct = [msgInner, msgLang, msgContext];

    const msgJSON = JSON.stringify(msgStruct);
    const fReqVal = [null, msgJSON];
    const fReqJSON = JSON.stringify(fReqVal);

    const data = new URLSearchParams();
    data.set('f.req', fReqJSON);
    if (this.snlm0e) {
      data.set('at', this.snlm0e);
    }

    const query = new URLSearchParams();
    query.set('bl', this.bl);
    query.set('_reqid', reqIDStr);
    query.set('rt', 'c');
    if (this.fsid) {
      query.set('f.sid', this.fsid);
    }

    const fullURL = `https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate?${query.toString()}`;
    const jspbVal = buildHeaderValue(modelCfg);

    const resp = await this.request(fullURL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Origin': 'https://gemini.google.com',
        'Referer': 'https://gemini.google.com/app',
        'X-Same-Domain': '1',
        'x-goog-ext-525001261-jspb': jspbVal,
        'x-goog-ext-525005358-jspb': '["DIRECT-API-SESSION",1]',
        'x-goog-ext-73010989-jspb': '[0]',
      },
      body: data.toString(),
      signal,
    });

    if (resp.status !== 200) {
      const errText = await resp.text().catch(() => '');
      throw new Error(`Google Gemini Web returned HTTP ${resp.status}: ${errText.slice(0, 200)}`);
    }

    const rawBody = await this.readAndProcessStream(resp, onChunk, signal);

    const response: GeminiResponse = {
      text: '',
      conversation_id: '',
      response_id: '',
      choice_id: '',
      images: [],
      videos: [],
      elapsed: 0,
    };

    parseResponse(rawBody, response);

    if (response.conversation_id) {
      this.updateConvState(modelCfg.id, response.conversation_id, response.response_id, response.choice_id);
    }

    return response;
  }

  private async readAndProcessStream(
    resp: Response,
    onChunk?: (text: string) => void,
    signal?: AbortSignal
  ): Promise<string> {
    if (!resp.body) return '';

    const reader = resp.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let fullText = '';
    let prevText = '';
    let buffer = '';

    try {
      while (true) {
        if (signal?.aborted) {
          await reader.cancel();
          break;
        }

        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        fullText += chunk;
        buffer += chunk;

        // Extract RPC envelope items: [[["wrb.fr", ...]]]
        let wrbIdx = buffer.indexOf('[[["wrb.fr"');
        if (wrbIdx === -1) {
          wrbIdx = buffer.indexOf('[["wrb.fr"');
        }

        while (wrbIdx !== -1) {
          // Find matching end of JSON bracket or scan lines
          const nextWrb = buffer.indexOf('[["wrb.fr"', wrbIdx + 10);
          let candidate = '';
          if (nextWrb !== -1) {
            candidate = buffer.slice(wrbIdx, nextWrb).trim();
            buffer = buffer.slice(nextWrb);
          } else {
            // Check if buffer ends with a newline indicating complete frame
            const lastNl = buffer.lastIndexOf('\n');
            if (lastNl > wrbIdx) {
              candidate = buffer.slice(wrbIdx, lastNl).trim();
              buffer = buffer.slice(lastNl + 1);
            } else {
              // Incomplete frame, wait for more chunks
              break;
            }
          }

          if (candidate) {
            const tempResp: GeminiResponse = {
              text: '',
              conversation_id: '',
              response_id: '',
              choice_id: '',
              images: [],
              videos: [],
              elapsed: 0,
            };
            parseResponse(candidate, tempResp);

            if (tempResp.text && tempResp.text !== prevText) {
              let delta = '';
              if (tempResp.text.startsWith(prevText)) {
                delta = tempResp.text.slice(prevText.length);
              } else {
                // Find longest common prefix to avoid duplicate output
                let i = 0;
                while (i < prevText.length && i < tempResp.text.length && prevText[i] === tempResp.text[i]) {
                  i++;
                }
                delta = tempResp.text.slice(i);
              }

              if (delta && onChunk) {
                onChunk(delta);
              }
              prevText = tempResp.text;
            }
          }

          wrbIdx = buffer.indexOf('[[["wrb.fr"');
          if (wrbIdx === -1) {
            wrbIdx = buffer.indexOf('[["wrb.fr"');
          }
        }
      }

      // Final remainder check
      if (buffer.trim()) {
        const tempResp: GeminiResponse = {
          text: '',
          conversation_id: '',
          response_id: '',
          choice_id: '',
          images: [],
          videos: [],
          elapsed: 0,
        };
        parseResponse(buffer, tempResp);
        if (tempResp.text && tempResp.text !== prevText) {
          let delta = '';
          if (tempResp.text.startsWith(prevText)) {
            delta = tempResp.text.slice(prevText.length);
          } else {
            let i = 0;
            while (i < prevText.length && i < tempResp.text.length && prevText[i] === tempResp.text[i]) {
              i++;
            }
            delta = tempResp.text.slice(i);
          }
          if (delta && onChunk) {
            onChunk(delta);
          }
        }
      }
    } finally {
      try {
        reader.releaseLock();
      } catch (_) {}
    }

    return fullText;
  }

  public async askModel(
    prompt: string,
    modelName: string = '',
    signal?: AbortSignal
  ): Promise<GeminiResponse> {
    const start = Date.now();
    await this.ensureInit(signal);

    const modelCfg = ModelRegistry.getInstance().resolve(modelName);
    this.reqId += 100;
    const reqIDStr = this.reqId.toString();

    const msgInner = [prompt, 0, null, [], null, null, 0];
    const msgLang = ['en-US'];
    const msgContext = [null, null, null, null, null, null, null, null, null, ''];
    const msgStruct = [msgInner, msgLang, msgContext];

    const msgJSON = JSON.stringify(msgStruct);
    const fReqVal = [null, msgJSON];
    const fReqJSON = JSON.stringify(fReqVal);

    const data = new URLSearchParams();
    data.set('f.req', fReqJSON);
    if (this.snlm0e) {
      data.set('at', this.snlm0e);
    }

    const query = new URLSearchParams();
    query.set('bl', this.bl);
    query.set('_reqid', reqIDStr);
    query.set('rt', 'c');
    if (this.fsid) {
      query.set('f.sid', this.fsid);
    }

    const fullURL = `https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate?${query.toString()}`;
    const jspbVal = buildHeaderValue(modelCfg);

    const resp = await this.request(fullURL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Origin': 'https://gemini.google.com',
        'Referer': 'https://gemini.google.com/app',
        'X-Same-Domain': '1',
        'x-goog-ext-525001261-jspb': jspbVal,
        'x-goog-ext-525005358-jspb': '["DIRECT-API-SESSION",1]',
        'x-goog-ext-73010989-jspb': '[0]',
      },
      body: data.toString(),
      signal,
    });

    if (resp.status !== 200) {
      const errText = await resp.text().catch(() => '');
      throw new Error(`Google Gemini Web returned HTTP ${resp.status}: ${errText.slice(0, 200)}`);
    }

    const rawBody = await resp.text();
    const response: GeminiResponse = {
      text: '',
      conversation_id: '',
      response_id: '',
      choice_id: '',
      images: [],
      videos: [],
      elapsed: (Date.now() - start) / 1000,
    };

    parseResponse(rawBody, response);

    if (response.conversation_id) {
      this.updateConvState(modelCfg.id, response.conversation_id, response.response_id, response.choice_id);
    }

    return response;
  }
}

export function parseResponse(raw: string, res: GeminiResponse): void {
  const lines = raw.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('[[')) {
      continue;
    }

    let wrapper: any[][];
    try {
      wrapper = JSON.parse(trimmed);
    } catch (_) {
      continue;
    }

    if (!Array.isArray(wrapper)) continue;

    for (const item of wrapper) {
      if (!Array.isArray(item) || item.length < 3) continue;
      if (item[0] !== 'wrb.fr') continue;

      const payloadStr = item[2];
      if (typeof payloadStr !== 'string') continue;

      let inner: any[];
      try {
        inner = JSON.parse(payloadStr);
      } catch (_) {
        continue;
      }

      if (!Array.isArray(inner)) continue;

      if (inner.length > 1 && Array.isArray(inner[1]) && inner[1].length >= 2) {
        if (typeof inner[1][0] === 'string') res.conversation_id = inner[1][0];
        if (typeof inner[1][1] === 'string') res.response_id = inner[1][1];
      }

      if (inner.length > 4 && Array.isArray(inner[4]) && inner[4].length > 0) {
        const msgItem = inner[4][0];
        if (Array.isArray(msgItem) && msgItem.length > 1) {
          if (Array.isArray(msgItem[1]) && msgItem[1].length > 0 && typeof msgItem[1][0] === 'string') {
            res.text = msgItem[1][0];
          }
          if (typeof msgItem[0] === 'string') {
            res.choice_id = msgItem[0];
          }

          if (msgItem.length > 12 && Array.isArray(msgItem[12]) && msgItem[12].length > 7) {
            const outerList = msgItem[12][7];
            if (Array.isArray(outerList) && outerList.length > 0 && Array.isArray(outerList[0])) {
              for (const imgObj of outerList[0]) {
                if (
                  Array.isArray(imgObj) &&
                  imgObj.length > 0 &&
                  Array.isArray(imgObj[0]) &&
                  imgObj[0].length > 3 &&
                  Array.isArray(imgObj[0][3]) &&
                  imgObj[0][3].length > 3 &&
                  typeof imgObj[0][3][3] === 'string'
                ) {
                  let imgURL: string = imgObj[0][3][3];
                  imgURL = imgURL.split('=')[0] + '=s0';
                  if (!res.images.includes(imgURL)) {
                    res.images.push(imgURL);
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}
