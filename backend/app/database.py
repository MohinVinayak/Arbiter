import ssl
from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base
from sqlalchemy.orm import sessionmaker
from app.config import settings

_db_url = settings.DATABASE_URL

# Render injects postgres:// — SQLAlchemy needs postgresql://
if _db_url.startswith("postgres://"):
    _db_url = _db_url.replace("postgres://", "postgresql://", 1)

# SQLite: needs check_same_thread=False for FastAPI's thread model
if _db_url.startswith("sqlite"):
    engine = create_engine(
        _db_url,
        connect_args={"check_same_thread": False}
    )
else:
    # PostgreSQL via pg8000 (pure-Python, no C-ext — works everywhere)
    if "+pg8000" not in _db_url:
        _db_url = _db_url.replace("postgresql://", "postgresql+pg8000://", 1)
        
    # Neon and other managed DBs often append ?sslmode=require. pg8000 doesn't support 
    # this query parameter directly in the connection URL, so we strip it.
    if "?" in _db_url:
        _db_url = _db_url.split("?")[0]
        
    # Create a default SSL context for secure connection (required by Neon/Render)
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    
    engine = create_engine(_db_url, connect_args={"ssl_context": ctx})

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    """Dependency — inject a DB session into route handlers."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()