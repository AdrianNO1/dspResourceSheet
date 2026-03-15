import type { BootstrapData } from "./types";

async function request<T>(url: string, init?: RequestInit) {
  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    ...init,
  });

  const payload = (await response.json()) as T | { error?: unknown };

  if (!response.ok) {
    const errorMessage =
      typeof payload === "object" && payload && "error" in payload
        ? JSON.stringify(payload.error)
        : "Request failed";
    throw new Error(errorMessage);
  }

  return payload as T;
}

export function getBootstrap() {
  return request<BootstrapData>("/api/bootstrap");
}

export function postBootstrap(url: string, body: unknown, method = "POST") {
  return request<BootstrapData>(url, {
    method,
    body: JSON.stringify(body),
  });
}

export function patchBootstrap(url: string, body: unknown) {
  return postBootstrap(url, body, "PATCH");
}

export function putBootstrap(url: string, body: unknown) {
  return postBootstrap(url, body, "PUT");
}

export function deleteBootstrap(url: string) {
  return request<BootstrapData>(url, { method: "DELETE" });
}

export function exportSnapshot() {
  return request<{ exportPath: string; snapshot: unknown }>("/api/export");
}

export function importSnapshot(snapshot: unknown) {
  return postBootstrap("/api/import", snapshot);
}
