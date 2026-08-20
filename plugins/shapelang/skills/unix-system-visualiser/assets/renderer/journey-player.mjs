const JOURNEY_SPEEDS = new Set([0.5, 1, 1.5, 2]);

export function createJourneyPlayer({
  journeys,
  onChange = () => {},
  onStep = () => {},
  schedule = (callback, delay) => window.setTimeout(callback, delay),
  cancel = (timer) => window.clearTimeout(timer),
  interval = 4000
}) {
  const journeyById = new Map(journeys.map((journey) => [journey.id, journey]));
  let selectedId = journeys[0]?.id ?? null;
  let index = -1;
  let speed = 1;
  let status = selectedId ? "paused" : "idle";
  let timer = null;

  function selectedJourney() {
    return selectedId ? (journeyById.get(selectedId) ?? null) : null;
  }

  function clearPending() {
    if (timer !== null) {
      cancel(timer);
      timer = null;
    }
  }

  function snapshot() {
    const journey = selectedJourney();
    const step = journey?.steps[index] ?? null;
    return {
      selectedId,
      status,
      index,
      count: journey?.steps.length ?? 0,
      speed,
      currentNodeId: step?.nodeId ?? null,
      narration: step?.narration ?? "",
      kind: journey?.kind ?? null,
      title: journey?.title ?? null
    };
  }

  function emitChange() {
    onChange(snapshot());
  }

  function emitStep() {
    const journey = selectedJourney();
    const step = journey?.steps[index];
    if (journey && step) {
      onStep(step, journey, snapshot());
    }
  }

  function scheduleNext() {
    clearPending();
    if (status !== "playing") {
      return;
    }
    timer = schedule(() => {
      timer = null;
      const journey = selectedJourney();
      if (!journey || index >= journey.steps.length - 1) {
        status = journey ? "complete" : "idle";
        emitChange();
        return;
      }
      index += 1;
      emitStep();
      if (index >= journey.steps.length - 1) {
        status = "complete";
        emitChange();
        return;
      }
      emitChange();
      scheduleNext();
    }, interval / speed);
  }

  function select(id) {
    if (!journeyById.has(id)) {
      return false;
    }
    clearPending();
    selectedId = id;
    index = 0;
    status = "paused";
    emitStep();
    emitChange();
    return true;
  }

  function play() {
    const journey = selectedJourney();
    if (!journey || journey.steps.length === 0) {
      return false;
    }
    clearPending();
    if (status === "complete" || index < 0 || index >= journey.steps.length) {
      index = 0;
    }
    status = "playing";
    emitStep();
    emitChange();
    scheduleNext();
    return true;
  }

  function pause() {
    if (status !== "playing") {
      return false;
    }
    clearPending();
    status = "paused";
    emitChange();
    return true;
  }

  function restart() {
    const journey = selectedJourney();
    if (!journey || journey.steps.length === 0) {
      return false;
    }
    clearPending();
    index = 0;
    status = "paused";
    emitStep();
    emitChange();
    return true;
  }

  function seek(nextIndex) {
    const journey = selectedJourney();
    if (!journey || !Number.isInteger(nextIndex)) {
      return false;
    }
    const bounded = Math.max(0, Math.min(journey.steps.length - 1, nextIndex));
    clearPending();
    index = bounded;
    status = index === journey.steps.length - 1 ? "complete" : "paused";
    emitStep();
    emitChange();
    return true;
  }

  function next() {
    const journey = selectedJourney();
    if (!journey || index >= journey.steps.length - 1) {
      return false;
    }
    return seek(index + 1);
  }

  function previous() {
    if (!selectedJourney() || index <= 0) {
      return false;
    }
    return seek(index - 1);
  }

  function setSpeed(nextSpeed) {
    if (!JOURNEY_SPEEDS.has(nextSpeed)) {
      return false;
    }
    speed = nextSpeed;
    if (status === "playing") {
      scheduleNext();
    }
    emitChange();
    return true;
  }

  function destroy() {
    clearPending();
  }

  return {
    destroy,
    next,
    pause,
    play,
    previous,
    restart,
    seek,
    select,
    setSpeed,
    snapshot
  };
}
