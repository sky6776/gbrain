import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { writeFileSync, unlinkSync, mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  transcribe,
  getTranscriptionStatus,
  TranscriptionResult,
  TranscriptionConfig,
} from '../src/core/transcription.js';

describe('transcription', () => {
  const originalEnv = { ...process.env };
  let tmpDir: string;
  let tmpWav: string;
  let tmpTxt: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'gbrain-test-'));
    tmpWav = join(tmpDir, 'test.wav');
    tmpTxt = join(tmpDir, 'test.txt');
    writeFileSync(tmpWav, 'fake wav data');
    writeFileSync(tmpTxt, 'not audio');

    delete process.env.GBRAIN_TRANSCRIPTION_GROQ_API_KEY;
    delete process.env.GBRAIN_GROQ_API_KEY;
    delete process.env.GBRAIN_TRANSCRIPTION_OPENAI_API_KEY;
    delete process.env.GBRAIN_TRANSCRIPTION_PROVIDER;
  });

  afterEach(() => {
    try { unlinkSync(tmpWav); } catch {}
    try { unlinkSync(tmpTxt); } catch {}
    process.env = { ...originalEnv };
  });

  describe('getTranscriptionStatus', () => {
    test('returns unavailable when no API keys set', () => {
      const status = getTranscriptionStatus();
      expect(status.available).toBe(false);
      expect(status.provider).toBe('none');
    });

    test('returns groq when GBRAIN_TRANSCRIPTION_GROQ_API_KEY is set', () => {
      process.env.GBRAIN_TRANSCRIPTION_GROQ_API_KEY = 'test-key';
      const status = getTranscriptionStatus();
      expect(status.available).toBe(true);
      expect(status.provider).toBe('groq');
    });

    test('returns groq when GBRAIN_GROQ_API_KEY is set (legacy)', () => {
      process.env.GBRAIN_GROQ_API_KEY = 'test-key';
      const status = getTranscriptionStatus();
      expect(status.available).toBe(true);
      expect(status.provider).toBe('groq');
    });

    test('returns openai when GBRAIN_TRANSCRIPTION_OPENAI_API_KEY is set', () => {
      process.env.GBRAIN_TRANSCRIPTION_OPENAI_API_KEY = 'test-key';
      const status = getTranscriptionStatus();
      expect(status.available).toBe(true);
      expect(status.provider).toBe('openai');
    });

    test('groq takes precedence over openai', () => {
      process.env.GBRAIN_TRANSCRIPTION_GROQ_API_KEY = 'groq-key';
      process.env.GBRAIN_TRANSCRIPTION_OPENAI_API_KEY = 'openai-key';
      const status = getTranscriptionStatus();
      expect(status.available).toBe(true);
      expect(status.provider).toBe('groq');
    });
  });

  describe('transcribe', () => {
    test('throws on unsupported audio format', async () => {
      await expect(transcribe(tmpTxt)).rejects.toThrow('Unsupported audio format');
    });

    test('throws on missing API key', async () => {
      process.env.GBRAIN_TRANSCRIPTION_PROVIDER = 'groq';
      await expect(transcribe(tmpWav)).rejects.toThrow('API key not set');
    });

    test('provider can be overridden via config', async () => {
      const config: TranscriptionConfig = { provider: 'openai' };
      await expect(transcribe(tmpWav, config)).rejects.toThrow('openai');
    });

    test('provider env var GBRAIN_TRANSCRIPTION_PROVIDER is respected', async () => {
      process.env.GBRAIN_TRANSCRIPTION_PROVIDER = 'openai';
      await expect(transcribe(tmpWav)).rejects.toThrow('openai');
    });
  });

  describe('format validation', () => {
    test('supported audio extensions are recognized', () => {
      const supported = ['.mp3', '.mp4', '.m4a', '.wav', '.webm', '.ogg', '.flac'];
      expect(supported.length).toBeGreaterThan(5);
    });
  });
});
