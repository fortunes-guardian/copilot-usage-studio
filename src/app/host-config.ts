export type HostMode = 'browser' | 'vscode';

export interface CopilotUsageStudioHostConfig {
  mode?: HostMode;
  apiBaseUrl?: string;
  initialView?: string;
  allowedViews?: string[];
}

declare global {
  interface Window {
    __COPILOT_USAGE_STUDIO_HOST__?: CopilotUsageStudioHostConfig;
  }
}

export function hostConfig(): CopilotUsageStudioHostConfig {
  return globalThis.window?.__COPILOT_USAGE_STUDIO_HOST__ ?? {};
}

export function apiUrl(path: string): string {
  const baseUrl = hostConfig().apiBaseUrl?.replace(/\/+$/, '') ?? '';
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${baseUrl}${normalizedPath}`;
}

export function allowedHostViews(defaultViews: string[]): string[] {
  const allowed = hostConfig().allowedViews;
  return Array.isArray(allowed) && allowed.length ? allowed : defaultViews;
}
