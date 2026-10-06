from tutor import run_tutor_turn

SCHEMA = "customers(id int, name text, city text); orders(id int, customer_id int, order_date date, amount int)"

history = []

for attempt in range(1, 5):
    text, history, tool = run_tutor_turn(
        question_id=2,
        question_text="How many orders are there in total?",
        schema_hint=SCHEMA,
        learner_sql="SELECT 13;",       # deliberately wrong every time
        history=history,
        attempt_number=attempt,
    )
    print(f"--- ATTEMPT {attempt} ---")
    print("tool result:", tool)
    print("tutor:", text)
    print()
