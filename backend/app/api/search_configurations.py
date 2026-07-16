from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.auth.dependencies import Principal, require_role
from app.db.session import get_db
from app.search.models import SearchConfiguration
from app.search.presets import PRESETS

router = APIRouter(prefix="/api/search/configurations", tags=["search-configurations"])


class SearchConfigurationOut(BaseModel):
    id: int | None
    name: str
    weights: dict
    is_preset: bool


class SearchConfigurationCreate(BaseModel):
    name: str
    weights: dict


@router.get("", response_model=list[SearchConfigurationOut])
def list_configurations(
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_role("use_search_engine")),
) -> list[SearchConfigurationOut]:
    presets = [
        SearchConfigurationOut(id=None, name=name, weights=weights, is_preset=True)
        for name, weights in PRESETS.items()
    ]
    own = (
        db.query(SearchConfiguration)
        .filter(SearchConfiguration.owner_id == principal.user_id)
        .order_by(SearchConfiguration.name)
        .all()
    )
    saved = [
        SearchConfigurationOut(id=c.id, name=c.name, weights=c.weights, is_preset=False)
        for c in own
    ]
    return presets + saved


@router.post("", response_model=SearchConfigurationOut, status_code=201)
def create_configuration(
    body: SearchConfigurationCreate,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_role("use_search_engine")),
) -> SearchConfigurationOut:
    if body.name in PRESETS:
        raise HTTPException(status_code=409, detail="Name conflicts with a built-in preset")
    exists = (
        db.query(SearchConfiguration)
        .filter(
            SearchConfiguration.owner_id == principal.user_id,
            SearchConfiguration.name == body.name,
        )
        .one_or_none()
    )
    if exists is not None:
        raise HTTPException(status_code=409, detail="Configuration name already exists")

    config = SearchConfiguration(owner_id=principal.user_id, name=body.name, weights=body.weights)
    db.add(config)
    db.commit()
    return SearchConfigurationOut(
        id=config.id, name=config.name, weights=config.weights, is_preset=False
    )


def _get_own_configuration(
    db: Session, configuration_id: int, owner_id: int
) -> SearchConfiguration:
    config = (
        db.query(SearchConfiguration)
        .filter(
            SearchConfiguration.id == configuration_id,
            SearchConfiguration.owner_id == owner_id,
        )
        .one_or_none()
    )
    if config is None:
        raise HTTPException(status_code=404, detail="Configuration not found")
    return config


@router.patch("/{configuration_id}", response_model=SearchConfigurationOut)
def update_configuration(
    configuration_id: int,
    body: SearchConfigurationCreate,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_role("use_search_engine")),
) -> SearchConfigurationOut:
    config = _get_own_configuration(db, configuration_id, principal.user_id)

    if body.name in PRESETS:
        raise HTTPException(status_code=409, detail="Name conflicts with a built-in preset")
    exists = (
        db.query(SearchConfiguration)
        .filter(
            SearchConfiguration.owner_id == principal.user_id,
            SearchConfiguration.name == body.name,
            SearchConfiguration.id != configuration_id,
        )
        .one_or_none()
    )
    if exists is not None:
        raise HTTPException(status_code=409, detail="Configuration name already exists")

    config.name = body.name
    config.weights = body.weights
    db.commit()
    return SearchConfigurationOut(
        id=config.id, name=config.name, weights=config.weights, is_preset=False
    )


@router.delete("/{configuration_id}", status_code=204)
def delete_configuration(
    configuration_id: int,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_role("use_search_engine")),
) -> None:
    config = _get_own_configuration(db, configuration_id, principal.user_id)
    db.delete(config)
    db.commit()
