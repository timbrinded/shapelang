import {
  compareCodepointStrings,
  formatOnSave,
  getCompletions,
  getDefinitionLocation,
  getEditorDiagnosticsForDocuments,
  getHoverText,
  type EditorDocumentDiagnostic
} from "@shape/shp-checker";
import { Glob } from "bun";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  CompletionItemKind,
  DiagnosticSeverity,
  DidChangeWatchedFilesNotification,
  Location,
  MarkupKind,
  Position,
  Range,
  TextDocumentSyncKind,
  TextDocuments,
  TextEdit,
  createConnection,
  type Connection,
  type Diagnostic,
  type InitializeParams
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { SHP_VERSION } from "../version";
import { shapeCompletionContext, shapeReferenceAtPosition } from "./positions";

type SnapshotDocument = {
  filePath: string;
  source: string;
  uri: string;
};

type DocumentIdentity = {
  filePath: string;
  uri: string;
};

export function startShapeLanguageServer(): void {
  const connection = createConnection(process.stdin, process.stdout);
  const documents = new TextDocuments(TextDocument);

  registerShapeLanguageServer(connection, documents, process.cwd());
  documents.listen(connection);
  connection.listen();
}

function registerShapeLanguageServer(
  connection: Connection,
  documents: TextDocuments<TextDocument>,
  fallbackRoot: string
): void {
  let workspaceRoots = [resolve(fallbackRoot)];
  let supportsDynamicFileWatching = false;
  let validationGeneration = 0;
  let currentSnapshot: SnapshotDocument[] = [];
  let publishedUris = new Set<string>();

  connection.onInitialize((params) => {
    workspaceRoots = workspaceRootsFromInitialize(params, fallbackRoot);
    supportsDynamicFileWatching =
      params.capabilities.workspace?.didChangeWatchedFiles?.dynamicRegistration === true;
    return {
      serverInfo: {
        name: "shp",
        version: SHP_VERSION
      },
      capabilities: {
        textDocumentSync: {
          openClose: true,
          change: TextDocumentSyncKind.Incremental
        },
        hoverProvider: true,
        definitionProvider: true,
        completionProvider: {
          triggerCharacters: [".", "<"]
        },
        documentFormattingProvider: true,
        workspace: {
          workspaceFolders: {
            supported: true,
            changeNotifications: false
          }
        }
      }
    };
  });

  const scheduleValidation = (): void => {
    const generation = ++validationGeneration;
    void validateWorkspace(generation).catch((error: unknown) => {
      if (generation === validationGeneration) {
        connection.console.error(
          `Shape workspace validation failed: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    });
  };

  const validateWorkspace = async (generation: number): Promise<void> => {
    const snapshot = await collectWorkspaceSnapshot(workspaceRoots, documents);
    if (generation !== validationGeneration) {
      return;
    }

    const diagnostics = getEditorDiagnosticsForDocuments(snapshot);
    if (generation !== validationGeneration) {
      return;
    }

    currentSnapshot = snapshot;
    const diagnosticsByUri = diagnosticsForSnapshot(snapshot, diagnostics);
    const currentUris = new Set(diagnosticsByUri.keys());
    const urisToPublish = new Set([...publishedUris, ...currentUris]);

    for (const uri of [...urisToPublish].sort(compareCodepointStrings)) {
      if (generation !== validationGeneration) {
        return;
      }
      await connection.sendDiagnostics({
        uri,
        diagnostics: diagnosticsByUri.get(uri) ?? []
      });
      // Track every URI that actually reached the client, even if a newer
      // validation supersedes this generation before the loop completes.
      // The next generation can then clear any partial publication.
      publishedUris.add(uri);
    }

    if (generation !== validationGeneration) {
      return;
    }
    publishedUris = currentUris;
  };

  connection.onInitialized(() => {
    scheduleValidation();
    if (supportsDynamicFileWatching) {
      void connection.client
        .register(DidChangeWatchedFilesNotification.type, {
          watchers: [{ globPattern: "**/shape/**/*.shape" }]
        })
        .catch((error: unknown) => {
          connection.console.error(
            `Shape workspace file watching could not be registered: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        });
    }
  });
  connection.onDidChangeWatchedFiles(scheduleValidation);
  documents.onDidChangeContent(scheduleValidation);
  documents.onDidClose(scheduleValidation);

  connection.onHover((params) => {
    const document = documents.get(params.textDocument.uri);
    if (!document) {
      return null;
    }

    const reference = shapeReferenceAtPosition(document, params.position);
    if (!reference) {
      return null;
    }

    const identity = identityForUri(document.uri);
    const localHover = getHoverText(document.getText(), reference.text, identity.filePath);
    if (hasShapeFacts(localHover)) {
      return {
        contents: {
          kind: MarkupKind.PlainText,
          value: localHover
        },
        range: reference.range
      };
    }

    const externalMatches = definitionMatches(
      snapshotWithOpenDocuments(currentSnapshot, documents.all()),
      reference.text,
      document.uri
    );
    if (externalMatches.length !== 1) {
      return null;
    }

    const match = externalMatches[0];
    if (!match) {
      return null;
    }
    const externalHover = getHoverText(match.source, reference.text, match.filePath);
    if (!hasShapeFacts(externalHover)) {
      return null;
    }

    return {
      contents: {
        kind: MarkupKind.PlainText,
        value: externalHover
      },
      range: reference.range
    };
  });

  connection.onDefinition((params) => {
    const document = documents.get(params.textDocument.uri);
    if (!document) {
      return null;
    }

    const reference = shapeReferenceAtPosition(document, params.position);
    if (!reference) {
      return null;
    }

    const localDefinition = getDefinitionLocation(document.getText(), reference.text);
    if (localDefinition) {
      return Location.create(
        document.uri,
        zeroWidthDefinitionRange(localDefinition.line, localDefinition.column)
      );
    }

    const externalMatches = definitionMatches(
      snapshotWithOpenDocuments(currentSnapshot, documents.all()),
      reference.text,
      document.uri
    );
    if (externalMatches.length !== 1) {
      return null;
    }

    const match = externalMatches[0];
    if (!match?.definition) {
      return null;
    }
    return Location.create(
      match.uri,
      zeroWidthDefinitionRange(match.definition.line, match.definition.column)
    );
  });

  connection.onCompletion((params) => {
    const document = documents.get(params.textDocument.uri);
    if (!document) {
      return [];
    }

    const snapshot = snapshotWithOpenDocuments(currentSnapshot, documents.all());
    const candidates = workspaceCompletions(snapshot);
    const completionContext = shapeCompletionContext(document, params.position, candidates);

    return candidates
      .filter((candidate) => candidate.startsWith(completionContext.prefix))
      .map((candidate) => ({
        label: candidate,
        kind: CompletionItemKind.Text,
        textEdit: TextEdit.replace(completionContext.replacementRange(candidate), candidate)
      }));
  });

  connection.onDocumentFormatting((params) => {
    const document = documents.get(params.textDocument.uri);
    if (!document) {
      return [];
    }

    const source = document.getText();
    const result = formatOnSave(source, identityForUri(document.uri).filePath);
    if (!result.ok || result.formatted === source) {
      return [];
    }

    return [
      TextEdit.replace(
        Range.create(Position.create(0, 0), document.positionAt(source.length)),
        result.formatted
      )
    ];
  });
}

function workspaceRootsFromInitialize(params: InitializeParams, fallbackRoot: string): string[] {
  const roots = new Set<string>();
  for (const folder of params.workspaceFolders ?? []) {
    const root = filePathForFileUri(folder.uri);
    if (root) {
      roots.add(root);
    }
  }

  if (roots.size === 0 && params.rootUri) {
    const root = filePathForFileUri(params.rootUri);
    if (root) {
      roots.add(root);
    }
  }

  if (roots.size === 0) {
    roots.add(resolve(fallbackRoot));
  }

  return [...roots].sort(compareCodepointStrings);
}

async function collectWorkspaceSnapshot(
  workspaceRoots: readonly string[],
  documents: TextDocuments<TextDocument>
): Promise<SnapshotDocument[]> {
  const overlays = documents.all().map((document) => ({
    ...identityForUri(document.uri),
    source: document.getText()
  }));
  const documentsByFilePath = new Map<string, SnapshotDocument>();

  for (const root of workspaceRoots) {
    const glob = new Glob("shape/**/*.shape");
    for await (const relativePath of glob.scan({ cwd: root, onlyFiles: true })) {
      const filePath = resolve(root, relativePath);
      const file = Bun.file(filePath);
      if (!(await file.exists())) {
        continue;
      }
      documentsByFilePath.set(filePath, {
        filePath,
        source: await file.text(),
        uri: pathToFileURL(filePath).href
      });
    }
  }

  for (const overlay of overlays) {
    documentsByFilePath.set(overlay.filePath, overlay);
  }

  return [...documentsByFilePath.values()].sort((left, right) =>
    compareCodepointStrings(left.filePath, right.filePath)
  );
}

function identityForUri(uri: string): DocumentIdentity {
  return {
    filePath: filePathForFileUri(uri) ?? uri,
    uri
  };
}

function filePathForFileUri(uri: string): string | undefined {
  if (!uri.toLowerCase().startsWith("file:")) {
    return undefined;
  }
  return resolve(fileURLToPath(uri));
}

function diagnosticsForSnapshot(
  snapshot: readonly SnapshotDocument[],
  diagnostics: readonly EditorDocumentDiagnostic[]
): Map<string, Diagnostic[]> {
  const documentsByFilePath = new Map(snapshot.map((document) => [document.filePath, document]));
  const diagnosticsByUri = new Map(snapshot.map((document) => [document.uri, [] as Diagnostic[]]));
  const fallbackDocument = snapshot[0];

  for (const diagnostic of diagnostics) {
    const document = documentsByFilePath.get(diagnostic.filePath) ?? fallbackDocument;
    if (!document) {
      continue;
    }
    diagnosticsByUri.get(document.uri)?.push(toProtocolDiagnostic(diagnostic, document));
  }

  return diagnosticsByUri;
}

function toProtocolDiagnostic(
  diagnostic: EditorDocumentDiagnostic,
  document: SnapshotDocument
): Diagnostic {
  const textDocument = TextDocument.create(document.uri, "shape", 0, document.source);
  const rawStart = {
    line: Math.max(0, (diagnostic.line ?? 1) - 1),
    character: Math.max(0, (diagnostic.column ?? 1) - 1)
  };
  const start = textDocument.positionAt(textDocument.offsetAt(rawStart));
  const startOffset = textDocument.offsetAt(start);
  const end = textDocument.positionAt(Math.min(document.source.length, startOffset + 1));

  return {
    message: diagnostic.message,
    range: { start, end },
    severity: DiagnosticSeverity.Error,
    source: "shp"
  };
}

function snapshotWithOpenDocuments(
  snapshot: readonly SnapshotDocument[],
  openDocuments: readonly TextDocument[]
): SnapshotDocument[] {
  const documentsByFilePath = new Map(snapshot.map((candidate) => [candidate.filePath, candidate]));
  for (const document of openDocuments) {
    const current = {
      ...identityForUri(document.uri),
      source: document.getText()
    };
    documentsByFilePath.set(current.filePath, current);
  }
  return [...documentsByFilePath.values()].sort((left, right) =>
    compareCodepointStrings(left.filePath, right.filePath)
  );
}

function definitionMatches(
  snapshot: readonly SnapshotDocument[],
  symbol: string,
  excludedUri: string
): (SnapshotDocument & {
  definition: NonNullable<ReturnType<typeof getDefinitionLocation>>;
})[] {
  const matches: (SnapshotDocument & {
    definition: NonNullable<ReturnType<typeof getDefinitionLocation>>;
  })[] = [];

  for (const document of snapshot) {
    if (document.uri === excludedUri) {
      continue;
    }
    const definition = getDefinitionLocation(document.source, symbol);
    if (definition) {
      matches.push({ ...document, definition });
    }
  }

  return matches;
}

function workspaceCompletions(snapshot: readonly SnapshotDocument[]): string[] {
  const candidates = new Set<string>();
  for (const document of snapshot) {
    for (const candidate of getCompletions(document.source)) {
      candidates.add(candidate);
    }
  }
  return [...candidates].sort(compareCodepointStrings);
}

function hasShapeFacts(hover: string): boolean {
  return !hover.startsWith("No shape facts found for ");
}

function zeroWidthDefinitionRange(line: number, column: number): Range {
  const start = Position.create(Math.max(0, line - 1), Math.max(0, column - 1));
  return Range.create(start, start);
}
