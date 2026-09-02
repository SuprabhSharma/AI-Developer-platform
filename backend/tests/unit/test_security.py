import uuid

from app.core.security import create_token, decode_token, hash_password, verify_password


def test_password_hashing_roundtrip():
    hashed = hash_password("s3cret-pw")
    assert verify_password("s3cret-pw", hashed)
    assert not verify_password("wrong", hashed)


def test_token_roundtrip():
    user_id = uuid.uuid4()
    token = create_token(user_id, "access")
    claims = decode_token(token)
    assert claims is not None
    assert claims["sub"] == str(user_id)
    assert claims["type"] == "access"


def test_invalid_token_returns_none():
    assert decode_token("not-a-real-token") is None
