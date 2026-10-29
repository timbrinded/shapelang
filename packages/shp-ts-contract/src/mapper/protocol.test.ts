import { describe, expect, test } from "bun:test";
import type { TransformResult } from "./emit.ts";
import { dispatch, frame, FrameDecoder, MapperSession, RpcError } from "./protocol.ts";

// Protocol oracle: TypeScript's native content-mapper protocol negotiates a
// position encoding and keeps options local to each opaque project handle.
// Transport Content-Length measures UTF-8 bytes, independently of span offsets.
// These tests exercise the actual session and decoder, not a simulated server.

const content = `module api
component Api {
  fn answer
    source ts("src/math.ts#answer")
    signature ts("() => number")
    effects unknown
}
`;

function initialized(): MapperSession {
  const session = new MapperSession();
  session.handle("initialize", { positionEncodings: ["utf-8", "utf-16"] });
  return session;
}

function open(session: MapperSession, handle: string, root: string): unknown {
  return session.handle("openProject", {
    projectHandle: handle,
    configFileName: `${root}/config/tsconfig.json`,
    options: { repoRoot: ".." },
    compilerOptions: { strict: true }
  });
}

function transform(session: MapperSession, handle: string, root: string): TransformResult {
  return session.handle("transform", {
    projectHandle: handle,
    fileName: `${root}/src/math.shape`,
    content
  }) as TransformResult;
}

function expectRpcError(action: () => unknown, code: number): RpcError {
  let thrown: unknown;
  try {
    action();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(RpcError);
  if (!(thrown instanceof RpcError)) throw new Error("Expected an RPC error.");
  expect(thrown.code).toBe(code);
  expect(thrown.message.length).toBeGreaterThan(0);
  return thrown;
}

describe("native content-mapper project protocol", () => {
  test("negotiates UTF-16 only when the client offers it", () => {
    const session = new MapperSession();
    expectRpcError(() => session.handle("initialize", { positionEncodings: ["utf-8"] }), -32602);
    expectRpcError(() => open(session, "before-initialization", "/projects/alpha"), -32002);
    expect(session.handle("initialize", { positionEncodings: ["utf-8", "utf-16"] })).toEqual({
      positionEncoding: "utf-16",
      diagnosticSource: "shape-ts"
    });
    expect(open(session, "after-initialization", "/projects/alpha")).toEqual({});
  });

  test("isolates repoRoot and relative config-directory resolution between project handles", () => {
    const session = initialized();
    open(session, "left", "/projects/alpha");
    open(session, "right", "/projects/beta");
    const left = transform(session, "left", "/projects/alpha");
    const right = transform(session, "right", "/projects/beta");
    expect(left.diagnostics).toEqual([]);
    expect(right.diagnostics).toEqual([]);
    expect(left.extension).toBe(".ts");
    expect(left.mappings.length).toBeGreaterThan(0);
    expect(left.text).toContain('from "./math.js"');
    const wrongProject = transform(session, "right", "/projects/alpha");
    expect(wrongProject.diagnostics).toMatchObject([{ code: 1007 }]);
    expect(wrongProject.text).toBe("export {};\n");
    expect(session.handle("closeProject", { projectHandle: "left" })).toBeNull();
    expect(transform(session, "right", "/projects/beta").diagnostics).toEqual([]);
  });

  test("a duplicate handle is rejected without replacing the original project", () => {
    const session = initialized();
    open(session, "same", "/projects/alpha");
    expectRpcError(() => open(session, "same", "/projects/beta"), -32602);
    expect(transform(session, "same", "/projects/alpha").diagnostics).toEqual([]);
    expect(transform(session, "same", "/projects/beta").diagnostics).toMatchObject([
      { code: 1007 }
    ]);
  });

  test("unknown and closed handles fail, while a closed handle can be opened afresh", () => {
    const session = initialized();
    expectRpcError(() => transform(session, "missing", "/projects/alpha"), -32602);
    expectRpcError(() => session.handle("closeProject", { projectHandle: "missing" }), -32602);
    open(session, "reused", "/projects/alpha");
    session.handle("closeProject", { projectHandle: "reused" });
    expectRpcError(() => transform(session, "reused", "/projects/alpha"), -32602);
    open(session, "reused", "/projects/beta");
    expect(transform(session, "reused", "/projects/beta").diagnostics).toEqual([]);
    expect(transform(session, "reused", "/projects/alpha").diagnostics).toMatchObject([
      { code: 1007 }
    ]);
  });

  test("invalid project options produce option diagnostics and cannot later yield a successful transform", () => {
    const session = initialized();
    open(session, "valid", "/projects/alpha");
    const opened = session.handle("openProject", {
      projectHandle: "invalid",
      configFileName: "/projects/beta/tsconfig.json",
      options: { repoRoot: 42, typo: true },
      compilerOptions: { strict: true }
    }) as { optionDiagnostics: { path: string[]; code: number; messageText: string }[] };
    expect(opened.optionDiagnostics).toHaveLength(2);
    expect(opened.optionDiagnostics).toContainEqual({
      path: ["repoRoot"],
      code: 1006,
      messageText: expect.any(String)
    });
    expect(opened.optionDiagnostics).toContainEqual({
      path: ["typo"],
      code: 1006,
      messageText: expect.any(String)
    });
    const failed = transform(session, "invalid", "/projects/beta");
    expect(failed).toMatchObject({
      extension: ".ts",
      text: "export {};\n",
      mappings: [],
      diagnostics: [{ code: 1006, start: 0, length: 1 }]
    });
    expect(transform(session, "valid", "/projects/alpha").diagnostics).toEqual([]);
  });

  test("requests with unknown methods or invalid transform arguments return structured RPC failures", () => {
    const session = initialized();
    open(session, "project", "/projects/alpha");
    const unknown = dispatch(session, {
      jsonrpc: "2.0",
      id: "unknown",
      method: "invented",
      params: {}
    });
    expect(unknown).toMatchObject({ jsonrpc: "2.0", id: "unknown", error: { code: -32601 } });
    const invalid = dispatch(session, {
      jsonrpc: "2.0",
      id: 8,
      method: "transform",
      params: { projectHandle: "project", fileName: 3 }
    });
    expect(invalid).toMatchObject({ jsonrpc: "2.0", id: 8, error: { code: -32602 } });
    expect(transform(session, "project", "/projects/alpha").diagnostics).toEqual([]);
  });

  test("dispatch preserves request identifiers and rejects malformed requests", () => {
    const session = new MapperSession();
    expect(
      dispatch(session, {
        jsonrpc: "2.0",
        id: 0,
        method: "initialize",
        params: { positionEncodings: ["utf-16"] }
      })
    ).toEqual({
      jsonrpc: "2.0",
      id: 0,
      result: { positionEncoding: "utf-16", diagnosticSource: "shape-ts" }
    });
    expect(dispatch(session, { jsonrpc: "1.0", id: "bad", method: "initialize" })).toMatchObject({
      jsonrpc: "2.0",
      id: "bad",
      error: { code: -32600 }
    });
    expect(
      dispatch(session, { jsonrpc: "2.0", method: "$/cancelRequest", params: { id: 1 } })
    ).toBeUndefined();
  });
});

describe("native content-mapper Content-Length transport", () => {
  test("serializes UTF-8 byte length independently of UTF-16 string length", () => {
    const encoded = frame({ text: "π😀" });
    const separator = encoded.indexOf("\r\n\r\n");
    const body = encoded.subarray(separator + 4);
    expect(encoded.subarray(0, separator).toString("ascii")).toBe(
      `Content-Length: ${Buffer.byteLength('{"text":"π😀"}', "utf8")}`
    );
    expect(body.toString("utf8")).toBe('{"text":"π😀"}');
    expect(body.length).toBeGreaterThan(body.toString("utf8").length);
  });

  test("reassembles fragmented headers and split multi-byte UTF-8 characters", () => {
    const decoder = new FrameDecoder();
    const body = Buffer.from('{"jsonrpc":"2.0","id":7,"result":{"text":"π😀"}}', "utf8");
    const wire = Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`), body]);
    const messages: unknown[] = [];
    for (const byte of wire) messages.push(...decoder.push(Uint8Array.of(byte)));
    expect(messages).toEqual([{ jsonrpc: "2.0", id: 7, result: { text: "π😀" } }]);
    expect(() => decoder.finish()).not.toThrow();
  });

  test("handles coalesced messages and retains a partial trailing frame", () => {
    const decoder = new FrameDecoder();
    const first = Buffer.from('Content-Length: 8\r\n\r\n{"id":1}');
    const second = Buffer.from('Content-Length: 8\r\n\r\n{"id":2}');
    const third = Buffer.from('Content-Length: 8\r\n\r\n{"id":3}');
    expect(decoder.push(Buffer.concat([first, second, third.subarray(0, 10)]))).toEqual([
      { id: 1 },
      { id: 2 }
    ]);
    expect(decoder.push(third.subarray(10))).toEqual([{ id: 3 }]);
    expect(() => decoder.finish()).not.toThrow();
  });

  test.each([
    ["missing length", "Other: 2\r\n\r\n{}"],
    ["duplicate length", "Content-Length: 2\r\nContent-Length: 2\r\n\r\n{}"],
    ["malformed duplicate length", "Content-Length: nope\r\nContent-Length: 2\r\n\r\n{}"],
    ["negative length", "Content-Length: -1\r\n\r\n{}"],
    ["oversized body", "Content-Length: 16777217\r\n\r\n"],
    ["invalid JSON", "Content-Length: 1\r\n\r\n{"],
    ["oversized unterminated header", "x".repeat(8193)],
    ["oversized terminated header", `X-Padding: ${"x".repeat(8192)}\r\nContent-Length: 2\r\n\r\n{}`]
  ])("rejects malformed transport: %s", (_label, wire) => {
    expectRpcError(() => new FrameDecoder().push(Buffer.from(wire!)), -32700);
  });

  test("rejects end-of-input inside either a header or its declared body", () => {
    for (const wire of ["Content-Len", "Content-Length: 2\r\n\r\n{"]) {
      const decoder = new FrameDecoder();
      expect(decoder.push(Buffer.from(wire))).toEqual([]);
      expectRpcError(() => decoder.finish(), -32700);
    }
  });
});
