import sqlalchemy
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

# Use the 'postgres' database which always exists
DEFAULT_DB_URL = "postgresql://postgres:1234@localhost/postgres"
TARGET_DB_NAME = "samara_factory"

def init_db():
    print(f"Connecting to default DB: {DEFAULT_DB_URL}")
    engine = create_engine(DEFAULT_DB_URL, isolation_level="AUTOCOMMIT")
    
    try:
        with engine.connect() as conn:
            print("Successfully connected to 'postgres' database.")
            
            # Check if target db exists
            result = conn.execute(text(f"SELECT 1 FROM pg_database WHERE datname = '{TARGET_DB_NAME}'"))
            if result.fetchone():
                print(f"Database '{TARGET_DB_NAME}' already exists.")
            else:
                print(f"Database '{TARGET_DB_NAME}' does not exist. Creating...")
                conn.execute(text(f"CREATE DATABASE {TARGET_DB_NAME}"))
                print(f"Database '{TARGET_DB_NAME}' created successfully.")
                
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    init_db()
