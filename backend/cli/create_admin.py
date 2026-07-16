import argparse

from app.auth.bootstrap import create_or_reset_admin
from app.db.session import SessionLocal


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Create or reset the single Scriptorium superuser account."
    )
    parser.add_argument("--username", required=True)
    parser.add_argument("--email", required=True)
    parser.add_argument("--password", required=True)
    args = parser.parse_args()

    with SessionLocal() as db:
        admin = create_or_reset_admin(db, args.username, args.email, args.password)
        print(f"Superuser '{admin.username}' ready (id={admin.id}).")


if __name__ == "__main__":
    main()
