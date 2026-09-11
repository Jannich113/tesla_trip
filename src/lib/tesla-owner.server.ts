import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { getCookie, setCookie } from "@tanstack/react-start/server";
import { env, isWorkspacePreview } from "@/lib/env.server";
import { OWNER_VIN, TESLA_OWNER_SCOPES, type TeslaOwnerStatus } from "@/lib/tesla-owner";

const SESSION_COOKIE = "juniper_owner";
const STATE_COOKIE = "juniper_owner_state";
const AUTH = "https://auth.tesla.com/oauth2/v3/authorize";
const TOKEN = "https://fleet-auth.prd.vn.cloud.tesla.com/oauth2/v3/token";
const DEFAULT_AUDIENCE = "https://fleet-api.prd.na.vn.cloud.tesla.com";

type OwnerSession = {
  sub: string;
  vin: string;
  teslaVehicleId: number;
  accessToken: string;
  refreshToken?: string;
  linkedAt: number;
  exp: number;
};

function clientId() {
  return env("TESLA_CLIENT_ID");
}

function clientSecret() {
  return env("TESLA_CLIENT_SECRET");
}

function audience() {
  return env("TESLA_AUDIENCE") ?? DEFAULT_AUDIENCE;
}

function signingKey() {
  return clientSecret() ?? env("TESLA_SESSION_SECRET") ?? "";
}

function isConfigured() {
  return Boolean(clientId() && clientSecret());
}

function redirectUri() {
  const explicit = env("TESLA_REDIRECT_URI");
  if (explicit) return explicit;
  const host = env("TESLA_PUBLIC_ORIGIN");
  if (host) return `${host.replace(/\/$/, "")}/api/tesla/callback`;
  return "";
}

function sign(value: string) {
  return createHmac("sha256", signingKey()).update(value).digest("base64url");
}

function writeCookie(name: string, value: string, maxAge: number) {
  setCookie(name, value, {
    httpOnly: true,
    sameSite: "lax",
    secure: !isWorkspacePreview(),
    path: "/",
    maxAge,
  });
}

function pack(payload: unknown, maxAge: number, name = SESSION_COOKIE) {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  writeCookie(name, `${body}.${sign(body)}`, maxAge);
}

function unpack<T>(raw: string | undefined): T | null {
  if (!raw || !signingKey()) return null;
  const dot = raw.lastIndexOf(".");
  if (dot < 1) return null;
  const body = raw.slice(0, dot);
  const mac = raw.slice(dot + 1);
  const expected = sign(body);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T;
  } catch {
    return null;
  }
}

function baseStatus(extra: Partial<TeslaOwnerStatus> = {}): TeslaOwnerStatus {
  return {
    configured: isConfigured(),
    linked: false,
    vin: OWNER_VIN,
    access: "owner",
    ...extra,
  };
}

export function readOwnerStatus(): TeslaOwnerStatus {
  if (!isConfigured()) return baseStatus({ reason: "not_configured" });
  const session = unpack<OwnerSession>(getCookie(SESSION_COOKIE));
  if (!session || session.vin !== OWNER_VIN || session.exp < Date.now() / 1000) {
    return baseStatus();
  }
  return {
    configured: true,
    linked: true,
    vin: session.vin,
    access: "owner",
    teslaVehicleId: session.teslaVehicleId,
    linkedAt: session.linkedAt,
  };
}

export function startOwnerLink(): { ok: true; url: string } | { ok: false; reason: TeslaOwnerStatus["reason"] } {
  if (!isConfigured()) return { ok: false, reason: "not_configured" };
  const redirect = redirectUri();
  if (!redirect) return { ok: false, reason: "not_configured" };
  const state = randomBytes(16).toString("hex");
  pack({ state }, 600, STATE_COOKIE);
  const url = new URL(AUTH);
  url.searchParams.set("client_id", clientId()!);
  url.searchParams.set("locale", "en-US");
  url.searchParams.set("prompt", "login");
  url.searchParams.set("redirect_uri", redirect);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", TESLA_OWNER_SCOPES.join(" "));
  url.searchParams.set("state", state);
  url.searchParams.set("show_keypair_step", "false");
  return { ok: true, url: url.toString() };
}

export function clearOwnerSession(): TeslaOwnerStatus {
  writeCookie(SESSION_COOKIE, "", 0);
  writeCookie(STATE_COOKIE, "", 0);
  return readOwnerStatus();
}

function isOwnerAccess(value: unknown) {
  if (!value || typeof value !== "string") return true;
  return value.toUpperCase() === "OWNER";
}

export async function completeOwnerLink(code: string, state: string): Promise<TeslaOwnerStatus["reason"] | "ok"> {
  if (!isConfigured()) return "not_configured";
  const pending = unpack<{ state: string }>(getCookie(STATE_COOKIE));
  writeCookie(STATE_COOKIE, "", 0);
  if (!pending || pending.state !== state) return "denied";
  const redirect = redirectUri();
  if (!redirect) return "not_configured";

  const tokenRes = await fetch(TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId()!,
      client_secret: clientSecret()!,
      code,
      audience: audience(),
      redirect_uri: redirect,
      scope: TESLA_OWNER_SCOPES.join(" "),
    }),
  });
  if (!tokenRes.ok) return "error";
  const token = (await tokenRes.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    id_token?: string;
  };
  if (!token.access_token) return "error";

  const listRes = await fetch(`${audience()}/api/1/vehicles`, {
    headers: { Authorization: `Bearer ${token.access_token}` },
  });
  if (!listRes.ok) return "error";
  const list = (await listRes.json()) as {
    response?: Array<{
      id?: number;
      vin?: string;
      access_type?: string;
    }>;
  };
  const match = list.response?.find((v) => v.vin === OWNER_VIN);
  if (!match) return "not_owner";
  if (!isOwnerAccess(match.access_type)) return "driver";

  const exp = Math.floor(Date.now() / 1000) + Math.max(60, token.expires_in ?? 3600);
  const session: OwnerSession = {
    sub: "tesla-owner",
    vin: OWNER_VIN,
    teslaVehicleId: match.id ?? 0,
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    linkedAt: Date.now(),
    exp,
  };
  pack(session, Math.max(60, token.expires_in ?? 3600));
  return "ok";
}
