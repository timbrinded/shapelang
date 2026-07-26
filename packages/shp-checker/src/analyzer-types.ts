export type AnalyzerEffect = "HardDelete" | "Truncate" | "DropStorage";

export type AnalyzerTargetSegment = {
  value: string;
  quoted: boolean;
};

export type AnalyzerTargetIdentity =
  | {
      kind: "sql";
      segments: AnalyzerTargetSegment[];
    }
  | {
      kind: "orm";
      value: string;
    };

export type AnalyzerHint = {
  effect: AnalyzerEffect;
  sourcePath: string;
  line: number;
  evidence: string;
  target?: string;
  targetIdentity?: AnalyzerTargetIdentity;
  sourceAnchor?: string;
};

export type AnalyzerWarning =
  | {
      kind: "missing_declared_effect";
      hint: AnalyzerHint;
    }
  | {
      kind: "target_mismatch";
      hint: AnalyzerHint;
      suspectedTarget: string;
      declaredTargets: string[];
    }
  | {
      kind: "ambiguous_source_attribution";
      hint: AnalyzerHint;
      declaredAnchors: string[];
      declaredTargets: string[];
    };

export type SourceSpan = {
  start: number;
  end: number;
};

export type AnalyzerMatch = {
  effect: AnalyzerEffect;
  span: SourceSpan;
  evidenceSpan: SourceSpan;
  lineOffset: number;
  target?: string;
  targetIdentity?: AnalyzerTargetIdentity;
  targetSpan?: SourceSpan;
};

export type LiteralRegion = {
  kind: "literal";
  span: SourceSpan;
  contentSpan: SourceSpan;
  literalKind: "single" | "double" | "template" | "quoted_identifier" | "dollar";
  closed: boolean;
  static: boolean;
};

export type CommentRegion = {
  kind: "comment";
  span: SourceSpan;
};

export type LexicalRegion = LiteralRegion | CommentRegion;

export type LexicalScan = {
  masked: string;
  regionsByStart: Map<number, LexicalRegion>;
};

export type SqlMatch = {
  effect: AnalyzerEffect;
  span: SourceSpan;
  statementSpan: SourceSpan;
  target?: string;
  targetIdentity?: Extract<AnalyzerTargetIdentity, { kind: "sql" }>;
  targetSpan?: SourceSpan;
};
