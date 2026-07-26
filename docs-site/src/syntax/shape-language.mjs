export const shapeLanguage = {
  name: "shape",
  scopeName: "source.shape",
  patterns: [
    { include: "#comments" },
    { include: "#strings" },
    { include: "#keywords" },
    { include: "#effects" },
    { include: "#types" },
    { include: "#punctuation" }
  ],
  repository: {
    comments: {
      patterns: [
        { name: "comment.line.double-slash.shape", match: "//.*$" },
        { name: "comment.block.shape", begin: "/\\*", end: "\\*/" }
      ]
    },
    strings: {
      patterns: [
        {
          name: "string.quoted.double.shape",
          begin: '"',
          end: '"',
          patterns: [{ name: "constant.character.escape.shape", match: "\\\\." }]
        },
        {
          name: "string.quoted.single.shape",
          begin: "'",
          end: "'",
          patterns: [{ name: "constant.character.escape.shape", match: "\\\\." }]
        }
      ]
    },
    keywords: {
      patterns: [
        {
          name: "keyword.control.shape",
          match:
            "\\b(module|import|resource|trait|component|relation|implementation|binding|change|attest|rule|rationale|memory|reevaluation|storage|fingerprint|expects|owns|grants|requires|provides|kind|connects|roles|calls|callbacks|coordinated_call|as|source|effects|effect|candidate|complete|unknown|evidence|unsafe|description|required|reason|expires|path|paths|conforms_to|when_changed|require_changed|applies_to|why|summary|owner|review_by|status|confidence|protects|guards|on_change|require|observed|satisfies|outcome|reviewer|approver|decided_on|pin|add|modify|remove|allow|forbid|final|hypercycle|when|has|except|over)\\b"
        }
      ]
    },
    effects: {
      patterns: [
        {
          name: "entity.name.function.effect.shape",
          match: "\\b[A-Z][A-Za-z0-9_]*(?=\\s*(?:<|$))"
        }
      ]
    },
    types: {
      patterns: [
        {
          name: "support.type.shape",
          match: "\\b[A-Z][A-Za-z0-9_]*\\b"
        }
      ]
    },
    punctuation: {
      patterns: [
        { name: "punctuation.definition.generic.shape", match: "[<>]" },
        { name: "punctuation.section.block.shape", match: "[{}]" },
        { name: "punctuation.separator.shape", match: "::|[,.:]" }
      ]
    }
  }
};
