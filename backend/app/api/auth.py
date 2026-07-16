from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.auth.dependencies import Principal, get_current_principal
from app.auth.models import RefreshToken, User
from app.auth.security import verify_password
from app.auth.tokens import (
    REFRESH_TOKEN_EXPIRE_DAYS,
    create_access_token,
    generate_refresh_token,
    hash_token,
)
from app.db.session import get_db

router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginRequest(BaseModel):
    username: str
    password: str
    remember_me: bool = False


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class MeResponse(BaseModel):
    user_id: int
    roles: list[str]
    is_superuser: bool


def _issue_tokens(response: Response, db: Session, user: User, remember: bool) -> str:
    access_token = create_access_token(user.id, [r.name for r in user.roles], user.is_superuser)

    raw_refresh = generate_refresh_token()
    db.add(
        RefreshToken(
            user_id=user.id,
            token_hash=hash_token(raw_refresh),
            remember=remember,
            expires_at=datetime.now(UTC) + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS),
        )
    )
    db.commit()

    # Without max_age, cookies are session-only and vanish when the browser closes —
    # that's the deliberate default. "Remember me" is what makes the refresh cookie
    # (and therefore the session) survive a browser restart, up to its real expiry.
    refresh_max_age = REFRESH_TOKEN_EXPIRE_DAYS * 86400 if remember else None

    response.set_cookie("access_token", access_token, httponly=True, secure=True, samesite="lax")
    response.set_cookie(
        "refresh_token",
        raw_refresh,
        httponly=True,
        secure=True,
        samesite="lax",
        path="/api/auth",
        max_age=refresh_max_age,
    )
    return access_token


@router.post("/login", response_model=TokenResponse)
def login(body: LoginRequest, response: Response, db: Session = Depends(get_db)) -> TokenResponse:
    user = db.query(User).filter(User.username == body.username).one_or_none()
    if user is None or not user.is_active or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    access_token = _issue_tokens(response, db, user, body.remember_me)
    return TokenResponse(access_token=access_token)


@router.post("/refresh", response_model=TokenResponse)
def refresh(request: Request, response: Response, db: Session = Depends(get_db)) -> TokenResponse:
    raw_refresh = request.cookies.get("refresh_token")
    if not raw_refresh:
        raise HTTPException(status_code=401, detail="Missing refresh token")

    token_hash = hash_token(raw_refresh)
    stored = (
        db.query(RefreshToken)
        .filter(RefreshToken.token_hash == token_hash, RefreshToken.revoked_at.is_(None))
        .one_or_none()
    )
    if stored is None or stored.expires_at < datetime.now(UTC):
        raise HTTPException(status_code=401, detail="Invalid or expired refresh token")

    stored.revoked_at = datetime.now(UTC)
    user = db.query(User).filter(User.id == stored.user_id).one()
    access_token = _issue_tokens(response, db, user, stored.remember)
    return TokenResponse(access_token=access_token)


@router.post("/logout", status_code=204)
def logout(request: Request, response: Response, db: Session = Depends(get_db)) -> None:
    raw_refresh = request.cookies.get("refresh_token")
    if raw_refresh:
        token_hash = hash_token(raw_refresh)
        stored = db.query(RefreshToken).filter(RefreshToken.token_hash == token_hash).one_or_none()
        if stored is not None:
            stored.revoked_at = datetime.now(UTC)
            db.commit()

    response.delete_cookie("access_token")
    response.delete_cookie("refresh_token", path="/api/auth")


@router.get("/me", response_model=MeResponse)
def me(principal: Principal = Depends(get_current_principal)) -> MeResponse:
    return MeResponse(
        user_id=principal.user_id,
        roles=sorted(principal.roles),
        is_superuser=principal.is_superuser,
    )
