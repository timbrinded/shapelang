// Executable laws for fixtures/skills/review/cross-object: presentRecord maps
// unknown ids to "not found", known ids to their catalog label, and never throws.
const KNOWN = ["known"];

export default function laws(fc, { presentRecord, getLabel }) {
  const unknownId = fc.string().filter((id) => !KNOWN.includes(id));
  const anyId = fc.oneof(fc.constantFrom(...KNOWN), fc.string());
  return {
    "unknown ids present as not found": fc.property(unknownId, (id) => presentRecord(id) === "not found"),
    "known ids present their catalog label": fc.property(fc.constantFrom(...KNOWN), (id) =>
      presentRecord(id) === getLabel(id)
    ),
    "presentRecord never throws": fc.property(anyId, (id) => {
      try {
        presentRecord(id);
        return true;
      } catch {
        return false;
      }
    })
  };
}
