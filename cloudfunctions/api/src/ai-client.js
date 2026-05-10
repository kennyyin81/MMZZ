const https = require("https");

const DEFAULT_ENDPOINT = "https://tokenhub.tencentmaas.com/v1/chat/completions";
const DEFAULT_MODEL = "deepseek-v4-flash";

function getAIConfig() {
  return {
    endpoint: process.env.TOKENHUB_BASE_URL || process.env.AI_CHAT_COMPLETIONS_URL || DEFAULT_ENDPOINT,
    apiKey: process.env.TOKENHUB_API_KEY || process.env.AI_API_KEY || "",
    model: process.env.TOKENHUB_MODEL || process.env.AI_MODEL || DEFAULT_MODEL,
    timeoutMs: Number(process.env.AI_TIMEOUT_MS || 25000)
  };
  
}

function postJson(url, headers, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const req = https.request(
      {
        method: "POST",
        hostname: target.hostname,
        port: target.port || 443,
        path: `${target.pathname}${target.search}`,
        headers: {
          "Content-Type": "application/json",
          ...headers
        },
        timeout: timeoutMs
      },
      (res) => {
        let raw = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          raw += chunk;
        });
        res.on("end", () => {
          let data = null;
          try {
            data = raw ? JSON.parse(raw) : null;
          } catch (error) {
            reject(new Error(`AI 返回非 JSON：${raw.slice(0, 120)}`));
            return;
          }

          if (res.statusCode < 200 || res.statusCode >= 300) {
            const message = (data && (data.error && (data.error.message || data.error.code))) || raw || `HTTP ${res.statusCode}`;
            reject(new Error(`AI 调用失败：${message}`));
            return;
          }

          resolve(data);
        });
      }
    );

    req.on("timeout", () => {
      req.destroy(new Error("AI 调用超时"));
    });
    req.on("error", reject);
    req.write(JSON.stringify(body));
    req.end();
  });
}

function normalizeMessages(systemPrompt, messages) {
  const list = [];
  const systemText = String(systemPrompt || "").trim();
  if (systemText) {
    list.push({ role: "system", content: systemText });
  }

  (Array.isArray(messages) ? messages : []).forEach((item) => {
    const role = ["system", "user", "assistant"].includes(item && item.role) ? item.role : "user";
    const content = String((item && item.content) || "").trim();
    if (content) {
      list.push({ role, content });
    }
  });

  return list;
}

async function callLLM(systemPrompt, messages, options) {
  const config = getAIConfig();
  if (!config.apiKey) {
    throw new Error("缺少 TOKENHUB_API_KEY 环境变量");
  }

  const payload = {
    model: (options && options.model) || config.model,
    messages: normalizeMessages(systemPrompt, messages),
    stream: false
  };

  if (options && typeof options.temperature === "number") {
    payload.temperature = options.temperature;
  }
  if (options && typeof options.max_tokens === "number") {
    payload.max_tokens = options.max_tokens;
  }

  const data = await postJson(
    config.endpoint,
    { Authorization: `Bearer ${config.apiKey}` },
    payload,
    config.timeoutMs
  );

  const content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (!content) {
    throw new Error("AI 返回内容为空");
  }
  return String(content).trim();
}

function safeParseAIJson(raw) {
  const text = String(raw || "").trim();
  if (!text) {
    return {
      intent: "chitchat",
      reply: "抱歉，我遇到了一点问题，请再试一次~",
      recommended_bar_ids: [],
      follow_up_question: ""
    };
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const jsonText = fenced ? fenced[1] : ((text.match(/\{[\s\S]*\}/) || [])[0] || "");
    if (jsonText) {
      try {
        return JSON.parse(jsonText);
      } catch (innerError) {}
    }
  }

  return {
    intent: "chitchat",
    reply: text || "抱歉，我遇到了一点问题，请再试一次~",
    recommended_bar_ids: [],
    follow_up_question: ""
  };
}

module.exports = {
  callLLM,
  safeParseAIJson,
  getAIConfig
};
