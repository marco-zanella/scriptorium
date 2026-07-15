import hashlib
import secrets
from datetime import UTC, datetime, timedelta

import jwt

from app.core.config import settings

ACCESS_TOKEN_EXPIRE_MINUTES = 30
REFRESH_TOKEN_EXPIRE_DAYS = 30
JWT_ALGORITHM = "HS256"


def create_access_token(user_id: int, roles: list[str], is_superuser: bool) -> str:
    now = datetime.now(UTC)
    payload = {
        "sub": str(user_id),
        "roles": roles,
        "is_superuser": is_superuser,
        "iat": now,
        "exp": now + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES),
    }
    return jwt.encode(payload, settings.jwt_secret_key, algorithm=JWT_ALGORITHM)


def decode_access_token(token: str) -> dict:
    return jwt.decode(token, settings.jwt_secret_key, algorithms=[JWT_ALGORITHM])


def generate_refresh_token() -> str:
    return secrets.token_urlsafe(32)


def hash_token(raw_token: str) -> str:
    return hashlib.sha256(raw_token.encode()).hexdigest()
