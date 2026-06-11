const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

function withBase(url: string): string {
  if (/^https?:\/\//.test(url)) return url;
  return `${BASE}${url}`;
}

export async function fetcher<T>(url: string): Promise<T> {
  const res = await fetch(withBase(url), { credentials: "same-origin" });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${text}`);
  }
  return res.json() as Promise<T>;
}

export async function postJson<T>(
  url: string,
  body: unknown,
  method = "POST",
): Promise<T> {
  const res = await fetch(withBase(url), {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${text}`);
  }
  return res.json() as Promise<T>;
}

export async function del(url: string): Promise<void> {
  const res = await fetch(withBase(url), { method: "DELETE" });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${text}`);
  }
}
