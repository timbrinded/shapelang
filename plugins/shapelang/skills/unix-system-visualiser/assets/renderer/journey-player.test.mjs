import { describe, expect, test } from "bun:test";
import { createJourneyPlayer } from "./journey-player.mjs";

describe("Unix System Visualiser journey player", () => {
  test("supports selection, manual navigation, restart, and replay without overflow", () => {
    const visited = [];
    const player = createJourneyPlayer({
      journeys: [journey("one", 3), journey("two", 2)],
      onStep: (step) => visited.push(step.nodeId),
      schedule: () => 1,
      cancel: () => {}
    });

    expect(player.snapshot()).toMatchObject({
      selectedId: "one",
      status: "paused",
      index: -1,
      count: 3,
      speed: 1,
      currentNodeId: null
    });
    expect(player.previous()).toBe(false);
    expect(player.next()).toBe(true);
    expect(player.snapshot().index).toBe(0);
    player.next();
    player.next();
    expect(player.next()).toBe(false);
    expect(player.snapshot()).toMatchObject({ status: "complete", index: 2 });
    player.play();
    expect(player.snapshot()).toMatchObject({ status: "playing", index: 0 });
    player.pause();
    player.restart();
    expect(player.snapshot()).toMatchObject({ status: "paused", index: 0 });
    expect(player.select("two")).toBe(true);
    expect(player.select("missing")).toBe(false);
    expect(player.snapshot()).toMatchObject({ selectedId: "two", index: 0, count: 2 });
    expect(visited).toContain("one-node-2");
    expect(visited.at(-1)).toBe("two-node-0");
  });

  test("reschedules playback for speed changes, pauses cleanly, and stops at the end", () => {
    const scheduler = fakeScheduler();
    const player = createJourneyPlayer({
      journeys: [journey("flow", 3)],
      schedule: scheduler.schedule,
      cancel: scheduler.cancel
    });

    expect(player.play()).toBe(true);
    expect(scheduler.delays()).toEqual([4000]);
    expect(player.setSpeed(2)).toBe(true);
    expect(scheduler.delays()).toEqual([2000]);
    expect(player.setSpeed(3)).toBe(false);
    scheduler.runNext();
    expect(player.snapshot()).toMatchObject({ status: "playing", index: 1, speed: 2 });
    expect(scheduler.delays()).toEqual([2000]);
    expect(player.pause()).toBe(true);
    expect(scheduler.delays()).toEqual([]);
    player.play();
    scheduler.runNext();
    expect(player.snapshot()).toMatchObject({ status: "complete", index: 2 });
    expect(scheduler.delays()).toEqual([]);
    expect(JSON.stringify(player.snapshot())).not.toContain("time");
  });
});

function journey(id, count) {
  return {
    id,
    title: id,
    kind: "authored",
    steps: Array.from({ length: count }, (_, index) => ({
      id: `${id}-step-${index}`,
      nodeId: `${id}-node-${index}`,
      narration: `${id} narration ${index}`
    }))
  };
}

function fakeScheduler() {
  let nextId = 1;
  const tasks = new Map();
  return {
    schedule(callback, delay) {
      const id = nextId;
      nextId += 1;
      tasks.set(id, { callback, delay });
      return id;
    },
    cancel(id) {
      tasks.delete(id);
    },
    delays() {
      return [...tasks.values()].map((task) => task.delay);
    },
    runNext() {
      const entry = tasks.entries().next().value;
      if (!entry) {
        throw new Error("no scheduled journey step");
      }
      const [id, task] = entry;
      tasks.delete(id);
      task.callback();
    }
  };
}
