# Workflow Prettier

A ComfyUI custom node that auto-arranges your workflow nodes with a single click.
Drop the node on the canvas, pick your layout settings, and hit **Prettify** — or right-click the canvas for quick access.

![ComfyUI](https://img.shields.io/badge/ComfyUI-custom_node-blue)
![License](https://img.shields.io/badge/license-MIT-green)

## Features

- **4 layout algorithms**
  - **Layered (Vertical Stacks)** — Sugiyama-style DAG columns with crossing minimization. Best for standard pipelines.
  - **Linear (Left to Right)** — Single row in topological order. Great for simple chains.
  - **Compact (Tight Rectangle)** — Shelf-based rectangle packing. Minimizes canvas area.
  - **Sort by Type** — Groups identical node types into columns, ordered by pipeline depth.

- **3 direction modes** — Left to Right, Top to Bottom, Right to Left

- **Group-aware layout** — Nodes inside groups are arranged within the group boundary, then groups are positioned as blocks. Supports nested groups.

- **Alignment & distribution tools** — Select 2+ nodes, right-click → Align/Distribute (left, right, top, bottom, center, distribute evenly — Figma-style)

- **Equalize Spacing** — Normalizes gaps between nodes without reordering

- **10-deep undo stack** — Every prettify/align action is undoable

- **Configurable spacing** — Horizontal, vertical, and group padding sliders

- **Collapsible details panel** — On-node description of what each setting does

## Installation

### ComfyUI Manager (Recommended)

Search for "Workflow Prettier" in the ComfyUI Manager and install.

### Manual (Git)

```bash
cd ComfyUI/custom_nodes
git clone https://github.com/Comfy-Org/comfyui-workflow-prettier.git
```

Restart ComfyUI. No pip dependencies required.

## Usage

### Quick Access (Right-Click Menu)

Right-click the canvas → **Prettify Workflow** → pick a layout. Uses sensible defaults (100px spacing, auto group detection).

### Full Control (Node)

1. Add the **Workflow Prettifier** node (search or find in `utils` category)
2. Configure layout, direction, group handling, and spacing
3. Click **Prettify!**
4. Click **Undo** if you don't like the result

### Alignment Tools

1. Select 2+ nodes
2. Right-click any selected node → **Align / Distribute**
3. Choose from: Align Left/Right/Top/Bottom, Center H/V, Distribute H/V

## How It Works

### Layered Layout (Sugiyama Algorithm)

1. **Build DAG** from node connections
2. **Topological sort** (Kahn's algorithm) to establish execution order
3. **Layer assignment** — each node placed in the earliest valid column
4. **Crossing minimization** — bidirectional barycenter heuristic (6 iterations)
5. **Coordinate assignment** — anchor-based median alignment: stack the densest layer compactly, propagate outward using median positions of connected neighbors, then resolve any remaining overlaps

### Compact Layout

Shelf-based rectangle packing: sorts nodes by height (tall first), fills shelves left-to-right until reaching a target width (√totalArea × 1.1), then starts a new shelf.

### Group-Aware Layout

1. Detect which nodes belong to which groups (center-point containment test, smallest area wins for nesting)
2. Layout nodes within each group independently
3. Build a "super-DAG" where each group is a virtual node sized to fit its contents
4. Run the same layout algorithm on the super-DAG
5. Offset each group's internal nodes to their final position

### Direction Transform

After layout, coordinates are transformed:
- **Top to Bottom**: Swap x/y coordinates, then run overlap resolution to handle size differences
- **Right to Left**: Mirror x-axis

## Configuration

| Setting | Default | Range | Description |
|---------|---------|-------|-------------|
| Layout | Layered | — | Layout algorithm to use |
| Direction | Left to Right | — | Flow direction |
| Group Handling | Auto | — | How to handle node groups |
| Horizontal Spacing | 100 | 30–400 | Gap between columns/nodes |
| Vertical Spacing | 100 | 20–200 | Gap between rows/nodes |
| Group Padding | 100 | 20–150 | Internal padding within groups |

## Project Structure

```
comfyui-workflow-prettier/
├── __init__.py              # Node definition (Python)
├── web/js/
│   └── workflow_prettier.js # Layout algorithms & UI (JavaScript)
├── pyproject.toml           # Package metadata
├── LICENSE                  # MIT
└── README.md
```

## Contributing

Contributions welcome! This is an open-source project under the MIT license.

1. Fork the repository
2. Create a feature branch
3. Test with various workflow sizes and group configurations
4. Submit a pull request

## License

[MIT](LICENSE) — Comfy Org, 2026
