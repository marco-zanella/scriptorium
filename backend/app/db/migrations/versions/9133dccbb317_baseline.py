"""baseline

Revision ID: 9133dccbb317
Revises: 
Create Date: 2026-07-15 16:15:47.866909

"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '9133dccbb317'
down_revision: str | None = None
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
