import { DataStore } from '../db/store';

export class GroqSpeechTranscriber {
  private static instance: GroqSpeechTranscriber | null = null;

  private constructor() {}

  public static getInstance(): GroqSpeechTranscriber {
    if (!GroqSpeechTranscriber.instance) {
      GroqSpeechTranscriber.instance = new GroqSpeechTranscriber();
    }
    return GroqSpeechTranscriber.instance;
  }

  public async transcribe(
    audioBuffer: Buffer | ArrayBuffer | Uint8Array,
    mimeType: string = 'audio/webm'
  ): Promise<{ text: string; error?: string }> {
    const settings = DataStore.getInstance().getSettings();
    const apiKey = (settings.groqApiKey || process.env.GROQ_API_KEY || '').trim();

    if (!apiKey) {
      return {
        text: '',
        error: 'Groq API Key is missing. Please add your free Groq API key in Settings.',
      };
    }

    try {
      const buffer = Buffer.isBuffer(audioBuffer)
        ? audioBuffer
        : Buffer.from(audioBuffer as any);

      if (buffer.length < 500) {
        // Less than 500 bytes of audio is silence or empty clip
        return { text: '' };
      }

      const formData = new FormData();
      const blob = new Blob([buffer], { type: mimeType || 'audio/webm' });
      formData.append('file', blob, 'audio.webm');
      formData.append('model', 'whisper-large-v3-turbo');
      formData.append('response_format', 'json');
      formData.append('temperature', '0');

      const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        body: formData,
      });

      if (!response.ok) {
        let errMessage = `HTTP ${response.status}`;
        try {
          const errJson = await response.json();
          errMessage = errJson?.error?.message || JSON.stringify(errJson);
        } catch (_) {
          const text = await response.text();
          if (text) errMessage = text;
        }

        if (response.status === 401) {
          return {
            text: '',
            error: 'Invalid Groq API Key. Please verify your key in Settings.',
          };
        }

        return {
          text: '',
          error: `Groq Whisper transcription failed: ${errMessage}`,
        };
      }

      const data: any = await response.json();
      const text = (data.text || '').trim();
      return { text };
    } catch (err: any) {
      console.error('[GroqSpeechTranscriber] Transcription error:', err);
      return {
        text: '',
        error: `Transcription failed: ${err.message || 'Network error'}`,
      };
    }
  }
}
