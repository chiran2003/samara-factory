from sqlalchemy import create_engine, text

# Use the exact string from database.py but ensuring psycopg2 is explicit
DB_URL = "postgresql+psycopg2://postgres:1234@localhost/samara_factory"

def test_conn():
    print(f"Connecting to: {DB_URL}")
    engine = create_engine(DB_URL)
    try:
        with engine.connect() as conn:
            print("Successfully connected to 'samara_factory'!")
            result = conn.execute(text("SELECT 1"))
            print(f"Test query result: {result.fetchone()}")
    except Exception as e:
        print(f"FAILED TO CONNECT: {e}")

if __name__ == "__main__":
    test_conn()
