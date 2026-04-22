/**
 * Audio transcription service.
 *
 * Default provider: Groq Whisper (fast, cheap).
 * Fallback: OpenAI Whisper if Groq unavailable.
 * For files >25MB: ffmpeg segmentation into <25MB chunks, transcribe each, concatenate.
 *
 * Each provider uses independent env vars (GBRAIN_TRANSCRIPTION_*)
 * so transcription can use a different provider than embedding.
 */

import Groq from 'groq-sdk';
import OpenAI from 'openai';
import { statSync, readFileSync, readdirSync } from 'fs';
import { basename, extname } from 'path';
import { execFileSync } from 'child_process';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TranscriptionSegment {
  start: number;
  end: number;
  text: string;
  speaker?: string;
}

export interface TranscriptionResult {
  text: string;
  segments: TranscriptionSegment[];
  language: string;
  duration: number;
  provider: string;
}

export interface TranscriptionConfig {
  provider?: 'groq' | 'openai';
  apiKey?: string;
  model?: string;
  language?: string;
  prompt?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB

const AUDIO_EXTENSIONS = new Set([
  '.mp3', '.mp4', '.mpeg', '.mpga', '.m4a', '.wav', '.webm', '.ogg', '.flac',
]);

const MIME_TYPES: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.mp4': 'audio/mp4',
  '.m4a': 'audio/m4a',
  '.wav': 'audio/wav',
  '.webm': 'audio/webm',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
};

// ---------------------------------------------------------------------------
// Provider detection
// ---------------------------------------------------------------------------

function detectProvider(): 'groq' | 'openai' {
  if (process.env.GBRAIN_TRANSCRIPTION_PROVIDER === 'openai') return 'openai';
  if (process.env.GBRAIN_TRANSCRIPTION_PROVIDER === 'groq') return 'groq';
  if (process.env.GBRAIN_TRANSCRIPTION_GROQ_API_KEY || process.env.GBRAIN_GROQ_API_KEY) return 'groq';
  if (process.env.GBRAIN_TRANSCRIPTION_OPENAI_API_KEY) return 'openai';
  return 'groq'; // default, will fail with clear error if no key
}

function getApiKey(provider: string): string | undefined {
  switch (provider) {
    case 'groq': return process.env.GBRAIN_TRANSCRIPTION_GROQ_API_KEY || process.env.GBRAIN_GROQ_API_KEY;
    case 'openai': return process.env.GBRAIN_TRANSCRIPTION_OPENAI_API_KEY;
    default: return undefined;
  }
}

function assertApiKey(provider: string): string {
  const key = getApiKey(provider);
  if (!key) {
    const envVar = provider === 'groq' ? 'GBRAIN_TRANSCRIPTION_GROQ_API_KEY' : 'GBRAIN_TRANSCRIPTION_OPENAI_API_KEY';
    throw new Error(
      `${provider} API key not set. Set ${envVar} environment variable.`
    );
  }
  return key;
}

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

/**
 * Transcribe an audio file using Groq Whisper (default) or OpenAI Whisper.
 * Files >25MB are segmented with ffmpeg before transcription.
 */
export async function transcribe(
  audioPath: string,
  config: TranscriptionConfig = {},
): Promise<TranscriptionResult> {
  // Validate file exists and is audio
  const stat = statSync(audioPath);
  const ext = extname(audioPath).toLowerCase();
  if (!AUDIO_EXTENSIONS.has(ext)) {
    throw new Error(`Unsupported audio format: ${ext}. Supported: ${[...AUDIO_EXTENSIONS].join(', ')}`);
  }

  const provider = config.provider || detectProvider();
  const apiKey = config.apiKey || assertApiKey(provider);

  // Handle large files via segmentation
  if (stat.size > MAX_FILE_SIZE) {
    return transcribeLargeFile(audioPath, provider, apiKey, config);
  }

  return transcribeFile(audioPath, provider, apiKey, config);
}

// ---------------------------------------------------------------------------
// Single file transcription (SDK-based)
// ---------------------------------------------------------------------------

async function transcribeFile(
  audioPath: string,
  provider: string,
  apiKey: string,
  config: TranscriptionConfig,
): Promise<TranscriptionResult> {
  const fileData = readFileSync(audioPath);
  const filename = basename(audioPath);
  const ext = extname(audioPath).toLowerCase();
  const mimeType = MIME_TYPES[ext] || 'audio/wav';
  const model = config.model || (provider === 'groq' ? 'whisper-large-v3' : 'whisper-1');

  if (provider === 'groq') {
    const client = new Groq({
      apiKey,
      baseURL: process.env.GBRAIN_TRANSCRIPTION_GROQ_BASE_URL || process.env.GBRAIN_GROQ_BASE_URL || undefined,
    });

    const response = await client.audio.transcriptions.create({
      file: new File([fileData], filename, { type: mimeType }),
      model,
      language: config.language,
      prompt: config.prompt,
      response_format: 'verbose_json',
    });

    const data = typeof response === 'object' ? response : { text: String(response), segments: [], language: config.language || 'unknown', duration: 0 };
    return {
      text: data.text || '',
      segments: (data.segments || []).map((s: any) => ({
        start: s.start ?? 0,
        end: s.end ?? 0,
        text: s.text || '',
      })),
      language: data.language || config.language || 'unknown',
      duration: data.duration || 0,
      provider,
    };
  }

  // OpenAI
  const client = new OpenAI({
    apiKey,
    baseURL: process.env.GBRAIN_TRANSCRIPTION_OPENAI_BASE_URL || undefined,
  });

  const response = await client.audio.transcriptions.create({
    file: new File([fileData], filename, { type: mimeType }),
    model,
    language: config.language,
    prompt: config.prompt,
    response_format: 'verbose_json',
  });

  const data = response as any;
  return {
    text: data.text || '',
    segments: (data.segments || []).map((s: any) => ({
      start: s.start ?? 0,
      end: s.end ?? 0,
      text: s.text || '',
    })),
    language: data.language || config.language || 'unknown',
    duration: data.duration || 0,
    provider,
  };
}

// ---------------------------------------------------------------------------
// Large file segmentation (>25MB via ffmpeg)
// ---------------------------------------------------------------------------

async function transcribeLargeFile(
  audioPath: string,
  provider: string,
  apiKey: string,
  config: TranscriptionConfig,
): Promise<TranscriptionResult> {
  const ffmpegAvailable = await checkFfmpeg();
  if (!ffmpegAvailable) {
    throw new Error(
      'File exceeds 25MB and ffmpeg is required for segmentation. ' +
      'Install ffmpeg: brew install ffmpeg (macOS) or apt install ffmpeg (Linux)'
    );
  }

  // Create temp directory safely
  const tmpDir = execFileSync('mktemp', ['-d'], { encoding: 'utf-8' }).trim();

  try {
    // Get audio duration via ffprobe (array args — no shell injection)
    const durationStr = execFileSync(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', audioPath],
      { encoding: 'utf-8' }
    ).trim();
    const totalDuration = parseFloat(durationStr) || 0;

    // Calculate segment length (~20MB per segment)
    const stat = statSync(audioPath);
    const bytesPerSecond = stat.size / Math.max(totalDuration, 1);
    const segmentSeconds = Math.floor((20 * 1024 * 1024) / bytesPerSecond);

    // Split audio (ffmpeg with array args — no shell injection)
    const ext = extname(audioPath);
    const segmentPattern = `${tmpDir}/segment_%03d${ext}`;
    execFileSync('ffmpeg', ['-i', audioPath, '-f', 'segment', '-segment_time', String(segmentSeconds), '-c', 'copy', segmentPattern], { stdio: 'pipe' });

    // Transcribe each segment
    const segments = readdirSync(tmpDir).filter(f => f.startsWith('segment_')).sort();
    const results: TranscriptionResult[] = [];
    let timeOffset = 0;

    for (const seg of segments) {
      const segPath = `${tmpDir}/${seg}`;
      const result = await transcribeFile(segPath, provider, apiKey, config);
      // Offset timestamps
      result.segments = result.segments.map(s => ({
        ...s,
        start: s.start + timeOffset,
        end: s.end + timeOffset,
      }));
      results.push(result);
      timeOffset += result.duration;
    }

    // Concatenate results
    return {
      text: results.map(r => r.text).join(' '),
      segments: results.flatMap(r => r.segments),
      language: results[0]?.language || 'unknown',
      duration: timeOffset,
      provider,
    };
  } finally {
    // Cleanup temp directory (rm with array args — no shell injection)
    try { execFileSync('rm', ['-rf', tmpDir]); } catch {}
  }
}

async function checkFfmpeg(): Promise<boolean> {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Status helper
// ---------------------------------------------------------------------------

export function getTranscriptionStatus(): { available: boolean; provider: string } {
  if (process.env.GBRAIN_TRANSCRIPTION_GROQ_API_KEY || process.env.GBRAIN_GROQ_API_KEY) {
    return { available: true, provider: 'groq' };
  }
  if (process.env.GBRAIN_TRANSCRIPTION_OPENAI_API_KEY) {
    return { available: true, provider: 'openai' };
  }
  return { available: false, provider: 'none' };
}
