import secrets
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.auth.models import ApiToken
from app.auth.tokens import hash_token
from app.db.session import get_db

API_KEY_PREFIX = "scriptorium_sk_"

api_key_scheme = HTTPBearer(auto_error=False)


@dataclass
class ApiKeyPrincipal:
    user_id: int
    token_id: int
    scopes: set[str]


def generate_api_key() -> tuple[str, str]:
    """Returns (raw_key, hash) — only the hash is ever persisted."""
    raw_key = f"{API_KEY_PREFIX}{secrets.token_urlsafe(32)}"
    return raw_key, hash_token(raw_key)


def _get_current_api_key_principal(
    creds: HTTPAuthorizationCredentials | None = Depends(api_key_scheme),
    db: Session = Depends(get_db),
) -> ApiKeyPrincipal:
    if not creds or not creds.credentials.startswith(API_KEY_PREFIX):
        raise HTTPException(status_code=401, detail="Not authenticated")

    token = db.query(ApiToken).filter_by(token_hash=hash_token(creds.credentials)).first()
    if token is None:
        raise HTTPException(status_code=401, detail="Invalid API key")
    if token.revoked_at is not None:
        raise HTTPException(status_code=401, detail="API key has been revoked")
    if token.expires_at is not None and token.expires_at <= datetime.now(UTC):
        raise HTTPException(status_code=401, detail="API key has expired")

    return ApiKeyPrincipal(user_id=token.user_id, token_id=token.id, scopes=set(token.scopes))


def require_scope(*scopes: str) -> Callable[[ApiKeyPrincipal], ApiKeyPrincipal]:
    def _check(
        principal: ApiKeyPrincipal = Depends(_get_current_api_key_principal),
    ) -> ApiKeyPrincipal:
        if not set(scopes) & principal.scopes:
            raise HTTPException(status_code=403, detail="Insufficient scope")
        return principal

    return _check
