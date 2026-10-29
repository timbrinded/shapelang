import { dispatch, frame, FrameDecoder, MapperSession, RpcError } from "./protocol.ts";

const session = new MapperSession();
const decoder = new FrameDecoder();

function fail(error: unknown): void {
  process.stdout.write(
    frame({
      jsonrpc: "2.0",
      id: null,
      error: {
        code: error instanceof RpcError ? error.code : -32603,
        message: error instanceof Error ? error.message : String(error)
      }
    })
  );
  process.exitCode = 1;
  process.stdin.destroy();
}

process.stdin.on("data", (chunk: Buffer) => {
  try {
    for (const message of decoder.push(chunk)) {
      const reply = dispatch(session, message);
      if (reply) process.stdout.write(frame(reply));
    }
  } catch (error) {
    fail(error);
  }
});
process.stdin.on("end", () => {
  try {
    decoder.finish();
  } catch (error) {
    fail(error);
  }
});
