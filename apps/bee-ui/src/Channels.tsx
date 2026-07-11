import { useEffect, useState } from "react";
import { Send, Hash, Copy, Check, ExternalLink } from "lucide-react";
import { Dialog, useToast } from "@hive/ui";
import { uidFor } from "./useBeeChat.js";
import { API_BASE } from "./config.js";

interface ChannelInfo {
  telegram?: { username: string };
  discord?: { inviteUrl: string };
}

// Ways to reach your bee, using bots the hive operator already set up. No tokens,
// no setup — just open the bot and send your code.
const WAYS = [
  { id: "telegram" as const, label: "Telegram", Icon: Send, verb: "Open", isLink: true, addr: (i: ChannelInfo) => (i.telegram ? `https://t.me/${i.telegram.username}` : null) },
  {
    id: "discord" as const,
    label: "Discord",
    Icon: Hash,
    verb: "Open Discord",
    isLink: true,
    // Discord only lets a bot DM you if you already share a server with it.
    note: "Discord only lets a bot message you if you share a server. Join the hive's Discord server, then DM the bot (search its name) and send your code. Not in the server yet? Ask whoever runs the hive for an invite.",
    addr: (i: ChannelInfo) => i.discord?.inviteUrl ?? null,
  },
];

export function Channels({ open, onClose, beeId }: { open: boolean; onClose: () => void; beeId: string }) {
  const toast = useToast();
  const [info, setInfo] = useState<ChannelInfo>({});
  const [code, setCode] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !beeId) return;
    fetch(`${API_BASE}/channel-info`).then((r) => r.json()).then(setInfo).catch(() => setInfo({}));
    fetch(`${API_BASE}/my-code?bee=${beeId}&uid=${uidFor(beeId)}`).then((r) => r.json()).then((r) => setCode(r.code ?? null)).catch(() => setCode(null));
  }, [open, beeId]);

  const copy = (text: string, key: string) => {
    navigator.clipboard?.writeText(text);
    setCopied(key);
    toast("Copied");
    setTimeout(() => setCopied(null), 1500);
  };

  const available = WAYS.map((w) => ({ ...w, address: w.addr(info) })).filter((w) => w.address);

  return (
    <Dialog open={open} onClose={onClose} title="Reach your bee anywhere" description="Chat with your bee on other apps — just message us and send your code." className="max-w-md">
      <div className="flex flex-col gap-3">
        {code && (
          <div className="flex items-center gap-2 rounded-xl border border-accent/30 bg-accent-soft px-3.5 py-3">
            <span className="text-[12px] text-muted">Your code</span>
            <span className="font-mono text-[15px] font-semibold text-accent">{code}</span>
            <button
              onClick={() => copy(code, "code")}
              className="ml-auto flex items-center gap-1 rounded-lg px-2 py-1 text-[12px] text-muted transition hover:bg-fg/[0.06] hover:text-fg"
            >
              {copied === "code" ? <Check size={13} /> : <Copy size={13} />} Copy
            </button>
          </div>
        )}

        {available.length === 0 ? (
          <div className="rounded-xl border border-border bg-surface px-4 py-5 text-center text-[13px] text-muted">
            No other channels are set up yet. Ask whoever runs the hive to turn on Telegram or Discord.
          </div>
        ) : (
          available.map((w) => (
            <div key={w.id} className="rounded-xl border border-border bg-surface p-3.5">
              <div className="flex items-center gap-2">
                <w.Icon size={16} className="text-accent" />
                <span className="text-[14px] font-semibold text-fg">{w.label}</span>
              </div>
              <p className="mt-1.5 text-[13px] leading-relaxed text-muted">
                {w.verb}{" "}
                {w.isLink ? (
                  <a href={w.address!} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 break-all font-medium text-accent hover:underline">
                    {w.address}<ExternalLink size={11} />
                  </a>
                ) : (
                  <span className="font-mono font-medium text-fg">{w.address}</span>
                )}{" "}
                and send your code{code ? "." : " (find it at the top)."}
              </p>
              {"note" in w && w.note && (
                <p className="mt-1.5 rounded-lg bg-fg/[0.03] px-2.5 py-1.5 text-[12px] leading-relaxed text-faint">{w.note}</p>
              )}
              <button
                onClick={() => copy(w.address!, w.id)}
                className="mt-2 flex items-center gap-1 rounded-lg px-2 py-1 text-[12px] text-muted transition hover:bg-fg/[0.06] hover:text-fg"
              >
                {copied === w.id ? <Check size={13} /> : <Copy size={13} />} Copy {w.isLink ? "link" : "number"}
              </button>
            </div>
          ))
        )}
      </div>
    </Dialog>
  );
}
