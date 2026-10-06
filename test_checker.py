from checker import check_sql

cases = [
    (1, "SELECT * FROM customers WHERE city = 'Bengaluru';", True,  "correct"),
    (1, "SELECT * FROM customers WHERE city = 'Delhi';",     False, "wrong result"),
    (2, "SELECT COUNT(*) FROM orders;",                      True,  "correct"),
    (2, "SELECT 13;",                                        False, "wrong count"),
    (3, "SELECT c.name, SUM(o.amount) FROM customers c JOIN orders o ON o.customer_id=c.id GROUP BY c.name;", True, "correct no alias"),
    (4, "SELECT c.name FROM customers c JOIN orders o ON o.customer_id=c.id GROUP BY c.name HAVING COUNT(*) > 2;", False, "missing count column"),
    (5, "SELECT c.name, o.amount FROM customers c JOIN orders o ON o.customer_id=c.id WHERE o.order_date >= '2026-07-01';", False, "missing upper bound"),
    (6, "SELECT name FROM customers WHERE id NOT IN (SELECT customer_id FROM orders);", True, "alternative correct"),
    (7, "SELECT c.city, ROUND(AVG(o.amount)) FROM customers c JOIN orders o ON o.customer_id=c.id GROUP BY c.city;", False, "rounded"),
    (8, "SELECT c.name, COUNT(*) FROM customers c JOIN orders o ON o.customer_id=c.id WHERE o.order_date BETWEEN '2026-08-01' AND '2026-08-31' GROUP BY c.name HAVING COUNT(*) > 1;", True, "correct"),
    # safety tests
    (1, "DROP TABLE customers;",                             False, "unsafe"),
    (1, "SELECT * FROM customers; DELETE FROM orders;",      False, "multi"),
    (1, "UPDATE customers SET city='X';",                    False, "unsafe"),
]

for qid, sql, expected_correct, label in cases:
    result = check_sql(qid, sql)
    mark = "PASS" if result["correct"] == expected_correct else "FAIL"
    print(f"[{mark}] Q{qid} {label:25s} -> correct={result['correct']} reason={result['reason']}")
