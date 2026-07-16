from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.auth.dependencies import Principal, require_role
from app.auth.models import Role, User
from app.auth.security import hash_password
from app.db.session import get_db

router = APIRouter(prefix="/api/users", tags=["users"])


class UserOut(BaseModel):
    id: int
    username: str
    email: str
    is_active: bool
    is_superuser: bool
    roles: list[str]
    created_at: datetime

    @classmethod
    def from_model(cls, user: User) -> "UserOut":
        return cls(
            id=user.id,
            username=user.username,
            email=user.email,
            is_active=user.is_active,
            is_superuser=user.is_superuser,
            roles=sorted(r.name for r in user.roles),
            created_at=user.created_at,
        )


class UserCreate(BaseModel):
    username: str
    email: str
    password: str = Field(min_length=8)
    roles: list[str] = []


class UserPatch(BaseModel):
    username: str | None = None
    email: str | None = None
    password: str | None = Field(default=None, min_length=8)
    is_active: bool | None = None


def _get_target_user(db: Session, user_id: int) -> User:
    # The superuser account is entirely out of scope for these endpoints — its
    # lifecycle is CLI-only. 404 (not 403) so its existence isn't leaked either.
    user = db.query(User).filter(User.id == user_id).one_or_none()
    if user is None or user.is_superuser:
        raise HTTPException(status_code=404, detail="User not found")
    return user


def _resolve_roles(db: Session, names: list[str], principal: Principal) -> list[Role]:
    if "manage_users" in names and not principal.is_superuser:
        raise HTTPException(status_code=403, detail="Only the superuser can grant manage_users")
    roles = db.query(Role).filter(Role.name.in_(names)).all()
    missing = set(names) - {r.name for r in roles}
    if missing:
        raise HTTPException(status_code=422, detail=f"Unknown roles: {', '.join(sorted(missing))}")
    return roles


@router.get("", response_model=list[UserOut])
def list_users(
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_role("manage_users")),
) -> list[UserOut]:
    users = db.query(User).filter(User.is_superuser.is_(False)).order_by(User.username).all()
    return [UserOut.from_model(u) for u in users]


@router.post("", response_model=UserOut, status_code=201)
def create_user(
    body: UserCreate,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_role("manage_users")),
) -> UserOut:
    if db.query(User).filter(User.username == body.username).one_or_none() is not None:
        raise HTTPException(status_code=409, detail="Username already exists")

    roles = _resolve_roles(db, body.roles, principal)
    user = User(
        username=body.username,
        email=body.email,
        password_hash=hash_password(body.password),
        is_active=True,
        is_superuser=False,
        roles=roles,
    )
    db.add(user)
    db.commit()
    return UserOut.from_model(user)


@router.patch("/{user_id}", response_model=UserOut)
def patch_user(
    user_id: int,
    body: UserPatch,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_role("manage_users")),
) -> UserOut:
    user = _get_target_user(db, user_id)

    if body.username is not None and body.username != user.username:
        exists = db.query(User).filter(User.username == body.username).one_or_none()
        if exists is not None:
            raise HTTPException(status_code=409, detail="Username already exists")
        user.username = body.username

    if body.email is not None:
        user.email = body.email
    if body.password is not None:
        user.password_hash = hash_password(body.password)
    if body.is_active is not None:
        user.is_active = body.is_active

    db.commit()
    return UserOut.from_model(user)


@router.delete("/{user_id}", status_code=204)
def delete_user(
    user_id: int,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_role("manage_users")),
) -> None:
    user = _get_target_user(db, user_id)
    db.delete(user)
    db.commit()


@router.post("/{user_id}/roles/{role_name}", response_model=UserOut)
def assign_role(
    user_id: int,
    role_name: str,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_role("manage_users")),
) -> UserOut:
    user = _get_target_user(db, user_id)
    (role,) = _resolve_roles(db, [role_name], principal)
    if role not in user.roles:
        user.roles.append(role)
        db.commit()
    return UserOut.from_model(user)


@router.delete("/{user_id}/roles/{role_name}", response_model=UserOut)
def revoke_role(
    user_id: int,
    role_name: str,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_role("manage_users")),
) -> UserOut:
    user = _get_target_user(db, user_id)
    if role_name == "manage_users" and not principal.is_superuser:
        raise HTTPException(status_code=403, detail="Only the superuser can revoke manage_users")
    user.roles = [r for r in user.roles if r.name != role_name]
    db.commit()
    return UserOut.from_model(user)
