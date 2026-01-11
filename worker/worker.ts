/**
 * Edge AI Gateway - Deployable Cloudflare Worker
 *
 * 安全的 AI API 代理，API Key 存储在 Cloudflare 环境变量中
 * 支持 Azure OpenAI、OpenAI、Cloudflare AI
 */

import { createProvider, type ProviderConfig } from '../src';

export interface Env {
  // 通用配置
  AI_PROVIDER: 'azure' | 'openai' | 'cloudflare';

  // Azure OpenAI
  AZURE_ENDPOINT?: string;
  AZURE_API_KEY?: string;
  AZURE_DEPLOYMENT?: string;
  AZURE_API_VERSION?: string;

  // OpenAI
  OPENAI_API_KEY?: string;
  OPENAI_BASE_URL?: string;
  OPENAI_ORGANIZATION?: string;

  // Cloudflare AI
  CF_ACCOUNT_ID?: string;
  CF_API_TOKEN?: string;
  CF_MODEL?: string;

  // 可选：客户端验证 Key
  CLIENT_API_KEY?: string;

  // 可选：允许的域名（CORS）
  ALLOWED_ORIGINS?: string;
}

// CORS 头
function getCorsHeaders(origin: string | null, allowedOrigins?: string): HeadersInit {
  const allowOrigin = allowedOrigins
    ? (allowedOrigins.split(',').includes(origin || '') ? origin : allowedOrigins.split(',')[0])
    : '*';

  return {
    'Access-Control-Allow-Origin': allowOrigin || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

// 创建 Provider 配置
function createProviderConfig(env: Env): ProviderConfig {
  switch (env.AI_PROVIDER) {
    case 'azure':
      return {
        type: 'azure',
        endpoint: env.AZURE_ENDPOINT || '',
        apiKey: env.AZURE_API_KEY || '',
        deployment: env.AZURE_DEPLOYMENT || 'gpt-4o',
        apiVersion: env.AZURE_API_VERSION || '2024-02-15-preview',
      };

    case 'openai':
      return {
        type: 'openai',
        apiKey: env.OPENAI_API_KEY || '',
        baseUrl: env.OPENAI_BASE_URL,
        organization: env.OPENAI_ORGANIZATION,
      };

    case 'cloudflare':
      return {
        type: 'cloudflare',
        accountId: env.CF_ACCOUNT_ID || '',
        apiToken: env.CF_API_TOKEN || '',
        model: env.CF_MODEL,
      };

    default:
      throw new Error(`Unknown provider: ${env.AI_PROVIDER}`);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get('Origin');
    const corsHeaders = getCorsHeaders(origin, env.ALLOWED_ORIGINS);

    // 处理 CORS 预检请求
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // 只接受 POST 请求
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 验证客户端 API Key（如果配置了）
    if (env.CLIENT_API_KEY) {
      const authHeader = request.headers.get('Authorization');
      if (authHeader !== `Bearer ${env.CLIENT_API_KEY}`) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    try {
      // 检查必要配置
      if (!env.AI_PROVIDER) {
        throw new Error('AI_PROVIDER environment variable is required');
      }

      const body = await request.json() as {
        messages: Array<{ role: string; content: string | object[] }>;
        model?: string;
        max_tokens?: number;
        temperature?: number;
        top_p?: number;
        stream?: boolean;
      };

      // 创建 Provider 并调用
      const config = createProviderConfig(env);
      const provider = createProvider(config);
      const response = await provider.chat(body);

      return new Response(JSON.stringify(response), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    } catch (error: any) {
      console.error('Worker error:', error);

      const status = error.message?.includes('Unauthorized') ? 401
        : error.message?.includes('not found') ? 404
        : 500;

      return new Response(JSON.stringify({
        error: error.message || 'Internal server error',
      }), {
        status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  },
};
