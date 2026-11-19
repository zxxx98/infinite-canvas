#!/usr/bin/env node
import { createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { proxyChannel } from "./channel-proxy.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3001);
const HOST = process.env.HOST || "0.0.0.0";
const DB_PATH = process.env.DB_PATH || resolve(__dirname, "data/app.db");
const STATIC_DIR = process.env.STATIC_DIR || resolve(__dirname, "../web/dist");

mkdirSync(dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        display_name TEXT NOT NULL DEFAULT '',
        role TEXT NOT NULL DEFAULT 'user',
        disabled INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS system_config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );
`);

function hashPassword(password) {
    const salt = randomBytes(16).toString("hex");
    const hash = scryptSync(String(password), salt, 64).toString("hex");
    return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
    const [salt, hash] = String(stored || "").split(":");
    if (!salt || !hash) return false;
    const expected = Buffer.from(hash, "hex");
    const actual = scryptSync(String(password), salt, 64);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function getSystemConfig(key, fallback = "") {
    const row = db.prepare("SELECT value FROM system_config WHERE key = ?").get(key);
    return row ? String(row.value) : fallback;
}

function setSystemConfig(key, value) {
    const now = new Date().toISOString();
    db.prepare(`
        INSERT INTO system_config (key, value, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(key, value, now);
}

function getAuthSecret() {
    if (process.env.AUTH_SECRET) return process.env.AUTH_SECRET;
    let secret = getSystemConfig("auth_secret");
    if (!secret) {
        secret = randomBytes(32).toString("hex");
        setSystemConfig("auth_secret", secret);
    }
    return secret;
}

const AUTH_SECRET = getAuthSecret();

function signToken(user) {
    const payload = Buffer.from(
        JSON.stringify({
            uid: user.id,
            ptag: String(user.password_hash).slice(-12),
            iat: Date.now(),
        }),
    ).toString("base64url");
    const sig = createHmac("sha256", AUTH_SECRET).update(payload).digest("base64url");
    return `${payload}.${sig}`;
}

function verifyToken(token) {
    const [payload, sig] = String(token || "").split(".");
    if (!payload || !sig) return null;
    const expectedSig = createHmac("sha256", AUTH_SECRET).update(payload).digest("base64url");
    const a = Buffer.from(sig);
    const b = Buffer.from(expectedSig);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    try {
        const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
        if (!data?.uid) return null;
        const user = db.prepare("SELECT * FROM users WHERE id = ?").get(data.uid);
        if (!user || user.disabled) return null;
        if (String(user.password_hash).slice(-12) !== data.ptag) return null;
        return user;
    } catch {
        return null;
    }
}

function toPublicUser(row) {
    return {
        id: String(row.id),
        username: String(row.username),
        displayName: String(row.display_name || row.username),
        role: row.role === "admin" ? "admin" : "user",
        disabled: Boolean(row.disabled),
        createdAt: String(row.created_at),
        updatedAt: String(row.updated_at),
    };
}

function ensureInitialAdmin() {
    const adminCount = db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin'").get()?.count || 0;
    if (adminCount > 0) return;
    const username = (process.env.ADMIN_USERNAME || "admin").trim();
    const password = process.env.ADMIN_PASSWORD || "admin123456";
    const now = new Date().toISOString();
    db.prepare(`
        INSERT INTO users (id, username, password_hash, display_name, role, disabled, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'admin', 0, ?, ?)
    `).run(randomUUID(), username, hashPassword(password), "管理员", now, now);
    console.log(`[canvas-server] Initialized default admin account: username="${username}" (password from ADMIN_PASSWORD or default "admin123456")`);
}

ensureInitialAdmin();

function sendJson(res, status, payload) {
    res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(payload));
}

function readJsonBody(req) {
    return new Promise((resolveBody, rejectBody) => {
        const chunks = [];
        req.on("data", (chunk) => chunks.push(chunk));
        req.on("end", () => {
            try {
                const raw = Buffer.concat(chunks).toString("utf8").trim();
                resolveBody(raw ? JSON.parse(raw) : {});
            } catch {
                rejectBody(new Error("请求体 JSON 格式无效"));
            }
        });
        req.on("error", rejectBody);
    });
}

function requireUser(req, res, header = req.headers.authorization || "") {
    const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    const user = verifyToken(token);
    if (!user) {
        sendJson(res, 401, { message: "未登录或登录已失效，请重新登录" });
        return null;
    }
    return user;
}

function requireAdmin(req, res) {
    const user = requireUser(req, res);
    if (!user) return null;
    if (user.role !== "admin") {
        sendJson(res, 403, { message: "需要管理员权限" });
        return null;
    }
    return user;
}

function readChannels() {
    const raw = getSystemConfig("channels", "[]");
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

async function handleApi(req, res, url) {
    const { pathname } = url;
    const method = req.method || "GET";

    if (pathname.startsWith("/api/proxy/")) {
        if (!requireUser(req, res, req.headers["x-canvas-proxy-authorization"] || "")) return;
        return proxyChannel(req, res, url, readChannels(), sendJson);
    }

    if (method === "POST" && pathname === "/api/auth/login") {
        const body = await readJsonBody(req);
        const username = String(body.username || "").trim();
        const password = String(body.password || "");
        if (!username || !password) return sendJson(res, 400, { message: "请输入用户名和密码" });
        const user = db.prepare("SELECT * FROM users WHERE username = ?").get(username);
        if (!user || !verifyPassword(password, user.password_hash)) {
            return sendJson(res, 401, { message: "用户名或密码错误" });
        }
        if (user.disabled) {
            return sendJson(res, 403, { message: "该账号已被禁用，请联系管理员" });
        }
        return sendJson(res, 200, { token: signToken(user), user: toPublicUser(user) });
    }

    if (method === "GET" && pathname === "/api/auth/me") {
        const user = requireUser(req, res);
        if (!user) return;
        return sendJson(res, 200, { user: toPublicUser(user) });
    }

    if (method === "PUT" && pathname === "/api/auth/password") {
        const user = requireUser(req, res);
        if (!user) return;
        const body = await readJsonBody(req);
        const currentPassword = String(body.currentPassword || "");
        const newPassword = String(body.newPassword || "").trim();
        if (!currentPassword || !newPassword) return sendJson(res, 400, { message: "请填写当前密码和新密码" });
        if (!verifyPassword(currentPassword, user.password_hash)) {
            return sendJson(res, 400, { message: "当前密码不正确" });
        }
        const now = new Date().toISOString();
        const nextHash = hashPassword(newPassword);
        db.prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?").run(nextHash, now, user.id);
        const updated = db.prepare("SELECT * FROM users WHERE id = ?").get(user.id);
        return sendJson(res, 200, { token: signToken(updated), user: toPublicUser(updated) });
    }

    if (method === "GET" && pathname === "/api/channels") {
        const user = requireUser(req, res);
        if (!user) return;
        return sendJson(res, 200, { channels: readChannels() });
    }

    if (method === "PUT" && pathname === "/api/admin/channels") {
        const admin = requireAdmin(req, res);
        if (!admin) return;
        const body = await readJsonBody(req);
        if (!Array.isArray(body.channels)) return sendJson(res, 400, { message: "渠道配置格式无效" });
        setSystemConfig("channels", JSON.stringify(body.channels));
        return sendJson(res, 200, { channels: body.channels });
    }

    if (method === "GET" && pathname === "/api/admin/users") {
        const admin = requireAdmin(req, res);
        if (!admin) return;
        const rows = db.prepare("SELECT * FROM users ORDER BY created_at ASC").all();
        return sendJson(res, 200, { users: rows.map(toPublicUser) });
    }

    if (method === "POST" && pathname === "/api/admin/users") {
        const admin = requireAdmin(req, res);
        if (!admin) return;
        const body = await readJsonBody(req);
        const username = String(body.username || "").trim();
        const password = String(body.password || "").trim();
        const displayName = String(body.displayName || "").trim() || username;
        const role = body.role === "admin" ? "admin" : "user";
        if (!username || !password) return sendJson(res, 400, { message: "用户名和密码不能为空" });
        const existing = db.prepare("SELECT id FROM users WHERE username = ?").get(username);
        if (existing) return sendJson(res, 409, { message: "该用户名已存在" });
        const id = randomUUID();
        const now = new Date().toISOString();
        db.prepare(`
            INSERT INTO users (id, username, password_hash, display_name, role, disabled, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, 0, ?, ?)
        `).run(id, username, hashPassword(password), displayName, role, now, now);
        const created = db.prepare("SELECT * FROM users WHERE id = ?").get(id);
        return sendJson(res, 201, { user: toPublicUser(created) });
    }

    const userMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)$/);
    if (userMatch) {
        const admin = requireAdmin(req, res);
        if (!admin) return;
        const targetId = decodeURIComponent(userMatch[1]);
        const target = db.prepare("SELECT * FROM users WHERE id = ?").get(targetId);
        if (!target) return sendJson(res, 404, { message: "账号不存在" });

        if (method === "PATCH") {
            const body = await readJsonBody(req);
            const nextRole = body.role !== undefined ? (body.role === "admin" ? "admin" : "user") : target.role;
            const nextDisabled = body.disabled !== undefined ? (body.disabled ? 1 : 0) : target.disabled;
            const nextDisplayName = body.displayName !== undefined ? String(body.displayName).trim() || target.username : target.display_name;
            const nextPassword = body.password !== undefined ? String(body.password).trim() : "";

            if (target.id === admin.id) {
                if (nextDisabled) return sendJson(res, 400, { message: "不能禁用当前登录的管理员账号" });
                if (nextRole !== "admin") return sendJson(res, 400, { message: "不能取消当前登录账号的管理员权限" });
            }
            if (target.role === "admin" && (nextRole !== "admin" || nextDisabled)) {
                const otherActiveAdmins = db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND disabled = 0 AND id != ?").get(target.id)?.count || 0;
                if (otherActiveAdmins === 0) return sendJson(res, 400, { message: "系统至少需要保留一个启用的管理员账号" });
            }

            const now = new Date().toISOString();
            const nextHash = nextPassword ? hashPassword(nextPassword) : target.password_hash;
            db.prepare(`
                UPDATE users
                SET display_name = ?, role = ?, disabled = ?, password_hash = ?, updated_at = ?
                WHERE id = ?
            `).run(nextDisplayName, nextRole, nextDisabled, nextHash, now, target.id);
            const updated = db.prepare("SELECT * FROM users WHERE id = ?").get(target.id);
            return sendJson(res, 200, { user: toPublicUser(updated) });
        }

        if (method === "DELETE") {
            if (target.id === admin.id) return sendJson(res, 400, { message: "不能删除当前登录的账号" });
            if (target.role === "admin") {
                const otherAdmins = db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND id != ?").get(target.id)?.count || 0;
                if (otherAdmins === 0) return sendJson(res, 400, { message: "系统至少需要保留一个管理员账号" });
            }
            db.prepare("DELETE FROM users WHERE id = ?").run(target.id);
            return sendJson(res, 200, { ok: true });
        }
    }

    return sendJson(res, 404, { message: "接口不存在" });
}

const MIME_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
};

function sanitizeAnalyticsId(value) {
    return String(value || "").replace(/[^A-Za-z0-9-]/g, "");
}

function serveStatic(req, res, pathname) {
    if (pathname === "/config.js") {
        const ga4 = sanitizeAnalyticsId(process.env.ANALYTICS_GA4_ID);
        const baidu = sanitizeAnalyticsId(process.env.ANALYTICS_BAIDU_ID);
        res.writeHead(200, {
            "content-type": "application/javascript; charset=utf-8",
            "cache-control": "no-store",
        });
        res.end(`window.__RUNTIME_CONFIG__ = {\n  ANALYTICS_GA4_ID: "${ga4}",\n  ANALYTICS_BAIDU_ID: "${baidu}"\n};\n`);
        return;
    }

    if (!existsSync(STATIC_DIR)) {
        sendJson(res, 404, { message: "Not Found" });
        return;
    }

    const safePath = normalize(decodeURIComponent(pathname)).replace(/^(\.\.(\/|\\|$))+/, "");
    let filePath = join(STATIC_DIR, safePath);
    if (!filePath.startsWith(STATIC_DIR)) {
        res.writeHead(403);
        res.end();
        return;
    }

    if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
        filePath = join(STATIC_DIR, "index.html");
    }
    if (!existsSync(filePath)) {
        sendJson(res, 404, { message: "Not Found" });
        return;
    }

    const ext = extname(filePath).toLowerCase();
    res.writeHead(200, { "content-type": MIME_TYPES[ext] || "application/octet-stream" });
    res.end(readFileSync(filePath));
}

const server = createServer((req, res) => {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    if (url.pathname.startsWith("/api/")) {
        handleApi(req, res, url).catch((error) => {
            const message = error instanceof Error ? error.message : "服务器内部错误";
            if (!res.headersSent) sendJson(res, 500, { message });
        });
        return;
    }
    serveStatic(req, res, url.pathname);
});

server.listen(PORT, HOST, () => {
    console.log(`[canvas-server] listening on http://${HOST}:${PORT} (db: ${DB_PATH})`);
});
