import type { ModelChannel } from "@/stores/use-config-store";

export const PIPIWANG_BASE_URL = "https://img.pipiwangcom.com";

export const PIPIWANG_IMAGE_SCRIPT = `/**
 * 皮皮智绘 · 生图 API (GPT image-1 / Grok image-2)
 * - 文生图：POST /api/v1/images/generations (JSON)
 * - 图改图：POST /api/v1/images/edits (multipart/form-data 或 JSON)
 * - 异步/超时兜底：GET /api/v1/tasks/{task_id}
 */
function resolveApiBase(rawBaseUrl) {
  const cleaned = String(rawBaseUrl || "${PIPIWANG_BASE_URL}")
    .trim()
    .replace(/\\/+$/, "")
    .replace(/\\/(?:api\\/v1|v1|api)$/i, "");
  return \`\${cleaned}/api/v1\`;
}

function extractUrls(payload) {
  const list = Array.isArray(payload?.data)
    ? payload.data
    : Array.isArray(payload?.result?.data)
      ? payload.result.data
      : Array.isArray(payload?.images)
        ? payload.images
        : [];
  const urls = [];
  for (const item of list) {
    if (typeof item === "string" && item) {
      urls.push(item);
    } else if (item?.b64_json) {
      urls.push(\`data:image/png;base64,\${item.b64_json}\`);
    } else if (item?.url) {
      urls.push(item.url);
    }
  }
  return urls;
}

function extractTaskId(payload) {
  if (!payload || typeof payload !== "object") return null;
  return payload.task_id ?? payload.detail?.task_id ?? payload.data?.task_id ?? null;
}

function extractErrorMessage(payload, fallback) {
  if (!payload) return fallback;
  if (typeof payload === "string") return payload;
  if (typeof payload.detail === "string") return payload.detail;
  if (typeof payload.detail?.message === "string") return payload.detail.message;
  if (typeof payload.error?.message === "string") return payload.error.message;
  if (typeof payload.message === "string") return payload.message;
  return fallback;
}

async function pollTaskResult({ apiBase, taskId, headers, request, poll }) {
  return await poll(
    async () => {
      const state = await request({
        method: "get",
        url: \`\${apiBase}/tasks/\${encodeURIComponent(String(taskId))}\`,
        headers,
      });
      const status = String(state?.status || state?.data?.status || "").toLowerCase();
      if (status === "failed" || status === "error" || status === "cancelled") {
        throw new Error(extractErrorMessage(state, \`任务 \${taskId} 生成失败\`));
      }
      const urls = extractUrls(state);
      return urls.length > 0 ? urls : null;
    },
    (urls) => urls,
    { intervalMs: 3000, timeoutMs: 1900 * 1000 },
  );
}

async function generateImage({
  prompt,
  images,
  params: {
    size,
    quality,
    count,
  },
  model,
  baseUrl,
  apiKey,
  request,
  poll,
}) {
  const apiBase = resolveApiBase(baseUrl);
  const targetModel = (model || "image-1").trim();
  const isGrok = targetModel === "image-2" || targetModel.toLowerCase().includes("grok");
  const n = Math.min(4, Math.max(1, Number(count) || 1));
  const resolvedSize = size && size !== "auto" && /^\\d+x\\d+$/i.test(size) ? size : "1024x1024";
  const resolvedQuality = isGrok ? "1k" : (quality || "auto");
  const headers = {
    Authorization: \`Bearer \${apiKey}\`,
  };

  let responseData;
  try {
    if (!images || images.length === 0) {
      responseData = await request({
        method: "post",
        url: \`\${apiBase}/images/generations\`,
        headers: {
          ...headers,
          "Content-Type": "application/json",
        },
        timeout: 1900 * 1000,
        data: {
          model: targetModel,
          prompt,
          n,
          size: resolvedSize,
          quality: resolvedQuality,
          response_format: "url",
        },
      });
    } else {
      const refImages = images.slice(0, 4);
      const canUseMultipart = refImages.every((item) => /^data:|^blob:/i.test(item));
      if (canUseMultipart) {
        const form = new FormData();
        form.set("model", targetModel);
        form.set("prompt", prompt);
        form.set("n", String(n));
        form.set("size", resolvedSize);
        form.set("quality", resolvedQuality);
        form.set("response_format", "url");
        const fieldName = refImages.length > 1 ? "image[]" : "image";
        for (let i = 0; i < refImages.length; i++) {
          const blob = await (await fetch(refImages[i])).blob();
          form.append(fieldName, blob, \`reference_\${i + 1}.png\`);
        }
        responseData = await request({
          method: "post",
          url: \`\${apiBase}/images/edits\`,
          headers,
          timeout: 1900 * 1000,
          data: form,
        });
      } else {
        responseData = await request({
          method: "post",
          url: \`\${apiBase}/images/edits\`,
          headers: {
            ...headers,
            "Content-Type": "application/json",
          },
          timeout: 1900 * 1000,
          data: {
            model: targetModel,
            prompt,
            n,
            size: resolvedSize,
            quality: resolvedQuality,
            response_format: "url",
            ...(refImages.length === 1
              ? { image: { url: refImages[0] } }
              : { images: refImages.map((url) => ({ url })) }),
          },
        });
      }
    }
  } catch (error) {
    const errPayload = error?.response?.data;
    const taskId = extractTaskId(errPayload);
    if (taskId) {
      return await pollTaskResult({ apiBase, taskId, headers, request, poll });
    }
    throw new Error(extractErrorMessage(errPayload, error?.message || "生图请求失败"));
  }

  const urls = extractUrls(responseData);
  if (urls.length > 0) return urls;

  const taskId = extractTaskId(responseData);
  if (taskId) {
    return await pollTaskResult({ apiBase, taskId, headers, request, poll });
  }

  throw new Error(extractErrorMessage(responseData, "未返回有效图片结果"));
}

return await generateImage({
  prompt,
  images,
  params,
  model,
  baseUrl,
  apiKey,
  request,
  poll,
});`;

export function applyPipiwangChannelPreset(channel: ModelChannel): ModelChannel {
    const isDefaultUrl = !channel.baseUrl.trim() || channel.baseUrl.includes("api.openai.com") || channel.baseUrl.includes("generativelanguage.googleapis.com");
    const isDefaultName = !channel.name.trim() || /^(默认渠道|新渠道|渠道\s*\d+|Default|Channel\s*\d+)$/i.test(channel.name.trim());
    const presetModels = ["image-1", "image-2"];
    const existingMap = new Map(channel.models.map((item) => [item.name, item]));
    for (const name of presetModels) {
        existingMap.set(name, {
            name,
            capability: "image",
            script: PIPIWANG_IMAGE_SCRIPT,
        });
    }
    return {
        ...channel,
        name: isDefaultName ? "皮皮智绘" : channel.name,
        baseUrl: isDefaultUrl ? PIPIWANG_BASE_URL : channel.baseUrl,
        apiFormat: "openai",
        models: Array.from(existingMap.values()),
    };
}
