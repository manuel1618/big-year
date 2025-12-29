import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getFreshGoogleAccountsForUser } from "@/lib/google-accounts";

export const dynamic = "force-dynamic";

async function refreshGoogleAccessToken(refreshToken: string) {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    client_secret: process.env.GOOGLE_CLIENT_SECRET!,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
    cache: "no-store",
  });
  const data = await res.json();
  if (!res.ok) throw data;
  return {
    accessToken: data.access_token as string,
    expiresAtMs: Date.now() + (data.expires_in ? data.expires_in * 1000 : 3600 * 1000),
    refreshToken: (data.refresh_token as string) || undefined,
  };
}

async function mergeAccountsFromDbAndSession(userId: string, session: any) {
  // Load DB accounts (may refresh and persist)
  const dbAccounts = await getFreshGoogleAccountsForUser(userId);
  const sessAccs = Array.isArray(session?.googleAccounts) ? (session.googleAccounts as any[]) : [];
  const byId = new Map<
    string,
    {
      accountId: string;
      email?: string;
      accessToken?: string;
      refreshToken?: string;
      accessTokenExpires?: number;
      source: "db" | "session";
    }
  >();
  for (const a of dbAccounts) {
    byId.set(a.accountId, { ...a, source: "db" });
  }
  for (const a of sessAccs) {
    const existing = byId.get(a.accountId as string);
    const cand = {
      accountId: a.accountId as string,
      email: a.email as string | undefined,
      accessToken: a.accessToken as string | undefined,
      refreshToken: a.refreshToken as string | undefined,
      accessTokenExpires: a.accessTokenExpires as number | undefined,
      source: "session" as const,
    };
    if (!existing) {
      byId.set(cand.accountId, cand);
    } else {
      // Prefer a candidate that has a refresh token, otherwise the one with later expiry
      const preferSess =
        (!!cand.refreshToken && !existing.refreshToken) ||
        ((cand.accessTokenExpires || 0) > (existing.accessTokenExpires || 0));
      if (preferSess) byId.set(cand.accountId, cand);
    }
  }
  const now = Date.now() + 60_000;
  const merged: any[] = [];
  for (const entry of byId.values()) {
    let accessToken = entry.accessToken;
    let refreshToken = entry.refreshToken;
    let expiresAtMs = entry.accessTokenExpires;
    if ((!expiresAtMs || expiresAtMs < now) && refreshToken) {
      try {
        const refreshed = await refreshGoogleAccessToken(refreshToken);
        accessToken = refreshed.accessToken;
        expiresAtMs = refreshed.expiresAtMs;
        refreshToken = refreshed.refreshToken ?? refreshToken;
      } catch {
        // keep existing token on refresh failure
      }
    }
    if (accessToken) {
      merged.push({
        accountId: entry.accountId,
        email: entry.email,
        accessToken,
        refreshToken,
        accessTokenExpires: expiresAtMs,
      });
    }
  }
  return merged;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const debug = url.searchParams.get("debug") === "1";
  const session = await getServerSession(authOptions);
  if (!(session as any)?.user?.id) {
    return NextResponse.json({ calendars: [] }, { status: 200 });
  }
  let accounts = await mergeAccountsFromDbAndSession(
    (session as any).user.id as string,
    session as any
  );
  if (accounts.length === 0) {
    return NextResponse.json({ calendars: [] }, { status: 200 });
  }
  const fetches = accounts.map(async (acc: any) => {
    const url =
      "https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=reader&maxResults=250";
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${acc.accessToken}` },
      cache: "no-store",
    });
    const status = res.status;
    if (!res.ok) {
      let error: string | undefined;
      try {
        const errJson = await res.json();
        error = errJson?.error?.message || errJson?.error_description;
      } catch {}
      return {
        items: [] as any[],
        accountId: acc.accountId,
        email: acc.email,
        _debug: debug ? { status, error } : undefined,
      };
    }
    const data = await res.json();
    return {
      items: data.items || [],
      accountId: acc.accountId,
      email: acc.email,
      _debug: debug ? { status } : undefined,
    };
  });
  const results = await Promise.all(fetches);
  const calendars = results.flatMap((r) =>
    (r.items || []).map((c: any) => ({
      id: `${r.accountId}|${c.id as string}`,
      originalId: c.id as string,
      accountId: r.accountId,
      accountEmail: r.email,
      summary: (c.summary as string) || "(Untitled)",
      primary: !!c.primary,
      backgroundColor: c.backgroundColor as string | undefined,
      accessRole: c.accessRole as string | undefined,
    }))
  );
  if (debug) {
    const diag = results.map((r) => ({
      accountId: (r as any).accountId,
      ...(r as any)._debug,
    }));
    return NextResponse.json({ calendars, debug: diag });
  }
  return NextResponse.json({ calendars });
}

