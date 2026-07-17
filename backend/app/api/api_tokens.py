from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.auth.api_keys import generate_api_key
from app.auth.dependencies import Principal, get_current_principal
from app.auth.models import ApiToken
from app.db.session import get_db

router = APIRouter(prefix="/api/api-tokens", tags=["api-tokens"])


class ApiTokenCreate(BaseModel):
    name: str | None = None
    scopes: list[str]
    expires_at: datetime | None = None


class ApiTokenOut(BaseModel):
    id: int
    name: str | None
    scopes: list[str]
    created_at: datetime
    expires_at: datetime | None
    revoked_at: datetime | None

    @classmethod
    def from_model(cls, token: ApiToken) -> "ApiTokenOut":
        return cls(
            id=token.id,
            name=token.name,
            scopes=token.scopes,
            created_at=token.created_at,
            expires_at=token.expires_at,
            revoked_at=token.revoked_at,
        )


class ApiTokenCreated(ApiTokenOut):
    raw_key: str


def _get_own_token(db: Session, principal: Principal, token_id: int) -> ApiToken:
    token = (
        db.query(ApiToken)
        .filter(ApiToken.id == token_id, ApiToken.user_id == principal.user_id)
        .one_or_none()
    )
    if token is None:
        raise HTTPException(status_code=404, detail="API token not found")
    return token


@router.post("", response_model=ApiTokenCreated, status_code=201)
def create_api_token(
    body: ApiTokenCreate,
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_current_principal),
) -> ApiTokenCreated:
    if not principal.is_superuser:
        unheld = set(body.scopes) - principal.roles
        if unheld:
            raise HTTPException(
                status_code=403,
                detail=f"Cannot grant scopes you don't hold as roles: {', '.join(sorted(unheld))}",
            )

    raw_key, token_hash = generate_api_key()
    token = ApiToken(
        user_id=principal.user_id,
        name=body.name,
        token_hash=token_hash,
        scopes=body.scopes,
        expires_at=body.expires_at,
    )
    db.add(token)
    db.commit()
    return ApiTokenCreated(**ApiTokenOut.from_model(token).model_dump(), raw_key=raw_key)


@router.get("", response_model=list[ApiTokenOut])
def list_api_tokens(
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_current_principal),
) -> list[ApiTokenOut]:
    tokens = db.query(ApiToken).filter(ApiToken.user_id == principal.user_id).all()
    return [ApiTokenOut.from_model(t) for t in tokens]


@router.delete("/{token_id}", status_code=204)
def revoke_api_token(
    token_id: int,
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_current_principal),
) -> None:
    token = _get_own_token(db, principal, token_id)
    token.revoked_at = datetime.now(UTC)
    db.commit()
