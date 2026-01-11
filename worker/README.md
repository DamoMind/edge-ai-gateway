# Edge AI Gateway - Cloudflare Worker

可部署的 AI API 代理，API Key 安全存储在 Cloudflare 环境变量中。

## 特性

- 🔐 **安全**：API Key 存储在 Cloudflare Secrets，不暴露给客户端
- 🌐 **多 Provider**：支持 Azure OpenAI、OpenAI、Cloudflare AI
- ⚡ **边缘部署**：全球 Cloudflare 网络，低延迟
- 🔑 **客户端验证**：可选的 API Key 验证
- 🌍 **CORS 支持**：支持浏览器/扩展直接调用

## 快速部署

### 1. 安装 Wrangler

```bash
npm install -g wrangler
```

### 2. 登录 Cloudflare

```bash
wrangler login
```

### 3. 配置环境变量

编辑 `wrangler.toml`：

```toml
[vars]
AI_PROVIDER = "azure"  # 或 "openai" / "cloudflare"
AZURE_ENDPOINT = "https://your-resource.openai.azure.com"
AZURE_DEPLOYMENT = "gpt-4o"
```

### 4. 设置敏感变量

```bash
# Azure OpenAI
wrangler secret put AZURE_API_KEY

# 或 OpenAI
wrangler secret put OPENAI_API_KEY

# 或 Cloudflare AI
wrangler secret put CF_API_TOKEN

# 可选：客户端验证 Key
wrangler secret put CLIENT_API_KEY
```

### 5. 部署

```bash
wrangler deploy
```

部署成功后获得 URL：
```
https://edge-ai-gateway.your-account.workers.dev
```

## API 使用

### 请求

```bash
curl -X POST https://edge-ai-gateway.your-account.workers.dev \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-client-api-key" \
  -d '{
    "messages": [
      {"role": "system", "content": "You are a helpful assistant."},
      {"role": "user", "content": "Hello!"}
    ],
    "max_tokens": 100,
    "temperature": 0.7
  }'
```

### 响应

OpenAI 兼容格式：

```json
{
  "id": "chatcmpl-xxx",
  "object": "chat.completion",
  "created": 1234567890,
  "model": "gpt-4o",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "Hello! How can I help you today?"
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 20,
    "completion_tokens": 10,
    "total_tokens": 30
  }
}
```

## 环境变量

### 通用

| 变量 | 必需 | 说明 |
|------|------|------|
| `AI_PROVIDER` | ✅ | Provider 类型：`azure` / `openai` / `cloudflare` |
| `CLIENT_API_KEY` | ❌ | 客户端验证 Key（推荐设置） |
| `ALLOWED_ORIGINS` | ❌ | 允许的域名（CORS） |

### Azure OpenAI

| 变量 | 必需 | 说明 |
|------|------|------|
| `AZURE_ENDPOINT` | ✅ | Azure OpenAI 端点 |
| `AZURE_API_KEY` | ✅ | Azure API Key（用 secret 设置） |
| `AZURE_DEPLOYMENT` | ✅ | 模型部署名 |
| `AZURE_API_VERSION` | ❌ | API 版本（默认 2024-02-15-preview） |

### OpenAI

| 变量 | 必需 | 说明 |
|------|------|------|
| `OPENAI_API_KEY` | ✅ | OpenAI API Key（用 secret 设置） |
| `OPENAI_BASE_URL` | ❌ | API 基础 URL |
| `OPENAI_ORGANIZATION` | ❌ | 组织 ID |

### Cloudflare AI

| 变量 | 必需 | 说明 |
|------|------|------|
| `CF_ACCOUNT_ID` | ✅ | Cloudflare 账户 ID |
| `CF_API_TOKEN` | ✅ | API Token（用 secret 设置） |
| `CF_MODEL` | ❌ | 模型名（默认 llama-3.1-8b） |

## 在 Chrome 扩展中使用

```typescript
const response = await fetch('https://edge-ai-gateway.xxx.workers.dev', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer your-client-api-key',
  },
  body: JSON.stringify({
    messages: [
      { role: 'user', content: 'Hello!' }
    ],
    max_tokens: 100,
  }),
});

const data = await response.json();
console.log(data.choices[0].message.content);
```

## 安全建议

1. **始终设置 `CLIENT_API_KEY`**：防止未授权访问
2. **限制 `ALLOWED_ORIGINS`**：只允许你的域名/扩展
3. **使用 `wrangler secret`**：不要在 wrangler.toml 中明文存储 Key
4. **监控使用量**：在 Cloudflare Dashboard 查看请求统计
