from collections.abc import Callable
from dataclasses import dataclass

import jwt
from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.auth.tokens import decode_access_token

bearer_scheme = HTTPBearer(auto_error=False)


@dataclass
class Principal:
    user_id: int
    roles: set[str]
    is_superuser: bool


def get_current_principal(
    request: Request,
    creds: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> Principal:
    token = creds.credentials if creds else request.cookies.get("access_token")
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")

    try:
        payload = decode_access_token(token)
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired token") from None

    return Principal(
        user_id=int(payload["sub"]),
        roles=set(payload.get("roles", [])),
        is_superuser=bool(payload.get("is_superuser", False)),
    )


def require_role(*roles: str) -> Callable[[Principal], Principal]:
    def _check(principal: Principal = Depends(get_current_principal)) -> Principal:
        if principal.is_superuser:
            return principal
        if not set(roles) & principal.roles:
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        return principal

    return _check
