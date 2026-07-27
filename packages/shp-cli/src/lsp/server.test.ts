import { expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  CompletionRequest,
  DefinitionRequest,
  DidChangeTextDocumentNotification,
  DidCloseTextDocumentNotification,
  DidOpenTextDocumentNotification,
  DocumentFormattingRequest,
  ExitNotification,
  HoverRequest,
  InitializeRequest,
  InitializedNotification,
  PublishDiagnosticsNotification,
  RegistrationRequest,
  ShutdownRequest,
  createProtocolConnection,
  type CompletionItem,
  type Diagnostic,
  type PublishDiagnosticsParams,
  type RegistrationParams
} from "vscode-languageserver/node";

const repoRoot = resolve(import.meta.dir, "../../../..");
const cliPath = resolve(repoRoot, "packages/shp-cli/src/index.ts");
const toolingUri = pathToFileURL(resolve(repoRoot, "shape/tooling.shape")).href;

test("serves core LSP requests over stdio", async () => {
  const { command, args } = lspSpawnCommand();
  const child = spawn(command, args, {
    cwd: repoRoot,
    stdio: ["pipe", "pipe", "pipe"]
  });
  if (!child.stdin || !child.stdout || !child.stderr) {
    throw new Error("LSP smoke child must expose stdio pipes");
  }

  const client = createProtocolConnection(child.stdout, child.stdin);
  const diagnostics = diagnosticsCollector(client);
  const stderrPromise = streamText(child.stderr);
  const registration = new Promise<RegistrationParams>((resolveRegistration) => {
    client.onRequest(RegistrationRequest.type, (params) => {
      resolveRegistration(params);
    });
  });
  let exited = false;

  try {
    client.listen();
    const initialized = await client.sendRequest(InitializeRequest.type, {
      processId: process.pid,
      rootUri: pathToFileURL(repoRoot).href,
      capabilities: {
        workspace: {
          workspaceFolders: true,
          didChangeWatchedFiles: {
            dynamicRegistration: true
          }
        }
      },
      workspaceFolders: [
        {
          name: "shapelang",
          uri: pathToFileURL(repoRoot).href
        }
      ]
    });

    expect(initialized.serverInfo?.name).toBe("shp");
    expect(initialized.capabilities.hoverProvider).toBe(true);
    expect(initialized.capabilities.definitionProvider).toBe(true);
    expect(initialized.capabilities.documentFormattingProvider).toBe(true);
    expect(initialized.capabilities.workspace?.workspaceFolders?.supported).toBe(true);
    await client.sendNotification(InitializedNotification.type, {});
    expect(await registration).toEqual({
      registrations: [
        expect.objectContaining({
          method: "workspace/didChangeWatchedFiles",
          registerOptions: {
            watchers: [{ globPattern: "**/shape/**/*.shape" }]
          }
        })
      ]
    });

    // Regression: tooling.shape is invalid when checked without its imported
    // modules. The workspace-backed LSP must publish the real, empty result.
    expect(await diagnostics.waitFor(toolingUri, (items) => items.length === 0)).toEqual([]);

    const baseUri = "untitled:lsp-base.shape";
    const consumerUri = "untitled:lsp-consumer.shape";
    const completionUri = "untitled:lsp-completion.shape";
    const baseSource = `module shared

  resource SharedEvent

component SharedStore {
  fn run
    effects complete {
    }
}

resource AuditEvent
`;
    const invalidConsumer = "component {";
    const validConsumer = `module smoke

import shared

resource LocalEvent

component AuditStore {
  owns LocalEvent
  owns SharedEvent

  fn appendEvent
    effects complete {
    }
}
`;

    await client.sendNotification(DidOpenTextDocumentNotification.type, {
      textDocument: {
        uri: baseUri,
        languageId: "shape",
        version: 1,
        text: baseSource
      }
    });
    await client.sendNotification(DidOpenTextDocumentNotification.type, {
      textDocument: {
        uri: consumerUri,
        languageId: "shape",
        version: 1,
        text: invalidConsumer
      }
    });
    expect(
      await diagnostics.waitFor(consumerUri, (items) =>
        items.some((diagnostic) => diagnostic.message.includes("Expecting"))
      )
    ).not.toEqual([]);

    await client.sendNotification(DidChangeTextDocumentNotification.type, {
      textDocument: {
        uri: consumerUri,
        version: 2
      },
      contentChanges: [{ text: validConsumer }]
    });
    expect(await diagnostics.waitFor(consumerUri, (items) => items.length === 0)).toEqual([]);
    expect(await diagnostics.waitFor(baseUri, (items) => items.length === 0)).toEqual([]);

    const rapidChangeMarker = diagnostics.mark();
    await client.sendNotification(DidChangeTextDocumentNotification.type, {
      textDocument: {
        uri: consumerUri,
        version: 3
      },
      contentChanges: [{ text: invalidConsumer }]
    });
    await client.sendNotification(DidChangeTextDocumentNotification.type, {
      textDocument: {
        uri: consumerUri,
        version: 4
      },
      contentChanges: [{ text: validConsumer }]
    });
    expect(
      await diagnostics.waitForAfter(consumerUri, rapidChangeMarker, (items) => items.length === 0)
    ).toEqual([]);
    await Bun.sleep(50);
    expect(
      diagnostics.after(consumerUri, rapidChangeMarker).every((items) => items.length === 0)
    ).toBe(true);

    const immediateUri = "untitled:lsp-immediate.shape";
    const updatedBaseSource = `${baseSource}resource ImmediateEvent\n`;
    const immediateSource = `module immediate

component ImmediateStore {
  owns ImmediateEvent
}
`;
    await client.sendNotification(DidChangeTextDocumentNotification.type, {
      textDocument: {
        uri: baseUri,
        version: 2
      },
      contentChanges: [{ text: updatedBaseSource }]
    });
    await client.sendNotification(DidOpenTextDocumentNotification.type, {
      textDocument: {
        uri: immediateUri,
        languageId: "shape",
        version: 1,
        text: immediateSource
      }
    });
    const immediateDefinition = await client.sendRequest(DefinitionRequest.type, {
      textDocument: { uri: immediateUri },
      position: positionOf(immediateSource, "ImmediateEvent", 0)
    });
    expect(immediateDefinition).toEqual(
      expect.objectContaining({
        uri: baseUri,
        range: {
          start: { line: 11, character: 0 },
          end: { line: 11, character: 0 }
        }
      })
    );
    await client.sendNotification(DidCloseTextDocumentNotification.type, {
      textDocument: { uri: immediateUri }
    });

    const sharedReference = positionOf(validConsumer, "SharedEvent", 0);
    const hover = await client.sendRequest(HoverRequest.type, {
      textDocument: { uri: consumerUri },
      position: sharedReference
    });
    expect(hover?.contents).toEqual(
      expect.objectContaining({
        value: expect.stringContaining("kind: resource")
      })
    );

    const externalDefinition = await client.sendRequest(DefinitionRequest.type, {
      textDocument: { uri: consumerUri },
      position: sharedReference
    });
    expect(externalDefinition).toEqual(
      expect.objectContaining({
        uri: baseUri,
        range: {
          start: { line: 2, character: 2 },
          end: { line: 2, character: 2 }
        }
      })
    );

    const qualifiedUri = "untitled:lsp-qualified.shape";
    const qualifiedSource = `shared::SharedEvent
shared::SharedStore.run
`;
    await client.sendNotification(DidOpenTextDocumentNotification.type, {
      textDocument: {
        uri: qualifiedUri,
        languageId: "shape",
        version: 1,
        text: qualifiedSource
      }
    });
    const qualifiedResourcePosition = { line: 0, character: 9 };
    const qualifiedHover = await client.sendRequest(HoverRequest.type, {
      textDocument: { uri: qualifiedUri },
      position: qualifiedResourcePosition
    });
    expect(qualifiedHover?.contents).toEqual(
      expect.objectContaining({
        value: expect.stringContaining("kind: resource")
      })
    );
    const qualifiedResourceDefinition = await client.sendRequest(DefinitionRequest.type, {
      textDocument: { uri: qualifiedUri },
      position: qualifiedResourcePosition
    });
    expect(qualifiedResourceDefinition).toEqual(
      expect.objectContaining({
        uri: baseUri,
        range: {
          start: { line: 2, character: 2 },
          end: { line: 2, character: 2 }
        }
      })
    );
    const qualifiedFunctionDefinition = await client.sendRequest(DefinitionRequest.type, {
      textDocument: { uri: qualifiedUri },
      position: { line: 1, character: 12 }
    });
    expect(qualifiedFunctionDefinition).toEqual(
      expect.objectContaining({
        uri: baseUri,
        range: {
          start: { line: 5, character: 2 },
          end: { line: 5, character: 2 }
        }
      })
    );

    const localDefinition = await client.sendRequest(DefinitionRequest.type, {
      textDocument: { uri: consumerUri },
      position: positionOf(validConsumer, "LocalEvent", 1)
    });
    expect(localDefinition).toEqual(
      expect.objectContaining({
        uri: consumerUri,
        range: {
          start: { line: 4, character: 0 },
          end: { line: 4, character: 0 }
        }
      })
    );

    await client.sendNotification(DidOpenTextDocumentNotification.type, {
      textDocument: {
        uri: completionUri,
        languageId: "shape",
        version: 1,
        text: "  forbid p"
      }
    });
    expect(await diagnostics.waitFor(completionUri, (items) => items.length > 0)).not.toEqual([]);
    const completion = await client.sendRequest(CompletionRequest.type, {
      textDocument: { uri: completionUri },
      position: { line: 0, character: 10 }
    });
    const completionItems: CompletionItem[] = Array.isArray(completion)
      ? completion
      : (completion?.items ?? []);
    expect(completionItems.find((item) => item.label === "forbid path")).toEqual(
      expect.objectContaining({
        textEdit: {
          range: {
            start: { line: 0, character: 2 },
            end: { line: 0, character: 10 }
          },
          newText: "forbid path"
        }
      })
    );

    const typoCompletionSource = `module completion

component CompletionStore {
  owns AuditEvenX
}
`;
    await client.sendNotification(DidChangeTextDocumentNotification.type, {
      textDocument: {
        uri: completionUri,
        version: 2
      },
      contentChanges: [{ text: typoCompletionSource }]
    });
    const typoCompletion = await client.sendRequest(CompletionRequest.type, {
      textDocument: { uri: completionUri },
      position: { line: 3, character: "  owns AuditEven".length }
    });
    const typoCompletionItems: CompletionItem[] = Array.isArray(typoCompletion)
      ? typoCompletion
      : (typoCompletion?.items ?? []);
    expect(typoCompletionItems.find((item) => item.label === "AuditEvent")).toEqual(
      expect.objectContaining({
        textEdit: {
          range: {
            start: { line: 3, character: "  owns ".length },
            end: { line: 3, character: "  owns AuditEvenX".length }
          },
          newText: "AuditEvent"
        }
      })
    );

    await client.sendNotification(DidChangeTextDocumentNotification.type, {
      textDocument: {
        uri: completionUri,
        version: 3
      },
      contentChanges: [{ text: "forbid paX" }]
    });
    const multiwordCompletion = await client.sendRequest(CompletionRequest.type, {
      textDocument: { uri: completionUri },
      position: { line: 0, character: 4 }
    });
    const multiwordCompletionItems: CompletionItem[] = Array.isArray(multiwordCompletion)
      ? multiwordCompletion
      : (multiwordCompletion?.items ?? []);
    expect(multiwordCompletionItems.find((item) => item.label === "forbid path")).toEqual(
      expect.objectContaining({
        textEdit: {
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: "forbid paX".length }
          },
          newText: "forbid path"
        }
      })
    );

    const contextCompletionCandidate = "InlineRationale<fn Alpha.handle>";
    const contextCompletionSource = `module completion

component Alpha {
  fn handle
    effects complete {
    }
}

rationale Keep : ${contextCompletionCandidate} {
}
`;
    await client.sendNotification(DidChangeTextDocumentNotification.type, {
      textDocument: {
        uri: completionUri,
        version: 4
      },
      contentChanges: [{ text: contextCompletionSource }]
    });
    const contextCompletionLine = contextCompletionSource.split("\n")[8] ?? "";
    const contextCompletionStart = contextCompletionLine.indexOf(contextCompletionCandidate);
    const contextCompletion = await client.sendRequest(CompletionRequest.type, {
      textDocument: { uri: completionUri },
      position: { line: 8, character: contextCompletionStart + 8 }
    });
    const contextCompletionItems: CompletionItem[] = Array.isArray(contextCompletion)
      ? contextCompletion
      : (contextCompletion?.items ?? []);
    expect(
      contextCompletionItems.find((item) => item.label === contextCompletionCandidate)
    ).toEqual(
      expect.objectContaining({
        textEdit: {
          range: {
            start: { line: 8, character: contextCompletionStart },
            end: {
              line: 8,
              character: contextCompletionStart + contextCompletionCandidate.length
            }
          },
          newText: contextCompletionCandidate
        }
      })
    );

    const formatting = await client.sendRequest(DocumentFormattingRequest.type, {
      textDocument: { uri: baseUri },
      options: {
        tabSize: 2,
        insertSpaces: true
      }
    });
    expect(formatting).toHaveLength(1);
    expect(formatting?.[0]?.newText).toContain("\nresource SharedEvent\n");
    expect(formatting?.[0]?.newText).not.toContain("\n  resource SharedEvent\n");

    await client.sendNotification(DidCloseTextDocumentNotification.type, {
      textDocument: { uri: completionUri }
    });
    expect(await diagnostics.waitFor(completionUri, (items) => items.length === 0)).toEqual([]);
    await client.sendNotification(DidCloseTextDocumentNotification.type, {
      textDocument: { uri: qualifiedUri }
    });
    expect(await diagnostics.waitFor(qualifiedUri, (items) => items.length === 0)).toEqual([]);

    await client.sendRequest(ShutdownRequest.type);
    await client.sendNotification(ExitNotification.type);
    const [exitCode] = await once(child, "exit");
    exited = true;
    expect(exitCode).toBe(0);
    expect(await stderrPromise).toBe("");
  } finally {
    client.dispose();
    if (!exited) {
      child.kill();
      await once(child, "exit").catch(() => undefined);
    }
  }
}, 20_000);

function lspSpawnCommand(): { command: string; args: string[] } {
  const executable = process.env.SHP_LSP_EXECUTABLE;
  if (executable) {
    return {
      command: resolve(repoRoot, executable),
      args: ["lsp"]
    };
  }

  return {
    command: process.execPath,
    args: [cliPath, "lsp"]
  };
}

function diagnosticsCollector(client: ReturnType<typeof createProtocolConnection>): {
  after: (uri: string, marker: number) => Diagnostic[][];
  mark: () => number;
  waitFor: (
    uri: string,
    predicate: (diagnostics: readonly Diagnostic[]) => boolean
  ) => Promise<Diagnostic[]>;
  waitForAfter: (
    uri: string,
    marker: number,
    predicate: (diagnostics: readonly Diagnostic[]) => boolean
  ) => Promise<Diagnostic[]>;
} {
  type DiagnosticBatch = {
    diagnostics: Diagnostic[];
    sequence: number;
  };
  type DiagnosticWaiter = {
    afterSequence: number;
    predicate: (diagnostics: readonly Diagnostic[]) => boolean;
    resolve: (diagnostics: Diagnostic[]) => void;
  };

  let sequence = 0;
  const history = new Map<string, DiagnosticBatch[]>();
  const latest = new Map<string, DiagnosticBatch>();
  const waiters = new Map<string, DiagnosticWaiter[]>();

  client.onNotification(PublishDiagnosticsNotification.type, (params: PublishDiagnosticsParams) => {
    sequence += 1;
    const batch = {
      diagnostics: params.diagnostics,
      sequence
    };
    latest.set(params.uri, batch);
    history.set(params.uri, [...(history.get(params.uri) ?? []), batch]);
    const uriWaiters = waiters.get(params.uri) ?? [];
    const pending = [];
    for (const waiter of uriWaiters) {
      if (sequence > waiter.afterSequence && waiter.predicate(params.diagnostics)) {
        waiter.resolve(params.diagnostics);
      } else {
        pending.push(waiter);
      }
    }
    waiters.set(params.uri, pending);
  });

  const waitForAfter = async (
    uri: string,
    afterSequence: number,
    predicate: (diagnostics: readonly Diagnostic[]) => boolean
  ): Promise<Diagnostic[]> => {
    const current = latest.get(uri);
    if (current && current.sequence > afterSequence && predicate(current.diagnostics)) {
      return current.diagnostics;
    }

    return await new Promise<Diagnostic[]>((resolveWaiter, rejectWaiter) => {
      let timeout: ReturnType<typeof setTimeout>;
      const waiter: DiagnosticWaiter = {
        afterSequence,
        predicate,
        resolve: (items) => {
          clearTimeout(timeout);
          resolveWaiter(items);
        }
      };
      const uriWaiters = waiters.get(uri) ?? [];
      uriWaiters.push(waiter);
      waiters.set(uri, uriWaiters);
      timeout = setTimeout(() => {
        waiters.set(
          uri,
          (waiters.get(uri) ?? []).filter((candidate) => candidate !== waiter)
        );
        rejectWaiter(new Error(`timed out waiting for diagnostics for ${uri}`));
      }, 5_000);
    });
  };

  return {
    after: (uri, marker) =>
      (history.get(uri) ?? [])
        .filter((batch) => batch.sequence > marker)
        .map((batch) => batch.diagnostics),
    mark: () => sequence,
    waitFor: (uri, predicate) => waitForAfter(uri, -1, predicate),
    waitForAfter
  };
}

function positionOf(
  source: string,
  text: string,
  occurrence: number
): {
  line: number;
  character: number;
} {
  let offset = -1;
  let from = 0;
  for (let index = 0; index <= occurrence; index += 1) {
    offset = source.indexOf(text, from);
    if (offset < 0) {
      throw new Error(`missing occurrence ${occurrence} of ${text}`);
    }
    from = offset + text.length;
  }

  const before = source.slice(0, offset);
  const lines = before.split("\n");
  return {
    line: lines.length - 1,
    character: (lines.at(-1) ?? "").length + 1
  };
}

async function streamText(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}
