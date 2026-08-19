function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function project(point) {
  const dx = point.x - state.camera.x;
  const dy = point.y - state.camera.y;
  const dz = point.z - state.camera.z;
  const yawCos = Math.cos(state.camera.yaw);
  const yawSin = Math.sin(state.camera.yaw);
  const pitchCos = Math.cos(state.camera.pitch);
  const pitchSin = Math.sin(state.camera.pitch);
  const cameraX = dx * yawCos - dz * yawSin;
  const yawZ = dx * yawSin + dz * yawCos;
  const cameraY = dy * pitchCos - yawZ * pitchSin;
  const cameraZ = dy * pitchSin + yawZ * pitchCos;
  if (cameraZ < 4) {
    return null;
  }
  const focal = Math.min(state.width, state.height) / (2 * Math.tan(state.fov / 2));
  return {
    x: state.width / 2 + (cameraX * focal) / cameraZ,
    y: state.height / 2 - (cameraY * focal) / cameraZ,
    z: cameraZ,
    scale: focal / cameraZ
  };
}

function polygon(points, fill, stroke, width) {
  if (points.some((point) => !point)) {
    return;
  }
  context.beginPath();
  context.moveTo(points[0].x, points[0].y);
  points.slice(1).forEach((point) => context.lineTo(point.x, point.y));
  context.closePath();
  if (fill) {
    context.fillStyle = fill;
    context.fill();
  }
  if (stroke) {
    context.strokeStyle = stroke;
    context.lineWidth = width || 1;
    context.stroke();
  }
}

function drawBackground(now) {
  const sky = context.createLinearGradient(0, 0, 0, state.height);
  sky.addColorStop(0, "#519bea");
  sky.addColorStop(0.18, "#6ddbf0");
  sky.addColorStop(0.24, "#9bf2df");
  sky.addColorStop(0.245, "#52a371");
  sky.addColorStop(1, "#469d70");
  context.fillStyle = sky;
  context.fillRect(0, 0, state.width, state.height);
  const shine = context.createLinearGradient(0, state.height * 0.18, 0, state.height * 0.42);
  shine.addColorStop(0, "rgba(255,255,255,0)");
  shine.addColorStop(0.5, "rgba(242,255,220,0.34)");
  shine.addColorStop(1, "rgba(255,255,255,0)");
  context.fillStyle = shine;
  context.fillRect(0, 0, state.width, state.height);
  if (state.pathGlow) {
    const glint = 0.028 + Math.sin(now / 900) * 0.008;
    context.fillStyle = "rgba(255,255,255," + glint + ")";
    context.fillRect(0, state.height * 0.3, state.width, state.height * 0.08);
  }
}

function drawGround() {
  const margin = 260;
  const minX = layoutBounds.minX - margin;
  const maxX = layoutBounds.maxX + margin;
  const minZ = layoutBounds.minZ - margin;
  const maxZ = layoutBounds.maxZ + margin;
  const corners = [
    project({ x: minX, y: 0, z: minZ }),
    project({ x: maxX, y: 0, z: minZ }),
    project({ x: maxX, y: 0, z: maxZ }),
    project({ x: minX, y: 0, z: maxZ })
  ];
  polygon(corners, "#4aa172");

  const gridStep = 180;
  const firstGridX = Math.floor(minX / gridStep) * gridStep;
  for (let x = firstGridX; x <= maxX; x += gridStep) {
    const from = project({ x, y: 0.18, z: minZ });
    const to = project({ x, y: 0.18, z: maxZ });
    if (!from || !to) {
      continue;
    }
    context.beginPath();
    context.moveTo(from.x, from.y);
    context.lineTo(to.x, to.y);
    context.strokeStyle = "rgba(75,145,99,0.14)";
    context.lineWidth = 1;
    context.stroke();
  }
}

function drawPlatform(district) {
  const y = 0;
  const thickness = 2.4;
  const halfWidth = district.width / 2;
  const halfDepth = district.depth / 2;
  const frontLeft = project({ x: district.x - halfWidth, y, z: district.z - halfDepth });
  const frontRight = project({ x: district.x + halfWidth, y, z: district.z - halfDepth });
  const backRight = project({ x: district.x + halfWidth, y, z: district.z + halfDepth });
  const backLeft = project({ x: district.x - halfWidth, y, z: district.z + halfDepth });
  const topLeft = project({
    x: district.x - halfWidth,
    y: y + thickness,
    z: district.z - halfDepth
  });
  const topRight = project({
    x: district.x + halfWidth,
    y: y + thickness,
    z: district.z - halfDepth
  });
  const topBackRight = project({
    x: district.x + halfWidth,
    y: y + thickness,
    z: district.z + halfDepth
  });
  const topBackLeft = project({
    x: district.x - halfWidth,
    y: y + thickness,
    z: district.z + halfDepth
  });
  polygon([frontLeft, frontRight, topRight, topLeft], "#00557e");
  const sideOnRight = state.camera.x > district.x;
  if (sideOnRight) {
    polygon([frontRight, backRight, topBackRight, topRight], "#006c9e");
  } else {
    polygon([backLeft, frontLeft, topLeft, topBackLeft], "#006c9e");
  }
  polygon(
    [topLeft, topRight, topBackRight, topBackLeft],
    "#087fb9",
    "rgba(184,242,255,0.44)",
    0.75
  );

  const labelBase = project({
    x: district.x,
    y: thickness + 0.2,
    z: district.z - halfDepth + 8
  });
  const labelEnd = project({
    x: district.x + 20,
    y: thickness + 0.2,
    z: district.z - halfDepth + 8
  });
  if (labelBase && labelEnd && labelBase.scale > 0.48) {
    const angle = Math.atan2(labelEnd.y - labelBase.y, labelEnd.x - labelBase.x);
    context.save();
    context.translate(labelBase.x, labelBase.y);
    context.rotate(angle);
    context.scale(
      clamp(labelBase.scale * 0.6, 0.45, 1.15),
      clamp(labelBase.scale * 0.35, 0.3, 0.65)
    );
    context.fillStyle = "rgba(241,255,255,0.92)";
    context.font = '700 12px "SFMono-Regular", Consolas, monospace';
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(district.label, 0, 0);
    context.restore();
  }
}

function cubeCorners(node) {
  const style = styles[node.type];
  const base = 2.55;
  const halfWidth = style.width / 2;
  const halfDepth = style.depth / 2;
  return {
    base,
    width: style.width,
    depth: style.depth,
    frontLeft: { x: node.x - halfWidth, y: base, z: node.z - halfDepth },
    frontRight: { x: node.x + halfWidth, y: base, z: node.z - halfDepth },
    backRight: { x: node.x + halfWidth, y: base, z: node.z + halfDepth },
    backLeft: { x: node.x - halfWidth, y: base, z: node.z + halfDepth },
    topFrontLeft: { x: node.x - halfWidth, y: base + style.height, z: node.z - halfDepth },
    topFrontRight: { x: node.x + halfWidth, y: base + style.height, z: node.z - halfDepth },
    topBackRight: { x: node.x + halfWidth, y: base + style.height, z: node.z + halfDepth },
    topBackLeft: { x: node.x - halfWidth, y: base + style.height, z: node.z + halfDepth }
  };
}

function drawBlock(node, now) {
  const corners = cubeCorners(node);
  const projected = {};
  Object.entries(corners).forEach(([key, value]) => {
    if (key !== "base" && key !== "width" && key !== "depth") {
      projected[key] = project(value);
    }
  });
  if (Object.values(projected).some((point) => !point)) {
    return;
  }
  const style = styles[node.type];
  const selected = state.selectedId === node.id;
  const hovered = state.hoverId === node.id;
  const pulse = selected && state.pathGlow ? 0.2 + Math.sin(now / 260) * 0.06 : 0;
  const frontFace = [
    projected.frontLeft,
    projected.frontRight,
    projected.topFrontRight,
    projected.topFrontLeft
  ];
  const topFace = [
    projected.topFrontLeft,
    projected.topFrontRight,
    projected.topBackRight,
    projected.topBackLeft
  ];
  const sideOnRight = state.camera.x > node.x;
  const sideFace = sideOnRight
    ? [projected.frontRight, projected.backRight, projected.topBackRight, projected.topFrontRight]
    : [projected.backLeft, projected.frontLeft, projected.topFrontLeft, projected.topBackLeft];
  const shadow = [
    project({ x: corners.frontLeft.x + 2.5, y: 0.16, z: corners.frontLeft.z + 2.5 }),
    project({ x: corners.frontRight.x + 2.5, y: 0.16, z: corners.frontRight.z + 2.5 }),
    project({ x: corners.backRight.x + 2.5, y: 0.16, z: corners.backRight.z + 2.5 }),
    project({ x: corners.backLeft.x + 2.5, y: 0.16, z: corners.backLeft.z + 2.5 })
  ];
  polygon(shadow, "rgba(0,57,74,0.2)");
  polygon(frontFace, style.front);
  polygon(sideFace, style.side);
  polygon(
    topFace,
    style.top,
    selected || hovered ? "#fff8c5" : "rgba(5,71,91,0.34)",
    selected ? 2.1 : hovered ? 1.5 : 0.55
  );
  if (selected) {
    const centre = project({
      x: node.x,
      y: corners.base + styles[node.type].height + 0.2,
      z: node.z
    });
    if (centre) {
      context.beginPath();
      context.arc(centre.x, centre.y, 8 + pulse * 26, 0, Math.PI * 2);
      context.strokeStyle = "rgba(255,247,166," + (0.74 + pulse) + ")";
      context.lineWidth = 1.4;
      context.stroke();
    }
  }

  const centre = project({
    x: node.x,
    y: corners.base + styles[node.type].height,
    z: node.z
  });
  const radius = Math.max(
    Math.abs(projected.topFrontRight.x - projected.topFrontLeft.x),
    Math.abs(projected.topFrontRight.y - projected.topFrontLeft.y),
    5
  );
  state.projected.push({
    node,
    point: centre,
    hitAreas: [topFace, frontFace, sideFace],
    radius,
    paintOrder: state.projected.length
  });

  const shouldLabel =
    selected ||
    (node.type === "module" && centre.scale > 0.5) ||
    (node.type === "component" && centre.scale > 0.85);
  if (shouldLabel && centre.scale > 0.33) {
    const labelAnchor = project({
      x: node.x,
      y: corners.base + 0.25,
      z: node.z - styles[node.type].depth / 2 - 3.5
    });
    const labelEnd = project({
      x: node.x + 14,
      y: corners.base + 0.25,
      z: node.z - styles[node.type].depth / 2 - 3.5
    });
    if (labelAnchor && labelEnd) {
      const angle = Math.atan2(labelEnd.y - labelAnchor.y, labelEnd.x - labelAnchor.x);
      context.save();
      context.translate(labelAnchor.x, labelAnchor.y);
      context.rotate(angle);
      context.scale(clamp(centre.scale * 0.47, 0.37, 1), clamp(centre.scale * 0.28, 0.25, 0.58));
      context.fillStyle = selected ? "#fff8c5" : "rgba(246,255,255,0.94)";
      context.font = '700 11px "SFMono-Regular", Consolas, monospace';
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(node.label.slice(0, 30), 0, 0);
      context.restore();
    }
  }
}

function drawPath(edge, now) {
  const from = nodeById.get(edge.from);
  const to = nodeById.get(edge.to);
  if (!from || !to) {
    return;
  }
  const selected = state.selectedId;
  const active = selected && (edge.from === selected || edge.to === selected);
  if (active) {
    return;
  }
  const structural = edge.kind === "relation" || edge.kind === "conforms" || edge.kind === "import";
  if (!structural) {
    return;
  }
  const lift = 1.7;
  const fromPoint = project({ x: from.x, y: lift, z: from.z });
  const toPoint = project({ x: to.x, y: lift, z: to.z });
  const midpoint = project({
    x: (from.x + to.x) / 2,
    y: lift,
    z: Math.min(from.z, to.z) - 8
  });
  if (!fromPoint || !toPoint || !midpoint) {
    return;
  }
  context.beginPath();
  context.moveTo(fromPoint.x, fromPoint.y);
  context.lineTo(midpoint.x, midpoint.y);
  context.lineTo(toPoint.x, toPoint.y);
  context.strokeStyle =
    edge.kind === "import" ? "rgba(255,255,255,0.94)" : "rgba(244,255,243,0.72)";
  context.lineWidth = 1.15;
  context.setLineDash(edge.kind === "import" ? [6, 5] : [2, 5]);
  context.lineDashOffset = state.pathGlow ? -now / 120 : 0;
  context.stroke();
  context.setLineDash([]);
}

function selectedPathPoints(edge) {
  const from = nodeById.get(edge.from);
  const to = nodeById.get(edge.to);
  if (!from || !to) {
    return null;
  }
  const fromHeight = 2.55 + styles[from.type].height + 1.1;
  const toHeight = 2.55 + styles[to.type].height + 1.1;
  const crest = Math.max(fromHeight, toHeight) + 8.5;
  const fromPoint = project({ x: from.x, y: fromHeight, z: from.z });
  const toPoint = project({ x: to.x, y: toHeight, z: to.z });
  const midpoint = project({
    x: (from.x + to.x) / 2,
    y: crest,
    z: (from.z + to.z) / 2
  });
  if (!fromPoint || !toPoint || !midpoint) {
    return null;
  }
  return { from, to, fromPoint, midpoint, toPoint };
}

function tracePath(points) {
  context.beginPath();
  context.moveTo(points.fromPoint.x, points.fromPoint.y);
  context.lineTo(points.midpoint.x, points.midpoint.y);
  context.lineTo(points.toPoint.x, points.toPoint.y);
}

function drawLinkMarker(point, color, radius) {
  context.beginPath();
  context.arc(point.x, point.y, radius + 1.8, 0, Math.PI * 2);
  context.fillStyle = "rgba(4, 61, 83, 0.78)";
  context.fill();
  context.beginPath();
  context.arc(point.x, point.y, radius, 0, Math.PI * 2);
  context.fillStyle = color;
  context.fill();
  context.strokeStyle = "#fff8c5";
  context.lineWidth = 1.25;
  context.stroke();
}

function drawSelectedNetwork(now) {
  const selected = state.selectedId;
  if (!selected) {
    return;
  }
  edges
    .filter((edge) => edge.from === selected || edge.to === selected)
    .forEach((edge, index) => {
      const points = selectedPathPoints(edge);
      if (!points) {
        return;
      }
      const selectedNode = edge.from === selected ? points.from : points.to;
      const selectedColor = styles[selectedNode.type].top;
      const dashOffset = state.pathGlow ? -(now / 26 + index * 9) : 0;
      context.save();
      context.lineCap = "round";
      context.lineJoin = "round";
      tracePath(points);
      context.strokeStyle = "rgba(4, 59, 80, 0.72)";
      context.lineWidth = 6.2;
      context.setLineDash([]);
      context.stroke();
      tracePath(points);
      context.strokeStyle = selectedColor;
      context.lineWidth = 3.7;
      context.setLineDash([10, 7]);
      context.lineDashOffset = dashOffset;
      context.stroke();
      tracePath(points);
      context.strokeStyle = "#fffbe5";
      context.lineWidth = 1.35;
      context.setLineDash([2.5, 14.5]);
      context.lineDashOffset = dashOffset * 1.9;
      context.stroke();
      context.setLineDash([]);
      drawLinkMarker(
        points.fromPoint,
        styles[points.from.type].top,
        points.from.id === selected ? 5.1 : 3.8
      );
      drawLinkMarker(
        points.toPoint,
        styles[points.to.type].top,
        points.to.id === selected ? 5.1 : 3.8
      );
      context.restore();
    });
}

function drawReticle() {
  const x = state.width / 2;
  const y = state.height * 0.58;
  context.beginPath();
  context.moveTo(x - 11, y);
  context.lineTo(x - 3, y);
  context.moveTo(x + 3, y);
  context.lineTo(x + 11, y);
  context.moveTo(x, y - 11);
  context.lineTo(x, y - 3);
  context.moveTo(x, y + 3);
  context.lineTo(x, y + 11);
  context.strokeStyle = "rgba(248,255,219,0.74)";
  context.lineWidth = 1.1;
  context.stroke();
}

function updateHoverLabel() {
  const item = state.hoverId
    ? state.projected.find((projected) => projected.node.id === state.hoverId)
    : null;
  if (!item?.point) {
    hoverLabel.classList.remove("is-visible", "is-below");
    return;
  }
  const node = item.node;
  hoverLabelKind.textContent = typeNames[node.type];
  hoverLabelName.textContent = node.label;
  hoverLabelSwatch.style.background = styles[node.type].top;
  hoverLabel.classList.add("is-visible");

  const labelWidth = hoverLabel.offsetWidth || 220;
  const labelHeight = hoverLabel.offsetHeight || 44;
  const needsLowerLabel = item.point.y < labelHeight + 22;
  const left = clamp(
    item.point.x + 18 + labelWidth > state.width - 12
      ? item.point.x - labelWidth - 18
      : item.point.x + 18,
    12,
    Math.max(12, state.width - labelWidth - 12)
  );
  const top = needsLowerLabel
    ? clamp(item.point.y, 12, Math.max(12, state.height - labelHeight - 22))
    : clamp(item.point.y, labelHeight + 22, state.height - 12);
  hoverLabel.style.left = left + "px";
  hoverLabel.style.top = top + "px";
  hoverLabel.classList.toggle("is-below", needsLowerLabel);
}

function updateFocus(now) {
  if (!state.focus) {
    return;
  }
  const progress = clamp((now - state.focus.startedAt) / state.focus.duration, 0, 1);
  const eased = 1 - Math.pow(1 - progress, 4);
  const start = state.focus.start;
  const end = state.focus.end;
  state.camera.x = start.x + (end.x - start.x) * eased;
  state.camera.y = start.y + (end.y - start.y) * eased;
  state.camera.z = start.z + (end.z - start.z) * eased;
  state.camera.yaw = fixedPerspective.yaw;
  state.camera.pitch = fixedPerspective.pitch;
  if (progress === 1) {
    state.focus = null;
  }
}

function updateMovement(delta) {
  if (state.keys.size === 0) {
    return;
  }
  state.focus = null;
  const speed = (state.keys.has("Shift") ? 155 : 68) * delta;
  if (state.keys.has("w")) {
    state.camera.z += speed;
  }
  if (state.keys.has("s")) {
    state.camera.z -= speed;
  }
  if (state.keys.has("a")) {
    state.camera.x -= speed;
  }
  if (state.keys.has("d")) {
    state.camera.x += speed;
  }
  if (state.keys.has("q")) {
    state.camera.y = clamp(state.camera.y - speed, 42, maximumCameraHeight);
  }
  if (state.keys.has("e")) {
    state.camera.y = clamp(state.camera.y + speed, 42, maximumCameraHeight);
  }
}

function scheduleRender() {
  if (!document.hidden && animationFrame === null) {
    animationFrame = window.requestAnimationFrame(render);
  }
}

function render(now) {
  animationFrame = null;
  const delta = Math.min(0.05, (now - state.lastTime) / 1000);
  state.lastTime = now;
  updateFocus(now);
  updateMovement(delta);
  context.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
  context.clearRect(0, 0, state.width, state.height);
  drawBackground(now);
  drawGround();
  edges.forEach((edge) => drawPath(edge, now));
  districts
    .map((district) => ({ district, point: project({ x: district.x, y: 0, z: district.z }) }))
    .filter((item) => item.point)
    .sort((left, right) => right.point.z - left.point.z)
    .forEach((item) => drawPlatform(item.district));
  state.projected = [];
  nodes
    .map((node) => ({ node, point: project({ x: node.x, y: 3, z: node.z }) }))
    .filter((item) => item.point)
    .sort((left, right) => right.point.z - left.point.z)
    .forEach((item) => drawBlock(item.node, now));
  drawSelectedNetwork(now);
  drawReticle();
  updateHoverLabel();
  state.frame += 1;
  state.rendered = true;
  if (state.pathGlow || state.focus || state.keys.size > 0 || state.pointer) {
    scheduleRender();
  }
}
