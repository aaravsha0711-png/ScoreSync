"""
routers/auth.py
POST /auth/register  — create a new user account
POST /auth/login     — return JWT access token
GET  /auth/me        — return current user info
"""

from fastapi import APIRouter, HTTPException, Depends, status
from pydantic import BaseModel, EmailStr, field_validator

from core.security import hash_password, verify_password, create_access_token
from core.deps import get_current_user
from db.database import get_conn

router = APIRouter(prefix="/auth", tags=["auth"])


# ── Schemas ───────────────────────────────────────────────────────────────────

class RegisterRequest(BaseModel):
    email: EmailStr
    name: str
    password: str

    @field_validator("password")
    @classmethod
    def password_strength(cls, v: str) -> str:
        if len(v) < 6:
            raise ValueError("Password must be at least 6 characters")
        return v

    @field_validator("name")
    @classmethod
    def name_nonempty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("Name cannot be empty")
        return v.strip()


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user_id: int
    email: str
    name: str


# ── Routes ────────────────────────────────────────────────────────────────────

@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
def register(body: RegisterRequest):
    with get_conn() as conn:
        existing = conn.execute(
            "SELECT id FROM users WHERE email = ?", (body.email,)
        ).fetchone()
        if existing:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="An account with that email already exists.",
            )

        cursor = conn.execute(
            "INSERT INTO users (email, name, hashed_pw) VALUES (?, ?, ?)",
            (body.email, body.name, hash_password(body.password)),
        )
        user_id = cursor.lastrowid

        # Create default profile row
        conn.execute(
            "INSERT INTO profiles (user_id, instrument, transposition) VALUES (?, ?, ?)",
            (user_id, "Concert (C)", 0),
        )

    token = create_access_token(body.email)
    return TokenResponse(
        access_token=token,
        user_id=user_id,
        email=body.email,
        name=body.name,
    )


@router.post("/login", response_model=TokenResponse)
def login(body: LoginRequest):
    with get_conn() as conn:
        row = conn.execute(
            "SELECT id, email, name, hashed_pw FROM users WHERE email = ?",
            (body.email,),
        ).fetchone()

    if not row or not verify_password(body.password, row["hashed_pw"]):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password.",
        )

    token = create_access_token(row["email"])
    return TokenResponse(
        access_token=token,
        user_id=row["id"],
        email=row["email"],
        name=row["name"],
    )


@router.get("/me")
def me(current_user: dict = Depends(get_current_user)):
    """Return the authenticated user's basic info and profile."""
    with get_conn() as conn:
        profile = conn.execute(
            "SELECT instrument, transposition, calibrated FROM profiles WHERE user_id = ?",
            (current_user["id"],),
        ).fetchone()

    return {
        **current_user,
        "profile": dict(profile) if profile else None,
    }
