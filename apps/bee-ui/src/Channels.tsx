import { useEffect, useState } from "react";
import { Send, Hash, Copy, Check, ExternalLink } from "lucide-react";
import { Dialog, useToast } from "@hive/ui";
import { uidFor } from "./useBeeChat.js";
import { API_BASE } from "./config.js";

interface ChannelInfo {
  telegram?: { username: string };
  discord?: { inviteUrl: string; botName?: string };
}

// Ways to connect your bee, using bots the hive operator already set up. No tokens, no
// setup — join/open and send your code.
const WAYS = [
  { id: "telegram" as const, label: "Telegram", Icon: Send, addr: (i: ChannelInfo) => (i.telegram ? `https://t.me/${i.telegram.username}` : null) },
  { id: "discord" as const, label: "Discord", Icon: Hash, addr: (i: ChannelInfo) => i.discord?.inviteUrl ?? null },
];

export function Channels({
  open,
  onClose,
  beeId,
  focus = null,
  connected = {},
}: {
  open: boolean;
  onClose: () => void;
  beeId: string;
  focus?: string | null;
  connected?: Record<string, boolean>;
}) {
  const toast = useToast();
  const [info, setInfo] = useState<ChannelInfo>({});
  const [code, setCode] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !beeId) return;
    fetch(`${API_BASE}/channel-info`).then((r) => r.json()).then(setInfo).catch(() => setInfo({}));
    fetch(`${API_BASE}/my-code?bee=${beeId}&uid=${uidFor(beeId)}`)
      .then((r) => r.json())
      .then((r) => {
        if (r.code) { setCode(r.code); localStorage.setItem(`bee_code_${beeId}`, r.code); }
        else setCode(localStorage.getItem(`bee_code_${beeId}`)); // fall back to the code we linked with
      })
      .catch(() => setCode(localStorage.getItem(`bee_code_${beeId}`)));
  }, [open, beeId]);

  const copy = (text: string, key: string) => {
    navigator.clipboard?.writeText(text);
    setCopied(key);
    toast("Copied");
    setTimeout(() => setCopied(null), 1500);
  };

  const available = WAYS.map((w) => ({ ...w, address: w.addr(info), connected: !!connected[w.id] }))
    .filter((w) => w.address)
    // if a specific channel was tapped, show only that one
    .filter((w) => !focus || w.id === focus);

  return (
    <Dialog open={open} onClose={onClose} title="Connect your bee anywhere" description="Chat with your bee on other apps — connect once with your code." className="max-w-md">
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
                {w.connected ? (
                  <span className="ml-auto flex items-center gap-1 rounded-full bg-share/15 px-2 py-0.5 text-[11px] font-medium text-share">
                    <Check size={11} /> Connected here
                  </span>
                ) : (
                  <span className="ml-auto text-[11px] text-faint">Connect with your code</span>
                )}
              </div>

              <p className="mt-1.5 text-[13px] leading-relaxed text-muted">
                {w.id === "discord" ? "Join this server" : "Open"}{" "}
                <a href={w.address!} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 break-all font-medium text-accent hover:underline">
                  {w.address}<ExternalLink size={11} />
                </a>
                {w.id === "discord" ? (
                  <> — the bot will DM you to link, just reply with your code</>
                ) : (
                  <> and send your code</>
                )}
                {code ? "." : " (find it at the top)."}
              </p>

              <button
                onClick={() => copy(w.address!, w.id)}
                className="mt-2 flex items-center gap-1 rounded-lg px-2 py-1 text-[12px] text-muted transition hover:bg-fg/[0.06] hover:text-fg"
              >
                {copied === w.id ? <Check size={13} /> : <Copy size={13} />} Copy link
              </button>
            </div>
          ))
        )}
      </div>
    </Dialog>
  );
}
