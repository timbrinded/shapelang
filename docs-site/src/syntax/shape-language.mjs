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
        { name: "string.quoted.double.shape", begin: "\"", end: "\"", patterns: [{ name: "constant.character.escape.shape", match: "\\\\." }] },
        { name: "string.quoted.single.shape", begin: "'", end: "'", patterns: [{ name: "constant.character.escape.shape", match: "\\\\." }] }
      ]
    },
    keywords: {
      patterns: [
        {
          name: "keyword.control.shape",
          match: "\\b(module|import|resource|trait|component|implementation|change|attest|rule|storage|owns|grants|requires|provides|source|effects|complete|unknown|evidence|unsafe|reason|expires|paths|conforms_to|on_change|require|add|modify|remove|allow|forbid|final|when|has|except|cycle|over|where|includes|via)\\b"
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
        { name: "punctuation.separator.shape", match: "[,.:]" }
      ]
    }
  }
};
