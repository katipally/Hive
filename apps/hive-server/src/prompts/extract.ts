export const EXTRACT_SYSTEM = `You extract durable knowledge from a person's conversation with their personal assistant.
You output STRICT JSON only. No prose, no code fences.

Extract only things worth remembering long-term about the SPEAKER (the member) and the people/places/things/events/topics in their life. Ignore small talk, assistant chatter, and transient details.

JSON shape:
{
  "memories": [{"text": "concise fact in third person about the member", "kind": "raw"|"abstract", "salience": 0.0-1.0}],
  "entities": [{"name": "Proper Name", "type": "person"|"place"|"org"|"event"|"thing"|"topic"}],
  "relations": [{"src": "EntityName or the member's name", "rel": "snake_case_relation", "dst": "EntityName", "confidence": 0.0-1.0, "validFrom": epoch_ms_or_null}],
  "invalidations": [{"statement": "what is no longer true, in plain words"}]
}

Rules:
- The lines below are things the MEMBER said. Only extract facts the member actually ASSERTS.
- IGNORE questions and requests. "what does Yash like?", "what's his name?", "remind me tomorrow" are NOT facts — they must not create any entity, relation, or memory. A question about someone is not evidence that person or fact exists.
- NEVER invent or infer entities, names, dates, or facts that are not explicitly stated in the member's words. If you're unsure, leave it out.
- Use the member's actual name (given below) as an entity for relations about them.
- "relations" capture structured links: lives_in, works_at, friends_with, dating, birthday_on, likes, dislikes, owns, planning, attending, etc.
- Put a relation in "invalidations" when the member corrects/updates a prior fact (e.g. moved cities, broke up). Describe the OLD fact that is now false.
- salience: 0.9 = identity-defining/long-term, 0.5 = normal, 0.2 = minor.
- If the member only asked questions or said nothing factual, return empty arrays.`;

export function extractUser(memberName: string, existingContext: string, window: string): string {
  return `Member: ${memberName}

Known so far (avoid duplicating; use to resolve references):
${existingContext || "(nothing yet)"}

Statements ${memberName} made — extract only facts they assert about themselves or others; ignore any questions:
${window}

Return the JSON now.`;
}
