import json
from functools import lru_cache
from pathlib import Path

from .models import Question, Suggestions

DATA_DIR = Path(__file__).parent / "data"
PATHWAY_FILE = DATA_DIR / "pathways.json"
REFERENCE_DIR = DATA_DIR / "references"

FALLBACK_NODE = "intake"


@lru_cache
def load_pathways() -> dict:
    pathways = json.loads(PATHWAY_FILE.read_text())
    nodes = pathways["nodes"]
    if pathways["root"] not in nodes:
        raise ValueError(f"Pathway root {pathways['root']!r} is not a node.")
    for node_id, node in nodes.items():
        for child in node.get("children", []):
            if child not in nodes:
                raise ValueError(
                    f"Pathway node {node_id!r} lists unknown child {child!r}."
                )
        hint = node.get("consult_hint")
        if hint and not (REFERENCE_DIR / f"{hint}.md").exists():
            raise ValueError(
                f"Pathway node {node_id!r} names consult_hint {hint!r} "
                "with no matching reference file."
            )
    return pathways


def node_ids() -> list[str]:
    """The closed label set for advisory classification."""
    return list(load_pathways()["nodes"].keys())


def node_catalog() -> str:
    """One line per node for the classification prompt: id — label — description."""
    nodes = load_pathways()["nodes"]
    return "\n".join(
        f"- {node_id}: {node['label']} — {node.get('description', '')}"
        for node_id, node in nodes.items()
    )


def resolve_node(node_id: str) -> str:
    return node_id if node_id in load_pathways()["nodes"] else FALLBACK_NODE


def questions_for(node_id: str) -> Suggestions:
    node_id = resolve_node(node_id)
    node = load_pathways()["nodes"][node_id]
    return Suggestions(
        pathway_node=node_id,
        questions=[Question.model_validate(item) for item in node["questions"]],
    )


def consult_hint_for(node_id: str) -> str | None:
    return load_pathways()["nodes"][resolve_node(node_id)].get("consult_hint")


@lru_cache
def reference_slice(hint: str) -> str:
    """The corpus slice the consult prompt grounds against, verbatim."""
    return (REFERENCE_DIR / f"{hint}.md").read_text()
