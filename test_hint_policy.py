from hint_policy import tool_context_for_level

sample_result = {
    "correct": False,
    "reason": "value_mismatch",
    "learner_rows": [(10,), (20,)],
    "reference_sql": "SELECT COUNT(*) FROM orders;"
}

for level in range(1, 5):
    print(f"\nLEVEL {level}")
    print(tool_context_for_level(level, sample_result))