from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth.models import Role

EXPECTED_ROLES = {
    "run_experiments",
    "use_search_engine",
    "use_rag",
    "index_content",
    "manage_users",
}


def test_migration_seeds_the_five_expected_roles(db_session: Session) -> None:
    names = set(db_session.scalars(select(Role.name)))
    assert names == EXPECTED_ROLES
