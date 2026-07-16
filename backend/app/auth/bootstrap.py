from sqlalchemy.orm import Session

from app.auth.models import User
from app.auth.security import hash_password


def create_or_reset_admin(db: Session, username: str, email: str, password: str) -> User:
    existing = db.query(User).filter(User.is_superuser.is_(True)).one_or_none()

    if existing is not None:
        existing.username = username
        existing.email = email
        existing.password_hash = hash_password(password)
        existing.is_active = True
        db.commit()
        return existing

    admin = User(
        username=username,
        email=email,
        password_hash=hash_password(password),
        is_superuser=True,
        is_active=True,
    )
    db.add(admin)
    db.commit()
    return admin
