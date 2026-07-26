import json
from functools import lru_cache
from pathlib import Path

from .models import Question, Suggestions

PATHWAY_FILE = Path(__file__).parent / "data" / "pathways.json"


@lru_cache
def load_pathways() -> dict:
    return json.loads(PATHWAY_FILE.read_text())


def questions_for(node_id: str) -> Suggestions:
    pathways = load_pathways()
    node = pathways["nodes"].get(node_id, pathways["nodes"]["intake"])
    return Suggestions(
        pathway_node=node_id if node_id in pathways["nodes"] else "intake",
        questions=[Question.model_validate(item) for item in node["questions"]],
    )
