function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  state.width = Math.max(1, rect.width);
  state.height = Math.max(1, rect.height);
  state.dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(state.width * state.dpr);
  canvas.height = Math.round(state.height * state.dpr);
  scheduleRender();
}

function isTypingTarget(target) {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target.isContentEditable
  );
}

canvas.addEventListener("pointerdown", (event) => {
  pauseJourneyForManualControl();
  canvas.focus();
  state.hoverId = null;
  state.pointer = {
    id: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    startX: event.clientX,
    startY: event.clientY,
    dragged: false
  };
  canvas.setPointerCapture(event.pointerId);
  scheduleRender();
});

canvas.addEventListener("pointermove", (event) => {
  if (state.pointer?.id === event.pointerId) {
    const dx = event.clientX - state.pointer.x;
    const dy = event.clientY - state.pointer.y;
    if (
      Math.abs(event.clientX - state.pointer.startX) +
        Math.abs(event.clientY - state.pointer.startY) >
      5
    ) {
      state.pointer.dragged = true;
    }
    if (state.pointer.dragged) {
      state.focus = null;
      const panScale = Math.max(0.32, state.camera.y * 0.0105);
      state.camera.x -= dx * panScale;
      state.camera.z += dy * panScale;
      state.camera.yaw = fixedPerspective.yaw;
      state.camera.pitch = fixedPerspective.pitch;
    }
    state.pointer.x = event.clientX;
    state.pointer.y = event.clientY;
    scheduleRender();
    return;
  }
  const node = nodeUnderPointer(event);
  const nextHover = node?.id || null;
  if (nextHover !== state.hoverId) {
    state.hoverId = nextHover;
    canvas.style.cursor = node ? "pointer" : "crosshair";
    scheduleRender();
  }
});

canvas.addEventListener("pointerleave", () => {
  if (!state.pointer) {
    state.hoverId = null;
    canvas.style.cursor = "crosshair";
    scheduleRender();
  }
});

function releasePointer(event) {
  if (!state.pointer || state.pointer.id !== event.pointerId) {
    return;
  }
  const wasDragged = state.pointer.dragged;
  state.pointer = null;
  if (canvas.hasPointerCapture(event.pointerId)) {
    canvas.releasePointerCapture(event.pointerId);
  }
  if (!wasDragged) {
    const node = nodeUnderPointer(event);
    if (node) {
      focusNode(node, true);
    } else {
      panToGround(groundPointFromPointer(event), true);
    }
  }
  scheduleRender();
}

canvas.addEventListener("pointerup", releasePointer);
canvas.addEventListener("pointercancel", (event) => {
  if (!state.pointer || state.pointer.id !== event.pointerId) {
    return;
  }
  state.pointer = null;
  if (canvas.hasPointerCapture(event.pointerId)) {
    canvas.releasePointerCapture(event.pointerId);
  }
  scheduleRender();
});
canvas.addEventListener(
  "wheel",
  (event) => {
    pauseJourneyForManualControl();
    state.focus = null;
    state.camera.y = clamp(state.camera.y + event.deltaY * 0.09, 42, maximumCameraHeight);
    scheduleRender();
    event.preventDefault();
  },
  { passive: false }
);

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    pauseJourneyForManualControl();
    resetOverview(true);
    return;
  }
  if (isTypingTarget(event.target)) {
    return;
  }
  const key = event.key.toLowerCase();
  if (["w", "a", "s", "d", "q", "e"].includes(key)) {
    pauseJourneyForManualControl();
    state.keys.add(key);
    scheduleRender();
    event.preventDefault();
  }
  if (event.key === "Shift") {
    state.keys.add("Shift");
  }
});

window.addEventListener("keyup", (event) => {
  state.keys.delete(event.key.toLowerCase());
  if (event.key === "Shift") {
    state.keys.delete("Shift");
  }
  scheduleRender();
});

locator.addEventListener("input", () => {
  pauseJourneyForManualControl();
  renderResults(locator.value);
});
locator.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    const first = results.querySelector("button");
    if (first) {
      first.click();
    }
  }
});
overviewButton.addEventListener("click", () => {
  pauseJourneyForManualControl();
  resetOverview(true);
});
function syncMotionButton() {
  motionButton.setAttribute("aria-pressed", String(state.pathGlow));
  motionButton.textContent = state.pathGlow ? "PAUSE PATH GLOW" : "RESUME PATH GLOW";
}
motionButton.addEventListener("click", () => {
  state.pathGlow = !state.pathGlow;
  syncMotionButton();
  scheduleRender();
  announce(state.pathGlow ? "Path glow resumed." : "Path glow paused.");
});
prefersReducedMotion.addEventListener("change", (event) => {
  if (event.matches) {
    state.pathGlow = false;
    syncMotionButton();
    scheduleRender();
  }
});
window.addEventListener("blur", () => {
  state.keys.clear();
  pauseJourneyForManualControl();
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    pauseJourneyForManualControl();
    if (animationFrame !== null) {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = null;
    }
    return;
  }
  state.lastTime = performance.now();
  scheduleRender();
});
new ResizeObserver(resizeCanvas).observe(canvas);

resetOverview(false);
resizeCanvas();
syncMotionButton();
const testingApi = {
  get ready() {
    return state.rendered;
  },
  ids() {
    return nodes.map((node) => node.id);
  },
  focusById(id) {
    const node = nodeById.get(id) || nodeByModelId.get(id);
    if (node) {
      pauseJourneyForManualControl();
      focusNode(node, false);
    }
    return Boolean(node);
  },
  focus(label) {
    const node = nodes.find((candidate) => candidate.label === label);
    if (node) {
      pauseJourneyForManualControl();
      focusNode(node, false);
    }
    return Boolean(node);
  },
  reset() {
    pauseJourneyForManualControl();
    resetOverview(false);
  },
  setMotion(enabled) {
    state.pathGlow = Boolean(enabled) && !prefersReducedMotion.matches;
    syncMotionButton();
    scheduleRender();
    return state.pathGlow;
  },
  settle() {
    const startingFrame = state.frame;
    scheduleRender();
    return new Promise((resolve) => {
      function check() {
        if (state.frame > startingFrame && !state.focus) {
          resolve();
          return;
        }
        window.requestAnimationFrame(check);
      }
      check();
    });
  },
  point(label) {
    const item = state.projected.find((candidate) => candidate.node.label === label);
    return item ? { x: item.point.x, y: item.point.y, radius: item.radius } : null;
  },
  hitAreas(label) {
    const item = state.projected.find((candidate) => candidate.node.label === label);
    return item
      ? item.hitAreas.map((area) => area.map((point) => ({ x: point.x, y: point.y })))
      : null;
  },
  journeyIds,
  select: selectJourney,
  play: playJourney,
  pause: pauseJourney,
  restart: restartJourney,
  next: nextJourneyStep,
  previous: previousJourneyStep,
  seek: seekJourneyStep,
  setSpeed: setJourneySpeed,
  selectJourney,
  playJourney,
  pauseJourney,
  restartJourney,
  nextJourneyStep,
  previousJourneyStep,
  seekJourneyStep,
  setJourneySpeed,
  journeySnapshot,
  snapshot() {
    return {
      selectedId: state.selectedId,
      camera: { ...state.camera },
      nodes: nodes.length,
      paths: edges.length,
      districts: districts.length,
      moduleFiles: Object.fromEntries(
        districts.map((district) => [district.module, district.files.slice()])
      ),
      pathGlow: state.pathGlow,
      journey: journeySnapshot(),
      rendererVersion: 2,
      schemaVersion: atlas.schemaVersion,
      shapeVersion: atlas.shapeVersion
    };
  }
};
window.__unixSystemVisualiser = testingApi;
scheduleRender();
