"""Cookie-based JWT authentication endpoints."""
import os

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, EmailStr, field_validator

from database import get_conn
from deps import get_current_user
from security import create_access_token, hash_password, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])
COOKIE_NAME = "scoresync_token"
COOKIE_MAX_AGE = 60 * 60 * 24 * 7


class RegisterRequest(BaseModel):
    email: EmailStr
    name: str
    password: str

    @field_validator("password")
    @classmethod
    def password_strength(cls, value: str) -> str:
        if len(value) < 6:
            raise ValueError("Password must be at least 6 characters")
        return value

    @field_validator("name")
    @classmethod
    def name_nonempty(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Name cannot be empty")
        return value.strip()


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class AuthUserResponse(BaseModel):
    user_id: int
    email: str
    name: str


def _set_auth_cookie(response: Response, token: str):
    response.set_cookie(key=COOKIE_NAME, value=token, max_age=COOKIE_MAX_AGE, httponly=True, secure=os.environ.get("ENVIRONMENT", "").lower() == "production", samesite="lax", path="/")


@router.post("/register", response_model=AuthUserResponse, status_code=status.HTTP_201_CREATED)
def register(body: RegisterRequest, response: Response):
    with get_conn() as conn:
        existing = conn.execute("SELECT id FROM users WHERE email = ?", (body.email,)).fetchone()
        if existing:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="An account with that email already exists.")
        cursor = conn.execute("INSERT INTO users (email, name, hashed_pw) VALUES (?, ?, ?)", (body.email, body.name, hash_password(body.password)))
        user_id = cursor.lastrowid
        conn.execute("INSERT INTO profiles (user_id, instrument, transposition) VALUES (?, ?, ?)", (user_id, "Concert (C)", 0))
    _set_auth_cookie(response, create_access_token(body.email))
    return AuthUserResponse(user_id=user_id, email=body.email, name=body.name)


@router.post("/login", response_model=AuthUserResponse)
def login(body: LoginRequest, response: Response):
    with get_conn() as conn:
        row = conn.execute("SELECT id, email, name, hashed_pw FROM users WHERE email = ?", (body.email,)).fetchone()
    if not row or not verify_password(body.password, row["hashed_pw"]):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Incorrect email or password.")
    _set_auth_cookie(response, create_access_token(row["email"]))
    return AuthUserResponse(user_id=row["id"], email=row["email"], name=row["name"])


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(response: Response):
    response.delete_cookie(COOKIE_NAME, path="/")


@router.get("/me")
def me(current_user: dict = Depends(get_current_user)):
    with get_conn() as conn:
        profile = conn.execute("SELECT instrument, transposition, calibrated FROM profiles WHERE user_id = ?", (current_user["id"],)).fetchone()
    return {**current_user, "profile": dict(profile) if profile else None}
