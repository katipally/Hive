import { id } from "@hive/shared";
import type { Bee } from "./bee.js";
import type { BeeConfig } from "./config.js";
import { appendDisplay, appendSession, displayTurns } from "./sessions.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// A realistic conversation between a member and their bee. Nothing here is a bare
// "fact" — it reads like how someone actually talks to their bee. The hive builds
// its graph by extracting these turns through the normal pipeline, so the demo data
// is derived from conversations, not hand-inserted.
interface Session {
  tag: string;
  turns: { role: "user" | "bee"; text: string }[];
}
const SCRIPTS: Record<string, Session[]> = {
  Alice: [
    {
      tag: "weekend",
      turns: [
        { role: "user", text: "Just got back from a climbing trip in the Dolomites — honestly the best weekend of my year." },
        { role: "bee", text: "That sounds amazing! The Dolomites are supposed to be unreal for climbing. Glad you had such a good time." },
        { role: "user", text: "It got me dreaming again about finally doing that Japan trip in the spring." },
        { role: "bee", text: "Spring in Japan would be perfect — cherry blossoms and great weather. Want me to keep an eye out for tips?" },
      ],
    },
    {
      tag: "work-life",
      turns: [
        { role: "user", text: "Big design review at Acme tomorrow, I'm a little nervous about it." },
        { role: "bee", text: "You've got this — you've prepped hard. Want to talk through the tricky parts?" },
        { role: "user", text: "Maybe later. Also my birthday's on August 2nd and I have no idea what to do this year." },
        { role: "bee", text: "Noted — August 2nd. Plenty of time to plan something you'll love." },
      ],
    },
  ],
  Bob: [
    {
      tag: "outdoors",
      turns: [
        { role: "user", text: "Did a 20km hike upstate this weekend, my legs are wrecked but it was worth it." },
        { role: "bee", text: "20km is no joke! Sounds like a great day out in the mountains." },
        { role: "user", text: "Been saving up for a big Japan trip this autumn too, can't wait." },
        { role: "bee", text: "Autumn in Japan is gorgeous. Exciting — I'll remember you're planning that." },
      ],
    },
    {
      tag: "surprise",
      turns: [
        { role: "user", text: "Keep this between us — I'm secretly planning a surprise birthday party for Alice on August 2nd." },
        { role: "bee", text: "Your secret's safe with me. That's a lovely thing to do for her." },
        { role: "user", text: "Cara's helping out, she's baking the cake at her place. Alice can't find out." },
        { role: "bee", text: "Understood — I won't breathe a word of it to anyone, especially not Alice." },
      ],
    },
  ],
  Cara: [
    {
      tag: "the-bakery",
      turns: [
        { role: "user", text: "Rise had its busiest Saturday ever — we sold out of croissants by 10am!" },
        { role: "bee", text: "That's incredible, congrats! Word about the bakery is clearly getting around." },
        { role: "user", text: "I've been playing a lot of cello in the evenings to wind down after the rush." },
        { role: "bee", text: "Sounds like the perfect way to decompress. I love that." },
      ],
    },
    {
      tag: "old-friends",
      turns: [
        { role: "user", text: "I'm helping Bob with Alice's surprise party — I'm on cake duty, of course." },
        { role: "bee", text: "Of course — no one better for the cake. Sounds like it'll be special." },
        { role: "user", text: "Alice and I go way back, we met at university years ago." },
        { role: "bee", text: "That's a lovely history. She's lucky to have a friend like you in her corner." },
      ],
    },
  ],
};

// Demo only (BEE_DEMO): pair each bee to its like-named member, then replay that
// member's conversations so the hive learns about them naturally (extraction) and
// each profile opens with lived-in chat history across a couple of sessions.
export async function demoAutoPair(bees: Map<string, Bee>, cfg: BeeConfig): Promise<void> {
  if (!process.env["BEE_DEMO"]) return;

  type M = { id: string; name: string; code: string };
  let members: M[] = [];
  for (let i = 0; i < 40; i++) {
    members = (await fetch(`${cfg.hiveHttpUrl}/api/members`).then((r) => r.json()).catch(() => [])) as M[];
    if (members.length >= 3) break;
    await sleep(1000);
  }

  for (const bee of bees.values()) {
    const name = bee.instance.name;
    const member = members.find((m) => m.name === name);
    if (!member) continue;

    const ext = `web-${name.toLowerCase()}`;
    const check = await bee.link.identityCheck("web", ext).catch(() => null);
    let channelIdentityId = check?.channelIdentityId;
    if (!channelIdentityId) {
      const r = await bee.link.pair("web", ext, name, member.code).catch(() => null);
      if (!r?.ok || !r.channelIdentityId) continue;
      channelIdentityId = r.channelIdentityId;
      console.log(`[bee] demo: linked ${name} → ${ext}`);
    }

    const scripts = SCRIPTS[name] ?? [];
    for (const s of scripts) {
      const sessionId = `member:${member.id}:${s.tag}`;
      // idempotent: don't re-seed a session that already has history (warm restart)
      if (displayTurns(bee.instance.beeId, sessionId).length > 0) continue;
      let ts = Date.now() - scripts.length * 3_600_000; // spread turns over the recent past
      for (const t of s.turns) {
        if (t.role === "user") {
          appendDisplay(bee.instance.beeId, sessionId, "user", t.text);
          appendSession(bee.instance.beeId, sessionId, "user", t.text);
          bee.link.ingestTurn({
            turnId: id("turn"),
            memberId: member.id,
            channelIdentityId,
            sessionId,
            role: "user",
            content: t.text,
            ts,
          });
        } else {
          appendDisplay(bee.instance.beeId, sessionId, "bee", t.text);
          appendSession(bee.instance.beeId, sessionId, "assistant", t.text);
        }
        ts += 60_000;
      }
    }
    console.log(`[bee] demo: seeded ${scripts.length} sessions for ${name}`);
  }
}
