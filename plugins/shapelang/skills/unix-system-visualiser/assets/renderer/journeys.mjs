const journeySelect = document.getElementById("journey-select");
const journeyKind = document.getElementById("journey-kind");
const journeySummary = document.getElementById("journey-summary");
const journeyStepCount = document.getElementById("journey-step-count");
const journeyPlaybackStatus = document.getElementById("journey-playback-status");
const journeyProgress = document.getElementById("journey-progress");
const journeySeek = document.getElementById("journey-seek");
const journeyNarration = document.getElementById("journey-narration");
const journeyPreviousButton = document.getElementById("journey-previous");
const journeyPlayButton = document.getElementById("journey-play");
const journeyNextButton = document.getElementById("journey-next");
const journeyRestartButton = document.getElementById("journey-restart");
const journeySpeed = document.getElementById("journey-speed");
const journeyRecords = atlas.journeys ?? [];
const journeyById = new Map(journeyRecords.map((journey) => [journey.id, journey]));

journeySelect.replaceChildren();
if (journeyRecords.length === 0) {
  const option = document.createElement("option");
  option.textContent = "No journeys available";
  option.value = "";
  journeySelect.append(option);
} else {
  journeyRecords.forEach((journey) => {
    const option = document.createElement("option");
    option.value = journey.id;
    option.textContent =
      (journey.kind === "authored" ? "AUTHORED — " : "INFERRED — ") + journey.title;
    journeySelect.append(option);
  });
}

const journeyPlayer = createJourneyPlayer({
  journeys: journeyRecords,
  onChange: renderJourneyState,
  onStep: applyJourneyStep
});

function currentJourney(snapshot = journeyPlayer.snapshot()) {
  return snapshot.selectedId ? (journeyById.get(snapshot.selectedId) ?? null) : null;
}

function applyJourneyStep(step) {
  focusJourneyStep(step);
  scheduleRender();
}

function renderJourneyState(snapshot) {
  const journey = currentJourney(snapshot);
  const hasJourney = Boolean(journey && snapshot.count > 0);
  const stepNumber = hasJourney ? snapshot.index + 1 : 0;
  journeySelect.disabled = !hasJourney;
  journeySelect.value = journey?.id ?? "";
  journeyKind.textContent = journey
    ? journey.kind === "authored"
      ? "AUTHORED"
      : "INFERRED TOUR"
    : "NONE";
  journeyKind.className = "journey-kind" + (journey ? ` is-${journey.kind}` : "");
  journeySummary.textContent =
    journey?.summary ?? "No authored or inferred architecture journey is available.";
  journeyStepCount.textContent = `STEP ${stepNumber} OF ${snapshot.count}`;
  journeyPlaybackStatus.textContent = snapshot.status.toUpperCase();
  journeyProgress.max = Math.max(1, snapshot.count);
  journeyProgress.value = stepNumber;
  journeyProgress.textContent =
    snapshot.count > 0 ? `${Math.round((stepNumber / snapshot.count) * 100)}%` : "0%";
  journeySeek.disabled = !hasJourney || snapshot.index < 0;
  journeySeek.min = "1";
  journeySeek.max = String(Math.max(1, snapshot.count));
  journeySeek.value = String(Math.max(1, stepNumber));
  journeySeek.setAttribute(
    "aria-valuetext",
    hasJourney
      ? snapshot.index < 0
        ? "Journey not started"
        : `Step ${stepNumber} of ${snapshot.count}`
      : "No journey steps"
  );
  if (journeyNarration.textContent !== snapshot.narration) {
    journeyNarration.textContent =
      snapshot.narration || "Press Play or Next to start the selected architecture journey.";
  }
  journeyPreviousButton.disabled = !hasJourney || snapshot.index <= 0;
  journeyNextButton.disabled = !hasJourney || snapshot.index >= snapshot.count - 1;
  journeyRestartButton.disabled = !hasJourney;
  journeyPlayButton.disabled = !hasJourney;
  journeyPlayButton.textContent =
    snapshot.status === "playing" ? "PAUSE" : snapshot.status === "complete" ? "REPLAY" : "PLAY";
  journeySpeed.disabled = !hasJourney;
  journeySpeed.value = String(snapshot.speed);
  scheduleRender();
}

function journeyIds() {
  return journeyRecords.map((journey) => journey.id);
}

function selectJourney(id) {
  return journeyPlayer.select(id);
}

function playJourney() {
  return journeyPlayer.play();
}

function pauseJourney() {
  return journeyPlayer.pause();
}

function restartJourney() {
  return journeyPlayer.restart();
}

function nextJourneyStep() {
  return journeyPlayer.next();
}

function previousJourneyStep() {
  return journeyPlayer.previous();
}

function seekJourneyStep(index) {
  return journeyPlayer.seek(index);
}

function setJourneySpeed(speed) {
  return journeyPlayer.setSpeed(speed);
}

function journeySnapshot() {
  return journeyPlayer.snapshot();
}

function pauseJourneyForManualControl() {
  return journeyPlayer.pause();
}

function journeyDisplayState() {
  const snapshot = journeyPlayer.snapshot();
  return { journey: currentJourney(snapshot), snapshot };
}

journeySelect.addEventListener("change", () => selectJourney(journeySelect.value));
journeyPreviousButton.addEventListener("click", previousJourneyStep);
journeyPlayButton.addEventListener("click", () => {
  if (journeySnapshot().status === "playing") {
    pauseJourney();
  } else {
    playJourney();
  }
});
journeyNextButton.addEventListener("click", nextJourneyStep);
journeyRestartButton.addEventListener("click", restartJourney);
journeySeek.addEventListener("change", () => seekJourneyStep(Number(journeySeek.value) - 1));
journeySpeed.addEventListener("change", () => setJourneySpeed(Number(journeySpeed.value)));

renderJourneyState(journeyPlayer.snapshot());

export { journeyDisplayState, journeyIds, pauseJourneyForManualControl };
