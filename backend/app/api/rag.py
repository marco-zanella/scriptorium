from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sse_starlette import EventSourceResponse

from app.auth.dependencies import Principal, require_role
from app.db.session import get_db
from app.rag.citations import citations_from_tool_invocations
from app.rag.loop import run_turn
from app.rag.models import Conversation, Message

router = APIRouter(prefix="/api/rag/conversations", tags=["rag"])

_IN_FLIGHT_STATUSES = ("pending", "streaming")


class ConversationOut(BaseModel):
    id: int
    title: str | None
    created_at: datetime
    updated_at: datetime

    @classmethod
    def from_model(cls, conversation: Conversation) -> "ConversationOut":
        return cls(
            id=conversation.id,
            title=conversation.title,
            created_at=conversation.created_at,
            updated_at=conversation.updated_at,
        )


class ConversationCreate(BaseModel):
    title: str | None = None


class CitationOut(BaseModel):
    id: str
    book: str | None
    chapter: str | None
    verse: str | None
    source: str | None
    content: str | None


class MessageOut(BaseModel):
    id: int
    role: str
    content: str | None
    status: str | None
    error: str | None
    citations: list[CitationOut]
    created_at: datetime
    updated_at: datetime

    @classmethod
    def from_model(cls, message: Message) -> "MessageOut":
        return cls(
            id=message.id,
            role=message.role,
            content=message.content,
            status=message.status,
            error=message.error,
            citations=citations_from_tool_invocations(message.tool_invocations),
            created_at=message.created_at,
            updated_at=message.updated_at,
        )


class MessageCreate(BaseModel):
    content: str


def _visible_query(db: Session, principal: Principal):
    query = db.query(Conversation)
    if not principal.is_superuser:
        query = query.filter(Conversation.owner_id == principal.user_id)
    return query


def _get_visible_conversation(
    db: Session, conversation_id: int, principal: Principal
) -> Conversation:
    conversation = (
        _visible_query(db, principal).filter(Conversation.id == conversation_id).one_or_none()
    )
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return conversation


@router.get("", response_model=list[ConversationOut])
def list_conversations(
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_role("use_rag")),
) -> list[ConversationOut]:
    conversations = _visible_query(db, principal).order_by(Conversation.id.desc()).all()
    return [ConversationOut.from_model(c) for c in conversations]


@router.post("", response_model=ConversationOut, status_code=201)
def create_conversation(
    body: ConversationCreate,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_role("use_rag")),
) -> ConversationOut:
    conversation = Conversation(owner_id=principal.user_id, title=body.title)
    db.add(conversation)
    db.commit()
    return ConversationOut.from_model(conversation)


@router.get("/{conversation_id}", response_model=ConversationOut)
def get_conversation(
    conversation_id: int,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_role("use_rag")),
) -> ConversationOut:
    return ConversationOut.from_model(_get_visible_conversation(db, conversation_id, principal))


@router.patch("/{conversation_id}", response_model=ConversationOut)
def rename_conversation(
    conversation_id: int,
    body: ConversationCreate,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_role("use_rag")),
) -> ConversationOut:
    conversation = _get_visible_conversation(db, conversation_id, principal)
    conversation.title = body.title
    db.commit()
    return ConversationOut.from_model(conversation)


@router.delete("/{conversation_id}", status_code=204)
def delete_conversation(
    conversation_id: int,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_role("use_rag")),
) -> None:
    conversation = _get_visible_conversation(db, conversation_id, principal)
    db.delete(conversation)
    db.commit()


@router.get("/{conversation_id}/messages", response_model=list[MessageOut])
def list_messages(
    conversation_id: int,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_role("use_rag")),
) -> list[MessageOut]:
    conversation = _get_visible_conversation(db, conversation_id, principal)
    return [MessageOut.from_model(m) for m in conversation.messages]


@router.post("/{conversation_id}/messages")
def post_message(
    conversation_id: int,
    body: MessageCreate,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_role("use_rag")),
) -> EventSourceResponse:
    conversation = _get_visible_conversation(db, conversation_id, principal)

    in_flight = (
        db.query(Message)
        .filter(
            Message.conversation_id == conversation.id,
            Message.status.in_(_IN_FLIGHT_STATUSES),
        )
        .first()
    )
    if in_flight is not None:
        raise HTTPException(status_code=409, detail="A response is already in progress")

    db.add(Message(conversation_id=conversation.id, role="user", content=body.content))
    assistant_message = Message(conversation_id=conversation.id, role="assistant", status="pending")
    db.add(assistant_message)
    db.commit()

    # sep="\n" so the wire format is exactly `data: <json>\n\n` per event -
    # sse_starlette's own default separator is "\r\n", which the frontend's
    # \n\n-based frame parser wouldn't match.
    return EventSourceResponse(run_turn(assistant_message.id), sep="\n")
