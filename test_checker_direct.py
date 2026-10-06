from checker import check_sql

print("Testing incorrect SQL:")
print(check_sql(2, "SELECT 13;"))

print("\nTesting correct SQL:")
print(check_sql(2, "SELECT COUNT(*) FROM orders;"))
