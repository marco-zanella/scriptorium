"""add score_stats to result_case

Revision ID: 474eb8ddd2cb
Revises: cf49249940bd
Create Date: 2026-07-20 09:47:30.438296

"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "474eb8ddd2cb"
down_revision: str | None = "cf49249940bd"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "result_case",
        sa.Column("score_stats", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("result_case", "score_stats")
