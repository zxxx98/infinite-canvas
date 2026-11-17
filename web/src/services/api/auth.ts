import axios from "axios";

import {
    createModelChannel,
    defaultConfig,
    modelOptionsFromChannels,
    normalizeModelOptionValue,
    selectableModelsByCapability,
    useConfigStore,
    type AiConfig,
    type ModelCapability,
    type ModelChannel,
} from "@/stores/use-config-store";

export type UserRole = "admin" | "user";

export type AuthUser = {
    id: string;
    username: string;
    displayName: string;
    role: UserRole;
    disabled: boolean;
    createdAt: string;
    updatedAt: string;
};

export type AuthSession = {
    token: string;
    user: AuthUser;
};

export type AdminCreateUserPayload = {
    username: string;
    password: string;
    displayName?: string;
    role: UserRole;
};

export type AdminUpdateUserPayload = {
    displayName?: string;
    role?: UserRole;
    disabled?: boolean;
    password?: string;
};

function authHeaders(token: string) {
    return { Authorization: `Bearer ${token}` };
}

export function extractApiError(error: unknown, fallback: string) {
    if (axios.isAxiosError<{ message?: string }>(error)) {
        return error.response?.data?.message || error.message || fallback;
    }
    return error instanceof Error ? error.message : fallback;
}

export async function loginApi(payload: { username: string; password: string }): Promise<AuthSession> {
    const { data } = await axios.post<AuthSession>("/api/auth/login", payload);
    return data;
}

export async function fetchCurrentUserApi(token: string): Promise<AuthUser> {
    const { data } = await axios.get<{ user: AuthUser }>("/api/auth/me", { headers: authHeaders(token) });
    return data.user;
}

export async function changePasswordApi(token: string, payload: { currentPassword: string; newPassword: string }): Promise<AuthSession> {
    const { data } = await axios.put<AuthSession>("/api/auth/password", payload, { headers: authHeaders(token) });
    return data;
}

export async function fetchServerChannelsApi(token: string): Promise<ModelChannel[]> {
    const { data } = await axios.get<{ channels: ModelChannel[] }>("/api/channels", { headers: authHeaders(token) });
    return Array.isArray(data.channels) ? data.channels : [];
}

export async function saveServerChannelsApi(token: string, channels: ModelChannel[]): Promise<ModelChannel[]> {
    const { data } = await axios.put<{ channels: ModelChannel[] }>("/api/admin/channels", { channels }, { headers: authHeaders(token) });
    return Array.isArray(data.channels) ? data.channels : channels;
}

export async function fetchAdminUsersApi(token: string): Promise<AuthUser[]> {
    const { data } = await axios.get<{ users: AuthUser[] }>("/api/admin/users", { headers: authHeaders(token) });
    return data.users || [];
}

export async function createAdminUserApi(token: string, payload: AdminCreateUserPayload): Promise<AuthUser> {
    const { data } = await axios.post<{ user: AuthUser }>("/api/admin/users", payload, { headers: authHeaders(token) });
    return data.user;
}

export async function updateAdminUserApi(token: string, id: string, payload: AdminUpdateUserPayload): Promise<AuthUser> {
    const { data } = await axios.patch<{ user: AuthUser }>(`/api/admin/users/${encodeURIComponent(id)}`, payload, { headers: authHeaders(token) });
    return data.user;
}

export async function deleteAdminUserApi(token: string, id: string): Promise<void> {
    await axios.delete(`/api/admin/users/${encodeURIComponent(id)}`, { headers: authHeaders(token) });
}

function pickCapabilityModel(config: AiConfig, capability: ModelCapability, current: string) {
    const options = selectableModelsByCapability(config, capability);
    const normalized = normalizeModelOptionValue(current, config.channels);
    return options.includes(normalized) ? normalized : options[0] || "";
}

export function applyServerChannelsToStore(rawChannels: ModelChannel[], isAdmin: boolean) {
    const current = useConfigStore.getState().config;
    const normalized = rawChannels.map((item) => createModelChannel(item));
    const channels = normalized.length ? normalized : isAdmin ? defaultConfig.channels.map((item) => createModelChannel(item)) : [];
    const next: AiConfig = {
        ...current,
        channels,
        models: modelOptionsFromChannels(channels),
        baseUrl: channels[0]?.baseUrl || "",
        apiKey: channels[0]?.apiKey || "",
        apiFormat: channels[0]?.apiFormat || "openai",
    };
    useConfigStore.setState({
        config: {
            ...next,
            imageModel: pickCapabilityModel(next, "image", current.imageModel),
            videoModel: pickCapabilityModel(next, "video", current.videoModel),
            textModel: pickCapabilityModel(next, "text", current.textModel),
            audioModel: pickCapabilityModel(next, "audio", current.audioModel),
        },
    });
}
