from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    Column,
    DateTime,
    ForeignKey,
    SmallInteger,
    Table,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

test_collection_membership = Table(
    "test_collection_membership",
    Base.metadata,
    Column(
        "test_collection_id", ForeignKey("test_collection.id", ondelete="CASCADE"), primary_key=True
    ),
    Column("test_case_id", ForeignKey("test_case.id", ondelete="CASCADE"), primary_key=True),
)


class TestCase(Base):
    __tablename__ = "test_case"
    __test__ = False

    id: Mapped[int] = mapped_column(primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("app_user.id", ondelete="CASCADE"))
    content: Mapped[str] = mapped_column(Text, nullable=False)
    language: Mapped[str] = mapped_column(Text, nullable=False)
    source: Mapped[str | None] = mapped_column(Text, nullable=True)
    context: Mapped[str | None] = mapped_column(Text, nullable=True)
    tags: Mapped[list[str]] = mapped_column(ARRAY(Text), nullable=False, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    collections: Mapped[list["TestCollection"]] = relationship(
        secondary=test_collection_membership, back_populates="test_cases"
    )
    targets: Mapped[list["TestCaseTarget"]] = relationship()


class TestCaseTarget(Base):
    __tablename__ = "test_case_target"
    __test__ = False
    __table_args__ = (
        UniqueConstraint("test_case_id", "target"),
        CheckConstraint("relevance BETWEEN 0 AND 3", name="ck_test_case_target_relevance_range"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    test_case_id: Mapped[int] = mapped_column(ForeignKey("test_case.id", ondelete="CASCADE"))
    target: Mapped[str] = mapped_column(Text, nullable=False)
    relevance: Mapped[int] = mapped_column(SmallInteger, nullable=False)


class TestCollection(Base):
    __tablename__ = "test_collection"
    __test__ = False

    id: Mapped[int] = mapped_column(primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("app_user.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    search_configuration_id: Mapped[int] = mapped_column(
        ForeignKey("search_configuration.id", ondelete="RESTRICT")
    )
    books: Mapped[list[str]] = mapped_column(ARRAY(Text), nullable=False, default=list)
    sources: Mapped[list[str]] = mapped_column(ARRAY(Text), nullable=False, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    test_cases: Mapped[list["TestCase"]] = relationship(
        secondary=test_collection_membership, back_populates="collections"
    )


class ResultCollection(Base):
    __tablename__ = "result_collection"
    __table_args__ = (
        CheckConstraint(
            "status IN ('pending', 'running', 'completed', 'failed')",
            name="ck_result_collection_status",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    test_collection_id: Mapped[int] = mapped_column(
        ForeignKey("test_collection.id", ondelete="CASCADE")
    )
    configuration_snapshot: Mapped[dict] = mapped_column(JSONB, nullable=False)
    books_snapshot: Mapped[list[str]] = mapped_column(ARRAY(Text), nullable=False)
    sources_snapshot: Mapped[list[str]] = mapped_column(ARRAY(Text), nullable=False)
    status: Mapped[str] = mapped_column(Text, nullable=False)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    test_collection: Mapped["TestCollection"] = relationship()


class ResultCase(Base):
    __tablename__ = "result_case"

    id: Mapped[int] = mapped_column(primary_key=True)
    test_case_id: Mapped[int] = mapped_column(ForeignKey("test_case.id", ondelete="CASCADE"))
    result_collection_id: Mapped[int] = mapped_column(
        ForeignKey("result_collection.id", ondelete="CASCADE")
    )
    results: Mapped[list] = mapped_column(JSONB, nullable=False)
    snapshot: Mapped[dict] = mapped_column(JSONB, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
