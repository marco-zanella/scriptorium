from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.auth.dependencies import Principal, require_role
from app.db.session import get_db
from app.eval.models import TestCollection
from app.search.models import SearchConfiguration

router = APIRouter(prefix="/api/search/configurations", tags=["search-configurations"])


class SearchConfigurationOut(BaseModel):
    id: int
    name: str
    weights: dict
    is_preset: bool

    @classmethod
    def from_model(cls, config: SearchConfiguration) -> "SearchConfigurationOut":
        return cls(
            id=config.id,
            name=config.name,
            weights=config.weights,
            is_preset=config.owner_id is None,
        )


class SearchConfigurationCreate(BaseModel):
    name: str
    weights: dict


@router.get("", response_model=list[SearchConfigurationOut])
def list_configurations(
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_role("use_search_engine")),
) -> list[SearchConfigurationOut]:
    configs = (
        db.query(SearchConfiguration)
        .filter(
            (SearchConfiguration.owner_id == principal.user_id)
            | (SearchConfiguration.owner_id.is_(None))
        )
        .order_by(SearchConfiguration.owner_id.is_(None).desc(), SearchConfiguration.name)
        .all()
    )
    return [SearchConfigurationOut.from_model(c) for c in configs]


def _global_name_exists(db: Session, name: str, exclude_id: int | None = None) -> bool:
    query = db.query(SearchConfiguration).filter(
        SearchConfiguration.owner_id.is_(None), SearchConfiguration.name == name
    )
    if exclude_id is not None:
        query = query.filter(SearchConfiguration.id != exclude_id)
    return query.first() is not None


@router.post("", response_model=SearchConfigurationOut, status_code=201)
def create_configuration(
    body: SearchConfigurationCreate,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_role("use_search_engine")),
) -> SearchConfigurationOut:
    if _global_name_exists(db, body.name):
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
    return SearchConfigurationOut.from_model(config)


def _get_editable_configuration(
    db: Session, configuration_id: int, principal: Principal
) -> SearchConfiguration:
    query = db.query(SearchConfiguration).filter(SearchConfiguration.id == configuration_id)
    if principal.is_superuser:
        query = query.filter(
            (SearchConfiguration.owner_id == principal.user_id)
            | (SearchConfiguration.owner_id.is_(None))
        )
    else:
        query = query.filter(SearchConfiguration.owner_id == principal.user_id)
    config = query.one_or_none()
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
    config = _get_editable_configuration(db, configuration_id, principal)

    if _global_name_exists(db, body.name, exclude_id=configuration_id):
        raise HTTPException(status_code=409, detail="Name conflicts with a built-in preset")
    exists = (
        db.query(SearchConfiguration)
        .filter(
            SearchConfiguration.owner_id == config.owner_id,
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
    return SearchConfigurationOut.from_model(config)


@router.delete("/{configuration_id}", status_code=204)
def delete_configuration(
    configuration_id: int,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_role("use_search_engine")),
) -> None:
    config = _get_editable_configuration(db, configuration_id, principal)
    referencing_count = (
        db.query(TestCollection)
        .filter(TestCollection.search_configuration_id == configuration_id)
        .count()
    )
    if referencing_count > 0:
        raise HTTPException(
            status_code=409,
            detail=f"Cannot delete this configuration because it's used by "
            f"{referencing_count} test collection(s)",
        )
    db.delete(config)
    db.commit()
