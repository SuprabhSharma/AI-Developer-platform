"""Business logic for registration/login/refresh. Routes stay thin and call this."""
import uuid

from fastapi import HTTPException, status

from app.core.security import create_token, decode_token, hash_password, verify_password
from app.models.user import Membership, OrgRole, Organization, User
from app.repositories.user_repository import UserRepository
from app.schemas.auth import LoginRequest, RegisterRequest, TokenResponse


class AuthService:
    def __init__(self, user_repo: UserRepository):
        self.user_repo = user_repo

    async def register(self, payload: RegisterRequest) -> TokenResponse:
        existing = await self.user_repo.get_by_email(payload.email)
        if existing:
            raise HTTPException(status.HTTP_409_CONFLICT, "Email already registered")

        user = await self.user_repo.create(
            User(email=payload.email, hashed_password=hash_password(payload.password), full_name=payload.full_name)
        )

        # Every user gets a personal organization — the multi-tenancy anchor.
        org = await self.user_repo.create_organization(
            Organization(name=payload.full_name or payload.email, slug=f"personal-{uuid.uuid4().hex[:8]}", is_personal=True)
        )
        await self.user_repo.create_membership(Membership(user_id=user.id, organization_id=org.id, role=OrgRole.OWNER))

        return self._issue_tokens(user.id)

    async def login(self, payload: LoginRequest) -> TokenResponse:
        user = await self.user_repo.get_by_email(payload.email)
        if not user or not verify_password(payload.password, user.hashed_password):
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid credentials")
        if not user.is_active:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Account disabled")
        return self._issue_tokens(user.id)

    async def refresh(self, refresh_token: str) -> TokenResponse:
        claims = decode_token(refresh_token)
        if not claims or claims.get("type") != "refresh":
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid refresh token")
        return self._issue_tokens(uuid.UUID(claims["sub"]))

    def _issue_tokens(self, user_id: uuid.UUID) -> TokenResponse:
        return TokenResponse(
            access_token=create_token(user_id, "access"),
            refresh_token=create_token(user_id, "refresh"),
        )
