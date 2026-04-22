/**
 * LLM-based Chunking
 *
 * Uses an Anthropic-compatible LLM to semantically chunk documents
 * into topic-coherent sections. Falls back to simple chunking when
 * the LLM is unavailable.
 *
 * Configurable via GBRAIN_ env vars for alternative providers.
 */

import Anthropic from '@anthropic-ai/sdk';

const CHUNKER_MODEL = process.env.GBRAIN_CHUNKER_MODEL || 'claude-haiku-4-5-20251001';

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    const options: Anthropic.ClientOptions = {
      apiKey: process.env.GBRAIN_ANTHROPIC_API_KEY || undefined,
    };
    const baseURL = process.env.GBRAIN_ANTHROPIC_BASE_URL;
    if (baseURL) {
      options.baseURL = baseURL;
    }
    client = new Anthropic(options);
  }
  return client;
}

export interface LLMChunk {
  content: string;
  topic: string;
  start_offset: number;
  end_offset: number;
}

export async function chunkWithLLM(
  text: string,
  maxChunkSize: number = 1000,
): Promise<LLMChunk[]> {
  if (!process.env.GBRAIN_ANTHROPIC_API_KEY) {
    return simpleChunk(text, maxChunkSize);
  }

  try {
    const response = await getClient().messages.create({
      model: CHUNKER_MODEL,
      max_tokens: 4096,
      tools: [
        {
          name: 'submit_chunks',
          description: 'Submit the semantically chunked document sections',
          input_schema: {
            type: 'object' as const,
            properties: {
              chunks: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    topic: { type: 'string', description: 'Topic or heading for this section' },
                    content: { type: 'string', description: 'The text content of this section' },
                  },
                  required: ['topic', 'content'],
                },
              },
            },
            required: ['chunks'],
          },
        },
      ],
      messages: [
        {
          role: 'user',
          content: `Analyze the following document and break it into semantically coherent chunks. Each chunk should cover a single topic or section. The maximum size for each chunk is approximately ${maxChunkSize} characters.

Document:
---
${text.slice(0, 50000)}
---

Use the submit_chunks tool to return the chunks.`,
        },
      ],
    });

    const toolUse = response.content.find(block => block.type === 'tool_use');
    if (toolUse && toolUse.type === 'tool_use') {
      const input = toolUse.input as { chunks?: Array<{ topic: string; content: string }> };
      if (input.chunks && Array.isArray(input.chunks)) {
        return input.chunks.map(chunk => ({
          content: chunk.content,
          topic: chunk.topic,
          start_offset: 0,
          end_offset: chunk.content.length,
        }));
      }
    }

    return simpleChunk(text, maxChunkSize);
  } catch (e) {
    // LLM chunking is non-fatal, fall back to simple chunking
    return simpleChunk(text, maxChunkSize);
  }
}

function simpleChunk(text: string, maxChunkSize: number): LLMChunk[] {
  const chunks: LLMChunk[] = [];
  let offset = 0;

  while (offset < text.length) {
    let end = Math.min(offset + maxChunkSize, text.length);

    // Try to break at paragraph or sentence boundary
    if (end < text.length) {
      const paragraphBreak = text.lastIndexOf('\n\n', end);
      if (paragraphBreak > offset + maxChunkSize * 0.3) {
        end = paragraphBreak;
      } else {
        const sentenceBreak = text.lastIndexOf('. ', end);
        if (sentenceBreak > offset + maxChunkSize * 0.3) {
          end = sentenceBreak + 1;
        }
      }
    }

    chunks.push({
      content: text.slice(offset, end).trim(),
      topic: 'Untitled Section',
      start_offset: offset,
      end_offset: end,
    });

    offset = end;
  }

  return chunks;
}
