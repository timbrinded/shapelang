export type AstSourceFileInput = {
  path: string;
  source: string;
  language?: string;
};

export type AstGenerationDiagnostic = {
  kind: "error" | "warning";
  code: string;
  message: string;
  path?: string;
  nodeId?: string;
};

export type AstGenerationResult<T> =
  | {
      ok: true;
      value: T;
      diagnostics: AstGenerationDiagnostic[];
    }
  | {
      ok: false;
      diagnostics: AstGenerationDiagnostic[];
    };

export type SourceSpan = {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  startByte?: number;
  endByte?: number;
};

export type RawAstNode = {
  id: string;
  parserId?: string;
  path: string;
  language: string;
  kind: string;
  named: boolean;
  semanticLabel?: string;
  attributes?: Record<string, AstScalar>;
  parentId?: string;
  childIndex?: number;
  fieldName?: string;
  span?: SourceSpan;
  textHash?: string;
  text?: string;
};

type AstScalar = string | number | boolean | null;

export type RawAstFile = {
  id: string;
  path: string;
  language: string;
  rootNodeId: string;
  sourceHash?: string;
  parser?: string;
};

export type SemanticConfidence = "high" | "medium" | "low";

export type CodeContainer = {
  id: string;
  name: string;
  kind: "file" | "module" | "type" | "impl";
  path: string;
  language: string;
  nodeId?: string;
  anchorId?: string;
  ownerId?: string;
  confidence: SemanticConfidence;
};

export type CodeFunction = {
  id: string;
  name: string;
  path: string;
  language: string;
  nodeId?: string;
  anchorId?: string;
  ownerId: string;
  confidence: SemanticConfidence;
  sourceRef: string;
};

export type CodeResource = {
  id: string;
  name: string;
  path: string;
  language: string;
  nodeId?: string;
  anchorId?: string;
  confidence: SemanticConfidence;
  reason: string;
  sourceRef: string;
};

export type CodeAstAnchor = {
  id: string;
  name: string;
  path: string;
  language: string;
  nodeId: string;
  kind: string;
  sourceRef: string;
  target: string;
  targetKind: "component" | "fn" | "resource";
  fingerprint?: AstFingerprint;
};

export type AstFingerprint = {
  provider: string;
  value: string;
};

export type CodeRelation = {
  id: string;
  kind: "calls" | "candidate_call" | "imports" | "implements";
  fromId: string;
  toId: string;
  path: string;
  nodeId?: string;
  confidence: SemanticConfidence;
  summary: string;
};

export type CodeCandidateEffect = {
  id: string;
  name: string;
  functionId: string;
  effect: string;
  targetResourceId: string;
  sourceRef: string;
  confidence: SemanticConfidence;
  anchorId?: string;
  summary: string;
};

export type CodeSemanticGraph = {
  files: RawAstFile[];
  rawNodes: RawAstNode[];
  containers: CodeContainer[];
  functions: CodeFunction[];
  resources: CodeResource[];
  anchors: CodeAstAnchor[];
  relations: CodeRelation[];
  candidateEffects: CodeCandidateEffect[];
  diagnostics: AstGenerationDiagnostic[];
};

export type GenerateShapeOptions = {
  moduleName?: string;
  includeAstLayer?: boolean;
  rawModuleName?: string;
};

export type GeneratedShapeOutput = {
  semanticShape: string;
  rawShape?: string;
};

export type TreeSitterParseProvider = (
  language: string,
  source: string
) => Promise<unknown> | unknown;
