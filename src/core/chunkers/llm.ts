/**
 * LLM-guided chunking: use an LLM to identify natural section boundaries
 * in a document, then split at those boundaries.
 *
 * Uses OpenAI-compatible SDK so any provider (OpenAI, Zhipu, DashScope,
 * DeepSeek, etc.) can be used via GBRAIN_CHUNKER_* env vars.
 * Falls back to OPENAI_API_KEY for backward compatibility.
 */

import OpenAI from 'openai';
import { getChunkerConfig } from '../config.js';

export interface LLMChunk {
  heading: string;
  content: string;
  startLine: number;
  endLine: number;
}

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!client) {
    const cfg = getChunkerConfig();
    client = new OpenAI({
      apiKey: cfg.apiKey || undefined,
      baseURL: cfg.baseURL || undefined,
    });
  }
  return client;
}

function isChunkerConfigured(): boolean {
  const cfg = getChunkerConfig();
  return !!(cfg.apiKey && cfg.model);
}

/**
 * Use an LLM to identify natural section boundaries in a document.
 * Returns an array of chunks with headings and line ranges.
 */
export async function llmChunk(
  text: string,
  opts?: { maxChunks?: number },
): Promise<LLMChunk[]> {
  if (!isChunkerConfigured()) {
    // Fallback: treat the entire text as a single chunk
    const lines = text.split('\n');
    return [{
      heading: 'Document',
      content: text,
      startLine: 1,
      endLine: lines.length,
    }];
  }

  const cfg = getChunkerConfig();
  const maxChunks = opts?.maxChunks ?? 20;

  try {
    const response = await getClient().chat.completions.create({
      model: cfg.model!,
      messages: [
        {
          role: 'system',
          content:
            'You are a document structure analyzer. Given a document, identify its natural sections. ' +
            'Return a JSON array of objects with "heading", "startLine", and "endLine" fields. ' +
            'Lines are 1-indexed. Do not overlap sections. Cover the entire document.',
        },
        {
          role: 'user',
          content: text,
        },
      ],
      max_tokens: 2000,
      temperature: 0,
    });

    const content = response.choices?.[0]?.message?.content ?? '';
    // Extract JSON from the response (may be wrapped in markdown code block)
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      // Fallback to single chunk
      const lines = text.split('\n');
      return [{
        heading: 'Document',
        content: text,
        startLine: 1,
        endLine: lines.length,
      }];
    }

    const parsed = JSON.parse(jsonMatch[0]) as Array<{ heading?: string; startLine?: number; endLine?: number }>;
    const lines = text.split('\n');

    return parsed
      .filter(c => c.heading && c.startLine && c.endLine)
      .slice(0, maxChunks)
      .map(c => ({
        heading: c.heading!,
        content: lines.slice((c.startLine! - 1), c.endLine!).join('\n'),
        startLine: c.startLine!,
        endLine: c.endLine!,
      }));
  } catch (err) {
    // LLM chunking is best-effort; fall back to single chunk
    const lines = text.split('\n');
    return [{
      heading: 'Document',
      content: text,
      startLine: 1,
      endLine: lines.length,
    }];
  }
}
