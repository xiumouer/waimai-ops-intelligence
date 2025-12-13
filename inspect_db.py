import sqlite3
import os

DB_PATH = 'data.db'

def inspect():
    if not os.path.exists(DB_PATH):
        print(f"Database not found at {DB_PATH}")
        return

    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    
    # Get table list
    c.execute("SELECT name FROM sqlite_master WHERE type='table';")
    tables = c.fetchall()
    
    print(f"{'Table':<20} {'Column Info (cid, name, type, notnull, dflt_value, pk)'}")
    print("-" * 80)
    
    for t in tables:
        table_name = t[0]
        if table_name == 'sqlite_sequence':
            continue
            
        c.execute(f"SELECT COUNT(*) FROM {table_name}")
        count = c.fetchone()[0]
        
        print(f"\n[{table_name}] ({count} rows)")
        c.execute(f"PRAGMA table_info({table_name})")
        cols = c.fetchall()
        for col in cols:
            # col: (cid, name, type, notnull, dflt_value, pk)
            print(f"  - {col[1]:<15} {col[2]:<10} (PK: {col[5]})")
            
    conn.close()

if __name__ == '__main__':
    inspect()
