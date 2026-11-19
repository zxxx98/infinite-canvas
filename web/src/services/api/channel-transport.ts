import axios, { AxiosHeaders, type AxiosRequestConfig } from "axios";

import i18n from "@/i18n";
import { withLocalProxy, type AiConfig } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";

type ChannelConfig = Pick<AiConfig, "baseUrl" | "requestChannel">;

export function channelUrl(config: ChannelConfig, url: string) {
    const mode = config.requestChannel?.requestMode;
    return mode === "direct" || mode === "server" ? url : withLocalProxy(url, mode === "local");
}

function route(config: ChannelConfig, url: string) {
    const channel = config.requestChannel;
    if (channel?.requestMode !== "server") return { url: channelUrl(config, url) };

    const target = new URL(url);
    if (target.origin !== new URL(config.baseUrl).origin || target.username || target.password) {
        throw new Error(i18n.t("config.channelEditor.proxyTargetMismatch"));
    }
    const token = useUserStore.getState().token;
    if (!token) throw new Error(i18n.t("config.channelEditor.proxyLoginRequired"));
    return {
        url: `/api/proxy/${encodeURIComponent(channel.id)}/${encodeURIComponent(target.origin)}${target.pathname}${target.search}`,
        authorization: `Bearer ${token}`,
    };
}

export function channelAxios<T = unknown>(config: ChannelConfig, url: string, options: AxiosRequestConfig) {
    const routed = route(config, url);
    if (!routed.authorization) return axios.request<T>({ ...options, url: routed.url });
    const headers = AxiosHeaders.concat(options.headers);
    headers.set("X-Canvas-Proxy-Authorization", routed.authorization);
    return axios.request<T>({ ...options, baseURL: window.location.origin, url: routed.url, headers });
}

export function channelFetch(config: ChannelConfig, url: string, options: RequestInit) {
    const routed = route(config, url);
    if (!routed.authorization) return fetch(routed.url, options);
    const headers = new Headers(options.headers);
    headers.set("X-Canvas-Proxy-Authorization", routed.authorization);
    return fetch(routed.url, { ...options, headers, redirect: "error" });
}
