from sqlalchemy.orm import Session

from app.auth.bootstrap import create_or_reset_admin
from app.auth.models import User
from app.auth.security import verify_password


def test_creates_superuser_when_none_exists(db_session: Session) -> None:
    admin = create_or_reset_admin(db_session, "admin", "admin@example.com", "s3cret-pw")

    assert admin.is_superuser
    assert admin.is_active
    assert verify_password("s3cret-pw", admin.password_hash)


def test_rerunning_resets_the_same_superuser_instead_of_creating_another(
    db_session: Session,
) -> None:
    first = create_or_reset_admin(db_session, "admin", "admin@example.com", "first-pw")
    second = create_or_reset_admin(db_session, "admin2", "admin2@example.com", "second-pw")

    assert first.id == second.id
    assert db_session.query(User).filter(User.is_superuser.is_(True)).count() == 1
    assert second.username == "admin2"
    assert verify_password("second-pw", second.password_hash)
