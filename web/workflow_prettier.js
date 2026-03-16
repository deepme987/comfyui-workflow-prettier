/**
 * ComfyUI Workflow Prettier
 *
 * Auto-arrange workflow nodes using graph layout algorithms.
 * Provides 4 layout modes (Layered/Sugiyama, Linear, Compact, Sort by Type),
 * group-aware positioning, direction transforms, alignment tools, and undo.
 *
 * @see https://github.com/Comfy-Org/comfyui-workflow-prettier
 * @license MIT
 */

import { app } from "../../scripts/app.js";

// ═════════════════════════════════════════════════════════════════════════════
//  UNDO STACK (10 deep)
// ═════════════════════════════════════════════════════════════════════════════

const undoStack = [];
const MAX_UNDO = 10;

function pushUndo(graph) {
  const state = { nodes: new Map(), groups: [] };
  for (const node of graph._nodes)
    state.nodes.set(node.id, [node.pos[0], node.pos[1]]);
  for (const group of graph._groups ?? []) {
    const b = group._bounding ?? group.bounding;
    state.groups.push(b ? [b[0], b[1], b[2], b[3]] : null);
  }
  undoStack.push(state);
  if (undoStack.length > MAX_UNDO) undoStack.shift();
}

function popUndo(graph) {
  const state = undoStack.pop();
  if (!state) return false;
  for (const node of graph._nodes) {
    const pos = state.nodes.get(node.id);
    if (pos) { node.pos[0] = pos[0]; node.pos[1] = pos[1]; }
  }
  const groups = graph._groups ?? [];
  for (let i = 0; i < groups.length && i < state.groups.length; i++) {
    const saved = state.groups[i];
    if (!saved) continue;
    const b = groups[i]._bounding ?? groups[i].bounding;
    if (b) { b[0] = saved[0]; b[1] = saved[1]; b[2] = saved[2]; b[3] = saved[3]; }
  }
  graph.setDirtyCanvas(true, true);
  return true;
}

// ═════════════════════════════════════════════════════════════════════════════
//  GRAPH PRIMITIVES
// ═════════════════════════════════════════════════════════════════════════════

function getWorkflowNodes(graph) {
  return graph._nodes.filter((n) => n.type !== "WorkflowPrettifier");
}

function iterLinks(graph) {
  const links = graph.links;
  if (!links) return [];
  if (links instanceof Map) return [...links.values()].filter(Boolean);
  if (Array.isArray(links)) return links.filter(Boolean);
  return Object.values(links).filter(Boolean);
}

function buildDAG(graph, nodeSet) {
  const nodes = nodeSet ?? getWorkflowNodes(graph);
  const nodeMap = new Map();
  const adj = new Map();
  const revAdj = new Map();
  const ids = new Set();

  for (const node of nodes) {
    nodeMap.set(node.id, node);
    adj.set(node.id, []);
    revAdj.set(node.id, []);
    ids.add(node.id);
  }

  for (const link of iterLinks(graph)) {
    const src = link[1] ?? link.origin_id;
    const tgt = link[3] ?? link.target_id;
    if (src != null && tgt != null && ids.has(src) && ids.has(tgt)) {
      adj.get(src).push(tgt);
      revAdj.get(tgt).push(src);
    }
  }

  return { adj, revAdj, nodeMap };
}

function topoSort(nodeMap, adj, revAdj) {
  const inDeg = new Map();
  for (const id of nodeMap.keys()) inDeg.set(id, revAdj.get(id)?.length ?? 0);

  const queue = [];
  for (const [id, d] of inDeg) if (d === 0) queue.push(id);

  queue.sort((a, b) => {
    const na = nodeMap.get(a), nb = nodeMap.get(b);
    const ay = na.pos?.[1] ?? 0, by = nb.pos?.[1] ?? 0;
    return ay !== by ? ay - by : (na.pos?.[0] ?? 0) - (nb.pos?.[0] ?? 0);
  });

  const sorted = [];
  const visited = new Set();
  while (queue.length > 0) {
    const id = queue.shift();
    sorted.push(id);
    visited.add(id);
    for (const tgt of adj.get(id) ?? []) {
      const nd = inDeg.get(tgt) - 1;
      inDeg.set(tgt, nd);
      if (nd === 0) queue.push(tgt);
    }
  }
  for (const id of nodeMap.keys()) if (!visited.has(id)) sorted.push(id);
  return sorted;
}

function assignLayers(topo, adj) {
  const layer = new Map();
  for (const id of topo) layer.set(id, 0);
  for (const id of topo) {
    const cur = layer.get(id);
    for (const tgt of adj.get(id) ?? [])
      if (cur + 1 > layer.get(tgt)) layer.set(tgt, cur + 1);
  }
  return layer;
}

function buildLayerArrays(layerMap) {
  const max = Math.max(...layerMap.values(), 0);
  const layers = [];
  for (let i = 0; i <= max; i++) layers.push([]);
  for (const [id, l] of layerMap) layers[l].push(id);
  return layers;
}

// ═════════════════════════════════════════════════════════════════════════════
//  CROSSING MINIMIZATION (Barycenter, bidirectional)
// ═════════════════════════════════════════════════════════════════════════════

function bary(nodeId, neighborAdj, neighborLayer, posMap) {
  const nbrs = (neighborAdj.get(nodeId) ?? []).filter((n) => neighborLayer.includes(n));
  if (nbrs.length === 0) return null;
  let sum = 0;
  for (const n of nbrs) sum += posMap.get(n) ?? 0;
  return sum / nbrs.length;
}

function minimizeCrossings(rawLayers, adj, revAdj, nodeMap) {
  const layers = rawLayers.map((l) => [...l]);
  for (const layer of layers)
    layer.sort((a, b) => (nodeMap.get(a)?.pos?.[1] ?? 0) - (nodeMap.get(b)?.pos?.[1] ?? 0));

  for (let iter = 0; iter < 6; iter++) {
    // Forward
    for (let l = 1; l < layers.length; l++) {
      const pm = new Map();
      layers[l - 1].forEach((id, i) => pm.set(id, i));
      const sc = layers[l].map((id, oi) => ({ id, bc: bary(id, revAdj, layers[l - 1], pm), oi }));
      sc.sort((a, b) => {
        if (a.bc == null && b.bc == null) return a.oi - b.oi;
        if (a.bc == null) return 1; if (b.bc == null) return -1;
        return a.bc - b.bc;
      });
      layers[l] = sc.map((s) => s.id);
    }
    // Backward
    for (let l = layers.length - 2; l >= 0; l--) {
      const pm = new Map();
      layers[l + 1].forEach((id, i) => pm.set(id, i));
      const sc = layers[l].map((id, oi) => ({ id, bc: bary(id, adj, layers[l + 1], pm), oi }));
      sc.sort((a, b) => {
        if (a.bc == null && b.bc == null) return a.oi - b.oi;
        if (a.bc == null) return 1; if (b.bc == null) return -1;
        return a.bc - b.bc;
      });
      layers[l] = sc.map((s) => s.id);
    }
  }
  return layers;
}

// ═════════════════════════════════════════════════════════════════════════════
//  COORDINATE ASSIGNMENT (Median alignment)
// ═════════════════════════════════════════════════════════════════════════════

function assignCoordinates(layers, adj, revAdj, nodeMap, vSpacing) {
  const yPos = new Map();
  if (layers.length === 0) return yPos;

  let anchorIdx = 0;
  for (let i = 1; i < layers.length; i++)
    if (layers[i].length > layers[anchorIdx].length) anchorIdx = i;

  // Stack anchor
  let y = 0;
  for (const id of layers[anchorIdx]) {
    yPos.set(id, y);
    y += (nodeMap.get(id)?.size?.[1] ?? 100) + vSpacing;
  }

  // Propagate outward
  for (let l = anchorIdx + 1; l < layers.length; l++)
    alignLayer(layers[l], revAdj, layers[l - 1], yPos, nodeMap, vSpacing);
  for (let l = anchorIdx - 1; l >= 0; l--)
    alignLayer(layers[l], adj, layers[l + 1], yPos, nodeMap, vSpacing);

  // Normalize to y=0
  let minY = Infinity;
  for (const v of yPos.values()) if (v < minY) minY = v;
  if (isFinite(minY) && minY !== 0)
    for (const [id, v] of yPos) yPos.set(id, v - minY);

  return yPos;
}

function alignLayer(layer, neighborAdj, refLayer, yPos, nodeMap, vSpacing) {
  const refSet = new Set(refLayer);
  const positioned = [], unpositioned = [];

  for (const id of layer) {
    const nbrs = (neighborAdj.get(id) ?? []).filter((n) => refSet.has(n));
    if (nbrs.length > 0) {
      const centers = nbrs
        .map((n) => (yPos.get(n) ?? 0) + (nodeMap.get(n)?.size?.[1] ?? 100) / 2)
        .sort((a, b) => a - b);
      const mid = Math.floor(centers.length / 2);
      const median = centers.length % 2 === 0
        ? (centers[mid - 1] + centers[mid]) / 2 : centers[mid];
      yPos.set(id, median - (nodeMap.get(id)?.size?.[1] ?? 100) / 2);
      positioned.push(id);
    } else {
      unpositioned.push(id);
    }
  }

  if (unpositioned.length > 0) {
    let lastBot = 0;
    for (const id of positioned) {
      const bot = (yPos.get(id) ?? 0) + (nodeMap.get(id)?.size?.[1] ?? 100);
      if (bot > lastBot) lastBot = bot;
    }
    for (const id of unpositioned) {
      yPos.set(id, lastBot + vSpacing);
      lastBot += (nodeMap.get(id)?.size?.[1] ?? 100) + vSpacing;
    }
  }

  // Resolve overlaps
  const sorted = [...layer].sort((a, b) => (yPos.get(a) ?? 0) - (yPos.get(b) ?? 0));
  for (let i = 1; i < sorted.length; i++) {
    const prevBot = (yPos.get(sorted[i - 1]) ?? 0) + (nodeMap.get(sorted[i - 1])?.size?.[1] ?? 100);
    if ((yPos.get(sorted[i]) ?? 0) < prevBot + vSpacing)
      yPos.set(sorted[i], prevBot + vSpacing);
  }
}

// ═════════════════════════════════════════════════════════════════════════════
//  LAYOUT ALGORITHMS
// ═════════════════════════════════════════════════════════════════════════════

// ─── Layered (Sugiyama) ──────────────────────────────────────────────────────

function layoutLayered(graph, nodes, startX, startY, opts = {}) {
  if (nodes.length === 0) return { width: 0, height: 0 };
  if (nodes.length === 1) {
    nodes[0].pos[0] = startX; nodes[0].pos[1] = startY;
    return { width: nodes[0].size?.[0] ?? 200, height: nodes[0].size?.[1] ?? 100 };
  }

  const hSp = opts.horizontalSpacing ?? 100;
  const vSp = opts.verticalSpacing ?? 100;

  const { adj, revAdj, nodeMap } = buildDAG(graph, nodes);
  const topo = topoSort(nodeMap, adj, revAdj);
  const layerMap = assignLayers(topo, adj);
  const rawLayers = buildLayerArrays(layerMap);
  const layers = minimizeCrossings(rawLayers, adj, revAdj, nodeMap);
  const yPos = assignCoordinates(layers, adj, revAdj, nodeMap, vSp);

  const colWidths = layers.map((col) => {
    let mx = 0;
    for (const id of col) { const w = nodeMap.get(id)?.size?.[0] ?? 200; if (w > mx) mx = w; }
    return mx || 200;
  });

  let totalW = 0, totalH = 0, cx = startX;
  for (let c = 0; c < layers.length; c++) {
    for (const id of layers[c]) {
      const node = nodeMap.get(id);
      if (!node) continue;
      node.pos[0] = cx;
      node.pos[1] = startY + (yPos.get(id) ?? 0);
      const bot = node.pos[1] + (node.size?.[1] ?? 100) - startY;
      if (bot > totalH) totalH = bot;
    }
    cx += colWidths[c] + hSp;
    totalW = cx - startX - hSp;
  }
  return { width: totalW, height: totalH };
}

// ─── Linear ──────────────────────────────────────────────────────────────────

function layoutLinear(graph, nodes, startX, startY, opts = {}) {
  if (nodes.length === 0) return { width: 0, height: 0 };
  const hSp = opts.horizontalSpacing ?? 100;
  const { adj, revAdj, nodeMap } = buildDAG(graph, nodes);
  const topo = topoSort(nodeMap, adj, revAdj);
  let cx = startX, maxH = 0;
  for (const id of topo) {
    const node = nodeMap.get(id);
    if (!node) continue;
    node.pos[0] = cx; node.pos[1] = startY;
    cx += (node.size?.[0] ?? 200) + hSp;
    const h = node.size?.[1] ?? 100;
    if (h > maxH) maxH = h;
  }
  return { width: cx - startX - hSp, height: maxH };
}

// ─── Compact (Rectangle packing) ────────────────────────────────────────────

function layoutCompact(graph, nodes, startX, startY, opts = {}) {
  if (nodes.length === 0) return { width: 0, height: 0 };
  const hSp = opts.horizontalSpacing ?? 100;
  const vSp = opts.verticalSpacing ?? 100;

  // Sort by height descending (tall nodes first for better packing)
  const sorted = [...nodes].sort((a, b) => (b.size?.[1] ?? 100) - (a.size?.[1] ?? 100));

  // Target width: sqrt of total area, aiming for roughly square
  let totalArea = 0;
  for (const n of sorted) totalArea += ((n.size?.[0] ?? 200) + hSp) * ((n.size?.[1] ?? 100) + vSp);
  const targetWidth = Math.sqrt(totalArea) * 1.1;

  // Shelf-based packing
  let shelfX = startX, shelfY = startY, shelfHeight = 0;
  let maxX = startX, maxY = startY;

  for (const node of sorted) {
    const w = node.size?.[0] ?? 200;
    const h = node.size?.[1] ?? 100;

    if (shelfX + w - startX > targetWidth && shelfX > startX) {
      shelfY += shelfHeight + vSp;
      shelfX = startX;
      shelfHeight = 0;
    }

    node.pos[0] = shelfX;
    node.pos[1] = shelfY;
    shelfX += w + hSp;
    if (h > shelfHeight) shelfHeight = h;

    if (shelfX > maxX) maxX = shelfX;
    if (shelfY + h > maxY) maxY = shelfY + h;
  }

  return { width: maxX - startX - hSp, height: maxY - startY };
}

// ─── Sort by Type ────────────────────────────────────────────────────────────

function layoutSortByType(graph, nodes, startX, startY, opts = {}) {
  if (nodes.length === 0) return { width: 0, height: 0 };
  const hSp = opts.horizontalSpacing ?? 100;
  const vSp = opts.verticalSpacing ?? 100;

  // Group by type
  const typeGroups = new Map();
  for (const node of nodes) {
    const type = node.type ?? "Unknown";
    if (!typeGroups.has(type)) typeGroups.set(type, []);
    typeGroups.get(type).push(node);
  }

  // Order type groups by topological depth (average layer of their nodes)
  const { adj, revAdj, nodeMap } = buildDAG(graph, nodes);
  const topo = topoSort(nodeMap, adj, revAdj);
  const layerMap = assignLayers(topo, adj);

  const typeAvgLayer = new Map();
  for (const [type, group] of typeGroups) {
    let sum = 0;
    for (const n of group) sum += layerMap.get(n.id) ?? 0;
    typeAvgLayer.set(type, sum / group.length);
  }

  const sortedTypes = [...typeGroups.keys()].sort(
    (a, b) => (typeAvgLayer.get(a) ?? 0) - (typeAvgLayer.get(b) ?? 0)
  );

  // Place each type group as a column
  let cx = startX, totalH = 0;
  for (const type of sortedTypes) {
    const group = typeGroups.get(type);
    let cy = startY;
    let colWidth = 0;
    for (const node of group) {
      node.pos[0] = cx;
      node.pos[1] = cy;
      const w = node.size?.[0] ?? 200;
      const h = node.size?.[1] ?? 100;
      if (w > colWidth) colWidth = w;
      cy += h + vSp;
    }
    const colH = cy - startY - vSp;
    if (colH > totalH) totalH = colH;
    cx += colWidth + hSp;
  }

  return { width: cx - startX - hSp, height: totalH };
}

// ═════════════════════════════════════════════════════════════════════════════
//  DIRECTION TRANSFORMS
// ═════════════════════════════════════════════════════════════════════════════

function applyDirection(graph, nodes, direction, opts = {}) {
  if (direction === "Left to Right") return; // default, no transform

  // Find bounding box of laid-out nodes
  let minX = Infinity, minY = Infinity;
  for (const n of nodes) {
    if (n.pos[0] < minX) minX = n.pos[0];
    if (n.pos[1] < minY) minY = n.pos[1];
  }

  if (direction === "Top to Bottom") {
    // Rotate 90: swap (x,y) relative to origin
    for (const n of nodes) {
      const rx = n.pos[0] - minX;
      const ry = n.pos[1] - minY;
      n.pos[0] = minX + ry;
      n.pos[1] = minY + rx;
    }
    // Also need to handle group bounding boxes
    for (const group of graph._groups ?? []) {
      const b = group._bounding ?? group.bounding;
      if (!b) continue;
      const rx = b[0] - minX;
      const ry = b[1] - minY;
      b[0] = minX + ry;
      b[1] = minY + rx;
      const tmpW = b[2];
      b[2] = b[3];
      b[3] = tmpW;
    }
    // After rotation, node widths/heights stay the same but positions are swapped.
    // Resolve any overlaps that result from the rotation.
    resolveOverlaps(nodes, opts.horizontalSpacing ?? 100, opts.verticalSpacing ?? 100);
  } else if (direction === "Right to Left") {
    // Mirror X
    let maxRight = 0;
    for (const n of nodes) {
      const right = n.pos[0] + (n.size?.[0] ?? 200);
      if (right > maxRight) maxRight = right;
    }
    for (const n of nodes) {
      n.pos[0] = maxRight - n.pos[0] - (n.size?.[0] ?? 200);
    }
    // Mirror group bounding boxes
    for (const group of graph._groups ?? []) {
      const b = group._bounding ?? group.bounding;
      if (!b) continue;
      b[0] = maxRight - b[0] - b[2];
    }
  }
}

// ─── Post-direction overlap resolution ──────────────────────────────────────
// After rotating (Top to Bottom), nodes may overlap because their widths/heights
// didn't swap. This scans rows and columns and pushes nodes apart.

function resolveOverlaps(nodes, hSp, vSp) {
  if (nodes.length < 2) return;

  // Group nodes into approximate rows (by Y position)
  const sorted = [...nodes].sort((a, b) => a.pos[1] - b.pos[1]);
  const rows = [];
  let currentRow = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const n = sorted[i];
    const prevBot = currentRow[0].pos[1] + (currentRow[0].size?.[1] ?? 100);
    // If this node's top is within the row's vertical range, same row
    if (n.pos[1] < prevBot - 10) {
      currentRow.push(n);
    } else {
      rows.push(currentRow);
      currentRow = [n];
    }
  }
  rows.push(currentRow);

  // Within each row, sort by X and push apart any horizontal overlaps
  for (const row of rows) {
    row.sort((a, b) => a.pos[0] - b.pos[0]);
    for (let i = 1; i < row.length; i++) {
      const prevRight = row[i - 1].pos[0] + (row[i - 1].size?.[0] ?? 200);
      if (row[i].pos[0] < prevRight + hSp) {
        row[i].pos[0] = prevRight + hSp;
      }
    }
  }

  // Between rows, ensure no vertical overlap
  for (let r = 1; r < rows.length; r++) {
    // Find the max bottom of previous row
    let prevMaxBot = 0;
    for (const n of rows[r - 1]) {
      const bot = n.pos[1] + (n.size?.[1] ?? 100);
      if (bot > prevMaxBot) prevMaxBot = bot;
    }
    // Find the min top of current row
    let curMinTop = Infinity;
    for (const n of rows[r]) {
      if (n.pos[1] < curMinTop) curMinTop = n.pos[1];
    }
    // Push down if overlapping
    if (curMinTop < prevMaxBot + vSp) {
      const shift = prevMaxBot + vSp - curMinTop;
      for (const n of rows[r]) n.pos[1] += shift;
    }
  }
}

// ═════════════════════════════════════════════════════════════════════════════
//  GROUP DETECTION & GROUP-AWARE LAYOUT
// ═════════════════════════════════════════════════════════════════════════════

function partitionByGroup(graph) {
  const groups = graph._groups ?? [];
  const groupNodes = new Map();
  const assigned = new Set();

  for (let gi = 0; gi < groups.length; gi++) groupNodes.set(gi, []);

  for (const node of getWorkflowNodes(graph)) {
    const cx = node.pos[0] + (node.size?.[0] ?? 200) / 2;
    const cy = node.pos[1] + (node.size?.[1] ?? 100) / 2;
    let best = -1, bestArea = Infinity;

    for (let gi = 0; gi < groups.length; gi++) {
      const b = groups[gi]._bounding ?? groups[gi].bounding;
      if (!b) continue;
      if (cx >= b[0] && cx <= b[0] + b[2] && cy >= b[1] && cy <= b[1] + b[3]) {
        const area = b[2] * b[3];
        if (area < bestArea) { bestArea = area; best = gi; }
      }
    }

    if (best >= 0) { groupNodes.get(best).push(node); assigned.add(node.id); }
  }

  const ungrouped = getWorkflowNodes(graph).filter((n) => !assigned.has(n.id));
  return { groupNodes, ungrouped, groups };
}

function buildSuperDAG(graph, groupNodes, ungrouped) {
  const n2s = new Map();
  for (const [gi, nodes] of groupNodes) for (const n of nodes) n2s.set(n.id, `g${gi}`);
  for (const n of ungrouped) n2s.set(n.id, n.id);

  const sids = new Set();
  for (const gi of groupNodes.keys()) if (groupNodes.get(gi).length > 0) sids.add(`g${gi}`);
  for (const n of ungrouped) sids.add(n.id);

  const sAdj = new Map(), sRev = new Map();
  for (const sid of sids) { sAdj.set(sid, []); sRev.set(sid, []); }

  const seen = new Set();
  for (const link of iterLinks(graph)) {
    const src = link[1] ?? link.origin_id, tgt = link[3] ?? link.target_id;
    if (src == null || tgt == null) continue;
    const ss = n2s.get(src), ts = n2s.get(tgt);
    if (ss != null && ts != null && ss !== ts && sids.has(ss) && sids.has(ts)) {
      const key = `${ss}->${ts}`;
      if (!seen.has(key)) { seen.add(key); sAdj.get(ss).push(ts); sRev.get(ts).push(ss); }
    }
  }
  return { sids, sAdj, sRev };
}

function layoutWithGroups(graph, layoutFn, opts = {}) {
  const pad = opts.groupPadding ?? 100;
  const titleH = 34;
  const gSp = opts.groupSpacing ?? 100;

  const { groupNodes, ungrouped, groups } = partitionByGroup(graph);
  const hasGroups = [...groupNodes.values()].some((n) => n.length > 0);
  if (!hasGroups) {
    layoutFn(graph, getWorkflowNodes(graph), 100, 100, opts);
    return;
  }

  // Layout within each group at origin
  const gSizes = new Map();
  for (const [gi, nodes] of groupNodes) {
    if (nodes.length === 0) { gSizes.set(gi, { width: 0, height: 0 }); continue; }
    gSizes.set(gi, layoutFn(graph, nodes, 0, 0, opts));
  }

  // Build virtual super-nodes for groups + ungrouped
  const { sids, sAdj, sRev } = buildSuperDAG(graph, groupNodes, ungrouped);
  const vNodes = [];
  const vMap = new Map();
  for (const sid of sids) {
    let w, h;
    if (typeof sid === "string" && sid.startsWith("g")) {
      const gs = gSizes.get(parseInt(sid.slice(1)));
      w = (gs?.width ?? 200) + pad * 2; h = (gs?.height ?? 100) + pad * 2 + titleH;
    } else {
      const node = graph._nodes.find((n) => n.id === sid);
      w = node?.size?.[0] ?? 200; h = node?.size?.[1] ?? 100;
    }
    const vNode = { id: sid, pos: [0, 0], size: [w, h] };
    vNodes.push(vNode);
    vMap.set(sid, vNode);
  }

  // Use the SAME layout function for super-node positioning
  // Create a fake graph context for the super-nodes
  const fakeGraph = { _nodes: vNodes, _groups: [], links: [] };

  // Build link array for super-node edges so layoutFn can use buildDAG
  let fakeLinkId = 1;
  for (const [src, targets] of sAdj) {
    for (const tgt of targets) {
      fakeGraph.links.push([fakeLinkId++, src, 0, tgt, 0, "*"]);
    }
  }

  layoutFn(fakeGraph, vNodes, 100, 100, {
    ...opts,
    horizontalSpacing: gSp,
    verticalSpacing: gSp,
  });

  // Apply positions
  for (const [gi, nodes] of groupNodes) {
    if (nodes.length === 0) continue;
    const v = vMap.get(`g${gi}`);
    if (!v) continue;
    const ox = v.pos[0] + pad, oy = v.pos[1] + pad + titleH;
    for (const n of nodes) { n.pos[0] += ox; n.pos[1] += oy; }
    const group = groups[gi];
    if (group) {
      const b = group._bounding ?? group.bounding;
      if (b) { b[0] = v.pos[0]; b[1] = v.pos[1]; b[2] = v.size[0]; b[3] = v.size[1]; }
    }
  }

  for (const n of ungrouped) {
    const v = vMap.get(n.id);
    if (v) { n.pos[0] = v.pos[0]; n.pos[1] = v.pos[1]; }
  }
}

// ═════════════════════════════════════════════════════════════════════════════
//  ALIGNMENT & DISTRIBUTION (for selected nodes)
// ═════════════════════════════════════════════════════════════════════════════

function getSelectedNodes(graph) {
  return (graph._nodes ?? []).filter(
    (n) => n.is_selected && n.type !== "WorkflowPrettifier"
  );
}

function alignNodes(graph, mode) {
  const sel = getSelectedNodes(graph);
  if (sel.length < 2) return;
  pushUndo(graph);

  const getW = (n) => n.size?.[0] ?? 200;
  const getH = (n) => n.size?.[1] ?? 100;

  switch (mode) {
    case "left":
      { const minX = Math.min(...sel.map((n) => n.pos[0]));
        for (const n of sel) n.pos[0] = minX; }
      break;
    case "right":
      { const maxR = Math.max(...sel.map((n) => n.pos[0] + getW(n)));
        for (const n of sel) n.pos[0] = maxR - getW(n); }
      break;
    case "top":
      { const minY = Math.min(...sel.map((n) => n.pos[1]));
        for (const n of sel) n.pos[1] = minY; }
      break;
    case "bottom":
      { const maxB = Math.max(...sel.map((n) => n.pos[1] + getH(n)));
        for (const n of sel) n.pos[1] = maxB - getH(n); }
      break;
    case "centerH":
      { const avgX = sel.reduce((s, n) => s + n.pos[0] + getW(n) / 2, 0) / sel.length;
        for (const n of sel) n.pos[0] = avgX - getW(n) / 2; }
      break;
    case "centerV":
      { const avgY = sel.reduce((s, n) => s + n.pos[1] + getH(n) / 2, 0) / sel.length;
        for (const n of sel) n.pos[1] = avgY - getH(n) / 2; }
      break;
    case "distributeH":
      { if (sel.length < 3) break;
        const sorted = [...sel].sort((a, b) => a.pos[0] - b.pos[0]);
        const first = sorted[0].pos[0];
        const last = sorted[sorted.length - 1].pos[0] + getW(sorted[sorted.length - 1]);
        const totalNodeW = sorted.reduce((s, n) => s + getW(n), 0);
        const gap = (last - first - totalNodeW) / (sorted.length - 1);
        let x = first;
        for (const n of sorted) { n.pos[0] = x; x += getW(n) + gap; } }
      break;
    case "distributeV":
      { if (sel.length < 3) break;
        const sorted = [...sel].sort((a, b) => a.pos[1] - b.pos[1]);
        const first = sorted[0].pos[1];
        const last = sorted[sorted.length - 1].pos[1] + getH(sorted[sorted.length - 1]);
        const totalNodeH = sorted.reduce((s, n) => s + getH(n), 0);
        const gap = (last - first - totalNodeH) / (sorted.length - 1);
        let y = first;
        for (const n of sorted) { n.pos[1] = y; y += getH(n) + gap; } }
      break;
  }
  graph.setDirtyCanvas(true, true);
}

// ═════════════════════════════════════════════════════════════════════════════
//  EQUALIZE SPACING
// ═════════════════════════════════════════════════════════════════════════════

function equalizeSpacing(graph, opts = {}) {
  const nodes = getWorkflowNodes(graph);
  if (nodes.length < 2) return;
  pushUndo(graph);

  const hSp = opts.horizontalSpacing ?? 100;
  const vSp = opts.verticalSpacing ?? 100;

  // Find columns: group nodes by approximate X position
  const sorted = [...nodes].sort((a, b) => a.pos[0] - b.pos[0]);
  const columns = [];
  let currentCol = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const prev = currentCol[currentCol.length - 1];
    const prevRight = prev.pos[0] + (prev.size?.[0] ?? 200);
    // If this node starts before the previous ends + some threshold, same column
    if (sorted[i].pos[0] < prevRight + hSp * 0.3) {
      currentCol.push(sorted[i]);
    } else {
      columns.push(currentCol);
      currentCol = [sorted[i]];
    }
  }
  columns.push(currentCol);

  // Within each column, equalize vertical spacing
  for (const col of columns) {
    col.sort((a, b) => a.pos[1] - b.pos[1]);
    if (col.length < 2) continue;
    let cy = col[0].pos[1];
    for (const n of col) {
      n.pos[1] = cy;
      cy += (n.size?.[1] ?? 100) + vSp;
    }
  }

  // Equalize horizontal spacing between columns
  let cx = columns[0][0].pos[0];
  for (const col of columns) {
    let colWidth = 0;
    for (const n of col) {
      n.pos[0] = cx;
      const w = n.size?.[0] ?? 200;
      if (w > colWidth) colWidth = w;
    }
    cx += colWidth + hSp;
  }

  graph.setDirtyCanvas(true, true);
}

// ═════════════════════════════════════════════════════════════════════════════
//  MAIN ENTRY POINT
// ═════════════════════════════════════════════════════════════════════════════

const LAYOUT_FNS = {
  "Layered (Vertical Stacks)": layoutLayered,
  "Linear (Left to Right)": layoutLinear,
  "Compact (Tight Rectangle)": layoutCompact,
  "Sort by Type": layoutSortByType,
};

function runPrettify(graph, opts) {
  const layoutFn = LAYOUT_FNS[opts.layout] ?? layoutLayered;
  const groupMode = opts.groupHandling ?? "Auto (Respect Groups)";
  const allNodes = getWorkflowNodes(graph);

  if (groupMode === "Ignore Groups") {
    layoutFn(graph, allNodes, 100, 100, opts);
  } else if (groupMode === "Respect Groups" || groupMode === "Auto (Respect Groups)") {
    const hasGroups = (graph._groups ?? []).length > 0 &&
      [...partitionByGroup(graph).groupNodes.values()].some((n) => n.length > 0);
    if (hasGroups) {
      layoutWithGroups(graph, layoutFn, opts);
    } else {
      layoutFn(graph, allNodes, 100, 100, opts);
    }
  }

  // Apply direction transform
  if (opts.direction && opts.direction !== "Left to Right") {
    applyDirection(graph, allNodes, opts.direction, opts);
  }
}

// ═════════════════════════════════════════════════════════════════════════════
//  EXTENSION REGISTRATION
// ═════════════════════════════════════════════════════════════════════════════

function readNodeOpts(node) {
  const get = (name) => node.widgets?.find((w) => w.name === name)?.value;
  return {
    layout: get("layout") ?? "Layered (Vertical Stacks)",
    direction: get("direction") ?? "Left to Right",
    groupHandling: get("group_handling") ?? "Auto (Respect Groups)",
    horizontalSpacing: get("horizontal_spacing") ?? 100,
    verticalSpacing: get("vertical_spacing") ?? 100,
    groupPadding: get("group_padding") ?? 100,
  };
}

app.registerExtension({
  name: "comfyui.workflow.prettier",

  init() {
    // ── Canvas right-click: Prettify + quick layouts ──
    const origCanvas = LGraphCanvas.prototype.getCanvasMenuOptions;
    LGraphCanvas.prototype.getCanvasMenuOptions = function () {
      const options = origCanvas.apply(this, arguments);
      options.push(null);

      const defaultOpts = { horizontalSpacing: 100, verticalSpacing: 100, groupPadding: 100 };
      const doLayout = (fn) => {
        const g = app.graph;
        if (!g?._nodes?.length) return;
        pushUndo(g);
        fn(g);
        g.setDirtyCanvas(true, true);
      };

      options.push({
        content: "Prettify Workflow",
        has_submenu: true,
        callback: () => {},
        submenu: {
          options: [
            { content: "Layered (Vertical Stacks)", callback: () =>
                doLayout((g) => runPrettify(g, { ...defaultOpts, layout: "Layered (Vertical Stacks)", groupHandling: "Auto (Respect Groups)", direction: "Left to Right" })) },
            { content: "Linear (Left to Right)", callback: () =>
                doLayout((g) => runPrettify(g, { ...defaultOpts, layout: "Linear (Left to Right)", groupHandling: "Auto (Respect Groups)", direction: "Left to Right" })) },
            { content: "Compact (Tight Rectangle)", callback: () =>
                doLayout((g) => runPrettify(g, { ...defaultOpts, layout: "Compact (Tight Rectangle)", groupHandling: "Auto (Respect Groups)", direction: "Left to Right" })) },
            { content: "Sort by Type", callback: () =>
                doLayout((g) => runPrettify(g, { ...defaultOpts, layout: "Sort by Type", groupHandling: "Auto (Respect Groups)", direction: "Left to Right" })) },
            null,
            { content: "Equalize Spacing", callback: () => {
                const g = app.graph;
                if (!g?._nodes?.length) return;
                equalizeSpacing(g, defaultOpts);
            }},
            null,
            { content: `Undo (${undoStack.length})`, callback: () => {
                if (app.graph) popUndo(app.graph);
            }},
          ],
        },
      });

      return options;
    };

    // ── Node right-click: Alignment tools (when nodes selected) ──
    const origNode = LGraphCanvas.prototype.getNodeMenuOptions;
    if (origNode) {
      LGraphCanvas.prototype.getNodeMenuOptions = function (node) {
        const options = origNode.apply(this, arguments);
        const sel = getSelectedNodes(app.graph);
        if (sel.length >= 2) {
          options.push(null);
          options.push({
            content: "Align / Distribute",
            has_submenu: true,
            callback: () => {},
            submenu: {
              options: [
                { content: "Align Left", callback: () => alignNodes(app.graph, "left") },
                { content: "Align Right", callback: () => alignNodes(app.graph, "right") },
                { content: "Align Top", callback: () => alignNodes(app.graph, "top") },
                { content: "Align Bottom", callback: () => alignNodes(app.graph, "bottom") },
                null,
                { content: "Center Horizontally", callback: () => alignNodes(app.graph, "centerH") },
                { content: "Center Vertically", callback: () => alignNodes(app.graph, "centerV") },
                null,
                { content: "Distribute Horizontally", callback: () => alignNodes(app.graph, "distributeH") },
                { content: "Distribute Vertically", callback: () => alignNodes(app.graph, "distributeV") },
              ],
            },
          });
        }
        return options;
      };
    }
  },

  nodeCreated(node) {
    if (node.comfyClass !== "WorkflowPrettifier") return;

    node.color = "#2a363b";
    node.bgcolor = "#1a252a";

    // Prettify button
    const prettifyBtn = node.addWidget("button", "Prettify!", null, () => {
      const graph = app.graph;
      if (!graph?._nodes?.length) return;
      pushUndo(graph);
      runPrettify(graph, readNodeOpts(node));
      graph.setDirtyCanvas(true, true);
    });
    prettifyBtn.serialize = false;

    // Equalize Spacing button
    const eqBtn = node.addWidget("button", "Equalize Spacing", null, () => {
      const graph = app.graph;
      if (!graph?._nodes?.length) return;
      const opts = readNodeOpts(node);
      equalizeSpacing(graph, opts);
    });
    eqBtn.serialize = false;

    // Undo button
    const undoBtn = node.addWidget("button", "Undo", null, () => {
      if (app.graph) popUndo(app.graph);
    });
    undoBtn.serialize = false;

    node.size[0] = Math.max(node.size[0], 340);

    // ── Collapsible description panel via toggle button + custom draw widget ──
    let detailsOpen = false;

    const LAYOUT_HINTS = {
      "Layered (Vertical Stacks)": "DAG columns — nodes grouped by depth, stacked vertically. Best for standard workflows with branching pipelines.",
      "Linear (Left to Right)": "Single row in topological execution order. Good for simple linear pipelines with few branches.",
      "Compact (Tight Rectangle)": "Packs nodes into the smallest rectangle possible. Ignores connections — pure space optimization.",
      "Sort by Type": "Groups identical node types into columns, ordered by pipeline depth. Great for spotting patterns and duplicates.",
    };

    const DIR_HINTS = {
      "Left to Right": "Standard left-to-right data flow.",
      "Top to Bottom": "Vertical top-to-bottom flow — good for tall monitors.",
      "Right to Left": "Reversed right-to-left flow.",
    };

    const GROUP_HINTS = {
      "Auto (Respect Groups)": "Detects groups automatically. Nodes inside groups are arranged within the group, then groups are positioned as blocks.",
      "Respect Groups": "Forces group-aware layout even if detection is ambiguous.",
      "Ignore Groups": "Treats all nodes as ungrouped — flat layout across the entire canvas.",
    };

    function wrapText(ctx, text, maxWidth) {
      const words = text.split(" ");
      const lines = [];
      let current = "";
      for (const word of words) {
        const test = current ? current + " " + word : word;
        if (ctx.measureText(test).width > maxWidth && current) {
          lines.push(current);
          current = word;
        } else {
          current = test;
        }
      }
      if (current) lines.push(current);
      return lines;
    }

    // Toggle button
    const toggleBtn = node.addWidget("button", "▸ Details", null, () => {
      detailsOpen = !detailsOpen;
      toggleBtn.name = detailsOpen ? "▾ Hide Details" : "▸ Details";
      // Resize node to fit or shrink
      if (detailsOpen) {
        node._collapsedHeight = node.size[1];
        node.size[1] += detailsWidget._panelHeight || 120;
      } else {
        node.size[1] = node._collapsedHeight || node.size[1];
      }
      node.setDirtyCanvas(true, true);
    });
    toggleBtn.serialize = false;

    // Custom draw widget that renders the description panel
    const detailsWidget = node.addCustomWidget({
      name: "details_panel",
      type: "custom",
      value: "",
      serialize: false,
      _panelHeight: 0,

      draw(ctx, _node, widgetWidth, y, widgetHeight) {
        if (!detailsOpen) {
          this._panelHeight = 0;
          return;
        }

        const pad = 8;
        const w = widgetWidth - pad * 2;
        const lineH = 14;
        const font = "11px sans-serif";
        const boldFont = "bold 11px sans-serif";

        const layout = _node.widgets?.find((wg) => wg.name === "layout")?.value;
        const dir = _node.widgets?.find((wg) => wg.name === "direction")?.value;
        const grp = _node.widgets?.find((wg) => wg.name === "group_handling")?.value;

        // Pre-calculate all lines
        ctx.font = font;
        const layoutLines = wrapText(ctx, LAYOUT_HINTS[layout] ?? "", w - 8);
        const dirLines = wrapText(ctx, DIR_HINTS[dir] ?? "", w - 8);
        const grpLines = wrapText(ctx, GROUP_HINTS[grp] ?? "", w - 8);

        const totalLines = 3 + layoutLines.length + dirLines.length + grpLines.length + 2;
        const panelH = totalLines * lineH + 20;
        this._panelHeight = panelH;

        // Background
        ctx.fillStyle = "rgba(0,0,0,0.3)";
        ctx.beginPath();
        ctx.roundRect(pad, y + 2, w, panelH, 5);
        ctx.fill();

        let cy = y + lineH + 6;

        const drawSection = (title, lines, color) => {
          ctx.font = boldFont;
          ctx.fillStyle = color;
          ctx.fillText(title, pad + 6, cy);
          cy += lineH;

          ctx.font = font;
          ctx.fillStyle = "#bbb";
          for (const line of lines) {
            ctx.fillText(line, pad + 10, cy);
            cy += lineH;
          }
          cy += 6;
        };

        drawSection("Layout", layoutLines, "#8ac");
        drawSection("Direction", dirLines, "#8ca");
        drawSection("Groups", grpLines, "#a8c");

        // Footer
        ctx.fillStyle = "#777";
        ctx.font = font;
        ctx.fillText(`Undo: ${undoStack.length}/${MAX_UNDO}  ·  Select 2+ nodes → right-click → Align`, pad + 6, cy);
      },

      computeSize() {
        if (!detailsOpen) return [0, 0];
        return [340, this._panelHeight || 120];
      },
    });
  },
});
