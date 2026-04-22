/**
 * Query Expansion via LLM
 *
 * Uses an OpenAI-compatible API to expand user queries into
 * alternative search terms for better recall. Falls back to the
 * original query when expansion fails (non-fatal).
 *
 * Supports any OpenAI-compatible provider (Zhipu, DashScope, DeepSeek, etc.)
 * via GBRAIN_EXPANSION_* env vars, independent from embedding provider.
 */

import OpenAI from 'openai';

const EXPANSION_MODEL = process.env.GBRAIN_EXPANSION_MODEL || '';
const MAX_ALTERNATIVES = 5;

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!client) {
    client = new OpenAI({
      apiKey: process.env.GBRAIN_EXPANSION_API_KEY || undefined,
      baseURL: process.env.GBRAIN_EXPANSION_BASE_URL || undefined,
    });
  }
  return client;
}

function isExpansionConfigured(): boolean {
  return !!(process.env.GBRAIN_EXPANSION_API_KEY && EXPANSION_MODEL);
}

export async function expandQuery(query: string): Promise<string[]> {
  try {
    if (!isExpansionConfigured()) {
      return [query];
    }

    const response = await getClient().chat.completions.create({
      model: EXPANSION_MODEL,
      max_tokens: 256,
      tools: [
        {
          type: 'function' as const,
          function: {
            name: 'submit_alternatives',
            description: 'Submit alternative search queries',
            parameters: {
              type: 'object',
              properties: {
                alternatives: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Alternative search queries that capture the same intent',
                },
              },
              required: ['alternatives'],
            },
          },
        },
      ],
      messages: [
        {
          role: 'user',
          content: `Generate up to ${MAX_ALTERNATIVES} alternative search queries that capture the same intent as: "${query}".
The alternatives should use different keywords, synonyms, or phrasings while preserving the core intent.
Return the alternatives using the submit_alternatives function.`,
        },
      ],
    });

    const message = response.choices[0]?.message;
    if (message?.tool_calls && message.tool_calls.length > 0) {
      const toolCall = message.tool_calls[0];
      if (toolCall.function.name === 'submit_alternatives') {
        const input = JSON.parse(toolCall.function.arguments) as { alternatives?: string[] };
        if (input.alternatives && Array.isArray(input.alternatives)) {
          return [...new Set([query, ...input.alternatives])].slice(0, MAX_ALTERNATIVES + 1);
        }
      }
    }

    return [query];
  } catch (e) {
    // Query expansion is non-fatal - just return original query
    return [query];
  }
}
