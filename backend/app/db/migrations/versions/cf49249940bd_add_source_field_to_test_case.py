"""add source field to test_case

Revision ID: cf49249940bd
Revises: f55ae20f2092
Create Date: 2026-07-18 19:26:28.178852

"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'cf49249940bd'
down_revision: str | None = 'f55ae20f2092'
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.add_column('test_case', sa.Column('source', sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column('test_case', 'source')
