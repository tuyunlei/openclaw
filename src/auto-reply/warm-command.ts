import { normalizeCommandBody } from "./commands-registry.js";

export function parseWarmCommand(raw?: string): {
  hasCommand: boolean;
  mode?: "on" | "off";
} {
  if (!raw) {
    return { hasCommand: false };
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return { hasCommand: false };
  }
  const normalized = normalizeCommandBody(trimmed);
  const match = normalized.match(/^\/warm(?:\s+([a-zA-Z]+))?\s*$/i);
  if (!match) {
    return { hasCommand: false };
  }
  const token = match[1]?.trim().toLowerCase();
  if (!token) {
    return { hasCommand: true };
  }
  if (token === "on") {
    return { hasCommand: true, mode: "on" };
  }
  if (token === "off") {
    return { hasCommand: true, mode: "off" };
  }
  return { hasCommand: true };
}
