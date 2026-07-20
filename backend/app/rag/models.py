from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class Conversation(Base):
    __tablename__ = "conversation"

    id: Mapped[int] = mapped_column(primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("app_user.id", ondelete="CASCADE"))
    title: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # passive_deletes=True: the FK's own ondelete="CASCADE" (same convention as
    # every other table in this codebase) already handles child rows at the DB
    # level - without this, the ORM's default delete behavior tries to first
    # UPDATE each loaded child's conversation_id to NULL (which the NOT NULL
    # constraint then rejects) instead of just deleting the parent and letting
    # Postgres cascade.
    messages: Mapped[list["Message"]] = relationship(
        order_by="Message.id", back_populates="conversation", passive_deletes=True
    )


class Message(Base):
    __tablename__ = "message"
    __table_args__ = (
        CheckConstraint("role IN ('user', 'assistant')", name="ck_message_role"),
        CheckConstraint(
            "(role = 'user' AND status IS NULL) OR "
            "(role = 'assistant' AND status IN ('pending', 'streaming', 'completed', 'failed'))",
            name="ck_message_status_by_role",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    conversation_id: Mapped[int] = mapped_column(ForeignKey("conversation.id", ondelete="CASCADE"))
    role: Mapped[str] = mapped_column(Text, nullable=False)
    content: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str | None] = mapped_column(Text, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    # [{"name": str, "args": dict, "result": dict}, ...] in call order for this
    # assistant turn. Citations shown to the user are derived from this at read
    # time (flatten+dedup each invocation's result["hits"]), never stored
    # separately - same "no precomputed columns" convention as app/eval/.
    tool_invocations: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    conversation: Mapped["Conversation"] = relationship(back_populates="messages")
