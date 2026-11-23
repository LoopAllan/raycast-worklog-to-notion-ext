import {
  Action,
  ActionPanel,
  Cache,
  Form,
  getPreferenceValues,
  popToRoot,
  showHUD,
  showToast,
  Toast,
} from "@raycast/api";
import { useEffect, useMemo, useRef, useState } from "react";
import { loadActionUsage, rankActions, recordActionUsage } from "./lib/action-usage";
import { buildEntryTree } from "./lib/entry";
import { fetchTicketSummary, normalizeTicketKey } from "./lib/jira";
import { loadJournalContext, type JournalContext } from "./lib/journal-context";
import { createNotionClient, isStaleContextError } from "./lib/notion";
import { latestEntryEnd } from "./lib/position";
import { parseSections, type Section } from "./lib/sections";
import { currentTimeSlot, normalizeTime, parseHhmm, resolveEndTime } from "./lib/time";
import { writeWorklog } from "./lib/write-worklog";

interface ExtensionPreferences {
  notionApiKey: string;
  notionDatabaseId: string;
  notionDateProperty?: string;
  jiraBaseUrl: string;
  jiraEmail?: string;
  jiraApiToken?: string;
  autoSections?: boolean;
  sectionMorningStart?: string;
  sectionLunchStart?: string;
  sectionAfternoonStart?: string;
  sectionOvertimeStart?: string;
}

interface FormValues {
  timeStart: string;
  timeEnd: string;
  action: string;
  ticket: string;
  description: string;
}

const preferences = getPreferenceValues<ExtensionPreferences>();
const notion = createNotionClient(preferences.notionApiKey);
const idCache = new Cache({ namespace: "notion-ids" });
const actionCache = new Cache({ namespace: "action-usage" });
const journalSettings = {
  databaseId: preferences.notionDatabaseId.trim(),
  dateProperty: preferences.notionDateProperty?.trim() || "Date",
};
const jiraCredentials = {
  baseUrl: preferences.jiraBaseUrl.trim(),
  email: preferences.jiraEmail ?? "",
  apiToken: preferences.jiraApiToken ?? "",
};

/** Validated section times when Auto Sections is on; throws so a bad time surfaces on submit. */
function configuredSections(): Section[] | null {
  if (!preferences.autoSections) {
    return null;
  }
  return parseSections({
    早上: preferences.sectionMorningStart ?? "",
    午休: preferences.sectionLunchStart ?? "",
    下午: preferences.sectionAfternoonStart ?? "",
    加班: preferences.sectionOvertimeStart ?? "",
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Starts a request now but defers its error to whoever awaits it, avoiding unhandled rejections. */
function prefetch<T>(task: () => Promise<T>): Promise<T> {
  const promise = task();
  promise.catch(() => undefined);
  return promise;
}

/** Returns the normalized value, or undefined plus an error when the input is invalid. */
function tryNormalize(value: string): { value?: string; error?: string } {
  try {
    return { value: normalizeTime(value) };
  } catch (error) {
    return { error: errorMessage(error) };
  }
}

export default function Command() {
  const [timeStart, setTimeStart] = useState(currentTimeSlot());
  const [timeEnd, setTimeEnd] = useState("");
  // Read once per form: the most used actions come first and the last one is preselected.
  const [actionUsage] = useState(() => loadActionUsage(actionCache));
  const rankedActions = useMemo(() => rankActions(actionUsage.counts), [actionUsage]);
  const [action, setAction] = useState(actionUsage.last);
  const [errors, setErrors] = useState<Partial<Record<keyof FormValues, string>>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [ticketLine, setTicketLine] = useState<string>();
  const [lastEndHint, setLastEndHint] = useState("載入中…");
  // Notion and Jira lookups run while the user is still typing, so submitting only has to write.
  const journalRef = useRef<Promise<JournalContext>>(undefined);
  const summariesRef = useRef(new Map<string, Promise<string>>());
  const latestTicketRef = useRef<string | null>(null);

  useEffect(() => {
    journalRef.current = prefetch(() => loadJournalContext(notion, journalSettings, idCache));
    // Only a hint: a failed lookup is reported properly on submit.
    journalRef.current.then(
      ({ rootBlocks }) => setLastEndHint(latestEntryEnd(rootBlocks) ?? "今天還沒有紀錄"),
      () => setLastEndHint("無法讀取"),
    );
  }, []);

  function ticketSummary(key: string): Promise<string> {
    let summary = summariesRef.current.get(key);
    if (!summary) {
      summary = prefetch(() => fetchTicketSummary(key, jiraCredentials));
      summariesRef.current.set(key, summary);
      // A failed lookup should be retried on the next attempt instead of being cached.
      summary.catch(() => summariesRef.current.delete(key));
    }
    return summary;
  }

  function prefetchTicket(value: string) {
    setTicketLine(undefined);
    let key: string | null;
    try {
      key = normalizeTicketKey(value);
      setErrors((prev) => ({ ...prev, ticket: undefined }));
    } catch (error) {
      setErrors((prev) => ({ ...prev, ticket: errorMessage(error) }));
      return;
    }
    latestTicketRef.current = key;
    if (key) {
      // Ignore a slower response for a ticket the user has already replaced.
      const isLatest = () => latestTicketRef.current === key;
      ticketSummary(key).then(
        (summary) => isLatest() && setTicketLine(`${key} ${summary}`),
        (error: unknown) => isLatest() && setErrors((prev) => ({ ...prev, ticket: errorMessage(error) })),
      );
    }
  }

  const preview = useMemo(() => {
    try {
      const root = `${normalizeTime(timeStart)} - ${resolveEndTime({ start: timeStart, end: timeEnd })} ${action}`;
      return ticketLine ? `${root}\n    ${ticketLine}` : root;
    } catch (error) {
      return `⚠️ ${errorMessage(error)}`;
    }
  }, [timeStart, timeEnd, action, ticketLine]);

  function normalizeTimeField(field: "timeStart" | "timeEnd", value: string, setter: (value: string) => void) {
    if (field === "timeEnd" && value.trim() === "") {
      setErrors((prev) => ({ ...prev, timeEnd: undefined }));
      return;
    }
    const result = tryNormalize(value);
    if (result.value) {
      setter(result.value);
    }
    setErrors((prev) => ({ ...prev, [field]: result.error }));
  }

  async function handleSubmit(values: FormValues) {
    if (isSubmitting) {
      return;
    }
    setIsSubmitting(true);
    const toast = await showToast({ style: Toast.Style.Animated, title: "寫入 Notion 中…" });

    try {
      const start = normalizeTime(values.timeStart);
      const end = resolveEndTime({ start, end: values.timeEnd });
      const ticketKey = normalizeTicketKey(values.ticket);

      const journal = journalRef.current ?? loadJournalContext(notion, journalSettings, idCache);
      const [summary, context] = await Promise.all([ticketKey ? ticketSummary(ticketKey) : undefined, journal]);
      const entry = buildEntryTree({
        start,
        end,
        action: values.action,
        ticketLine: ticketKey ? `${ticketKey} ${summary}` : undefined,
        description: values.description,
      });

      const now = new Date();
      const write = (journalContext: JournalContext) =>
        writeWorklog(notion, journalContext, {
          entry,
          startMinutes: parseHhmm(start),
          sections: configuredSections(),
          nowMinutes: now.getHours() * 60 + now.getMinutes(),
        });

      try {
        await write(context);
      } catch (error) {
        if (!isStaleContextError(error)) {
          throw error;
        }
        // The page changed after the form opened (or the cached page is gone): reload once and retry.
        journalRef.current = undefined;
        await write(await loadJournalContext(notion, journalSettings, idCache));
      }

      recordActionUsage(actionCache, values.action);
      await showHUD(`✅ 已寫入 ${entry.text}`);
      await popToRoot({ clearSearchBar: true });
    } catch (error) {
      toast.style = Toast.Style.Failure;
      toast.title = "寫入失敗";
      toast.message = errorMessage(error);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Form
      isLoading={isSubmitting}
      actions={
        <ActionPanel>
          <Action.SubmitForm title="寫入 Notion" onSubmit={handleSubmit} />
        </ActionPanel>
      }
    >
      <Form.Description title="預覽" text={`${preview}\n\n上一筆結束：${lastEndHint}`} />
      <Form.TextField
        id="timeStart"
        title="Time Start"
        placeholder="mmii，例如 1110"
        info="以 5 分鐘為單位四捨五入"
        value={timeStart}
        error={errors.timeStart}
        onChange={setTimeStart}
        onBlur={(event) => normalizeTimeField("timeStart", event.target.value ?? "", setTimeStart)}
      />
      <Form.TextField
        id="timeEnd"
        title="Time End"
        placeholder="mmii，例如 1140"
        info="以 5 分鐘為單位四捨五入，必須大於 Time Start"
        value={timeEnd}
        error={errors.timeEnd}
        onChange={setTimeEnd}
        onBlur={(event) => normalizeTimeField("timeEnd", event.target.value ?? "", setTimeEnd)}
      />
      <Form.Dropdown id="action" title="Action" value={action} onChange={setAction}>
        {rankedActions.map((item) => (
          <Form.Dropdown.Item key={item} value={item} title={item} />
        ))}
      </Form.Dropdown>
      <Form.TextField
        id="ticket"
        title="Jira Ticket"
        placeholder="VIPOP-xxxxx / PMOJBVIP-xxxxx（選填）"
        error={errors.ticket}
        onBlur={(event) => prefetchTicket(event.target.value ?? "")}
      />
      <Form.TextArea
        id="description"
        title="Description"
        placeholder={[
          "每一行是一個 block，空行會略過",
          "- 「- 」或「* 」開頭會變成項目符號",
          "    縮排（空白或 Tab）的行會掛到上一行底下",
          "    - 縮排的項目符號也可以",
          "        可以一直往下縮",
          "回到最左邊就是新的一行",
        ].join("\n")}
      />
    </Form>
  );
}
