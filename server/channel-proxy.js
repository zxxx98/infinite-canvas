import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { pipeline } from "node:stream";

const requestHeaders = ["accept", "authorization", "content-type", "content-length", "x-goog-api-key", "openai-organization", "openai-project", "range"];
const responseHeaders = ["content-type", "content-encoding", "content-length", "content-range", "retry-after"];

function pickHeaders(headers, names) {
    return Object.fromEntries(names.filter((name) => headers[name] !== undefined).map((name) => [name, headers[name]]));
}

function readTarget(url, channels) {
    const [, , , id, origin, ...segments] = url.pathname.split("/");
    const channel = channels.find((item) => item?.id === decodeURIComponent(id || "") && item.requestMode === "server");
    if (!channel || typeof channel.baseUrl !== "string") return null;
    const base = new URL(channel.baseUrl);
    if (!["http:", "https:"].includes(base.protocol) || base.username || base.password || base.search || base.hash) return null;
    if (origin !== encodeURIComponent(base.origin)) return null;

    const pathname = `/${segments.join("/")}`;
    const decoded = decodeURIComponent(pathname);
    const prefix = decodeURIComponent(base.pathname).replace(/\/+$/, "");
    if (decoded.includes("//") || /[%\\;\u0000-\u001f\u007f]/.test(decoded) || decoded.split("/").some((segment) => segment === "." || segment === "..")) return null;
    if (!decoded.startsWith(`${prefix}/`)) return null;
    return { base, path: `${pathname}${url.search}` };
}

export function proxyChannel(req, res, url, channels, sendJson) {
    if (req.method !== "GET" && req.method !== "POST") return sendJson(res, 405, { message: "服务端代理只支持 GET 和 POST 请求" });
    let target;
    try {
        target = readTarget(url, channels);
    } catch {
        return sendJson(res, 400, { message: "代理渠道或请求路径无效" });
    }
    if (!target) return sendJson(res, 403, { message: "代理目标不属于已保存并启用服务端代理的渠道，请检查并保存渠道设置" });

    const { base, path } = target;
    const request = base.protocol === "https:" ? httpsRequest : httpRequest;
    const upstream = request(base, { path, method: req.method, headers: pickHeaders(req.headers, requestHeaders) }, (response) => {
        if (response.statusCode >= 300 && response.statusCode < 400) {
            response.destroy();
            return sendJson(res, 502, { message: "服务端代理不跟随上游重定向，请配置最终接口地址" });
        }
        res.writeHead(response.statusCode, {
            ...pickHeaders(response.headers, responseHeaders),
            "cache-control": "no-store",
            "content-security-policy": "sandbox; default-src 'none'",
            "x-content-type-options": "nosniff",
            "x-accel-buffering": "no",
        });
        res.flushHeaders();
        pipeline(response, res, () => {});
    });
    upstream.on("error", () => {
        if (res.destroyed || res.writableEnded) return;
        if (res.headersSent) res.destroy();
        else sendJson(res, 502, { message: "服务端无法连接渠道接口" });
    });
    res.once("close", () => {
        if (!res.writableFinished) upstream.destroy();
    });
    req.once("error", () => upstream.destroy());
    if (req.method === "POST") req.pipe(upstream);
    else upstream.end();
}
