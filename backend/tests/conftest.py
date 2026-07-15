from collections.abc import Generator

import pytest
from sqlalchemy.orm import Session

from app.auth.models import User
from app.db.session import SessionLocal


@pytest.fixture
def db_session() -> Generator[Session, None, None]:
    session = SessionLocal()
    try:
        yield session
    finally:
        session.query(User).delete()
        session.commit()
        session.close()
