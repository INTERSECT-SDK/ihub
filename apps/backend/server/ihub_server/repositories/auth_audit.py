"""Repository helpers for auth allowlist and audit logging."""

from sqlmodel import Session, select

from ihub_server.models import AuthorizedUser, LoginAuditLog


def get_active_authorized_user_by_email(session: Session, email: str) -> AuthorizedUser | None:
    statement = select(AuthorizedUser).where(
        AuthorizedUser.email == email,
        AuthorizedUser.is_active,
    )
    return session.exec(statement).first()


def ensure_authorized_user_exists(session: Session, email: str) -> AuthorizedUser:
    """Return existing user by email, or create an active one if missing."""
    statement = select(AuthorizedUser).where(AuthorizedUser.email == email)
    existing = session.exec(statement).first()
    if existing:
        if not existing.is_active:
            existing.is_active = True
            session.add(existing)
            session.commit()
            session.refresh(existing)
        return existing

    user = AuthorizedUser(email=email, is_active=True)
    session.add(user)
    session.commit()
    session.refresh(user)
    return user


def create_login_audit_log(session: Session, log_entry: LoginAuditLog) -> LoginAuditLog:
    session.add(log_entry)
    session.commit()
    session.refresh(log_entry)
    return log_entry
