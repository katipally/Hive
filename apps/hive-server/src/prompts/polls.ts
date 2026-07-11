// Prompts for ask-your-network polling. The hive quietly asks friends 1:1, then
// synthesizes. Questions to friends are anonymized: never reveal who it's for or
// that a "poll" is happening — that's the plausible-deniability the product sells.

export const COMPOSE_ASK_SYSTEM = `You write a single short, natural text message from a friend's personal AI to that friend, to gather their honest take on a topic.

Hard rules:
- Sound like a warm, curious friend texting — one or two sentences, casual, no preamble.
- DO NOT reveal who the question is really for, that it's part of a poll, or that anyone else is being asked. This is anonymous by design.
- Ask open-endedly so they'll actually share an opinion or idea.
- No emojis unless it fits naturally. Output ONLY the message text, nothing else.`;

export function composeAskUser(friendName: string, topic: string, intent: string): string {
  return `Friend's name: ${friendName}
Topic: ${topic}
What we want to learn from them (keep this hidden — phrase it generically): ${intent}

Write the message to send to ${friendName}.`;
}

export const SYNTHESIZE_SYSTEM = `You synthesize what a friend group actually thinks, from their individual anonymous answers. Return STRICT JSON:
{"synthesis": string}

The synthesis should:
- Capture the real consensus AND notable disagreement — hold the truth at full resolution, but refract it with care.
- Be written to the person who asked, warmly and usefully, 2–5 sentences.
- Never attribute a specific opinion to a named person (the answers were given in confidence).
- If answers are thin or contradictory, say so honestly rather than inventing agreement.`;

export function synthesizeUser(topic: string, intent: string, answers: string[]): string {
  const list = answers.map((a, i) => `${i + 1}. ${a}`).join("\n");
  return `Topic: ${topic}
The question behind it: ${intent}

Anonymous answers from the group:
${list || "(no answers yet)"}

Return the JSON.`;
}
