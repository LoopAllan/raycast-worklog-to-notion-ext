const TICKET_PATTERN = /^(VIPOP|PMOJBVIP)-\d+$/;

/** Returns the upper-cased key, null when empty, and throws on an unsupported format. */
export function normalizeTicketKey(input: string): string | null {
  const key = input.trim().toUpperCase();
  if (key === "") {
    return null;
  }
  if (!TICKET_PATTERN.test(key)) {
    throw new Error(`Jira ticket 格式錯誤：「${input.trim()}」，應為 VIPOP-xxxxx 或 PMOJBVIP-xxxxx`);
  }
  return key;
}

export interface JiraCredentials {
  baseUrl: string;
  email: string;
  apiToken: string;
}

export async function fetchTicketSummary(key: string, { baseUrl, email, apiToken }: JiraCredentials): Promise<string> {
  if (!email || !apiToken) {
    throw new Error("尚未設定 Jira Email／API Token，請到 Extension Preferences 填寫");
  }

  const url = `${baseUrl.replace(/\/+$/, "")}/rest/api/3/issue/${encodeURIComponent(key)}?fields=summary`;
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      Authorization: `Basic ${Buffer.from(`${email}:${apiToken}`).toString("base64")}`,
    },
  });

  if (response.status === 404) {
    throw new Error(`找不到 Jira ticket ${key}（或沒有權限）`);
  }
  if (response.status === 401 || response.status === 403) {
    throw new Error(`Jira 驗證失敗（HTTP ${response.status}），請檢查 Email／API Token`);
  }
  if (!response.ok) {
    throw new Error(`讀取 Jira ticket ${key} 失敗：HTTP ${response.status}`);
  }

  const body = (await response.json()) as { fields?: { summary?: string } };
  const summary = body.fields?.summary?.trim();
  if (!summary) {
    throw new Error(`Jira ticket ${key} 沒有 summary`);
  }
  return summary;
}
