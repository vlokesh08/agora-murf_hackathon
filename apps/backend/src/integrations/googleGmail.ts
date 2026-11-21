const API_BASE = "https://www.googleapis.com/gmail/v1/users/me";

async function callApi<T>(accessToken: string, path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`Gmail API error (${res.status}): ${await res.text()}`);
  }
  return res.json() as Promise<T>;
}

function header(headers: { name: string; value: string }[] | undefined, name: string) {
  return headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
}

interface GmailMessageList {
  messages?: { id: string }[];
}

interface GmailMessage {
  id: string;
  snippet?: string;
  payload?: { headers?: { name: string; value: string }[] };
}

/** Lists a given day's inbox messages (from/subject/snippet), newest first. `dateIso` is "YYYY-MM-DD". */
export async function listMessagesForDate(accessToken: string, dateIso: string) {
  const [year, month, day] = dateIso.split("-").map(Number);
  const start = new Date(year, month - 1, day);
  const end = new Date(year, month - 1, day + 1);
  const fmt = (d: Date) =>
    `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;

  const q = encodeURIComponent(`after:${fmt(start)} before:${fmt(end)}`);
  const list = await callApi<GmailMessageList>(accessToken, `/messages?q=${q}&maxResults=15`);
  const ids = list.messages ?? [];

  const fullMessages = await Promise.all(
    ids.map((m) =>
      callApi<GmailMessage>(
        accessToken,
        `/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`
      )
    )
  );

  return fullMessages.map((m) => ({
    id: m.id,
    from: header(m.payload?.headers, "From"),
    subject: header(m.payload?.headers, "Subject"),
    snippet: m.snippet ?? "",
  }));
}
