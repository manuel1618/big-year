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
  const dbModule = await import("@/lib/google-accounts");
  const dbAccounts = await dbModule.getFreshGoogleAccountsForUser(userId);
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

function startOfYearIso(year: number) {
  return new Date(Date.UTC(year, 0, 1)).toISOString();
}
function endOfYearIso(year: number) {
  return new Date(Date.UTC(year + 1, 0, 1)).toISOString();
}

function isIsoDateOnly(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function addDaysIsoDateOnly(isoDate: string, days: number) {
  const [y, m, d] = isoDate.split("-").map((p) => parseInt(p, 10));
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  dt.setUTCDate(dt.getUTCDate() + days);
  const yy = dt.getUTCFullYear();
  const mm = `${dt.getUTCMonth() + 1}`.padStart(2, "0");
  const dd = `${dt.getUTCDate()}`.padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const year = parseInt(
    searchParams.get("year") || `${new Date().getFullYear()}`,
    10
  );
  const calendarIdsParam = searchParams.get("calendarIds") || "";
  const calendarIds = calendarIdsParam
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const session = await getServerSession(authOptions);
  if (!(session as any)?.user?.id) {
    return NextResponse.json({ events: [] }, { status: 200 });
  }

  let accounts = await mergeAccountsFromDbAndSession(
    (session as any).user.id as string,
    session as any
  );
  if (accounts.length === 0) {
    return NextResponse.json({ events: [] }, { status: 200 });
  }

  const params = new URLSearchParams({
    singleEvents: "true",
    orderBy: "startTime",
    timeMin: startOfYearIso(year),
    timeMax: endOfYearIso(year),
    maxResults: "2500",
  });

  // calendarIds are composite: `${accountId}|${calendarId}`
  const idsByAccount = new Map<string, string[]>();
  if (calendarIds.length > 0) {
    for (const comp of calendarIds) {
      const [accId, calId] = comp.split("|");
      if (!accId || !calId) continue;
      const arr = idsByAccount.get(accId) ?? [];
      arr.push(calId);
      idsByAccount.set(accId, arr);
    }
  }
  const fetches: Promise<any>[] = [];
  for (const acc of accounts) {
    let tokenToUse: string | undefined = acc.accessToken as string | undefined;
    const cals =
      idsByAccount.size > 0 ? idsByAccount.get(acc.accountId) || [] : ["primary"];
    for (const calId of cals) {
      const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
        calId
      )}/events?${params.toString()}`;
      fetches.push(
        (async () => {
          if (!tokenToUse) return { items: [], calendarId: calId, accountId: acc.accountId };
          const doFetch = async (accessToken: string) => {
            const res = await fetch(url, {
              headers: { Authorization: `Bearer ${accessToken}` },
              cache: "no-store",
            });
            if (!res.ok) return { ok: false as const, status: res.status, data: null as any };
            const data = await res.json();
            return { ok: true as const, status: res.status, data };
          };
          let attempt = await doFetch(tokenToUse);
          if (!attempt.ok && attempt.status === 401 && acc.refreshToken) {
            try {
              const refreshed = await refreshGoogleAccessToken(acc.refreshToken);
              tokenToUse = refreshed.accessToken;
              attempt = await doFetch(tokenToUse);
            } catch {}
          }
          if (!attempt.ok) return { items: [], calendarId: calId, accountId: acc.accountId };
          return {
            items: attempt.data.items || [],
            calendarId: calId,
            accountId: acc.accountId,
          };
        })()
      );
    }
  }
 
  const results = await Promise.all(fetches);
  const events = results.flatMap((r) =>
    (r.items || [])
      .filter((e: any) => e?.start?.date && e.status !== "cancelled")
      .map((e: any) => ({
        id: `${r.accountId || "primary"}|${r.calendarId || "primary"}:${e.id}`,
        calendarId: `${r.accountId || "primary"}|${r.calendarId || "primary"}`,
        summary: e.summary || "(Untitled)",
        startDate: e.start.date as string,
        endDate: e.end?.date as string,
      }))
  );

  return NextResponse.json({ events });
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!(session as any)?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const title = typeof body?.title === "string" ? body.title.trim() : "";
  const calendarIdComposite = typeof body?.calendarId === "string" ? body.calendarId.trim() : "";
  const startDate = body?.startDate;
  const endDate = body?.endDate; // inclusive, optional

  if (!title) {
    return NextResponse.json({ error: "Title is required" }, { status: 400 });
  }
  if (!calendarIdComposite.includes("|")) {
    return NextResponse.json({ error: "calendarId is required" }, { status: 400 });
  }
  if (!isIsoDateOnly(startDate)) {
    return NextResponse.json({ error: "startDate must be YYYY-MM-DD" }, { status: 400 });
  }
  if (endDate != null && !isIsoDateOnly(endDate)) {
    return NextResponse.json({ error: "endDate must be YYYY-MM-DD" }, { status: 400 });
  }
  if (isIsoDateOnly(endDate) && endDate < startDate) {
    return NextResponse.json({ error: "endDate must be on/after startDate" }, { status: 400 });
  }

  const [accountId, calendarId] = calendarIdComposite.split("|");
  if (!accountId || !calendarId) {
    return NextResponse.json({ error: "Invalid calendarId" }, { status: 400 });
  }

  let accounts = await mergeAccountsFromDbAndSession(
    (session as any).user.id as string,
    session as any
  );
  let account = accounts.find((a) => a.accountId === accountId);
  if (!account) {
    return NextResponse.json({ error: "Account not found" }, { status: 404 });
  }

  // Google all-day events require end.date to be exclusive.
  // UI sends endDate as inclusive; convert to exclusive.
  const endExclusive = addDaysIsoDateOnly(isIsoDateOnly(endDate) ? endDate : startDate, 1);

  const createUrl = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
    calendarId
  )}/events`;
  const createRes = await fetch(createUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${account.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      summary: title,
      start: { date: startDate },
      end: { date: endExclusive },
    }),
    cache: "no-store",
  });

  if (!createRes.ok) {
    let errText = "Failed to create event";
    try {
      const errJson = await createRes.json();
      errText = errJson?.error?.message || errJson?.error_description || errText;
    } catch {}
    return NextResponse.json({ error: errText }, { status: createRes.status });
  }

  const created = await createRes.json();
  return NextResponse.json({
    event: {
      id: `${accountId}|${calendarId}:${created.id as string}`,
      calendarId: `${accountId}|${calendarId}`,
      summary: (created.summary as string) || title,
      startDate,
      endDate: endExclusive,
    },
  });
}

export async function DELETE(req: Request) {
  const session = await getServerSession(authOptions);
  if (!(session as any)?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const compositeId = typeof body?.id === "string" ? body.id : "";
  // Expected format: `${accountId}|${calendarId}:${eventId}`
  const [accAndCal, eventId] = compositeId.split(":");
  const [accountId, calendarId] = (accAndCal || "").split("|");
  if (!accountId || !calendarId || !eventId) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const accounts = await mergeAccountsFromDbAndSession(
    (session as any).user.id as string,
    session as any
  );
  const account = accounts.find((a) => a.accountId === accountId);
  if (!account) {
    return NextResponse.json({ error: "Account not found" }, { status: 404 });
  }

  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
    calendarId
  )}/events/${encodeURIComponent(eventId)}`;
  let res = await fetch(url, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${account.accessToken}` },
    cache: "no-store",
  });
  if (res.status === 401 && account.refreshToken) {
    try {
      const refreshed = await refreshGoogleAccessToken(account.refreshToken);
      res = await fetch(url, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${refreshed.accessToken}` },
        cache: "no-store",
      });
    } catch {}
  }
  if (!res.ok && res.status !== 204) {
    let errText = "Failed to delete event";
    try {
      const errJson = await res.json();
      errText = errJson?.error?.message || errJson?.error_description || errText;
    } catch {}
    return NextResponse.json({ error: errText }, { status: res.status });
  }
  return NextResponse.json({ ok: true });
}

export async function PUT(req: Request) {
  const session = await getServerSession(authOptions);
  if (!(session as any)?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const compositeId = typeof body?.id === "string" ? body.id : "";
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  const calendarIdComposite = typeof body?.calendarId === "string" ? body.calendarId.trim() : "";
  const startDate = body?.startDate;
  const endDate = body?.endDate; // inclusive, optional

  // Expected format: `${accountId}|${calendarId}:${eventId}`
  const [accAndCal, eventId] = compositeId.split(":");
  const [oldAccountId, oldCalendarId] = (accAndCal || "").split("|");
  if (!oldAccountId || !oldCalendarId || !eventId) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  if (!title) {
    return NextResponse.json({ error: "Title is required" }, { status: 400 });
  }
  if (!calendarIdComposite.includes("|")) {
    return NextResponse.json({ error: "calendarId is required" }, { status: 400 });
  }
  if (!isIsoDateOnly(startDate)) {
    return NextResponse.json({ error: "startDate must be YYYY-MM-DD" }, { status: 400 });
  }
  if (endDate != null && !isIsoDateOnly(endDate)) {
    return NextResponse.json({ error: "endDate must be YYYY-MM-DD" }, { status: 400 });
  }
  if (isIsoDateOnly(endDate) && endDate < startDate) {
    return NextResponse.json({ error: "endDate must be on/after startDate" }, { status: 400 });
  }

  const [newAccountId, newCalendarId] = calendarIdComposite.split("|");
  if (!newAccountId || !newCalendarId) {
    return NextResponse.json({ error: "Invalid calendarId" }, { status: 400 });
  }

  const accounts = await mergeAccountsFromDbAndSession(
    (session as any).user.id as string,
    session as any
  );
  const oldAccount = accounts.find((a) => a.accountId === oldAccountId);
  const newAccount = accounts.find((a) => a.accountId === newAccountId);
  if (!oldAccount) {
    return NextResponse.json({ error: "Account not found" }, { status: 404 });
  }
  if (!newAccount) {
    return NextResponse.json({ error: "New account not found" }, { status: 404 });
  }

  // Google all-day events require end.date to be exclusive.
  // UI sends endDate as inclusive; convert to exclusive.
  const endExclusive = addDaysIsoDateOnly(isIsoDateOnly(endDate) ? endDate : startDate, 1);

  // If moving to a different calendar, we need to delete from old and create in new
  const isMovingCalendar = oldAccountId !== newAccountId || oldCalendarId !== newCalendarId;

  if (isMovingCalendar) {
    // Delete from old calendar
    const deleteUrl = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
      oldCalendarId
    )}/events/${encodeURIComponent(eventId)}`;
    let deleteRes = await fetch(deleteUrl, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${oldAccount.accessToken}` },
      cache: "no-store",
    });
    if (deleteRes.status === 401 && oldAccount.refreshToken) {
      try {
        const refreshed = await refreshGoogleAccessToken(oldAccount.refreshToken);
        deleteRes = await fetch(deleteUrl, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${refreshed.accessToken}` },
          cache: "no-store",
        });
      } catch {}
    }
    if (!deleteRes.ok && deleteRes.status !== 204) {
      let errText = "Failed to delete event from old calendar";
      try {
        const errJson = await deleteRes.json();
        errText = errJson?.error?.message || errJson?.error_description || errText;
      } catch {}
      return NextResponse.json({ error: errText }, { status: deleteRes.status });
    }

    // Create in new calendar
    const createUrl = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
      newCalendarId
    )}/events`;
    const createRes = await fetch(createUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${newAccount.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        summary: title,
        start: { date: startDate },
        end: { date: endExclusive },
      }),
      cache: "no-store",
    });

    if (!createRes.ok) {
      let errText = "Failed to create event in new calendar";
      try {
        const errJson = await createRes.json();
        errText = errJson?.error?.message || errJson?.error_description || errText;
      } catch {}
      return NextResponse.json({ error: errText }, { status: createRes.status });
    }

    const created = await createRes.json();
    return NextResponse.json({
      event: {
        id: `${newAccountId}|${newCalendarId}:${created.id as string}`,
        calendarId: `${newAccountId}|${newCalendarId}`,
        summary: (created.summary as string) || title,
        startDate,
        endDate: endExclusive,
      },
    });
  } else {
    // Update in place
    const updateUrl = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
      oldCalendarId
    )}/events/${encodeURIComponent(eventId)}`;
    const updateRes = await fetch(updateUrl, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${oldAccount.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        summary: title,
        start: { date: startDate },
        end: { date: endExclusive },
      }),
      cache: "no-store",
    });

    if (updateRes.status === 401 && oldAccount.refreshToken) {
      try {
        const refreshed = await refreshGoogleAccessToken(oldAccount.refreshToken);
        const retryRes = await fetch(updateUrl, {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${refreshed.accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            summary: title,
            start: { date: startDate },
            end: { date: endExclusive },
          }),
          cache: "no-store",
        });
        if (!retryRes.ok) {
          let errText = "Failed to update event";
          try {
            const errJson = await retryRes.json();
            errText = errJson?.error?.message || errJson?.error_description || errText;
          } catch {}
          return NextResponse.json({ error: errText }, { status: retryRes.status });
        }
        const updated = await retryRes.json();
        return NextResponse.json({
          event: {
            id: compositeId,
            calendarId: `${oldAccountId}|${oldCalendarId}`,
            summary: (updated.summary as string) || title,
            startDate,
            endDate: endExclusive,
          },
        });
      } catch {}
    }

    if (!updateRes.ok) {
      let errText = "Failed to update event";
      try {
        const errJson = await updateRes.json();
        errText = errJson?.error?.message || errJson?.error_description || errText;
      } catch {}
      return NextResponse.json({ error: errText }, { status: updateRes.status });
    }

    const updated = await updateRes.json();
    return NextResponse.json({
      event: {
        id: compositeId,
        calendarId: `${oldAccountId}|${oldCalendarId}`,
        summary: (updated.summary as string) || title,
        startDate,
        endDate: endExclusive,
      },
    });
  }
}


