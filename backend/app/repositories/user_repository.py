"""Data-access layer for User/Organization/Membership — no business logic here."""
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import Membership, Organization, User


class UserRepository:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_by_id(self, user_id: uuid.UUID) -> User | None:
        return await self.db.get(User, user_id)

    async def get_by_email(self, email: str) -> User | None:
        result = await self.db.execute(select(User).where(User.email == email))
        return result.scalar_one_or_none()

    async def create(self, user: User) -> User:
        self.db.add(user)
        await self.db.flush()
        return user

    async def create_organization(self, org: Organization) -> Organization:
        self.db.add(org)
        await self.db.flush()
        return org

    async def create_membership(self, membership: Membership) -> Membership:
        self.db.add(membership)
        await self.db.flush()
        return membership

    async def get_personal_organization(self, user_id: uuid.UUID) -> Organization | None:
        result = await self.db.execute(
            select(Organization)
            .join(Membership, Membership.organization_id == Organization.id)
            .where(Membership.user_id == user_id, Organization.is_personal.is_(True))
        )
        return result.scalar_one_or_none()
