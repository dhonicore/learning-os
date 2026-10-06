CHECK_SQL_TOOL = {
    "type": "function",
    "function": {
        "name": "check_sql",
        "description": (
            "Run the learner's SQL against the practice database and compare "
            "its result to the expected result. Returns correctness and a "
            "short reason. Does NOT return the expected answer."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "question_id": {
                    "type": "integer",
                    "description": "The numeric id of the practice question (1-8).",
                },
                "sql": {
                    "type": "string",
                    "description": "The learner's SQL query, exactly as written.",
                },
            },
            "required": ["question_id", "sql"],
        },
    },
}

from checker import check_sql


def execute_tool(name: str, arguments: dict) -> dict:
    if name == "check_sql":
        return check_sql(
            question_id=int(arguments["question_id"]),
            learner_sql=arguments["sql"],
        )
    return {"error": f"Unknown tool: {name}"}