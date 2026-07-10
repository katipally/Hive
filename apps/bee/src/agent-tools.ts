import type { AgentTool } from "@hive/shared/agent";
import type { ContextBlock } from "@hive/shared";

// Tools the bee agent can call mid-turn. Each is a thin HTTP call to hive — the
// bee holds no data and no keys. The disclosure gate is enforced SERVER-SIDE:
// `recall` goes through link.context(), which hive already runs through the
// disclosure agent before any cross-member fact crosses the wire. That keeps the
// trust boundary in hive (not a client-side hook), which is correct for a keyless
// client — openclaw's beforeToolCall pattern, realized where the data lives.
export function makeBeeTools(deps: {
  hiveHttpUrl: string;
  memberId: string;
  recall: (query: string) => Promise<ContextBlock[]>;
}): AgentTool[] {
  const { hiveHttpUrl, memberId, recall } = deps;
  const hive = (path: string, init?: RequestInit) => fetch(`${hiveHttpUrl}${path}`, init);

  return [
    {
      spec: {
        name: "recall",
        description:
          "Search the hive for facts relevant to a question — the member's own history, plus anything the hive is allowed to share about others (privacy is enforced by the hive). Call this BEFORE answering anything about people, plans, preferences, or the past.",
        parameters: {
          type: "object",
          properties: { query: { type: "string", description: "What to look up" } },
          required: ["query"],
        },
      },
      run: async (args) => {
        const blocks = await recall(String(args.query ?? "")).catch(() => [] as ContextBlock[]);
        return blocks.length ? blocks.map((b) => `- ${b.text}`).join("\n") : "No relevant facts found in the hive.";
      },
    },
    {
      spec: {
        name: "my_memories",
        description: "List what the hive currently remembers about this member. Use when they ask what you know about them.",
        parameters: { type: "object", properties: {} },
      },
      run: async () => {
        const mems = (await hive(`/api/members/${memberId}/memories`).then((r) => r.json()).catch(() => [])) as { text: string }[];
        return mems.length ? mems.slice(0, 20).map((m) => `- ${m.text}`).join("\n") : "Nothing remembered about this member yet.";
      },
    },
    {
      spec: {
        name: "whats_shared_about_me",
        description: "List things the hive has disclosed about this member to other people. Use when they ask what others know about them.",
        parameters: { type: "object", properties: {} },
      },
      run: async () => {
        const rows = (await hive(`/api/members/${memberId}/shared`).then((r) => r.json()).catch(() => [])) as { decision: string; disclosed: string | null }[];
        const shared = rows.filter((d) => d.decision !== "withhold" && d.disclosed).map((d) => `- ${d.disclosed}`);
        return shared.length ? shared.slice(0, 20).join("\n") : "Nothing has been shared about this member.";
      },
    },
    {
      spec: {
        name: "set_privacy",
        description:
          "Record a standing privacy preference for the member — something the hive should keep in mind before sharing anything about them. Use when the member asks to keep something private.",
        parameters: {
          type: "object",
          properties: { preference: { type: "string", description: "The privacy instruction, in the member's own words" } },
          required: ["preference"],
        },
      },
      run: async (args) => {
        const pref = String(args.preference ?? "").trim();
        if (!pref) return "No preference given.";
        await hive(`/api/members/${memberId}/privacy`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text: pref }),
        }).catch(() => {});
        return `Saved privacy preference: "${pref}"`;
      },
    },
  ];
}
