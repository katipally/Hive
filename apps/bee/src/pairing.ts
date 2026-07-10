export function detectCode(text: string): string | null {
  const m = text.match(/BEE-[A-Z0-9]{4}/i);
  return m ? m[0].toUpperCase() : null;
}

export function pairingPrompt(): string {
  return "👋 I'm a Hive bee, but we're not linked yet. Send me your invite code (looks like BEE-XXXX) to get started.";
}
