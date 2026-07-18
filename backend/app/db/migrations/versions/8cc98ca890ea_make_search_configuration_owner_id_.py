"""make search_configuration owner_id nullable and seed global presets

Revision ID: 8cc98ca890ea
Revises: e94ae7c1bcc3
Create Date: 2026-07-18 16:41:03.870532

"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "8cc98ca890ea"
down_revision: str | None = "e94ae7c1bcc3"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None

GLOBAL_NAME_INDEX = "ix_search_configuration_global_name"

PRESETS = {
    "text reuse": {
        "weights": {"text": 0.6, "shingle": 0.2, "trigram": 0.2, "language": 0.0, "semantic": 0.0},
        "variant_weights": {
            "text": 0.3,
            "shingle": 0.1,
            "trigram": 0.1,
            "language": 0.0,
            "semantic": 0.0,
        },
    },
    "language": {
        "weights": {"text": 0.2, "shingle": 0.0, "trigram": 0.1, "language": 0.7, "semantic": 0.0},
        "variant_weights": {
            "text": 0.1,
            "shingle": 0.0,
            "trigram": 0.05,
            "language": 0.35,
            "semantic": 0.0,
        },
    },
    "semantic": {
        "weights": {"text": 0.0, "shingle": 0.0, "trigram": 0.0, "language": 0.0, "semantic": 1.0},
        "variant_weights": {
            "text": 0.0,
            "shingle": 0.0,
            "trigram": 0.0,
            "language": 0.0,
            "semantic": 0.5,
        },
    },
    "hybrid": {
        "weights": {"text": 0.2, "shingle": 0.0, "trigram": 0.1, "language": 0.7, "semantic": 1.0},
        "variant_weights": {
            "text": 0.1,
            "shingle": 0.0,
            "trigram": 0.05,
            "language": 0.35,
            "semantic": 0.5,
        },
    },
}


def upgrade() -> None:
    op.alter_column("search_configuration", "owner_id", existing_type=sa.INTEGER(), nullable=True)

    op.create_index(
        GLOBAL_NAME_INDEX,
        "search_configuration",
        ["name"],
        unique=True,
        postgresql_where=sa.text("owner_id IS NULL"),
    )

    search_configuration = sa.table(
        "search_configuration",
        sa.column("owner_id", sa.Integer),
        sa.column("name", sa.Text),
        sa.column("weights", postgresql.JSONB),
    )
    op.bulk_insert(
        search_configuration,
        [{"owner_id": None, "name": name, "weights": weights} for name, weights in PRESETS.items()],
    )


def downgrade() -> None:
    op.execute("DELETE FROM search_configuration WHERE owner_id IS NULL")
    op.drop_index(GLOBAL_NAME_INDEX, table_name="search_configuration")
    op.alter_column("search_configuration", "owner_id", existing_type=sa.INTEGER(), nullable=False)
