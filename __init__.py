WEB_DIRECTORY = "./web/js"


class WorkflowPrettifier:
    """Auto-arrange workflow nodes. Drop this node on the canvas, pick your
    settings, and click Prettify. Does not connect to other nodes."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "layout": ([
                    "Layered (Vertical Stacks)",
                    "Linear (Left to Right)",
                    "Compact (Tight Rectangle)",
                    "Sort by Type",
                ],),
                "direction": ([
                    "Left to Right",
                    "Top to Bottom",
                    "Right to Left",
                ],),
                "group_handling": ([
                    "Auto (Respect Groups)",
                    "Respect Groups",
                    "Ignore Groups",
                ],),
                "horizontal_spacing": ("INT", {"default": 100, "min": 30, "max": 400, "step": 10}),
                "vertical_spacing": ("INT", {"default": 100, "min": 20, "max": 200, "step": 10}),
                "group_padding": ("INT", {"default": 100, "min": 20, "max": 150, "step": 10}),
            },
        }

    RETURN_TYPES = ()
    FUNCTION = "noop"
    CATEGORY = "utils"
    OUTPUT_NODE = False
    DESCRIPTION = (
        "Auto-arrange your workflow nodes.\n\n"
        "Layouts: Layered (DAG columns), Linear (single row), "
        "Compact (tight rectangle), Sort by Type (group same nodes).\n\n"
        "Supports groups, configurable direction, and undo stack (10 deep).\n\n"
        "Right-click selected nodes for alignment tools."
    )

    def noop(self, **kwargs):
        return ()


NODE_CLASS_MAPPINGS = {
    "WorkflowPrettifier": WorkflowPrettifier,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "WorkflowPrettifier": "Workflow Prettifier",
}

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
