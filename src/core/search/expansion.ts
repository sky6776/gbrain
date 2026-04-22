/**
 * Query Expansion via LLM
 *
 * Uses an Anthropic-compatible API to expand user queries into
 * alternative search terms for better recall. Falls back to the
 * original query when expansion fails (non-fatal).
 *
 * Configurable via GBRAIN_ env vars for alternative providers.
 */

import Anthropic from '@anthropic-ai/sdk';

const EXPANSION_MODEL = process.env.GBRAIN_EXPANSION_MODEL || 'claude-haiku-4-5-20251001';
const MAX_ALTERNATIVES = 5;

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

export async function expandQuery(query: string): Promise<string[]> {
  try {
    if (!process.env.GBRAIN_ANTHROPIC_API_KEY) {
      return [query];
    }

    const response = await getClient().messages.create({
      model: EXPANSION_MODEL,
      max_tokens: 256,
      tools: [
        {
          name: 'submit_alternatives',
          description: 'Submit alternative search queries',
          input_schema: {
            type: 'object' as const,
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
      ],
      messages: [
        {
          role: 'user',
          content: `Generate up to ${MAX_ALTERNATIVES} alternative search queries that capture the same intent as: "${query}".
The alternatives should use different keywords, synonyms, or phrasings while preserving the core intent.
Return the alternatives using the submit_alternatives tool.`,
        },
      ],
    });

    // Extract tool use response
    const toolUse = response.content.find(block => block.type === 'tool_use');
    if (toolUse && toolUse.type === 'tool_use') {
      const input = toolUse.input as { alternatives?: string[] };
      if (input.alternatives && Array.isArray(input.alternatives)) {
        return [...new Set([query, ...input.alternatives])].slice(0, MAX_ALTERNATIVES + 1);
      }
    }

    return [query];
  } catch (e) {
    // Query expansion is non-fatal - just return original query
    return [query];
  }
}
