QUESTIONS = {
    1: {
        "purpose": "practice",
        "question": "List all customers from Bengaluru.",
        "reference_sql": "SELECT * FROM customers WHERE city = 'Bengaluru';",
    },
    2: {
        "purpose": "practice",
        "question": "How many orders are there in total?",
        "reference_sql": "SELECT COUNT(*) FROM orders;",
    },
    3: {
        "purpose": "practice",
        "question": "What is the total amount spent by each customer?",
        "reference_sql": """
            SELECT c.name, SUM(o.amount) AS total
            FROM customers c
            JOIN orders o ON o.customer_id = c.id
            GROUP BY c.name;
        """,
    },
    4: {
        "purpose": "practice",
        "question": "Which customers placed more than 2 orders?",
        "reference_sql": """
            SELECT c.name, COUNT(o.id) AS order_count
            FROM customers c
            JOIN orders o ON o.customer_id = c.id
            GROUP BY c.name
            HAVING COUNT(o.id) > 2;
        """,
    },
    5: {
        "purpose": "practice",
        "question": "Show customer name and amount for orders placed in July-September 2026.",
        "reference_sql": """
            SELECT c.name, o.amount
            FROM customers c
            JOIN orders o ON o.customer_id = c.id
            WHERE o.order_date BETWEEN '2026-07-01' AND '2026-09-30';
        """,
    },
    6: {
        "purpose": "held_out",
        "question": "Which customers have never ordered?",
        "reference_sql": """
            SELECT c.name
            FROM customers c
            LEFT JOIN orders o ON o.customer_id = c.id
            WHERE o.id IS NULL;
        """,
    },
    7: {
        "purpose": "held_out",
        "question": "What is the average order amount per city?",
        "reference_sql": """
            SELECT c.city, AVG(o.amount) AS avg_amount
            FROM customers c
            JOIN orders o ON o.customer_id = c.id
            GROUP BY c.city;
        """,
    },
    8: {
        "purpose": "held_out",
        "question": "Which customers placed more than 1 order in August 2026?",
        "reference_sql": """
            SELECT c.name, COUNT(o.id) AS order_count
            FROM customers c
            JOIN orders o ON o.customer_id = c.id
            WHERE o.order_date BETWEEN '2026-08-01' AND '2026-08-31'
            GROUP BY c.name
            HAVING COUNT(o.id) > 1;
        """,
    },
}