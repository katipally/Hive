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
- "relations" capture structured links. Pick the RIGHT verb — do not default to "likes":
  * where the member lives / moved to / is based / is from → lives_in  (NEVER "likes" for a home city)
  * job or employer → works_at ;  school/university → studies_at
  * romantic partner → dating ;  spouse → married_to ;  birthday → birthday_on
  * a genuine interest, hobby, sport, cuisine, or preference → likes / dislikes  (e.g. hiking, photography, ramen)
  * a future plan or trip → planning
- Entity "type" must fit what the thing IS:
  * city, country, neighborhood, region → place        * company, school, team, brand → org
  * a named person → person                            * a dated happening (a wedding, a concert) → event
  * a hobby, activity, sport, cuisine, field, or subject (hiking, photography, cooking, ramen) → topic
  * only a concrete physical object → thing
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
