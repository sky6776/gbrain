/**
 * Audio Transcription Service
 *
 * Supports multiple transcription providers:
 * - Groq Whisper (default) - fast, cost-effective
 * - OpenAI Whisper - high accuracy
 * - Deepgram - enterprise features
 *
 * Configurable via GBRAIN_ prefixed env vars.
 */

import Groq from 'groq';
import OpenAI from 'openai';

function detectProvider(): 'groq' | 'openai' {
  if (process.env.GBRAIN_GROQ_API_KEY) return 'groq';
  if (process.env.GBRAIN_OPENAI_API_KEY) return 'openai';
  return 'groq'; // default, will fail with clear error if no key
}

function getApiKey(provider: string): string | undefined {
  switch (provider) {
    case 'groq': return process.env.GBRAIN_GROQ_API_KEY;
    case 'openai': return process.env.GBRAIN_OPENAI_API_KEY;
    case 'deepgram': return process.env.GBRAIN_DEEPGRAM_API_KEY;
    default: return undefined;
  }
}

function assertApiKey(provider: string): string {
  const key = getApiKey(provider);
  if (!key) {
    const envVar = provider === 'groq' ? 'GBRAIN_GROQ_API_KEY' : 'GBRAIN_OPENAI_API_KEY';
    throw new Error(
      `${provider} API key not set. Set ${envVar} environment variable. ` +
      (provider === 'groq' ? 'Or set GBRAIN_OPENAI_API_KEY to use OpenAI Whisper as fallback.' : '')
    );
  }
  return key;
}

export async function transcribe(
  audioBuffer: Buffer,
  options: {
    provider?: 'groq' | 'openai';
    language?: string;
    prompt?: string;
  } = {},
): Promise<string> {
  const provider = options.provider || detectProvider();
  const apiKey = assertApiKey(provider);

  switch (provider) {
    case 'groq':
      return transcribeWithGroq(audioBuffer, apiKey, options);
    case 'openai':
      return transcribeWithOpenAI(audioBuffer, apiKey, options);
    default:
      throw new Error(`Unsupported transcription provider: ${provider}`);
  }
}

async function transcribeWithGroq(
  audioBuffer: Buffer,
  apiKey: string,
  options: { language?: string; prompt?: string },
): Promise<string> {
  const client = new Groq({
    apiKey,
    baseURL: process.env.GBRAIN_GROQ_BASE_URL || undefined,
  });

  const response = await client.audio.transcriptions.create({
    file: new File([audioBuffer], 'audio.wav', { type: 'audio/wav' }),
    model: 'whisper-large-v3',
    language: options.language,
    prompt: options.prompt,
    response_format: 'text',
  });

  return typeof response === 'string' ? response : response.text;
}

async function transcribeWithOpenAI(
  audioBuffer: Buffer,
  apiKey: string,
  options: { language?: string; prompt?: string },
): Promise<string> {
  const client = new OpenAI({
    apiKey,
    baseURL: process.env.GBRAIN_OPENAI_BASE_URL || undefined,
  });

  const response = await client.audio.transcriptions.create({
    file: new File([audioBuffer], 'audio.wav', { type: 'audio/wav' }),
    model: 'whisper-1',
    language: options.language,
    prompt: options.prompt,
  });

  return response.text;
}

export function getTranscriptionStatus(): { available: boolean; provider: string } {
  if (process.env.GBRAIN_GROQ_API_KEY) {
    return { available: true, provider: 'groq' };
  }
  if (process.env.GBRAIN_OPENAI_API_KEY) {
    return { available: true, provider: 'openai' };
  }
  return { available: false, provider: 'none' };
}
