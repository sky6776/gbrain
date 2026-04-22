/**
 * LLM-based Chunking
 *
 * Uses an OpenAI-compatible LLM to semantically chunk documents
 * into topic-coherent sections. Falls back to simple chunking when
 * the LLM is unavailable.
 *
 * Supports any OpenAI-compatible provider (Zhipu, DashScope, DeepSeek, etc.)
 * via GBRAIN_CHUNKER_* env vars, independent from other providers.
 */

import OpenAI from 'openai';

const CHUNKER_MODEL = process.env.GBRAIN_CHUNKER_MODEL || '';

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!client) {
    client = new OpenAI({
      apiKey: process.env.GBRAIN_CHUNKER_API_KEY || undefined,
      baseURL: process.env.GBRAIN_CHUNKER_BASE_URL || undefined,
    });
  }
  return client;
}

function isChunkerConfigured(): boolean {
  return !!(process.env.GBRAIN_CHUNKER_API_KEY && CHUNKER_MODEL);
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
  if (!isChunkerConfigured()) {
    return simpleChunk(text, maxChunkSize);
  }

  try {
    const response = await getClient().chat.completions.create({
      model: CHUNKER_MODEL,
      max_tokens: 4096,
      tools: [
        {
          type: 'function' as const,
          function: {
            name: 'submit_chunks',
            description: 'Submit the semantically chunked document sections',
            parameters: {
              type: 'object',
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

Use the submit_chunks function to return the chunks.`,
        },
      ],
    });

    const message = response.choices[0]?.message;
    if (message?.tool_calls && message.tool_calls.length > 0) {
      const toolCall = message.tool_calls[0];
      if (toolCall.function.name === 'submit_chunks') {
        const input = JSON.parse(toolCall.function.arguments) as {
          chunks?: Array<{ topic: string; content: string }>;
        };
        if (input.chunks && Array.isArray(input.chunks)) {
          return input.chunks.map(chunk => ({
            content: chunk.content,
            topic: chunk.topic,
            start_offset: 0,
            end_offset: chunk.content.length,
          }));
        }
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
