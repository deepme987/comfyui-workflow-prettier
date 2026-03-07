# Workflow Prettier

Auto-arrange your ComfyUI workflow nodes with a single click.

<!-- TODO: Add screenshot here -->

## Features

- 4 layout algorithms: Layered (Sugiyama), Linear, Compact, Sort by Type
- Group-aware — prettifies within groups, then arranges groups as blocks
- 3 directions: Left-to-Right, Top-to-Bottom, Right-to-Left
- Alignment & distribution tools (select 2+ nodes → right-click)
- 10-deep undo stack

## Installation

### ComfyUI Manager

Search for **"Workflow Prettier"** and install.

### Manual

```bash
cd ComfyUI/custom_nodes
git clone https://github.com/Comfy-Org/comfyui-workflow-prettier.git
```

Restart ComfyUI. No dependencies required.

## Usage

**Quick:** Right-click canvas → **Prettify Workflow** → pick a layout.

**Full control:** Add the **Workflow Prettifier** node (`utils` category), configure settings, click **Prettify!**

## License

[MIT](LICENSE)
