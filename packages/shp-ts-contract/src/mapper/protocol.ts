import { dirname, isAbsolute, resolve } from "node:path";
import { emitContract } from "./emit.ts";

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export class RpcError extends Error {
  constructor(
    readonly code: number,
    message: string
  ) {
    super(message);
  }
}

type Project = { repoRoot: string } | { error: string };

/** Only explicit, static project options affect transforms; no project files are read. */
export class MapperSession {
  readonly #projects = new Map<string, Project>();
  #initialized = false;

  handle(method: string, input: unknown): unknown {
    if (!object(input)) throw new RpcError(-32602, "Expected an object of method parameters.");
    if (method === "initialize") {
      if (!Array.isArray(input.positionEncodings) || !input.positionEncodings.includes("utf-16")) {
        throw new RpcError(-32602, "Shape contracts require the utf-16 position encoding.");
      }
      this.#initialized = true;
      return { positionEncoding: "utf-16", diagnosticSource: "shape-ts" };
    }
    if (!this.#initialized)
      throw new RpcError(-32002, "Initialize the mapper before opening a project.");
    if (!["openProject", "transform", "closeProject"].includes(method)) {
      throw new RpcError(-32601, `Unsupported mapper method ${method}.`);
    }
    if (typeof input.projectHandle !== "string" || !input.projectHandle) {
      throw new RpcError(-32602, "A nonempty projectHandle is required.");
    }
    const handle = input.projectHandle;
    if (method === "openProject") {
      if (this.#projects.has(handle))
        throw new RpcError(-32602, `Project handle ${handle} is already open.`);
      const errors: { path: string[]; code: number; messageText: string }[] = [];
      const report = (path: string[], messageText: string): void => {
        errors.push({ path, code: 1006, messageText });
      };
      const options = input.options ?? {};
      if (!object(options))
        report([], "Mapper options must be an object containing only repoRoot.");
      else {
        for (const key of Object.keys(options).sort()) {
          if (key !== "repoRoot")
            report([key], `Unknown mapper option ${key}; only repoRoot is supported.`);
        }
        if (
          options.repoRoot !== undefined &&
          (typeof options.repoRoot !== "string" ||
            !options.repoRoot ||
            options.repoRoot.includes("\0"))
        ) {
          report(["repoRoot"], "repoRoot must be a nonempty path string.");
        }
      }
      if (typeof input.configFileName !== "string" || !isAbsolute(input.configFileName)) {
        report([], "Version 1 requires a configured project with an absolute configFileName.");
      }
      if (errors.length) {
        this.#projects.set(handle, { error: errors.map((error) => error.messageText).join(" ") });
        return { optionDiagnostics: errors };
      }
      // Values are narrowed again rather than trusted through the diagnostic accumulator.
      if (!object(options) || typeof input.configFileName !== "string")
        throw new RpcError(-32602, "Invalid project options.");
      const root = typeof options.repoRoot === "string" ? options.repoRoot : ".";
      this.#projects.set(handle, { repoRoot: resolve(dirname(input.configFileName), root) });
      return {};
    }
    const project = this.#projects.get(handle);
    if (!project) throw new RpcError(-32602, `Unknown or closed project handle ${handle}.`);
    if (method === "closeProject") {
      this.#projects.delete(handle);
      return null;
    }
    if (typeof input.fileName !== "string" || typeof input.content !== "string") {
      throw new RpcError(-32602, "transform requires fileName and content strings.");
    }
    if ("error" in project) {
      return {
        text: "export {};\n",
        extension: ".ts",
        mappings: [],
        diagnostics: [
          {
            code: 1006,
            messageText: `Invalid mapper project options: ${project.error}`,
            start: 0,
            length: Math.min(1, input.content.length)
          }
        ]
      };
    }
    return emitContract({
      fileName: input.fileName,
      content: input.content,
      repoRoot: project.repoRoot
    });
  }
}

export type RpcReply = { jsonrpc: "2.0"; id: string | number | null } & (
  | { result: unknown }
  | { error: { code: number; message: string } }
);

export function dispatch(session: MapperSession, message: unknown): RpcReply | undefined {
  if (object(message) && message.id === undefined) return undefined;
  const id =
    object(message) && (typeof message.id === "string" || typeof message.id === "number")
      ? message.id
      : null;
  try {
    if (
      !object(message) ||
      message.jsonrpc !== "2.0" ||
      typeof message.method !== "string" ||
      id === null
    ) {
      throw new RpcError(-32600, "Expected a JSON-RPC 2.0 request with an id and method.");
    }
    return { jsonrpc: "2.0", id, result: session.handle(message.method, message.params ?? {}) };
  } catch (error) {
    return {
      jsonrpc: "2.0",
      id,
      error: {
        code: error instanceof RpcError ? error.code : -32603,
        message: error instanceof Error ? error.message : String(error)
      }
    };
  }
}

/** Content-Length is byte-based even though mappings use UTF-16 offsets. */
export function frame(message: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`), body]);
}

export class FrameDecoder {
  #buffer = Buffer.alloc(0);

  push(chunk: Uint8Array): unknown[] {
    this.#buffer = Buffer.concat([this.#buffer, chunk]);
    const messages: unknown[] = [];
    while (this.#buffer.length) {
      const boundary = this.#buffer.indexOf("\r\n\r\n");
      if (boundary < 0) {
        if (this.#buffer.length > 8192)
          throw new RpcError(-32700, "Mapper frame header exceeds 8192 bytes.");
        break;
      }
      if (boundary > 8192) throw new RpcError(-32700, "Mapper frame header exceeds 8192 bytes.");
      const header = this.#buffer.subarray(0, boundary).toString("ascii");
      const lengths: string[] = [];
      for (const line of header.split("\r\n")) {
        const colon = line.indexOf(":");
        if (colon < 1) throw new RpcError(-32700, "Malformed mapper frame header.");
        if (line.slice(0, colon).trim().toLowerCase() === "content-length") {
          lengths.push(line.slice(colon + 1).trim());
        }
      }
      const length = Number(lengths[0]);
      if (
        lengths.length !== 1 ||
        !/^\d+$/.test(lengths[0] ?? "") ||
        !Number.isSafeInteger(length) ||
        length < 0 ||
        length > 16 * 1024 * 1024
      ) {
        throw new RpcError(-32700, "Expected one Content-Length no larger than 16 MiB.");
      }
      if (this.#buffer.length < boundary + 4 + length) break;
      const body = this.#buffer.subarray(boundary + 4, boundary + 4 + length).toString("utf8");
      this.#buffer = this.#buffer.subarray(boundary + 4 + length);
      try {
        messages.push(JSON.parse(body));
      } catch {
        throw new RpcError(-32700, "Mapper frame body must contain valid JSON.");
      }
    }
    return messages;
  }

  finish(): void {
    if (this.#buffer.length) throw new RpcError(-32700, "Incomplete mapper frame at end of input.");
  }
}
