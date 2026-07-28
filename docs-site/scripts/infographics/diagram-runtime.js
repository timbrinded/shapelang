(function () {
  const root = document.documentElement;

  function parseEndpoint(value) {
    const [node, port = "center"] = value.split(":");
    return { node, port };
  }

  function portPoint(element, port, diagramRect) {
    const rect = element.getBoundingClientRect();
    const x = rect.left - diagramRect.left;
    const y = rect.top - diagramRect.top;
    const points = {
      bottom: { x: x + rect.width / 2, y: y + rect.height },
      center: { x: x + rect.width / 2, y: y + rect.height / 2 },
      left: { x, y: y + rect.height / 2 },
      right: { x: x + rect.width, y: y + rect.height / 2 },
      top: { x: x + rect.width / 2, y }
    };
    const point = points[port];
    if (!point) throw new Error(`Unknown connector port: ${port}`);
    return point;
  }

  function offsetPoint(point, port, distance) {
    const offsets = {
      bottom: { x: 0, y: distance },
      center: { x: 0, y: 0 },
      left: { x: -distance, y: 0 },
      right: { x: distance, y: 0 },
      top: { x: 0, y: -distance }
    };
    const offset = offsets[port];
    if (!offset) throw new Error(`Unknown connector port: ${port}`);
    return { x: point.x + offset.x, y: point.y + offset.y };
  }

  function curveByPorts(start, end, fromPort, toPort, tension) {
    const vectors = {
      bottom: { x: 0, y: 1 },
      center: { x: 0, y: 0 },
      left: { x: -1, y: 0 },
      right: { x: 1, y: 0 },
      top: { x: 0, y: -1 }
    };
    const sourceVector = vectors[fromPort];
    const targetVector = vectors[toPort];
    if (!sourceVector || !targetVector) throw new Error("Unknown connector port");
    const control = Math.max(36, Math.hypot(end.x - start.x, end.y - start.y) * tension);
    const sourceControl = {
      x: start.x + sourceVector.x * control,
      y: start.y + sourceVector.y * control
    };
    const targetControl = {
      x: end.x + targetVector.x * control,
      y: end.y + targetVector.y * control
    };
    return `M${start.x} ${start.y}C${sourceControl.x} ${sourceControl.y} ${targetControl.x} ${targetControl.y} ${end.x} ${end.y}`;
  }

  function route(edge, start, end, fromPort, toPort) {
    const routeType = edge.dataset.route ?? "straight";
    const tension = Number(edge.dataset.tension ?? 0.42);

    switch (routeType) {
      case "curve":
        return curveByPorts(start, end, fromPort, toPort, tension);
      case "orthogonal": {
        const middleX = start.x + (end.x - start.x) / 2;
        return `M${start.x} ${start.y}H${middleX}V${end.y}H${end.x}`;
      }
      case "straight":
        return `M${start.x} ${start.y}L${end.x} ${end.y}`;
      default:
        throw new Error(`Unknown connector route: ${routeType}`);
    }
  }

  function distance(left, right) {
    return Math.hypot(left.x - right.x, left.y - right.y);
  }

  function rectanglesOverlap(left, right, tolerance = 1) {
    return (
      Math.min(left.right, right.right) - Math.max(left.left, right.left) > tolerance &&
      Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top) > tolerance
    );
  }

  function elementName(element) {
    return element.dataset.node ?? element.textContent.trim().replaceAll(/\s+/g, " ");
  }

  function validateBounds(element, diagramRect, errors) {
    const rect = element.getBoundingClientRect();
    const tolerance = 1;
    if (
      rect.left < diagramRect.left - tolerance ||
      rect.top < diagramRect.top - tolerance ||
      rect.right > diagramRect.right + tolerance ||
      rect.bottom > diagramRect.bottom + tolerance
    ) {
      errors.push({ kind: "out-of-bounds", node: elementName(element) });
    }
  }

  function validateText(element, errors) {
    const inlineOverflow = element.scrollWidth - element.clientWidth;
    if (inlineOverflow > 1) {
      errors.push({
        inlineOverflow,
        kind: "text-overflow",
        node: elementName(element)
      });
    }

    const size = Number.parseFloat(getComputedStyle(element).fontSize);
    if (size < 20) {
      errors.push({ fontSize: size, kind: "text-too-small", node: elementName(element) });
    }
  }

  function validateContainerOverflow(element, errors) {
    const inlineOverflow = element.scrollWidth - element.clientWidth;
    const blockOverflow = element.scrollHeight - element.clientHeight;
    if (inlineOverflow > 1 || blockOverflow > 1) {
      errors.push({
        blockOverflow,
        inlineOverflow,
        kind: "container-overflow",
        node: elementName(element)
      });
    }
  }

  function groupsByAttribute(elements, attribute) {
    const groups = new Map();
    for (const element of elements) {
      if (!element.hasAttribute(attribute)) continue;
      const group = element.getAttribute(attribute);
      const members = groups.get(group) ?? [];
      members.push(element);
      groups.set(group, members);
    }
    return groups;
  }

  function validateRowAlignment(boxes, errors) {
    for (const [group, members] of groupsByAttribute(boxes, "data-align-row")) {
      if (members.length < 2) continue;
      const values = members.map((member) => {
        const rect = member.getBoundingClientRect();
        return rect.top + rect.height / 2;
      });
      const drift = Math.max(...values) - Math.min(...values);
      if (drift > 0.75) {
        errors.push({ drift, group, kind: "row-alignment" });
      }
    }
  }

  function validateEqualSizes(boxes, errors) {
    for (const [group, members] of groupsByAttribute(boxes, "data-equal-size")) {
      if (members.length < 2) continue;
      const rects = members.map((member) => member.getBoundingClientRect());
      const widthDrift =
        Math.max(...rects.map((rect) => rect.width)) - Math.min(...rects.map((rect) => rect.width));
      const heightDrift =
        Math.max(...rects.map((rect) => rect.height)) -
        Math.min(...rects.map((rect) => rect.height));
      if (widthDrift > 0.75 || heightDrift > 0.75) {
        errors.push({ group, heightDrift, kind: "unequal-size", widthDrift });
      }
    }
  }

  function renderDiagram(diagram) {
    const errors = [];
    const diagramRect = diagram.getBoundingClientRect();
    const svg = diagram.querySelector(".connectors");
    const nodeElements = [...diagram.querySelectorAll("[data-node]")];
    const nodes = new Map();

    for (const element of nodeElements) {
      if (nodes.has(element.dataset.node)) {
        errors.push({ kind: "duplicate-node", node: element.dataset.node });
      }
      nodes.set(element.dataset.node, element);
    }

    if (!svg) {
      return {
        edgeCount: 0,
        errors: [...errors, { kind: "missing-connector-layer" }],
        height: diagramRect.height,
        maximumEndpointError: 0,
        nodeCount: nodes.size,
        width: diagramRect.width
      };
    }

    svg.setAttribute("viewBox", `0 0 ${diagramRect.width} ${diagramRect.height}`);
    svg.setAttribute("preserveAspectRatio", "none");

    let maximumEndpointError = 0;
    let edgeCount = 0;

    for (const edge of diagram.querySelectorAll("[data-edge]")) {
      if (!edge.dataset.from || !edge.dataset.to) {
        errors.push({ kind: "missing-edge-endpoint" });
        continue;
      }

      const from = parseEndpoint(edge.dataset.from);
      const to = parseEndpoint(edge.dataset.to);
      const source = nodes.get(from.node);
      const target = nodes.get(to.node);
      if (!source || !target) {
        errors.push({
          edge: `${edge.dataset.from}->${edge.dataset.to}`,
          kind: "missing-node"
        });
        continue;
      }

      const startAnchor = portPoint(source, from.port, diagramRect);
      const endAnchor = portPoint(target, to.port, diagramRect);
      const start = startAnchor;
      const end = offsetPoint(endAnchor, to.port, 9);
      edge.setAttribute("d", route(edge, start, end, from.port, to.port));

      const length = edge.getTotalLength();
      const renderedStart = edge.getPointAtLength(0);
      const renderedEnd = edge.getPointAtLength(length);
      const startError = distance(renderedStart, start);
      const endError = distance(renderedEnd, end);
      maximumEndpointError = Math.max(maximumEndpointError, startError, endError);
      edgeCount += 1;

      if (startError > 0.75 || endError > 0.75) {
        errors.push({
          edge: `${edge.dataset.from}->${edge.dataset.to}`,
          endError,
          kind: "connector-drift",
          startError
        });
      }

      const edgeName = `${edge.dataset.from}->${edge.dataset.to}`;
      const obstructions = [...diagram.querySelectorAll("[data-box]")]
        .filter((box) => box !== source && box !== target)
        .filter((box) => box.dataset.edgeLabel !== edgeName)
        .filter((box) => {
          const rect = box.getBoundingClientRect();
          for (let sample = 1; sample < 48; sample += 1) {
            const point = edge.getPointAtLength((length * sample) / 48);
            const pageX = diagramRect.left + point.x;
            const pageY = diagramRect.top + point.y;
            if (
              pageX > rect.left &&
              pageX < rect.right &&
              pageY > rect.top &&
              pageY < rect.bottom
            ) {
              return true;
            }
          }
          return false;
        })
        .map(elementName);

      if (obstructions.length > 0) {
        errors.push({ edge: edgeName, kind: "connector-obstruction", nodes: obstructions });
      }
    }

    const boxes = [...diagram.querySelectorAll("[data-box]")];
    for (const box of boxes) {
      validateBounds(box, diagramRect, errors);
      validateContainerOverflow(box, errors);
    }

    for (let leftIndex = 0; leftIndex < boxes.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < boxes.length; rightIndex += 1) {
        const left = boxes[leftIndex];
        const right = boxes[rightIndex];
        if (rectanglesOverlap(left.getBoundingClientRect(), right.getBoundingClientRect())) {
          errors.push({
            kind: "overlap",
            nodes: [elementName(left), elementName(right)]
          });
        }
      }
    }

    validateRowAlignment(boxes, errors);
    validateEqualSizes(boxes, errors);

    for (const element of diagram.querySelectorAll("[data-fit]")) {
      validateText(element, errors);
    }

    for (const icon of diagram.querySelectorAll(".hi")) {
      const mask = getComputedStyle(icon).maskImage;
      if (!mask || mask === "none") {
        errors.push({ icon: icon.className, kind: "missing-icon" });
      }
    }

    return {
      edgeCount,
      errors,
      height: diagramRect.height,
      maximumEndpointError,
      nodeCount: nodes.size,
      visibleText: diagram.textContent.replaceAll(/\s+/g, " ").trim(),
      width: diagramRect.width
    };
  }

  async function run() {
    try {
      await document.fonts.ready;
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

      const diagrams = [...document.querySelectorAll(".diagram")].map(renderDiagram);
      const errors = diagrams.flatMap((diagram) => diagram.errors);
      const report = {
        diagrams,
        errors,
        fontStatus: document.fonts.status,
        status: errors.length === 0 ? "ok" : "error"
      };

      const reportElement = document.createElement("script");
      reportElement.id = "diagram-report";
      reportElement.type = "application/json";
      reportElement.textContent = JSON.stringify(report);
      document.body.append(reportElement);
      root.dataset.diagramStatus = report.status;
    } catch (error) {
      const report = {
        errors: [
          { kind: "runtime", message: error instanceof Error ? error.message : String(error) }
        ],
        status: "error"
      };
      const reportElement = document.createElement("script");
      reportElement.id = "diagram-report";
      reportElement.type = "application/json";
      reportElement.textContent = JSON.stringify(report);
      document.body.append(reportElement);
      root.dataset.diagramStatus = "error";
    }
  }

  run();
})();
