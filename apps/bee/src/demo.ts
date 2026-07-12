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
      tag: "dolomites-trip",
      turns: [
        { role: "user", text: "Just got back from a climbing trip in the Dolomites — honestly the best weekend of my year, the via ferrata routes were incredible." },
        { role: "bee", text: "That sounds amazing! The Dolomites are unreal for climbing. So glad you had such a good time." },
        { role: "user", text: "It got me dreaming again about finally doing that Japan trip in the spring — cherry blossom season." },
        { role: "bee", text: "Spring in Japan would be perfect. Want me to keep an eye out for tips and routes?" },
      ],
    },
    {
      tag: "new-job",
      turns: [
        { role: "user", text: "Big news — I just left Acme and I'm joining a startup called Lumen as their lead designer. A bit terrified but excited." },
        { role: "bee", text: "That's a huge move, congratulations! Lumen is lucky to have you. Terrified-excited is exactly right for a leap like this." },
        { role: "user", text: "Also my birthday's coming up on August 2nd and I have no clue what to do this year." },
        { role: "bee", text: "Noted — August 2nd. Plenty of time to plan something you'll love." },
      ],
    },
    {
      tag: "photography",
      turns: [
        { role: "user", text: "I've been getting really into film photography lately, shooting a lot on my old Pentax around Berlin." },
        { role: "bee", text: "Film has such a lovely character. Berlin must be a great city to shoot — so much texture." },
        { role: "user", text: "Thinking of putting together a little photo zine of the Kreuzberg streets." },
        { role: "bee", text: "I love that idea. A Kreuzberg zine could be really special — let me know if you want help shaping it." },
      ],
    },
  ],
  Bob: [
    {
      tag: "catskills-hike",
      turns: [
        { role: "user", text: "Did a 20km hike upstate this weekend, my legs are wrecked but it was worth it — the Catskills in autumn are unbeatable." },
        { role: "bee", text: "20km is no joke! The Catskills in fall sound gorgeous. Great day out in the mountains." },
        { role: "user", text: "Been saving up for a big Japan trip this autumn too, can't wait to hike around Kyoto." },
        { role: "bee", text: "Autumn in Japan is stunning. I'll remember you're planning that — Kyoto's trails are special." },
      ],
    },
    {
      tag: "surprise",
      turns: [
        { role: "user", text: "Keep this strictly between us — I'm secretly planning a surprise birthday party for Alice on August 2nd." },
        { role: "bee", text: "Your secret's safe with me. That's a wonderful thing to do for her." },
        { role: "user", text: "Cara's helping — she's baking the cake at her place. Alice absolutely can't find out." },
        { role: "bee", text: "Understood — not a word to anyone, especially not Alice." },
      ],
    },
    {
      tag: "cycling",
      turns: [
        { role: "user", text: "Picked up a new road bike, been doing early morning rides along the Hudson before work." },
        { role: "bee", text: "Those quiet morning rides are the best. The Hudson path must be beautiful at sunrise." },
        { role: "user", text: "Trying to talk my friend Dana into joining me for a century ride this fall." },
        { role: "bee", text: "A century's a great goal! Hope Dana's up for it — riding with a friend makes the miles fly." },
      ],
    },
  ],
  Cara: [
    {
      tag: "the-bakery",
      turns: [
        { role: "user", text: "Rise had its busiest Saturday ever — we sold out of croissants by 10am!" },
        { role: "bee", text: "That's incredible, congrats! Word about the bakery is clearly spreading." },
        { role: "user", text: "I've been playing a lot of cello in the evenings to wind down after the rush." },
        { role: "bee", text: "Sounds like the perfect way to decompress. I love that." },
      ],
    },
    {
      tag: "old-friends",
      turns: [
        { role: "user", text: "I'm helping Bob with Alice's surprise party — I'm on cake duty, of course." },
        { role: "bee", text: "Of course — no one better for the cake. It'll be special." },
        { role: "user", text: "Alice and I go way back, we met at university in Bristol years ago." },
        { role: "bee", text: "That's a lovely history. She's lucky to have you in her corner." },
      ],
    },
    {
      tag: "wine-trip",
      turns: [
        { role: "user", text: "Booked a little wine-tasting trip to Bordeaux next month, I need a proper break." },
        { role: "bee", text: "You've earned it! Bordeaux in the vineyards sounds restorative. Enjoy every glass." },
        { role: "user", text: "Might bring back a few bottles for Alice's party, actually." },
        { role: "bee", text: "A perfect touch. She'll love that." },
      ],
    },
  ],
  Dana: [
    {
      tag: "seed-round",
      turns: [
        { role: "user", text: "Long week — we just closed our seed round for the startup, so relieved and exhausted." },
        { role: "bee", text: "Congratulations, that's massive! Closing a seed round is no small feat. Take a breath — you earned it." },
        { role: "user", text: "I run a small climate-tech company here in San Francisco, it's been all-consuming." },
        { role: "bee", text: "Climate tech is such meaningful work. All-consuming makes sense for something you care about that much." },
      ],
    },
    {
      tag: "trail-running",
      turns: [
        { role: "user", text: "Went trail running in Marin this morning to clear my head — the views of the bay were unreal." },
        { role: "bee", text: "Marin's trails are stunning. A run with a view like that is the best kind of reset." },
        { role: "user", text: "Bob keeps trying to get me to do a century bike ride with him this fall, I might actually cave." },
        { role: "bee", text: "Ha — Bob's persistent! A century with a friend could be a great challenge." },
      ],
    },
    {
      tag: "japan-dream",
      turns: [
        { role: "user", text: "I've always wanted to visit Japan — thinking maybe next year, mixing hiking and photography." },
        { role: "bee", text: "Japan for hiking and photography would be incredible — the mountains and the light are something else." },
        { role: "user", text: "I shoot a lot of landscape photography on the side, it's my main way to switch off." },
        { role: "bee", text: "Beautiful. Landscape photography and travel go hand in hand — Japan would give you so much to shoot." },
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
    if (members.length >= 4) break;
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
