import { dispatch, frame, FrameDecoder, MapperSession, rpcFailure } from "./protocol.ts";

const session = new MapperSession();
const decoder = new FrameDecoder();

function fail(error: unknown): void {
  process.stdout.write(frame(rpcFailure(null, error)));
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
