from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from app.config import settings

# Force pg8000 dialect — psycopg2 has DLL issues on Windows with Python 3.14+.
# Rewrites postgresql:// or postgresql+psycopg2:// → postgresql+pg8000://
_db_url = settings.DATABASE_URL
if "postgresql" in _db_url and "+pg8000" not in _db_url:
    _db_url = _db_url.replace("postgresql+psycopg2", "postgresql").replace("postgresql", "postgresql+pg8000", 1)

engine = create_engine(_db_url)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

# Dependency — inject DB session into routes
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()